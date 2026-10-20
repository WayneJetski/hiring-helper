/**
 * Tests for discovering applications that belong to jobs we have not seen yet.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { selectApplicationsForUnknownJobs } from './sync-discovery.js';
import type { BambooHRApplication } from '../types/bamboohr.types.js';

function application(id: number, jobId: number): BambooHRApplication {
  return { id, job: { id: jobId, title: { id: null, label: 'Job' } } } as BambooHRApplication;
}

test('selects every application of a job we have never stored', () => {
  const all = [application(1, 10), application(2, 99), application(3, 99)];
  const selected = selectApplicationsForUnknownJobs(all, new Set([10]), new Set([1]));
  assert.deepEqual(selected.map((a) => a.id), [2, 3]);
});

test('ignores applications of known jobs, even ones we have not stored', () => {
  const all = [application(5, 10)];
  assert.deepEqual(selectApplicationsForUnknownJobs(all, new Set([10]), new Set()), []);
});

test('skips applications already stored (ingested by the incremental pass)', () => {
  const all = [application(7, 99)];
  assert.deepEqual(selectApplicationsForUnknownJobs(all, new Set(), new Set([7])), []);
});
