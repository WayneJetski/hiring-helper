import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAiFilterClauses, parseFlagFilter, parseScoreFilter } from './ai-filters.js';

test('no filter adds no clauses', () => {
  assert.deepEqual(buildAiFilterClauses({}), []);
  assert.deepEqual(buildAiFilterClauses({ scoreFilter: 'all', flagFilter: 'all' }), []);
});

test('scored and unscored are opposites', () => {
  const [scored] = buildAiFilterClauses({ scoreFilter: 'scored' });
  const [unscored] = buildAiFilterClauses({ scoreFilter: 'unscored' });
  assert.equal(unscored, `NOT ${scored}`);
});

test('flag and score filters combine', () => {
  assert.equal(buildAiFilterClauses({ scoreFilter: 'scored', flagFilter: 'unflagged' }).length, 2);
});

test('unknown query values are ignored rather than rejected', () => {
  assert.equal(parseScoreFilter('bogus'), undefined);
  assert.equal(parseScoreFilter('scored'), 'scored');
  assert.equal(parseFlagFilter('all'), undefined);
  assert.equal(parseFlagFilter('flagged'), 'flagged');
});
