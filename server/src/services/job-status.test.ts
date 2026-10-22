import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOSED_JOB_CHANGES_MESSAGE,
  CLOSED_JOB_SCORING_MESSAGE,
  findJobsToClose,
  isClosedJobStatus,
} from './job-status.js';

test('Filled, Canceled and Closed jobs are closed, whatever the capitalisation', () => {
  for (const status of ['Filled', 'canceled', 'Cancelled', ' CLOSED ', 'Archived']) {
    assert.equal(isClosedJobStatus(status), true, status);
  }
});

test('open, draft, on hold, unknown and missing statuses are not closed', () => {
  for (const status of ['Open', 'Draft', 'On Hold', 'Something new', '', null, undefined]) {
    assert.equal(isClosedJobStatus(status), false, String(status));
  }
});

test('a stored job missing from the BambooHR listing is closed', () => {
  const stored = [
    { id: 1, status: 'Open' },
    { id: 2, status: 'Open' },
  ];
  assert.deepEqual(findJobsToClose(stored, new Set([1])), [2]);
});

test('a job already closed is not closed again, so its original label survives', () => {
  assert.deepEqual(findJobsToClose([{ id: 2, status: 'Filled' }], new Set([1])), []);
});

test('an empty listing closes nothing', () => {
  assert.deepEqual(findJobsToClose([{ id: 1, status: 'Open' }], new Set()), []);
});

test('a job with no stored status that is still listed stays open', () => {
  assert.deepEqual(findJobsToClose([{ id: 1, status: null }], new Set([1])), []);
});

test('the scoring refusal for a closed job says why', () => {
  assert.match(CLOSED_JOB_SCORING_MESSAGE, /closed/);
});

test('the refusal for moving or rejecting in a closed job says why', () => {
  assert.match(CLOSED_JOB_CHANGES_MESSAGE, /closed/);
  assert.match(CLOSED_JOB_CHANGES_MESSAGE, /moved or rejected/);
});
