/**
 * What an unattended Claude Code run is allowed to touch.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SCORING_MCP_TOOLS,
  scopedMcpConfig,
  WITHHELD_MCP_TOOLS,
  claudeChildEnvironment,
  scoringSandboxArguments,
} from './claude-sandbox.js';

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Tool names registered by the MCP server, read from its source. */
function registeredMcpToolNames(): string[] {
  const files = ['read.tools.ts', 'write.tools.ts', 'ingest.tools.ts'];
  return files.flatMap((file) => {
    const source = readFileSync(resolve(SRC_DIR, 'mcp/tools', file), 'utf-8');
    return [...source.matchAll(/^\s*'([a-z_]+)',\s*$/gm)].map((match) => match[1]);
  });
}

test('a scoring run keeps only the Skill built-in and loads only the project MCP config', () => {
  const args = scoringSandboxArguments('/repo');
  assert.equal(args[args.indexOf('--tools') + 1], 'Skill');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--mcp-config') + 1], join('/repo', '.mcp.json'));
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
  const args = scoringSandboxArguments('/repo');
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
  const root = resolve(SRC_DIR, '../..');
  const config = JSON.parse(scopedMcpConfig(root, [101, 102])) as {
    mcpServers: Record<string, { command: string; env?: Record<string, string> }>;
  };
  const server = config.mcpServers['hiring-helper'];
  assert.equal(server.command, 'node', 'the project definition is kept');
  assert.equal(server.env?.HIRING_HELPER_SCORING_SCOPE, '101,102');

  const args = scoringSandboxArguments(root, [101, 102]);
  assert.match(args[args.indexOf('--mcp-config') + 1], /HIRING_HELPER_SCORING_SCOPE/);
  assert.match(scoringSandboxArguments(root)[scoringSandboxArguments(root).indexOf('--mcp-config') + 1], /\.mcp\.json$/);
});
