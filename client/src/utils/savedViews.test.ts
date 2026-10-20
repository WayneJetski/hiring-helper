import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildBuiltInViews, deleteView, loadSavedViews, saveView } from './savedViews.js';
import { installMemoryStorage } from './testStorage.js';

beforeEach(installMemoryStorage);

const sample = { search: '', sortColumn: 'confidence' as const, sortDirection: 'desc' as const };

test('built-in views come from the status groups that exist', () => {
  const views = buildBuiltInViews([
    { id: 1, label: 'New' },
    { id: 2, label: 'Reviewed' },
    { id: 3, label: 'Offer Out' },
    { id: 4, label: 'Not a Fit' },
  ]);
  assert.deepEqual(
    views.map((view) => [view.id, view.statusIds]),
    [
      ['builtin:to-review', [1, 2]],
      ['builtin:in-progress', [3]],
      ['builtin:rejected', [4]],
    ]
  );
});

test('a built-in view is omitted when its group has no statuses', () => {
  assert.deepEqual(buildBuiltInViews([{ id: 1, label: 'New' }]).map((view) => view.id), ['builtin:to-review']);
});

test('saves, lists and deletes custom views', () => {
  const afterSave = saveView({ name: 'Top picks', statusIds: [1, 2], ...sample });
  assert.equal(afterSave.length, 1);
  assert.equal(loadSavedViews()[0].name, 'Top picks');
  assert.equal(loadSavedViews()[0].isBuiltIn, false);

  assert.deepEqual(deleteView(afterSave[0].id), []);
  assert.deepEqual(loadSavedViews(), []);
});

test('saving a view with an existing name replaces it', () => {
  saveView({ name: 'Top picks', statusIds: [1], ...sample });
  saveView({ name: 'top picks', statusIds: [2], ...sample });
  const views = loadSavedViews();
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].statusIds, [2]);
});

test('ignores corrupted stored views', () => {
  (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.setItem(
    'hiringHelper.savedViews',
    JSON.stringify([{ nonsense: true }, 'x'])
  );
  assert.deepEqual(loadSavedViews(), []);
});
