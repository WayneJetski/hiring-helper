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
  assert.ok(args.includes('Skill') && args.includes('mcp__hiring-helper__save_evaluation'));
  assert.ok(!args.includes('mcp__hiring-helper__*'), 'no wildcard: each tool is named');
  assert.ok(args.includes('--strict-mcp-config'), 'only the hiring-helper server is loaded');
  assert.equal(args[args.indexOf('--tools') + 1], 'Skill', 'the built-in tools are removed, not just unapproved');
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
  assert.ok(args.includes('Skill') && args.includes('mcp__hiring-helper__save_evaluation'));
  assert.ok(args.includes('--strict-mcp-config'));
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
  assert.match(status.error ?? '', /Claude Code reported a problem/);
  assert.doesNotMatch(status.error ?? '', /boom/);
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
  assert.match(service.getStatus().error ?? '', /not signed in.*Sign in to Claude/);
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

// ---- batching ----

import { chunkIds, SCORING_BATCH_SIZE } from './scoring.service.js';

/** A service whose every spawn returns a new fake child, so batches can be driven one by one. */
function makeBatchingService(): { service: ScoringService; children: FakeChild[]; prompts: string[] } {
  const children: FakeChild[] = [];
  const prompts: string[] = [];
  const spawnFn: SpawnFn = (_command, args) => {
    const child = new FakeChild();
    children.push(child);
    prompts.push(args[1]);
    return child as unknown as ChildProcess;
  };
  return { service: new ScoringService(spawnFn, fakeJobsRepo), children, prompts };
}

const saveCall = {
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'mcp__hiring-helper__save_evaluation' }] },
};

test('chunkIds splits into consecutive batches and keeps order', () => {
  assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkIds([], 2), []);
  assert.equal(chunkIds(Array.from({ length: 30 }, (_, i) => i)).length, Math.ceil(30 / SCORING_BATCH_SIZE));
});

test('a long id list runs as sequential batches, each a fresh claude session', () => {
  const { service, children, prompts } = makeBatchingService();
  const ids = Array.from({ length: SCORING_BATCH_SIZE + 3 }, (_, i) => 1000 + i);
  service.start({ jobId: 45, applicationIds: ids, total: ids.length, isRescore: false });

  // Only the first batch is running.
  assert.equal(children.length, 1);
  assert.match(prompts[0], new RegExp(`these ${SCORING_BATCH_SIZE} application IDs`));
  assert.match(prompts[0], /none has a score yet/);
  assert.equal(prompts[0].includes(String(ids[SCORING_BATCH_SIZE])), false);

  children[0].emitLine(saveCall);
  children[0].emitLine({ type: 'result', is_error: false, result: 'batch one done' });

  // The next batch started; the run as a whole is still going and progress carries over.
  assert.equal(children.length, 2);
  assert.equal(service.getStatus().running, true);
  assert.equal(service.getStatus().scored, 1);
  assert.match(prompts[1], /these 3 application IDs/);
  assert.match(prompts[1], new RegExp(String(ids[SCORING_BATCH_SIZE])));

  // The finished first child closing must not be mistaken for a crash of the second.
  children[0].emit('close', 0);
  assert.equal(service.getStatus().running, true);

  children[1].emitLine(saveCall);
  children[1].emitLine({ type: 'result', is_error: false, result: 'batch two done' });
  const status = service.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.ok, true);
  assert.equal(status.scored, 2);
  assert.match(status.message ?? '', /2 candidates in 2 batches/);
});

test('an error in one batch stops the remaining batches', () => {
  const { service, children } = makeBatchingService();
  const ids = Array.from({ length: SCORING_BATCH_SIZE * 2 }, (_, i) => i + 1);
  service.start({ jobId: 45, applicationIds: ids });

  children[0].emitLine({ type: 'result', is_error: true, result: 'boom' });

  assert.equal(children.length, 1, 'no further batch is started');
  const status = service.getStatus();
  assert.equal(status.running, false);
  assert.equal(status.ok, false);
  assert.match(status.error ?? '', /Claude Code reported a problem/);
  assert.doesNotMatch(status.error ?? '', /boom/);
});

test('cancelling mid-run does not start the remaining batches', () => {
  const { service, children } = makeBatchingService();
  const ids = Array.from({ length: SCORING_BATCH_SIZE * 2 }, (_, i) => i + 1);
  service.start({ jobId: 45, applicationIds: ids });

  assert.equal(service.cancel(), true);
  children[0].emitLine({ type: 'result', is_error: false, result: 'late' });

  assert.equal(children.length, 1);
  assert.equal(service.getStatus().cancelled, true);
});
