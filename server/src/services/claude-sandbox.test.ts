/**
 * What an unattended Claude Code run is allowed to touch.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCORING_MCP_TOOLS,
  projectMcpConfig,
  WITHHELD_MCP_TOOLS,
  claudeChildEnvironment,
  scoringSandboxArguments,
} from './claude-sandbox.js';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = resolve(SRC_DIR, '../..');

/** Tool names registered by the MCP server, read from its source. */
function registeredMcpToolNames(): string[] {
  const files = ['read.tools.ts', 'write.tools.ts', 'ingest.tools.ts'];
  return files.flatMap((file) => {
    const source = readFileSync(resolve(SRC_DIR, 'mcp/tools', file), 'utf-8');
    return [...source.matchAll(/^\s*'([a-z_]+)',\s*$/gm)].map((match) => match[1]);
  });
}

test('a scoring run keeps only the Skill built-in and loads only the project MCP config', () => {
  const args = scoringSandboxArguments(PROJECT_ROOT);
  assert.equal(args[args.indexOf('--tools') + 1], 'Skill');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.deepEqual(
    Object.keys(JSON.parse(args[args.indexOf('--mcp-config') + 1]).mcpServers),
    ['hiring-helper']
  );
  // Variadic, so it must come last or it would swallow the flags after it.
  assert.equal(args.indexOf('--allowedTools') < args.length - 1, true);
  assert.equal(args.slice(args.indexOf('--allowedTools') + 1).some((arg) => arg.startsWith('--')), false);
});

test('every registered MCP tool is either allowed or withheld from a scoring run', () => {
  const registered = registeredMcpToolNames();
  assert.ok(registered.includes('save_evaluation'), 'the tool scan should find the real tools');

  const classified = [...SCORING_MCP_TOOLS, ...WITHHELD_MCP_TOOLS].map((tool) =>
    tool.replace('mcp__hiring-helper__', '')
  );
  assert.deepEqual([...classified].sort(), [...registered].sort());
});

test('a scoring run cannot rewrite the posting, sync, or browse other candidates', () => {
  const args = scoringSandboxArguments(PROJECT_ROOT);
  const denied = args.slice(args.indexOf('--disallowedTools') + 1, args.indexOf('--allowedTools'));
  for (const tool of ['save_job_posting', 'sync_from_bamboohr', 'list_applicants']) {
    assert.ok(denied.includes(`mcp__hiring-helper__${tool}`), tool);
  }
  assert.equal(SCORING_MCP_TOOLS.some((tool) => denied.includes(tool)), false);
});

test('the BambooHR API key is not passed to Claude Code', () => {
  const environment = claudeChildEnvironment({
    PATH: '/usr/bin',
    HOME: '/home/someone',
    BAMBOOHR_API_KEY: 'secret',
    BAMBOOHR_SUBDOMAIN: 'acme',
  });
  assert.equal('BAMBOOHR_API_KEY' in environment, false);
  assert.equal(environment.PATH, '/usr/bin');
  assert.equal(environment.HOME, '/home/someone');
});

test('building the child environment does not change the server\'s own', () => {
  const parent = { BAMBOOHR_API_KEY: 'secret' };
  claudeChildEnvironment(parent);
  assert.equal(parent.BAMBOOHR_API_KEY, 'secret');
});

test('a batch is passed to the MCP server so it refuses every other application', () => {
  const config = JSON.parse(projectMcpConfig(PROJECT_ROOT, [101, 102])) as {
    mcpServers: Record<string, { env?: Record<string, string> }>;
  };
  assert.equal(config.mcpServers['hiring-helper'].env?.HIRING_HELPER_SCORING_SCOPE, '101,102');

  const args = scoringSandboxArguments(PROJECT_ROOT, [101, 102]);
  assert.match(args[args.indexOf('--mcp-config') + 1], /HIRING_HELPER_SCORING_SCOPE/);
});

test('without ids the MCP server is left unscoped', () => {
  const config = JSON.parse(projectMcpConfig(PROJECT_ROOT)) as {
    mcpServers: Record<string, { env?: Record<string, string> }>;
  };
  assert.equal(config.mcpServers['hiring-helper'].env, undefined);
});

test('the MCP server runs on the same Node as this server, not whichever is first on PATH', () => {
  // Regression: a Homebrew Node ahead of an nvm Node on the child's PATH crashed
  // better-sqlite3 (NODE_MODULE_VERSION mismatch), so no tools loaded and 0 were scored.
  const config = JSON.parse(projectMcpConfig(PROJECT_ROOT, [1])) as {
    mcpServers: Record<string, { command: string }>;
  };
  assert.equal(config.mcpServers['hiring-helper'].command, process.execPath);
});
