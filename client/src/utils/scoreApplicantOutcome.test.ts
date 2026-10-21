import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeBatchOutcome, describeSingleScoreOutcome } from './scoreApplicantOutcome.js';
import type { ScoringStatus } from '../types/applicant.types';

const finished: ScoringStatus = {
  running: false,
  jobId: 1,
  startedAt: '2026-10-21T12:00:00Z',
  finishedAt: '2026-10-21T12:01:00Z',
  scored: 1,
  total: 1,
  cancelled: false,
  ok: true,
  error: null,
  message: null,
};

test('a saved score is reported as success', () => {
  assert.deepEqual(describeSingleScoreOutcome(finished, 'Ada Lovelace'), {
    tone: 'success',
    text: 'Ada Lovelace has been scored.',
  });
});

test('a run that saved nothing is a warning, not a success', () => {
  const notice = describeSingleScoreOutcome({ ...finished, scored: 0 }, 'Ada Lovelace');
  assert.equal(notice.tone, 'warning');
  assert.match(notice.text, /not scored/);
});

test('a failed run shows its error', () => {
  const notice = describeSingleScoreOutcome({ ...finished, ok: false, error: 'Claude is busy' }, 'Ada');
  assert.deepEqual(notice, { tone: 'error', text: 'Claude is busy' });
});

test('a cancelled run is a warning', () => {
  const notice = describeSingleScoreOutcome({ ...finished, ok: false, cancelled: true }, 'Ada');
  assert.equal(notice.tone, 'warning');
});

test('a batch run that scored nobody is a warning, not "finished: 0 scored"', () => {
  const notice = describeBatchOutcome({ ...finished, scored: 0, total: 12 });
  assert.equal(notice.tone, 'warning');
  assert.match(notice.text, /nobody was scored/);
});

test('a batch run reports its count on success', () => {
  assert.deepEqual(describeBatchOutcome({ ...finished, scored: 5, total: 12 }), {
    tone: 'success',
    text: 'Scoring finished: 5 scored.',
  });
});

test('a batch run with nothing to score is not flagged', () => {
  assert.equal(describeBatchOutcome({ ...finished, scored: 0, total: 0 }).tone, 'success');
});
