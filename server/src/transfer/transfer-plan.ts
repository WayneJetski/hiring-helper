/**
 * Works out what importing a bundle would do, without touching anything. Pure, so the
 * rules are tested without a database.
 *
 * Rules: anything missing locally is filled in without asking. Anything that exists
 * locally and differs from the file is a conflict the person decides on. Identical data
 * is left alone. Jobs and applicants the local app does not have (not synced yet) are
 * skipped and counted.
 */

import type { ScoringConfig } from '../scoring/scoring-config.js';
import type { TransferBundle, TransferJob } from './transfer-format.js';

export interface LocalJobState {
  id: number;
  description: string | null;
  scoringConfig: ScoringConfig | null;
  criteriaConfirmedAt: string | null;
}

export interface LocalApplicationState {
  id: number;
  jobId: number;
  /** Null when the applicant has not been scored here. */
  score: number | null;
  /** The saved report's text, used to tell an identical score from a different one. */
  report: { brief: string; full: string; risks: string } | null;
}

export type SettingAction = 'none' | 'fill' | 'same' | 'conflict';

export interface ScoreConflict {
  applicationId: number;
  name: string;
  currentScore: number;
  importedScore: number;
}

export interface JobPlan {
  jobId: number;
  title: string;
  /** False when the job has not been synced to this machine, so nothing is imported for it. */
  isSynced: boolean;
  description: SettingAction;
  criteria: SettingAction;
  scores: {
    /** Applicants with no score here: filled without asking. */
    fill: number[];
    /** Applicants already scored here with a different score or report. */
    conflicts: ScoreConflict[];
    /** Applicants already scored identically. */
    same: number;
    /** Applicants in the file that this machine does not have. */
    notFound: number;
  };
}

export interface ImportPlan {
  jobs: JobPlan[];
}

/** What the person chose for the conflicts. Fills never need a decision. */
export interface ImportDecisions {
  replaceSettingsJobIds: number[];
  replaceScoreApplicationIds: number[];
}

/** The writes to make for one job once decisions are applied. */
export interface JobWork {
  jobId: number;
  writeDescription: boolean;
  writeCriteria: boolean;
  applicationIds: number[];
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === '';
}

function planDescription(incoming: string | null, local: string | null): SettingAction {
  if (isBlank(incoming)) return 'none';
  if (isBlank(local)) return 'fill';
  return (incoming as string).trim() === (local as string).trim() ? 'same' : 'conflict';
}

interface CriteriaSnapshot {
  scoringConfig: ScoringConfig | null;
  criteriaConfirmedAt: string | null;
}

function hasCriteria(criteria: CriteriaSnapshot): boolean {
  return criteria.scoringConfig !== null || criteria.criteriaConfirmedAt !== null;
}

/**
 * Whether two jobs score the same way. Confirmation is not compared: replacing never
 * un-confirms a job, so a different confirmation state alone is not worth asking about.
 */
function sameCriteria(a: CriteriaSnapshot, b: CriteriaSnapshot): boolean {
  return JSON.stringify(a.scoringConfig) === JSON.stringify(b.scoringConfig);
}

function planCriteria(incoming: CriteriaSnapshot, local: CriteriaSnapshot): SettingAction {
  if (!hasCriteria(incoming)) return 'none';
  if (!hasCriteria(local)) return 'fill';
  return sameCriteria(incoming, local) ? 'same' : 'conflict';
}

function isSameReport(
  local: LocalApplicationState['report'],
  incoming: { brief: string; full: string; risks: string } | null
): boolean {
  // A file with a score but no report cannot differ from the local report.
  if (incoming === null) return true;
  return (
    local !== null &&
    local.brief === incoming.brief &&
    local.full === incoming.full &&
    local.risks === incoming.risks
  );
}

function planJob(
  job: TransferJob,
  localJob: LocalJobState | undefined,
  localApplications: ReadonlyMap<number, LocalApplicationState>
): JobPlan {
  const scores: JobPlan['scores'] = { fill: [], conflicts: [], same: 0, notFound: 0 };
  if (!localJob) {
    scores.notFound = job.applications.length;
    return {
      jobId: job.id,
      title: job.title,
      isSynced: false,
      description: 'none',
      criteria: 'none',
      scores,
    };
  }

  for (const application of job.applications) {
    const local = localApplications.get(application.id);
    if (!local || local.jobId !== job.id) {
      scores.notFound++;
    } else if (local.score === null) {
      scores.fill.push(application.id);
    } else if (local.score === application.score && isSameReport(local.report, application.summary)) {
      scores.same++;
    } else {
      scores.conflicts.push({
        applicationId: application.id,
        name: application.name,
        currentScore: local.score,
        importedScore: application.score,
      });
    }
  }

  return {
    jobId: job.id,
    title: job.title,
    isSynced: true,
    description: planDescription(job.settings.description, localJob.description),
    criteria: planCriteria(job.settings, localJob),
    scores,
  };
}

export function planImport(
  bundle: TransferBundle,
  localJobs: ReadonlyMap<number, LocalJobState>,
  localApplications: ReadonlyMap<number, LocalApplicationState>
): ImportPlan {
  return {
    jobs: bundle.jobs.map((job) => planJob(job, localJobs.get(job.id), localApplications)),
  };
}

/** Turn a plan and the person's decisions into the writes to make. */
export function selectWork(plan: ImportPlan, decisions: ImportDecisions): JobWork[] {
  const replaceSettings = new Set(decisions.replaceSettingsJobIds);
  const replaceScores = new Set(decisions.replaceScoreApplicationIds);

  return plan.jobs
    .filter((job) => job.isSynced)
    .map((job) => {
      const isReplacingSettings = replaceSettings.has(job.jobId);
      const shouldWrite = (action: SettingAction): boolean =>
        action === 'fill' || (action === 'conflict' && isReplacingSettings);
      return {
        jobId: job.jobId,
        writeDescription: shouldWrite(job.description),
        writeCriteria: shouldWrite(job.criteria),
        applicationIds: [
          ...job.scores.fill,
          ...job.scores.conflicts
            .map((conflict) => conflict.applicationId)
            .filter((applicationId) => replaceScores.has(applicationId)),
        ],
      };
    })
    .filter((work) => work.writeDescription || work.writeCriteria || work.applicationIds.length > 0);
}
