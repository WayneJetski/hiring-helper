/**
 * Unit tests for ScoringService. Uses a fake spawn (no real `claude` process)
 * and a fake JobsRepository, so nothing is scored and no CLI is required.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { ScoringService, type SpawnFn } from './scoring.service.js';
import type { JobsRepository } from '../repositories/jobs.repository.js';
import type { ChildProcess } from 'node:child_process';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killedWith: string | null = null;
  kill(signal: string): boolean {
    this.killedWith = signal;
    return true;
  }
  emitLine(obj: unknown): void {
    this.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'));
  }
}

const fakeJobsRepo = {
  getById: (id: number) => ({ id, title: 'Software Engineer' }),
} as unknown as JobsRepository;

function makeService(): { service: ScoringService; child: FakeChild; captured: { command?: string; args?: string[]; cwd?: unknown } } {
  const captured: { command?: string; args?: string[]; cwd?: unknown } = {};
  const child = new FakeChild();
  const spawnFn: SpawnFn = (command, args, options) => {
    captured.command = command;
    captured.args = args;
    captured.cwd = options.cwd;
    return child as unknown as ChildProcess;
  };
  return { service: new ScoringService(spawnFn, fakeJobsRepo), child, captured };
}

test('spawns claude with a tight allowlist and job-scoped prompt', () => {
  const { service, captured } = makeService();
  const res = service.start({ jobId: 45 });

  assert.equal(res.started, true);
  assert.equal(captured.command, 'claude');
  const args = captured.args ?? [];
  assert.equal(args[0], '-p');
  assert.match(args[1], /job 45/);
  assert.match(args[1], /score-candidates/);
  assert.ok(args.includes('--output-format') && args.includes('stream-json'));
  assert.ok(args.includes('--verbose'));
  assert.ok(args.includes('--allowedTools'));
  assert.ok(args.includes('Skill') && args.includes('mcp__hiring-helper__*'));
  // A model is pinned (default Sonnet 5) rather than inheriting the caller's.
  const modelIdx = args.indexOf('--model');
  assert.ok(modelIdx !== -1 && typeof args[modelIdx + 1] === 'string' && args[modelIdx + 1].length > 0);
  // Safety: no arbitrary shell/file tools are ever allowed.
  for (const forbidden of ['Bash', 'Write', 'Edit']) {
    assert.ok(!args.includes(forbidden), `must not allow ${forbidden}`);
  }
  assert.equal(typeof captured.cwd, 'string');
});

test('re-score mode names the explicit IDs and overwrites, via the skill rubric', () => {
  const { service, captured } = makeService();
  const res = service.start({ jobId: 45, applicationIds: [101, 102] });

  assert.equal(res.started, true);
  const prompt = (captured.args ?? [])[1] ?? '';
  assert.match(prompt, /re-score/i);
  assert.match(prompt, /101/);
  assert.match(prompt, /102/);
  assert.match(prompt, /get_system_prompt/);
  // Still the same tight sandbox.
  const args = captured.args ?? [];
  assert.ok(args.includes('Skill') && args.includes('mcp__hiring-helper__*'));
});

test('counts save_evaluation calls as progress and finishes on the result event', () => {
  const { service, child } = makeService();
  service.start({ jobId: 45 });
  assert.equal(service.getStatus().running, true);

  child.emitLine({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'mcp__hiring-helper__save_evaluation' }] },
  });
  child.emitLine({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'mcp__hiring-helper__save_evaluation' }] },
  });
  assert.equal(service.getStatus().scored, 2);

  child.emitLine({ type: 'result', is_error: false, result: 'Scored 2 candidates.' });
  const status = service.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.ok, true);
  assert.equal(status.scored, 2);
  assert.equal(status.message, 'Scored 2 candidates.');
  assert.ok(status.finishedAt);
});

test('single-flight: a second start while running is a no-op', () => {
  const { service, child } = makeService();
  service.start({ jobId: 45 });
  const second = service.start({ jobId: 45 });
  assert.equal(second.started, false);
  assert.equal(second.alreadyRunning, true);
  // First run can still complete normally.
  child.emitLine({ type: 'result', is_error: false, result: 'done' });
  assert.equal(service.getStatus().running, false);
});

test('a result error is surfaced', () => {
  const { service, child } = makeService();
  service.start({ jobId: 45 });
  child.emitLine({ type: 'result', is_error: true, result: 'boom' });
  const status = service.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.ok, false);
  assert.equal(status.error, 'boom');
});

test('a not-signed-in result tells the user to sign in from Setup', () => {
  const { service, child } = makeService();
  service.start({ jobId: 45 });
  child.emitLine({ type: 'result', is_error: true, result: 'Not logged in · Please run /login' });
  const status = service.getStatus();
  assert.equal(status.ok, false);
  assert.match(status.error ?? '', /Sign in to Claude/);
});

test('exit without a result event is a failure', () => {
  const { service, child } = makeService();
  service.start({ jobId: 45 });
  child.stderr.emit('data', Buffer.from('some stderr'));
  child.emit('close', 1);
  const status = service.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.ok, false);
  assert.match(status.error ?? '', /without completing/);
});

test('missing CLI (spawn throws ENOENT) yields a helpful error', () => {
  const spawnFn: SpawnFn = () => {
    throw new Error('spawn claude ENOENT');
  };
  const service = new ScoringService(spawnFn, fakeJobsRepo);
  const res = service.start({ jobId: 45 });
  assert.equal(res.started, false);
  const status = service.getStatus();
  assert.equal(status.ok, false);
  assert.match(status.error ?? '', /not found on PATH/);
});

test('a run that fails with a login problem points the user to sign in', () => {
  const { service, child } = makeService();
  service.start({ jobId: 45 });
  child.stderr.emit('data', Buffer.from('Invalid API key. Please run /login'));
  child.emit('close', 1);
  assert.match(service.getStatus().error ?? '', /not be signed in.*Sign in to Claude/);
});

test('reports the total it set out to score so the UI can show progress', () => {
  const { service } = makeService();
  service.start({ jobId: 45, total: 23 });
  assert.equal(service.getStatus().total, 23);
  assert.equal(service.getStatus().scored, 0);
});

test('cancel stops the run, keeps the count, and marks it cancelled', () => {
  const { service, child } = makeService();
  service.start({ jobId: 45, total: 10 });
  child.emitLine({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'mcp__hiring-helper__save_evaluation' }] },
  });

  assert.equal(service.cancel(), true);

  const status = service.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.cancelled, true);
  assert.equal(status.scored, 1);
  assert.equal(child.killedWith, 'SIGTERM');

  // The killed process exiting afterwards must not overwrite the cancelled state.
  child.emit('close', null);
  assert.equal(service.getStatus().cancelled, true);
  assert.match(service.getStatus().error ?? '', /cancelled/);
});

test('cancel does nothing when no run is active', () => {
  const { service } = makeService();
  assert.equal(service.cancel(), false);
});
