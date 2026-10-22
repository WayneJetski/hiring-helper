/**
 * Turns the server's import preview into the few numbers and lists the confirmation
 * dialog shows, and turns the person's choices back into the decisions the server expects.
 */

import type { ImportDecisions, ImportPlan, ImportResult, ScoreConflict } from '../types/transfer.types';

export interface ScoreConflictRow extends ScoreConflict {
  jobTitle: string;
}

export interface ImportPlanSummary {
  /** Jobs in the file that this machine has not synced, so they are skipped. */
  notSyncedJobTitles: string[];
  /** Jobs whose posting or criteria are empty here and will be filled. */
  settingsToFillCount: number;
  /** Jobs that already have a posting or criteria that differ from the file. */
  settingsConflicts: Array<{ jobId: number; title: string }>;
  scoresToFillCount: number;
  scoreConflicts: ScoreConflictRow[];
  /** Applicants already scored identically. */
  scoresSameCount: number;
  /** Applicants in the file that this machine does not have. */
  applicantsNotFoundCount: number;
  /** False when the import would change nothing, whatever the person chooses. */
  hasWork: boolean;
}

export function summarizeImportPlan(plan: ImportPlan): ImportPlanSummary {
  const summary: ImportPlanSummary = {
    notSyncedJobTitles: [],
    settingsToFillCount: 0,
    settingsConflicts: [],
    scoresToFillCount: 0,
    scoreConflicts: [],
    scoresSameCount: 0,
    applicantsNotFoundCount: 0,
    hasWork: false,
  };

  for (const job of plan.jobs) {
    if (!job.isSynced) {
      summary.notSyncedJobTitles.push(job.title);
      continue;
    }
    const actions = [job.description, job.criteria];
    if (actions.includes('fill')) summary.settingsToFillCount++;
    if (actions.includes('conflict')) summary.settingsConflicts.push({ jobId: job.jobId, title: job.title });
    summary.scoresToFillCount += job.scores.fill.length;
    summary.scoreConflicts.push(...job.scores.conflicts.map((conflict) => ({ ...conflict, jobTitle: job.title })));
    summary.scoresSameCount += job.scores.same;
    summary.applicantsNotFoundCount += job.scores.notFound;
  }

  summary.hasWork =
    summary.settingsToFillCount > 0 ||
    summary.settingsConflicts.length > 0 ||
    summary.scoresToFillCount > 0 ||
    summary.scoreConflicts.length > 0;
  return summary;
}

export interface ImportChoices {
  replaceSettings: boolean;
  replaceScores: boolean;
}

/** Fills never need a decision; only the conflicts the person chose to replace are listed. */
export function buildDecisions(summary: ImportPlanSummary, choices: ImportChoices): ImportDecisions {
  return {
    replaceSettingsJobIds: choices.replaceSettings
      ? summary.settingsConflicts.map((conflict) => conflict.jobId)
      : [],
    replaceScoreApplicationIds: choices.replaceScores
      ? summary.scoreConflicts.map((conflict) => conflict.applicationId)
      : [],
  };
}

/** One sentence on what an import did, for the message shown afterwards. */
export function describeImportResult(result: ImportResult): string {
  const imported = result.scoresFilled + result.scoresReplaced;
  const parts: string[] = [];
  if (result.jobsUpdated > 0) {
    parts.push(`updated settings for ${result.jobsUpdated} job${result.jobsUpdated !== 1 ? 's' : ''}`);
  }
  if (imported > 0) {
    parts.push(`imported ${imported} score${imported !== 1 ? 's' : ''}`);
  }
  let text =
    parts.length > 0 ? `Import finished: ${parts.join(' and ')}.` : 'Import finished: nothing needed changing.';
  if (result.scoresFailed > 0) {
    text += ` ${result.scoresFailed} applicant${result.scoresFailed !== 1 ? 's' : ''} could not be saved.`;
  }
  if (result.jobsFailed > 0) {
    text += ` Settings for ${result.jobsFailed} job${result.jobsFailed !== 1 ? 's' : ''} could not be saved.`;
  }
  return text;
}
