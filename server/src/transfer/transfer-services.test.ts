/**
 * Export and import with in-memory fakes (no database, no disk): one fake "machine"
 * per person, so a file really travels from one to the other.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneDefaultScoringConfig } from '../scoring/scoring-config.js';
import type { ApplicantSummary } from '../types/summary.types.js';
import type { ApplicationFlag } from '../types/flags.js';
import { TransferExportService, type TransferExportDependencies } from './transfer-export.service.js';
import { TransferImportService, type TransferImportDependencies } from './transfer-import.service.js';
import { parseTransferBundle } from './transfer-format.js';
import { ImportRefusedError } from './transfer-import.service.js';
import { makeSummary } from './transfer-fixtures.js';

interface FakeJob {
  id: number;
  title: string;
  description?: string;
  scoringConfig?: string;
  systemPrompt?: string;
  criteriaConfirmedAt?: string;
}

class FakeMachine {
  jobs = new Map<number, FakeJob>();
  applications = new Map<number, { id: number; jobId: number; applicantId: number }>();
  applicants = new Map<number, { firstName: string; lastName: string }>();
  scores: Record<string, number> = {};
  summaries = new Map<number, ApplicantSummary>();
  flags: Record<number, ApplicationFlag[]> = {};
  failSummaryFor: number | null = null;
  failSettingsForJob: number | null = null;
  company = 'acme';

  addJob(job: FakeJob): void {
    this.jobs.set(job.id, job);
  }

  addApplicant(id: number, jobId: number, name: string): void {
    const [firstName, lastName] = name.split(' ');
    this.applicants.set(id, { firstName, lastName });
    this.applications.set(id, { id, jobId, applicantId: id });
  }

  score(id: number, summary: ApplicantSummary, flags: ApplicationFlag[] = []): void {
    this.scores[id.toString()] = summary.confidence;
    this.summaries.set(id, summary);
    this.flags[id] = flags;
  }

  exporter(): TransferExportService {
    return new TransferExportService({
      jobsRepo: { getAll: () => [...this.jobs.values()] },
      applicationsRepo: {
        getFiltered: ({ jobId }: { jobId?: number }) =>
          [...this.applications.values()].filter((application) => application.jobId === jobId),
      },
      applicantsRepo: { getById: (id: number) => this.applicants.get(id) ?? null },
      scoresRepo: { getAllScores: async () => this.scores },
      summaryRepo: { getSummary: async (id: number) => this.summaries.get(id) ?? null },
      flagsRepo: { getFlagsMap: () => this.flags },
      companySubdomain: () => this.company,
      now: () => new Date('2026-10-22T12:00:00Z'),
    } as unknown as TransferExportDependencies);
  }

  importer(): TransferImportService {
    return new TransferImportService({
      jobsRepo: {
        getById: (id: number) => this.jobs.get(id),
        savePosting: (id: number, posting: { description: string }) => {
          if (this.failSettingsForJob === id) throw new Error('database is locked');
          const job = this.jobs.get(id);
          if (job) job.description = posting.description;
          return !!job;
        },
        importCriteria: (
          id: number,
          criteria: { scoringConfigJson: string | null; criteriaConfirmedAt: string | null }
        ) => {
          const job = this.jobs.get(id);
          if (!job) return false;
          job.scoringConfig = criteria.scoringConfigJson ?? undefined;
          // Like the real repository: a confirmation is set, never cleared.
          job.criteriaConfirmedAt = criteria.criteriaConfirmedAt ?? job.criteriaConfirmedAt;
          return true;
        },
      },
      applicationsRepo: { getById: (id: number) => this.applications.get(id) ?? null },
      scoresRepo: {
        getAllScores: async () => this.scores,
        setScore: async (id: number, score: number) => {
          this.scores[id.toString()] = score;
        },
      },
      summaryRepo: {
        getSummary: async (id: number) => this.summaries.get(id) ?? null,
        saveSummary: async (id: number, summary: ApplicantSummary) => {
          if (this.failSummaryFor === id) throw new Error('disk full');
          this.summaries.set(id, summary);
        },
        deleteSummary: async (id: number) => {
          this.summaries.delete(id);
        },
      },
      companySubdomain: () => this.company,
      flagsRepo: {
        getFlags: (id: number) => this.flags[id] ?? [],
        setFlags: (id: number, flags: ApplicationFlag[]) => {
          this.flags[id] = flags;
        },
      },
    } as unknown as TransferImportDependencies);
  }
}

/** The file as it would be saved and re-read: through JSON and the validator. */
async function shareFile(from: FakeMachine) {
  const parsed = parseTransferBundle(JSON.parse(JSON.stringify(await from.exporter().buildBundle())));
  assert.equal(parsed.ok, true);
  return parsed.ok ? parsed.bundle : (undefined as never);
}

