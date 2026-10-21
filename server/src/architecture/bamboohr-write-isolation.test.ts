/**
 * Structural guarantee: nothing that handles applicant-supplied content can change
 * anything in BambooHR.
 *
 * Résumés and application answers are written by strangers and are read by Claude
 * through the MCP server. A malicious résumé can try to talk Claude into doing
 * things, so the only protection that counts is that the capability does not exist
 * in that process. These tests read the source and fail when that stops being true.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_ENTRY = join(SRC_DIR, 'mcp/index.ts');
const WRITER_MODULE = join(SRC_DIR, 'services/bamboohr-status-writer.service.ts');
const PUSH_MODULE = join(SRC_DIR, 'services/bamboo-push.service.ts');
const HTTP_MODULE = join(SRC_DIR, 'services/bamboohr-http.ts');

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) return listSourceFiles(fullPath);
    const isProductionSource = fullPath.endsWith('.ts') && !fullPath.endsWith('.test.ts');
    return isProductionSource ? [fullPath] : [];
  });
}

/** Relative `.js` import specifiers in a file, resolved to the `.ts` files they name. */
function localImportsOf(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf-8');
  const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)].map(
    (match) => match[1]
  );
  return specifiers.map((specifier) =>
    resolve(dirname(filePath), specifier).replace(/\.js$/, '.ts')
  );
}

function transitiveImportsOf(entryFile: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entryFile];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...localImportsOf(current));
  }
  return seen;
}

function describe(files: Iterable<string>): string[] {
  return [...files].map((file) => relative(SRC_DIR, file)).sort();
}

test('the MCP server cannot reach the BambooHR status writer or the push service', () => {
  const reachable = transitiveImportsOf(MCP_ENTRY);
  assert.ok(reachable.size > 10, 'import walk should find the MCP server graph');

  assert.equal(reachable.has(WRITER_MODULE), false, 'MCP must not import the status writer');
  assert.equal(reachable.has(PUSH_MODULE), false, 'MCP must not import the push service');

  const controllersAndRoutes = [...reachable].filter((file) =>
    /\/(controllers|routes)\//.test(file)
  );
  assert.deepEqual(describe(controllersAndRoutes), [], 'MCP must not import REST controllers');
});

test('only the push service imports the status writer', () => {
  const importers = listSourceFiles(SRC_DIR).filter(
    (file) => file !== WRITER_MODULE && localImportsOf(file).includes(WRITER_MODULE)
  );
  assert.deepEqual(describe(importers), ['services/bamboo-push.service.ts']);
});

test('only the status writer sends a non-GET request to BambooHR', () => {
  const writeCall = /\.(?:post|put|patch|delete|request)\s*\(/;
  const usesBambooHRClient = (source: string): boolean =>
    /BambooHRClientProvider|bamboohr-http/.test(source);

  const offenders = listSourceFiles(SRC_DIR).filter((file) => {
    if (file === WRITER_MODULE || file === HTTP_MODULE) return false;
    const source = readFileSync(file, 'utf-8');
    return usesBambooHRClient(source) && writeCall.test(source);
  });
  assert.deepEqual(describe(offenders), []);
});

test('the write method exists in exactly one class', () => {
  const definitions = listSourceFiles(SRC_DIR).filter((file) =>
    /async\s+updateApplicationStatus\s*\(/.test(readFileSync(file, 'utf-8'))
  );
  assert.deepEqual(describe(definitions), ['services/bamboohr-status-writer.service.ts']);
});

/** The only production files allowed to make outbound HTTP requests, and why. */
const OUTBOUND_HTTP_ALLOW_LIST = [
  'services/bamboohr-http.ts', // every authenticated BambooHR call, with the access policy
  'services/setup.service.ts', // one GET to test a key typed on the setup screen
  'services/job-posting-fetcher.ts', // GET of the public careers page
];

test('outbound HTTP is made only by the reviewed files, and those send only GET (or the policed status POST)', () => {
  const outbound = listSourceFiles(SRC_DIR).filter((file) =>
    /^import (?!type)[^\n]*from 'axios'|require\('axios'\)|[^a-zA-Z.]fetch\(|fetchFn\(|node:https?'|from 'https?'/m.test(
      readFileSync(file, 'utf-8')
    )
  );
  assert.deepEqual(describe(outbound), [...OUTBOUND_HTTP_ALLOW_LIST].sort());

  for (const relativePath of ['services/setup.service.ts', 'services/job-posting-fetcher.ts']) {
    const source = readFileSync(join(SRC_DIR, relativePath), 'utf-8');
    assert.equal(/\.(post|put|patch|delete|request)\s*\(/.test(source), false, relativePath);
    assert.equal(/method\s*:\s*['"](?!GET)/i.test(source), false, relativePath);
  }
});
