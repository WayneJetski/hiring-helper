import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildOrderByClause } from './sort-order.js';

test('known columns and directions are used', () => {
  assert.equal(buildOrderByClause('confidence', 'asc'), 'ORDER BY COALESCE(sc.score, -1) ASC');
  assert.equal(buildOrderByClause('name', 'DESC'), 'ORDER BY ap.last_name, ap.first_name DESC');
});

test('anything else falls back to the default instead of reaching the SQL', () => {
  assert.equal(buildOrderByClause('nope', 'desc'), 'ORDER BY a.applied_date DESC');
  assert.equal(buildOrderByClause('constructor', 'asc'), 'ORDER BY a.applied_date ASC');
  assert.equal(buildOrderByClause('__proto__', 'asc'), 'ORDER BY a.applied_date ASC');
  assert.equal(
    buildOrderByClause('applied_date', 'asc,(SELECT 1 FROM applicants)'),
    'ORDER BY a.applied_date DESC'
  );
});
