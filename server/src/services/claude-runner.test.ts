/**
 * Tests for ClaudeRunner using a fake child process (no CLI, no network).
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { ClaudeRunCancelledError, ClaudeRunError, ClaudeRunner, type SpawnFn } from './claude-runner.js';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killedWith: string | null = null;
  kill(signal: string): boolean {
    this.killedWith = signal;
    return true;
  }
  reply(json: unknown, code = 0): void {
    this.stdout.emit('data', Buffer.from(typeof json === 'string' ? json : JSON.stringify(json)));
    this.emit('close', code);
  }
}

function setup(timeoutMs?: number): { runner: ClaudeRunner; child: FakeChild; captured: { args?: string[]; cwd?: unknown } } {
  const child = new FakeChild();
  const captured: { args?: string[]; cwd?: unknown } = {};
  const spawnFn: SpawnFn = (_command, args, options) => {
    captured.args = args;
    captured.cwd = options.cwd;
    return child as unknown as ChildProcess;
  };
  return { runner: new ClaudeRunner(spawnFn, { model: 'test-model', timeoutMs }), child, captured };
}

test('sends the prompt to the CLI with the chosen model and returns the reply text', async () => {
  const { runner, child, captured } = setup();
  const pending = runner.run('Hello there');
  child.reply({ type: 'result', is_error: false, result: '{"ok":true}' });

  assert.equal(await pending, '{"ok":true}');
  assert.deepEqual(captured.args, [
    '-p',
    'Hello there',
    '--model',
    'test-model',
    '--output-format',
    'json',
    '--tools',
    '',
    '--strict-mcp-config',
  ]);
  assert.notEqual(captured.cwd, process.cwd(), 'runs outside the project so its instructions are not loaded');
});

test('an error reported by Claude Code is reworded for the user', async () => {
  const { runner, child } = setup();
  const pending = runner.run('x');
  child.reply({ is_error: true, result: 'Credit balance is too low' });
  await assert.rejects(pending, (error: Error) => error instanceof ClaudeRunError && /billing/.test(error.message) && !/Credit balance is too low/.test(error.message));
});

test('a non-zero exit explains how to sign in when the output looks like a login problem', async () => {
  const { runner, child } = setup();
  const pending = runner.run('x');
  child.stderr.emit('data', Buffer.from('Invalid API key. Please run /login'));
  child.emit('close', 1);
  await assert.rejects(pending, /may not be signed in/);
});

test('a signed-out CLI (exit 1 with its message in the JSON) tells the user to sign in from Setup', async () => {
  const { runner, child } = setup();
  const pending = runner.run('x');
  child.reply({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' }, 1);
  await assert.rejects(pending, (error: Error) => {
    assert.ok(error instanceof ClaudeRunError);
    assert.match(error.message, /Sign in to Claude/);
    return true;
  });
});

test('unreadable output is reported rather than thrown raw', async () => {
  const { runner, child } = setup();
  const pending = runner.run('x');
  child.reply('definitely not json');
  await assert.rejects(pending, /could not be read/);
});

test('a missing CLI gives an install message', async () => {
  const spawnFn: SpawnFn = () => {
    throw new Error('spawn claude ENOENT');
  };
  await assert.rejects(new ClaudeRunner(spawnFn).run('x'), /not found on this computer/);
});

test('aborting stops the process and rejects as cancelled', async () => {
  const { runner, child } = setup();
  const controller = new AbortController();
  const pending = runner.run('x', controller.signal);
  controller.abort();
  await assert.rejects(pending, ClaudeRunCancelledError);
  assert.equal(child.killedWith, 'SIGTERM');
});

test('an already-cancelled request never starts a process', async () => {
  const { runner, captured } = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runner.run('x', controller.signal), ClaudeRunCancelledError);
  assert.equal(captured.args, undefined);
});

test('a run that takes too long is stopped with a plain message', async () => {
  const { runner, child } = setup(20);
  await assert.rejects(runner.run('x'), /taking too long/);
  assert.equal(child.killedWith, 'SIGTERM');
});
