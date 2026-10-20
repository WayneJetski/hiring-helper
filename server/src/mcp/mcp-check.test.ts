import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_TOOL_NAMES,
  checkMcpServer,
  diagnoseServerLog,
  isServerPreApproved,
  parseMcpLaunchConfig,
  type McpLaunchConfig,
} from './mcp-check.js';

const here = dirname(fileURLToPath(import.meta.url));
const fakeServerPath = join(here, 'test-fixtures', 'fake-mcp-server.mjs');

function fakeServerExposing(toolNames: readonly string[]): McpLaunchConfig {
  return {
    command: process.execPath,
    args: [fakeServerPath],
    env: { FAKE_TOOLS: toolNames.join(',') },
  };
}

describe('parseMcpLaunchConfig', () => {
  it('reads the command and arguments of the named server', () => {
    const text = JSON.stringify({
      mcpServers: { 'hiring-helper': { command: 'node', args: ['--import', 'tsx', 'a.ts'] } },
    });
    assert.deepEqual(parseMcpLaunchConfig(text), {
      command: 'node',
      args: ['--import', 'tsx', 'a.ts'],
    });
  });

  it('says so when the server is not registered', () => {
    assert.throws(() => parseMcpLaunchConfig('{"mcpServers":{}}'), /no "hiring-helper" server/);
  });

  it('says so when the file is not JSON', () => {
    assert.throws(() => parseMcpLaunchConfig('{oops'), /not valid JSON/);
  });

  it('rejects an entry without a command', () => {
    const text = JSON.stringify({ mcpServers: { 'hiring-helper': { args: [] } } });
    assert.throws(() => parseMcpLaunchConfig(text), /no command/);
  });
});

describe('isServerPreApproved', () => {
  it('is true when the server is listed', () => {
    assert.equal(isServerPreApproved('{"enabledMcpjsonServers":["hiring-helper"]}'), true);
  });

  it('is false when it is not listed, or the file is unusable', () => {
    assert.equal(isServerPreApproved('{"enabledMcpjsonServers":["other"]}'), false);
    assert.equal(isServerPreApproved('{}'), false);
    assert.equal(isServerPreApproved(''), false);
  });
});

describe('diagnoseServerLog', () => {
  it('explains a native module built for another Node.js version', () => {
    const log = 'was compiled against a different Node.js version using NODE_MODULE_VERSION 127';
    assert.match(diagnoseServerLog(log) ?? '', /npm rebuild better-sqlite3/);
  });

  it('has no advice for errors it does not recognise', () => {
    assert.equal(diagnoseServerLog('database is locked'), undefined);
  });
});

describe('checkMcpServer', () => {
  it('is ready when the server exposes every tool scoring needs', async () => {
    const result = await checkMcpServer(fakeServerExposing(REQUIRED_TOOL_NAMES), {
      workingDirectory: here,
    });
    assert.equal(result.isReady, true);
    assert.deepEqual([...result.toolNames].sort(), [...REQUIRED_TOOL_NAMES].sort());
  });

  it('names the tools that are missing', async () => {
    const result = await checkMcpServer(fakeServerExposing(['get_resume_text']), {
      workingDirectory: here,
    });
    assert.equal(result.isReady, false);
    assert.match(result.failureReason ?? '', /missing tools: .*save_evaluation/);
  });

  it('reports a server that exits at start-up, with what it printed', async () => {
    const result = await checkMcpServer(
      {
        command: process.execPath,
        args: ['-e', 'console.error("database is locked"); process.exit(1)'],
      },
      { workingDirectory: here }
    );
    assert.equal(result.isReady, false);
    assert.match(result.failureReason ?? '', /could not be started/);
    assert.match(result.serverLogTail, /database is locked/);
  });

  it('adds advice when the server dies on a Node.js version mismatch', async () => {
    const result = await checkMcpServer(
      {
        command: process.execPath,
        args: ['-e', 'console.error("NODE_MODULE_VERSION 127 vs 137"); process.exit(1)'],
      },
      { workingDirectory: here }
    );
    assert.match(result.failureReason ?? '', /npm rebuild better-sqlite3/);
  });

  it('reports a command that does not exist', async () => {
    const result = await checkMcpServer(
      { command: 'hiring-helper-no-such-command', args: [] },
      { workingDirectory: here }
    );
    assert.equal(result.isReady, false);
    assert.match(result.failureReason ?? '', /could not be started/);
  });

  it('gives up on a server that never answers', async () => {
    const result = await checkMcpServer(
      { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
      { workingDirectory: here, timeoutMs: 500 }
    );
    assert.equal(result.isReady, false);
    assert.match(result.failureReason ?? '', /did not answer/);
  });
});
