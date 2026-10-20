import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeMissingSetup, getJobReadiness } from './job-readiness.js';

test('a job with a posting and confirmed criteria is ready', () => {
  const readiness = getJobReadiness({ description: 'Hiring a analyst', criteriaConfirmedAt: '2026-10-20 10:00:00' });
  assert.deepEqual(readiness, { hasPosting: true, isCriteriaConfirmed: true, isReadyToScore: true });
  assert.equal(describeMissingSetup(readiness), null);
});

test('a brand-new job (no criteria confirmation yet) is not ready, even with a posting', () => {
  const readiness = getJobReadiness({ description: 'Posting text', criteriaConfirmedAt: null });
  assert.equal(readiness.isReadyToScore, false);
  assert.match(describeMissingSetup(readiness) ?? '', /confirm the scoring criteria/);
  assert.equal((describeMissingSetup(readiness) ?? '').includes('job posting'), false);
});

test('a whitespace-only or missing posting counts as no posting', () => {
  assert.equal(getJobReadiness({ description: '  \n ', criteriaConfirmedAt: 'x' }).hasPosting, false);
  assert.equal(getJobReadiness({ criteriaConfirmedAt: 'x' }).isReadyToScore, false);
});

test('names everything that is missing', () => {
  const message = describeMissingSetup(getJobReadiness({}));
  assert.match(message ?? '', /load or paste the job posting and confirm the scoring criteria/);
});
