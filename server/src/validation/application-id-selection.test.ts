/**
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_SELECTED_APPLICATIONS, parseRequiredApplicationIds } from './application-id-selection.js';

test('accepts a job and a list of whole-number ids', () => {
  assert.deepEqual(parseRequiredApplicationIds({ jobId: 4, ids: [1, 2, 3] }), {
    ok: true,
    jobId: 4,
    ids: [1, 2, 3],
  });
  assert.deepEqual(parseRequiredApplicationIds({ ids: [7] }), { ok: true, jobId: undefined, ids: [7] });
});

test('refuses a push that does not name the reviewed applications', () => {
  for (const body of [undefined, null, {}, { jobId: 1 }, { ids: [] }, { ids: 'all' }, { ids: null }]) {
    assert.equal(parseRequiredApplicationIds(body).ok, false, JSON.stringify(body));
  }
});

test('refuses ids that are not whole numbers', () => {
  for (const ids of [[1.5], ['1'], [NaN], [Infinity], [null], [{}], [1, '2']]) {
    assert.equal(parseRequiredApplicationIds({ ids }).ok, false, JSON.stringify(ids));
  }
});

test('refuses a jobId that is not a whole number', () => {
  assert.equal(parseRequiredApplicationIds({ jobId: '4', ids: [1] }).ok, false);
  assert.equal(parseRequiredApplicationIds({ jobId: 4.2, ids: [1] }).ok, false);
});

test('refuses an unreasonably long list', () => {
  const ids = Array.from({ length: MAX_SELECTED_APPLICATIONS + 1 }, (_, index) => index + 1);
  assert.equal(parseRequiredApplicationIds({ ids }).ok, false);
});
