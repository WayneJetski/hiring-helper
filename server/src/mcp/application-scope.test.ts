import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCORING_SCOPE_VARIABLE, scopeFromEnvironment } from './application-scope.js';

test('no variable means a person is driving: everything is allowed', () => {
  assert.equal(scopeFromEnvironment({}).allows(123), true);
});

test('a scoped run allows only its batch', () => {
  const scope = scopeFromEnvironment({ [SCORING_SCOPE_VARIABLE]: '101, 102,103' });
  assert.equal(scope.allows(101), true);
  assert.equal(scope.allows(103), true);
  assert.equal(scope.allows(104), false);
});

test('a scope that is empty or malformed allows nothing', () => {
  for (const value of ['', ' ', 'abc', '1,,2', '1;2', '-1', '1.5']) {
    const scope = scopeFromEnvironment({ [SCORING_SCOPE_VARIABLE]: value });
    assert.equal(scope.allows(1), false, JSON.stringify(value));
    assert.equal(scope.allows(2), false, JSON.stringify(value));
  }
});
