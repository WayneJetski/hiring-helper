import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getNeighbors, loadNavigationIds, saveNavigationIds } from './applicantNavigation.js';
import { installMemoryStorage } from './testStorage.js';

beforeEach(installMemoryStorage);

test('finds the previous and next applicant and the position', () => {
  assert.deepEqual(getNeighbors([10, 20, 30], 20), { previousId: 10, nextId: 30, position: 2, total: 3 });
});

test('the ends of the list have no previous or next', () => {
  assert.equal(getNeighbors([10, 20, 30], 10)?.previousId, null);
  assert.equal(getNeighbors([10, 20, 30], 30)?.nextId, null);
});

test('an applicant that is not in the list has no neighbors', () => {
  assert.equal(getNeighbors([10, 20], 99), null);
});

test('round-trips the remembered order', () => {
  saveNavigationIds([5, 6, 7]);
  assert.deepEqual(loadNavigationIds(), [5, 6, 7]);
});