function scoredMachine(): FakeMachine {
  const machine = new FakeMachine();
  machine.addJob({
    id: 7,
    title: 'Analyst',
    description: 'We are hiring an analyst.',
    scoringConfig: JSON.stringify(cloneDefaultScoringConfig()),
    criteriaConfirmedAt: '2026-10-01 10:00:00',
  });
  machine.addJob({ id: 8, title: 'Empty job' });
  machine.addApplicant(101, 7, 'Ada Lovelace');
  machine.addApplicant(102, 7, 'Grace Hopper');
  machine.addApplicant(103, 7, 'Unscored Person');
  machine.score(101, makeSummary({ confidence: 85, jobId: 7 }), ['tenure']);
  machine.score(102, makeSummary({ confidence: 40, brief: 'Weak', jobId: 7 }));
  return machine;
}

function syncedOnlyMachine(): FakeMachine {
  const machine = new FakeMachine();
  machine.addJob({ id: 7, title: 'Analyst (local title)' });
  machine.addApplicant(101, 7, 'Ada Lovelace');
  machine.addApplicant(102, 7, 'Grace Hopper');
  machine.addApplicant(103, 7, 'Unscored Person');
  return machine;
}

const keepMine = { replaceSettingsJobIds: [], replaceScoreApplicationIds: [] };

test('export holds scored applicants and job settings, and leaves out empty jobs and unscored people', async () => {
  const bundle = await shareFile(scoredMachine());
  assert.deepEqual(bundle.jobs.map((job) => job.id), [7]);
  assert.deepEqual(bundle.jobs[0].applications.map((application) => application.id), [101, 102]);
  assert.equal(bundle.jobs[0].applications[0].name, 'Ada Lovelace');
  assert.deepEqual(bundle.jobs[0].applications[0].flags, ['tenure']);
  assert.equal(bundle.jobs[0].settings.description, 'We are hiring an analyst.');
});

test('importing into a machine with nothing fills settings, scores, reports and flags', async () => {
  const receiver = syncedOnlyMachine();
  const bundle = await shareFile(scoredMachine());

  const result = await receiver.importer().apply(bundle, keepMine);

  assert.deepEqual(result, { jobsUpdated: 1, jobsFailed: 0, scoresFilled: 2, scoresReplaced: 0, scoresFailed: 0 });
  assert.equal(receiver.jobs.get(7)?.description, 'We are hiring an analyst.');
  assert.ok(receiver.jobs.get(7)?.scoringConfig);
  assert.equal(receiver.jobs.get(7)?.criteriaConfirmedAt, '2026-10-01 10:00:00');
  assert.equal(receiver.scores['101'], 85);
  assert.equal(receiver.scores['102'], 40);
  assert.equal(receiver.scores['103'], undefined);
  assert.deepEqual(receiver.flags[101], ['tenure']);
  assert.equal(receiver.summaries.get(102)?.brief, 'Weak');
});

test('imported reports are tied to this machine’s copy of the job', async () => {
  const receiver = syncedOnlyMachine();
  await receiver.importer().apply(await shareFile(scoredMachine()), keepMine);
  assert.equal(receiver.summaries.get(101)?.jobId, 7);
  assert.equal(receiver.summaries.get(101)?.jobTitle, 'Analyst (local title)');
});

test('what is already scored or written here is kept unless the person chooses to replace it', async () => {
  const receiver = syncedOnlyMachine();
  receiver.jobs.get(7)!.description = 'My own posting';
  receiver.score(101, makeSummary({ confidence: 20, brief: 'Mine' }));
  const bundle = await shareFile(scoredMachine());

  const result = await receiver.importer().apply(bundle, keepMine);

  assert.deepEqual(result, { jobsUpdated: 1, jobsFailed: 0, scoresFilled: 1, scoresReplaced: 0, scoresFailed: 0 });
  assert.equal(receiver.jobs.get(7)?.description, 'My own posting');
  assert.equal(receiver.scores['101'], 20);
  assert.equal(receiver.scores['102'], 40); // the unscored one was still filled
});

test('chosen conflicts are replaced', async () => {
  const receiver = syncedOnlyMachine();
  receiver.jobs.get(7)!.description = 'My own posting';
  receiver.score(101, makeSummary({ confidence: 20, brief: 'Mine' }));
  const bundle = await shareFile(scoredMachine());

  const result = await receiver.importer().apply(bundle, {
    replaceSettingsJobIds: [7],
    replaceScoreApplicationIds: [101],
  });

  assert.equal(result.scoresReplaced, 1);
  assert.equal(receiver.jobs.get(7)?.description, 'We are hiring an analyst.');
  assert.equal(receiver.scores['101'], 85);
  assert.equal(receiver.summaries.get(101)?.brief, 'Strong fit');
});

