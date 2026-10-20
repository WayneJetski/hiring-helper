import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateLink } from './bamboohrLinks.js';

test('builds the BambooHR candidate page link from the company address and candidate id', () => {
  assert.equal(
    buildCandidateLink('acme', 4821),
    'https://acme.bamboohr.com/hiring/candidates/4821'
  );
});

test('tolerates surrounding spaces in the company address', () => {
  assert.equal(buildCandidateLink('  acme ', 7), 'https://acme.bamboohr.com/hiring/candidates/7');
});

test('returns null rather than a malformed link when the company address is missing or invalid', () => {
  for (const build of [buildCandidateLink]) {
    assert.equal(build(null, 1), null);
    assert.equal(build('', 1), null);
    assert.equal(build('evil.com/x', 1), null);
    assert.equal(build('https://acme.bamboohr.com', 1), null);
  }
});

test('returns null for a candidate id that is missing or not a positive whole number', () => {
  for (const build of [buildCandidateLink]) {
    assert.equal(build('acme', undefined), null);
    assert.equal(build('acme', 0), null);
    assert.equal(build('acme', -4), null);
    assert.equal(build('acme', 1.5), null);
  }
});
