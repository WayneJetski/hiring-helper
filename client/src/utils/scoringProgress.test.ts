import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScoringProgress } from './scoringProgress.js';

const startedAt = '2026-10-20T12:00:00Z';
const now = new Date('2026-10-20T12:02:00Z'); // 120 s elapsed

test('percent and time left from the pace so far', () => {
  // 4 of 10 in 120 s = 30 s each; 6 left = 180 s.
  assert.deepEqual(computeScoringProgress(4, 10, startedAt, now), { percent: 40, secondsRemaining: 180 });
});

test('no estimate before anything is scored', () => {
  assert.deepEqual(computeScoringProgress(0, 10, startedAt, now), { percent: 0, secondsRemaining: null });
});

test('unknown total gives no percent or estimate', () => {
  assert.deepEqual(computeScoringProgress(3, null, startedAt, now), { percent: null, secondsRemaining: null });
});

test('never exceeds 100 percent or goes negative', () => {
  assert.deepEqual(computeScoringProgress(12, 10, startedAt, now), { percent: 100, secondsRemaining: 0 });
});
