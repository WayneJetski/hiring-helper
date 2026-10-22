import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisions, describeImportResult, summarizeImportPlan } from './importPlanSummary.js';
import type { ImportPlan, JobImportPlan } from '../types/transfer.types.js';

function job(overrides: Partial<JobImportPlan> = {}): JobImportPlan {
  return {
    jobId: 7,
    title: 'Analyst',
    isSynced: true,
    description: 'none',
    criteria: 'none',
    scores: { fill: [], conflicts: [], same: 0, notFound: 0 },
    ...overrides,
  };
}

test('fills and conflicts are counted per job and per applicant', () => {
  const plan: ImportPlan = {
    jobs: [
      job({
        description: 'fill',
        criteria: 'conflict',
        scores: {
          fill: [1, 2],
          conflicts: [{ applicationId: 3, name: 'Ada', currentScore: 40, importedScore: 80 }],
          same: 4,
          notFound: 5,
        },
      }),
    ],
  };
  const summary = summarizeImportPlan(plan);
  assert.equal(summary.settingsToFillCount, 1);
  assert.deepEqual(summary.settingsConflicts, [{ jobId: 7, title: 'Analyst' }]);
  assert.equal(summary.scoresToFillCount, 2);
  assert.equal(summary.scoreConflicts[0].jobTitle, 'Analyst');
  assert.equal(summary.scoresSameCount, 4);
  assert.equal(summary.applicantsNotFoundCount, 5);
  assert.equal(summary.hasWork, true);
});

test('jobs that are not synced here are listed and add no work', () => {
  const summary = summarizeImportPlan({
    jobs: [job({ isSynced: false, title: 'Gone', scores: { fill: [], conflicts: [], same: 0, notFound: 3 } })],
  });
  assert.deepEqual(summary.notSyncedJobTitles, ['Gone']);
  assert.equal(summary.hasWork, false);
});

test('a file identical to what is here has no work', () => {
  const summary = summarizeImportPlan({
    jobs: [job({ description: 'same', criteria: 'same', scores: { fill: [], conflicts: [], same: 2, notFound: 0 } })],
  });
  assert.equal(summary.hasWork, false);
  assert.equal(summary.scoresSameCount, 2);
});

test('choosing to keep mine lists no replacements; replacing lists every conflict', () => {
  const summary = summarizeImportPlan({
    jobs: [
      job({
        criteria: 'conflict',
        scores: {
          fill: [],
          conflicts: [
            { applicationId: 3, name: 'Ada', currentScore: 40, importedScore: 80 },
            { applicationId: 4, name: 'Grace', currentScore: 50, importedScore: 60 },
          ],
          same: 0,
          notFound: 0,
        },
      }),
    ],
  });
  assert.deepEqual(buildDecisions(summary, { replaceSettings: false, replaceScores: false }), {
    replaceSettingsJobIds: [],
    replaceScoreApplicationIds: [],
  });
  assert.deepEqual(buildDecisions(summary, { replaceSettings: true, replaceScores: true }), {
    replaceSettingsJobIds: [7],
    replaceScoreApplicationIds: [3, 4],
  });
});

test('the result message says what happened, with the right plurals', () => {
  assert.equal(
    describeImportResult({ jobsUpdated: 1, jobsFailed: 0, scoresFilled: 2, scoresReplaced: 1, scoresFailed: 0 }),
    'Import finished: updated settings for 1 job and imported 3 scores.'
  );
  assert.equal(
    describeImportResult({ jobsUpdated: 0, jobsFailed: 0, scoresFilled: 0, scoresReplaced: 0, scoresFailed: 0 }),
    'Import finished: nothing needed changing.'
  );
  assert.match(
    describeImportResult({ jobsUpdated: 0, jobsFailed: 1, scoresFilled: 1, scoresReplaced: 0, scoresFailed: 2 }),
    /2 applicants could not be saved. Settings for 1 job could not be saved/
  );
});
