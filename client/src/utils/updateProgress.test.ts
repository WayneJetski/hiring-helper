import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESTART_WAIT_LIMIT_MS, interpretUpdatePoll } from './updateProgress.js';
import type { UpdateStatus } from '../types/applicant.types.js';

function statusWith(apply: Partial<UpdateStatus['apply']>, currentCommit = 'aaaaaaa'): UpdateStatus {
  return {
    currentVersion: '2.0.0',
    currentCommit,
    branch: 'main',
    isManagedInstall: true,
    update: { available: false, latestCommit: null, compareUrl: null, checkedAt: null, error: null },
    apply: { state: 'idle', step: null, error: null, startedAt: null, ...apply },
  };
}

const base = { startCommit: 'aaaaaaa', sawServerDown: false, waitingForRestartMs: 0 };

test('shows the current step while the update runs', () => {
  const outcome = interpretUpdatePoll({ ...base, status: statusWith({ state: 'updating', step: 'Building the new version' }) });
  assert.deepEqual(outcome, { kind: 'working', text: 'Building the new version…' });
});

test('says it is restarting, both when asked and when the server cannot be reached', () => {
  assert.deepEqual(interpretUpdatePoll({ ...base, status: statusWith({ state: 'restarting' }) }), {
    kind: 'working',
    text: 'Restarting Hiring Helper…',
  });
  assert.deepEqual(interpretUpdatePoll({ ...base, status: null, sawServerDown: true }), {
    kind: 'working',
    text: 'Restarting Hiring Helper…',
  });
});

test('reloads once an idle server reports a different version', () => {
  assert.deepEqual(interpretUpdatePoll({ ...base, status: statusWith({}, 'bbbbbbb') }), { kind: 'reload' });
});

test('reloads when the server answers again after having been down, even on the same commit', () => {
  assert.deepEqual(interpretUpdatePoll({ ...base, status: statusWith({}), sawServerDown: true }), { kind: 'reload' });
});

test('an idle server that never went down and has not changed has not started yet, so keep waiting', () => {
  assert.deepEqual(interpretUpdatePoll({ ...base, status: statusWith({}) }), {
    kind: 'working',
    text: 'Starting the update…',
  });
});

test('a failed update shows why and stops', () => {
  const outcome = interpretUpdatePoll({
    ...base,
    status: statusWith({ state: 'failed', error: 'Building the new version failed.' }),
  });
  assert.deepEqual(outcome, { kind: 'failed', message: 'Building the new version failed.' });
});

test('a server that does not come back in time asks the person to step in', () => {
  const overdue = RESTART_WAIT_LIMIT_MS + 1;
  assert.deepEqual(interpretUpdatePoll({ ...base, status: null, sawServerDown: true, waitingForRestartMs: overdue }), {
    kind: 'stuck',
  });
  assert.deepEqual(
    interpretUpdatePoll({ ...base, status: statusWith({ state: 'restarting' }), waitingForRestartMs: overdue }),
    { kind: 'stuck' }
  );
});
