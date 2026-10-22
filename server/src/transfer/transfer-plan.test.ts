import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaultScoringConfig } from '../scoring/scoring-config.js';
import {
  planImport,
  selectWork,
  type LocalApplicationState,
  type LocalJobState,
} from './transfer-plan.js';
import { makeApplication, makeBundle, makeJob, makeSummary } from './transfer-fixtures.js';

const emptyLocalJob: LocalJobState = {
  id: 7,
  description: null,
  scoringConfig: null,
  legacyPrompt: null,
  criteriaConfirmedAt: null,
};

function plan(
  jobs: ReturnType<typeof makeJob>[],
  localJob: LocalJobState | null,
  applications: LocalApplicationState[] = []
) {
  return planImport(
    makeBundle(jobs),
    new Map(localJob ? [[localJob.id, localJob]] : []),
    new Map(applications.map((application) => [application.id, application]))
  );
}

const unscored = (id: number): LocalApplicationState => ({ id, jobId: 7, score: null, report: null });

test('a synced job with no posting or criteria is filled without asking', () => {
  const [job] = plan([makeJob()], emptyLocalJob).jobs;
  assert.equal(job.isSynced, true);
  assert.equal(job.description, 'fill');
  assert.equal(job.criteria, 'fill');
});

test('a job that differs from what is already saved is a conflict', () => {
  const local: LocalJobState = {
    ...emptyLocalJob,
    description: 'A different posting',
    scoringConfig: {
      ...cloneDefaultScoringConfig(),
      dimensions: cloneDefaultScoringConfig().dimensions.map((dimension, index) =>
        index === 0 ? { ...dimension, name: 'Something else' } : dimension
      ),
    },
    criteriaConfirmedAt: 'x',
  };
  const [job] = plan([makeJob()], local).jobs;
  assert.equal(job.description, 'conflict');
  assert.equal(job.criteria, 'conflict');
});

test('identical settings are left alone', () => {
  const imported = makeJob();
  const local: LocalJobState = {
    ...emptyLocalJob,
    description: `  ${imported.settings.description}  `,
    scoringConfig: imported.settings.scoringConfig,
    criteriaConfirmedAt: 'another time',
  };
  const [job] = plan([imported], local).jobs;
  assert.equal(job.description, 'same');
  assert.equal(job.criteria, 'same');
});

test('empty settings in the file never overwrite anything', () => {
  const imported = makeJob({
    settings: { description: null, scoringConfig: null, legacyPrompt: null, criteriaConfirmedAt: null },
  });
  const local: LocalJobState = { ...emptyLocalJob, description: 'Mine', criteriaConfirmedAt: 'x' };
  const [job] = plan([imported], local).jobs;
  assert.equal(job.description, 'none');
  assert.equal(job.criteria, 'none');
});

test('a job this machine has not synced is skipped and its applicants counted', () => {
  const [job] = plan([makeJob()], null).jobs;
  assert.equal(job.isSynced, false);
  assert.equal(job.scores.notFound, 1);
  assert.deepEqual(selectWork({ jobs: [job] }, { replaceSettingsJobIds: [7], replaceScoreApplicationIds: [101] }), []);
});

test('unscored applicants are filled; scored ones with a different score conflict', () => {
  const job = makeJob({
    applications: [makeApplication(1), makeApplication(2, { score: 55 }), makeApplication(3)],
  });
  const [result] = plan([job], emptyLocalJob, [
    unscored(1),
    { id: 2, jobId: 7, score: 70, report: { brief: 'b', full: 'f', risks: 'r' } },
  ]).jobs;
  assert.deepEqual(result.scores.fill, [1]);
  assert.deepEqual(result.scores.conflicts, [
    { applicationId: 2, name: 'Person 2', currentScore: 70, importedScore: 55 },
  ]);
  assert.equal(result.scores.notFound, 1);
});

test('the same score with the same report is not a conflict', () => {
  const summary = makeSummary();
  const job = makeJob({ applications: [makeApplication(1, { summary })] });
  const [result] = plan([job], emptyLocalJob, [
    { id: 1, jobId: 7, score: 80, report: { brief: summary.brief, full: summary.full, risks: summary.risks } },
  ]).jobs;
  assert.equal(result.scores.same, 1);
  assert.equal(result.scores.conflicts.length, 0);
});

test('the same score with a different report is a conflict', () => {
  const job = makeJob({ applications: [makeApplication(1)] });
  const [result] = plan([job], emptyLocalJob, [
    { id: 1, jobId: 7, score: 80, report: { brief: 'other', full: 'other', risks: 'other' } },
  ]).jobs;
  assert.equal(result.scores.conflicts.length, 1);
});

test('an applicant that belongs to another local job is not imported', () => {
  const [result] = plan([makeJob()], emptyLocalJob, [{ id: 101, jobId: 99, score: null, report: null }]).jobs;
  assert.equal(result.scores.notFound, 1);
  assert.deepEqual(result.scores.fill, []);
});

test('fills are always written; conflicts only when chosen', () => {
  const job = makeJob({
    applications: [makeApplication(1), makeApplication(2, { score: 55 })],
  });
  const importPlan = plan([job], { ...emptyLocalJob, description: 'Mine' }, [
    unscored(1),
    { id: 2, jobId: 7, score: 70, report: null },
  ]);

  const keepMine = selectWork(importPlan, { replaceSettingsJobIds: [], replaceScoreApplicationIds: [] });
  assert.deepEqual(keepMine, [
    { jobId: 7, writeDescription: false, writeCriteria: true, applicationIds: [1] },
  ]);

  const replace = selectWork(importPlan, { replaceSettingsJobIds: [7], replaceScoreApplicationIds: [2] });
  assert.deepEqual(replace, [
    { jobId: 7, writeDescription: true, writeCriteria: true, applicationIds: [1, 2] },
  ]);
});

test('a decision cannot replace something that was not a conflict', () => {
  const importPlan = plan([makeJob({ applications: [makeApplication(1)] })], emptyLocalJob, [
    { id: 1, jobId: 7, score: 80, report: { brief: 'Strong fit', full: 'Detailed assessment', risks: 'None' } },
  ]);
  const work = selectWork(importPlan, { replaceSettingsJobIds: [], replaceScoreApplicationIds: [1, 999] });
  assert.deepEqual(work.flatMap((entry) => entry.applicationIds), []);
});
