import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSelectedStatusIds, saveSelectedStatusIds, FILTER_STORAGE_KEYS } from './filterStorage.js';
import { installMemoryStorage } from './testStorage.js';

beforeEach(installMemoryStorage);

test('each job remembers its own status selection', () => {
  saveSelectedStatusIds(48, [1, 2]);
  saveSelectedStatusIds(45, [9]);
  assert.deepEqual(loadSelectedStatusIds(48), [1, 2]);
  assert.deepEqual(loadSelectedStatusIds(45), [9]);
});

test('"all jobs" has its own selection too', () => {
  saveSelectedStatusIds(null, [4]);
  assert.deepEqual(loadSelectedStatusIds(null), [4]);
  assert.deepEqual(loadSelectedStatusIds(48), []);
});

test('falls back to the older global selection until a job has its own', () => {
  (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.setItem(
    FILTER_STORAGE_KEYS.selectedStatusIds,
    JSON.stringify([7, 8])
  );
  assert.deepEqual(loadSelectedStatusIds(48), [7, 8]);
  saveSelectedStatusIds(48, []);
  assert.deepEqual(loadSelectedStatusIds(48), []);
});

test('drops non-numeric entries', () => {
  (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.setItem(
    `${FILTER_STORAGE_KEYS.selectedStatusIds}.48`,
    JSON.stringify([1, 'x', 3])
  );
  assert.deepEqual(loadSelectedStatusIds(48), [1, 3]);
});
