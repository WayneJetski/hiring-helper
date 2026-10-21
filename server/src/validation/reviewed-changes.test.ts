/**
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_REVIEWED_CHANGES, parseReviewedChanges } from './reviewed-changes.js';

test('accepts a job and the reviewed changes', () => {
  assert.deepEqual(parseReviewedChanges({ jobId: 4, changes: [{ id: 1, toStatusId: 9 }] }), {
    ok: true,
    jobId: 4,
    changes: [{ id: 1, toStatusId: 9 }],
  });
  assert.equal(parseReviewedChanges({ changes: [{ id: 7, toStatusId: 2 }] }).ok, true);
});

test('refuses a push that does not list what was reviewed', () => {
  for (const body of [undefined, null, {}, { jobId: 1 }, { changes: [] }, { changes: 'all' }, { ids: [1] }]) {
    assert.equal(parseReviewedChanges(body).ok, false, JSON.stringify(body));
  }
});

test('refuses changes that are not whole-number pairs', () => {
  for (const changes of [
    [{ id: 1 }],
    [{ toStatusId: 1 }],
    [{ id: '1', toStatusId: 2 }],
    [{ id: 1.5, toStatusId: 2 }],
    [{ id: 1, toStatusId: NaN }],
    [null],
    [1],
  ]) {
    assert.equal(parseReviewedChanges({ changes }).ok, false, JSON.stringify(changes));
  }
});

test('refuses a jobId that is not a whole number, or too long a list', () => {
  assert.equal(parseReviewedChanges({ jobId: '4', changes: [{ id: 1, toStatusId: 2 }] }).ok, false);
  const changes = Array.from({ length: MAX_REVIEWED_CHANGES + 1 }, (_, index) => ({ id: index + 1, toStatusId: 2 }));
  assert.equal(parseReviewedChanges({ changes }).ok, false);
});