test('preview changes nothing', async () => {
  const receiver = syncedOnlyMachine();
  const plan = await receiver.importer().preview(await shareFile(scoredMachine()));
  assert.deepEqual(plan.jobs[0].scores.fill, [101, 102]);
  assert.deepEqual(receiver.scores, {});
  assert.equal(receiver.jobs.get(7)?.description, undefined);
});

test('importing the same file twice the second time finds nothing to do', async () => {
  const receiver = syncedOnlyMachine();
  const bundle = await shareFile(scoredMachine());
  await receiver.importer().apply(bundle, keepMine);

  const plan = await receiver.importer().preview(bundle);
  assert.equal(plan.jobs[0].description, 'same');
  assert.equal(plan.jobs[0].criteria, 'same');
  assert.deepEqual(plan.jobs[0].scores.fill, []);
  assert.deepEqual(plan.jobs[0].scores.conflicts, []);
  assert.equal(plan.jobs[0].scores.same, 2);
});

test('one applicant failing to save does not stop the rest', async () => {
  const receiver = syncedOnlyMachine();
  receiver.failSummaryFor = 101;

  const result = await receiver.importer().apply(await shareFile(scoredMachine()), keepMine);

  assert.equal(result.scoresFailed, 1);
  assert.equal(result.scoresFilled, 1);
  assert.equal(receiver.scores['101'], undefined);
  assert.equal(receiver.scores['102'], 40);
});

test('a job the receiver has not synced is skipped', async () => {
  const receiver = new FakeMachine();
  const result = await receiver.importer().apply(await shareFile(scoredMachine()), {
    replaceSettingsJobIds: [7],
    replaceScoreApplicationIds: [101, 102],
  });
  assert.deepEqual(result, { jobsUpdated: 0, jobsFailed: 0, scoresFilled: 0, scoresReplaced: 0, scoresFailed: 0 });
  assert.deepEqual(receiver.scores, {});
});

test('a file from a different BambooHR company is refused, whatever the ids', async () => {
  const receiver = syncedOnlyMachine();
  receiver.company = 'other-co';
  const bundle = await shareFile(scoredMachine());

  await assert.rejects(receiver.importer().preview(bundle), ImportRefusedError);
  await assert.rejects(receiver.importer().apply(bundle, keepMine), /different BambooHR company \(acme\)/);
  assert.deepEqual(receiver.scores, {});
});

test('the company check ignores capitalisation', async () => {
  const receiver = syncedOnlyMachine();
  receiver.company = 'ACME';
  await receiver.importer().preview(await shareFile(scoredMachine()));
});

test('importing is refused until BambooHR is connected', async () => {
  const receiver = syncedOnlyMachine();
  receiver.company = '';
  await assert.rejects(receiver.importer().preview(await shareFile(scoredMachine())), /Connect BambooHR first/);
});

test('salary flags worked out here are kept; judged flags come from the file', async () => {
  const receiver = syncedOnlyMachine();
  receiver.flags[101] = ['salary-high', 'studying'];
  const sender = scoredMachine();
  sender.flags[101] = ['tenure', 'salary-low'];

  await receiver.importer().apply(await shareFile(sender), keepMine);

  assert.deepEqual([...receiver.flags[101]].sort(), ['salary-high', 'tenure']);
});

test('replacing with a score that has no report removes the old report', async () => {
  const receiver = syncedOnlyMachine();
  receiver.score(101, makeSummary({ confidence: 20, brief: 'Old report' }));
  const sender = scoredMachine();
  sender.summaries.delete(101);

  await receiver.importer().apply(await shareFile(sender), {
    replaceSettingsJobIds: [],
    replaceScoreApplicationIds: [101],
  });

  assert.equal(receiver.scores['101'], 85);
  assert.equal(receiver.summaries.has(101), false);
});

test('a job whose settings cannot be saved is counted and the scores still import', async () => {
  const receiver = syncedOnlyMachine();
  receiver.failSettingsForJob = 7;

  const result = await receiver.importer().apply(await shareFile(scoredMachine()), keepMine);

  assert.equal(result.jobsFailed, 1);
  assert.equal(result.jobsUpdated, 0);
  assert.equal(result.scoresFilled, 2);
});

test('replacing criteria never un-confirms a job that was ready to score', async () => {
  const receiver = syncedOnlyMachine();
  receiver.jobs.get(7)!.scoringConfig = JSON.stringify({ different: true });
  receiver.jobs.get(7)!.criteriaConfirmedAt = 'confirmed here';
  const sender = scoredMachine();
  sender.jobs.get(7)!.criteriaConfirmedAt = undefined;

  await receiver.importer().apply(await shareFile(sender), {
    replaceSettingsJobIds: [7],
    replaceScoreApplicationIds: [],
  });

  assert.equal(receiver.jobs.get(7)?.criteriaConfirmedAt, 'confirmed here');
});
