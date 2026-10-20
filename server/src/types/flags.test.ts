/**
 * Tests for mergeScoringFlags — the fix that stops a scoring run from wiping
 * answer-derived salary flags while it updates the resume-judged flags.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeScoringFlags } from './flags.js';

test('preserves salary flags while replacing scoring-managed flags', () => {
  // Candidate had salary-low (from answers) + a stale name flag; scoring now
  // judges studying + location. Salary must survive; name is dropped.
  const result = mergeScoringFlags(['salary-low', 'name'], ['studying', 'location']);
  assert.deepEqual([...result].sort(), ['location', 'salary-low', 'studying']);
});

test('empty incoming clears scoring flags but keeps salary flags', () => {
  const result = mergeScoringFlags(['salary-high', 'no_exp', 'location'], []);
  assert.deepEqual(result, ['salary-high']);
});

test('scoring never sets salary flags even if passed one', () => {
  // A salary flag in `incoming` is ignored (scoring doesn't own it); the
  // existing salary flag is what persists.
  const result = mergeScoringFlags(['salary-low'], ['salary-high', 'name']);
  assert.deepEqual([...result].sort(), ['name', 'salary-low']);
});

test('no existing flags: just the scoring flags', () => {
  assert.deepEqual(mergeScoringFlags([], ['name', 'location']).sort(), ['location', 'name']);
});
