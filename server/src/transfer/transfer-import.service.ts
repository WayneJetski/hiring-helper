/**
 * Imports an export file: previews what would change, then applies it using the
 * person's decisions about conflicts. Fills never overwrite anything.
 */

import { ApplicationFlagsRepository } from '../repositories/application-flags.repository.js';
import { ApplicationSummaryRepository } from '../repositories/application-summary.repository.js';
import { ApplicationsRepository } from '../repositories/applications.repository.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import { ScoresRepository } from '../repositories/scores.repository.js';
import { validateScoringConfig, type ScoringConfig } from '../scoring/scoring-config.js';
import type { ApplicantSummary } from '../types/summary.types.js';
import type { TransferBundle, TransferJob } from './transfer-format.js';
import {
  planImport,
  selectWork,
  type ImportDecisions,
  type ImportPlan,
  type LocalApplicationState,
  type LocalJobState,
} from './transfer-plan.js';

export interface TransferImportDependencies {
  jobsRepo: Pick<JobsRepository, 'getById' | 'savePosting' | 'importCriteria'>;
  applicationsRepo: Pick<ApplicationsRepository, 'getById'>;
  scoresRepo: Pick<ScoresRepository, 'getAllScores' | 'setScore'>;
  summaryRepo: Pick<ApplicationSummaryRepository, 'getSummary' | 'saveSummary'>;
  flagsRepo: Pick<ApplicationFlagsRepository, 'setFlags'>;
}

export interface ImportResult {
  /** Jobs whose posting or criteria were written. */
  jobsUpdated: number;
  scoresFilled: number;
  scoresReplaced: number;
  /** Applicants that could not be written (the rest still were). */
  scoresFailed: number;
}

function readScoringConfig(json: string | undefined): ScoringConfig | null {
  if (!json) return null;
  try {
    const validated = validateScoringConfig(JSON.parse(json));
    return validated.ok ? validated.config : null;
  } catch {
    return null;
  }
}

export class TransferImportService {
  private readonly dependencies: TransferImportDependencies;

  constructor(dependencies: Partial<TransferImportDependencies> = {}) {
    this.dependencies = {
      jobsRepo: new JobsRepository(),
      applicationsRepo: new ApplicationsRepository(),
      scoresRepo: new ScoresRepository(),
      summaryRepo: new ApplicationSummaryRepository(),
      flagsRepo: new ApplicationFlagsRepository(),
      ...dependencies,
    };
  }

  /** What importing this bundle would do right now. Changes nothing. */
  async preview(bundle: TransferBundle): Promise<ImportPlan> {
    const { localJobs, localApplications } = await this.readLocalState(bundle);
    return planImport(bundle, localJobs, localApplications);
  }

  async apply(bundle: TransferBundle, decisions: ImportDecisions): Promise<ImportResult> {
    // Plan again against the data as it is now, rather than trusting an earlier preview.
    const plan = await this.preview(bundle);
    const fillIds = new Set(plan.jobs.flatMap((job) => job.scores.fill));
    const jobsById = new Map(bundle.jobs.map((job) => [job.id, job]));
    const result: ImportResult = { jobsUpdated: 0, scoresFilled: 0, scoresReplaced: 0, scoresFailed: 0 };

    for (const work of selectWork(plan, decisions)) {
      const job = jobsById.get(work.jobId) as TransferJob;
      if (this.writeSettings(job, work.writeDescription, work.writeCriteria)) result.jobsUpdated++;

      const applications = new Map(job.applications.map((application) => [application.id, application]));
      for (const applicationId of work.applicationIds) {
        const application = applications.get(applicationId);
        if (!application) continue;
        try {
          await this.writeScore(job, application);
          if (fillIds.has(applicationId)) result.scoresFilled++;
          else result.scoresReplaced++;
        } catch (error) {
          console.error(`Failed to import the score for application ${applicationId}:`, error);
          result.scoresFailed++;
        }
      }
    }
    return result;
  }

  private writeSettings(job: TransferJob, writeDescription: boolean, writeCriteria: boolean): boolean {
    const { jobsRepo } = this.dependencies;
    if (writeDescription && job.settings.description !== null) {
      jobsRepo.savePosting(job.id, { description: job.settings.description });
    }
    if (writeCriteria) {
      jobsRepo.importCriteria(job.id, {
        scoringConfigJson: job.settings.scoringConfig ? JSON.stringify(job.settings.scoringConfig) : null,
        legacyPrompt: job.settings.legacyPrompt,
        criteriaConfirmedAt: job.settings.criteriaConfirmedAt,
      });
    }
    return writeDescription || writeCriteria;
  }

  private async writeScore(job: TransferJob, application: TransferJob['applications'][number]): Promise<void> {
    const { summaryRepo, scoresRepo, flagsRepo, jobsRepo } = this.dependencies;
    if (application.summary) {
      // Same shape as a locally scored report, tied to this machine's copy of the job.
      const summary: ApplicantSummary = {
        ...application.summary,
        confidence: application.score,
        jobId: job.id,
        jobTitle: jobsRepo.getById(job.id)?.title ?? job.title,
      };
      await summaryRepo.saveSummary(application.id, summary);
    }
    await scoresRepo.setScore(application.id, application.score);
    flagsRepo.setFlags(application.id, application.flags);
  }

  private async readLocalState(bundle: TransferBundle): Promise<{
    localJobs: Map<number, LocalJobState>;
    localApplications: Map<number, LocalApplicationState>;
  }> {
    const { jobsRepo, applicationsRepo, scoresRepo, summaryRepo } = this.dependencies;
    const localJobs = new Map<number, LocalJobState>();
    for (const job of bundle.jobs) {
      const local = jobsRepo.getById(job.id);
      if (!local) continue;
      localJobs.set(job.id, {
        id: local.id,
        description: local.description ?? null,
        scoringConfig: readScoringConfig(local.scoringConfig),
        legacyPrompt: local.systemPrompt ?? null,
        criteriaConfirmedAt: local.criteriaConfirmedAt ?? null,
      });
    }

    const scores = await scoresRepo.getAllScores();
    const localApplications = new Map<number, LocalApplicationState>();
    for (const job of bundle.jobs) {
      for (const incoming of job.applications) {
        const local = applicationsRepo.getById(incoming.id);
        if (!local) continue;
        const score = scores[incoming.id.toString()] ?? null;
        const summary = score === null ? null : await summaryRepo.getSummary(incoming.id);
        localApplications.set(incoming.id, {
          id: local.id,
          jobId: local.jobId,
          score,
          report: summary ? { brief: summary.brief, full: summary.full, risks: summary.risks } : null,
        });
      }
    }
    return { localJobs, localApplications };
  }
}
