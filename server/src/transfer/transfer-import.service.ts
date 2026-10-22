/**
 * Imports an export file: previews what would change, then applies it using the
 * person's decisions about conflicts. Fills never overwrite anything.
 */

import { ApplicationFlagsRepository } from '../repositories/application-flags.repository.js';
import { ApplicationSummaryRepository } from '../repositories/application-summary.repository.js';
import { ApplicationsRepository } from '../repositories/applications.repository.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import { ScoresRepository } from '../repositories/scores.repository.js';
import { config } from '../config/env.config.js';
import { parseStoredScoringConfig } from '../scoring/scoring-config.js';
import { mergeScoringFlags } from '../types/flags.js';
import type { ApplicantSummary } from '../types/summary.types.js';
import { mapInChunks } from './map-in-chunks.js';
import type { TransferApplication, TransferBundle, TransferJob } from './transfer-format.js';
import {
  planImport,
  selectWork,
  type ImportDecisions,
  type ImportPlan,
  type LocalApplicationState,
  type LocalJobState,
} from './transfer-plan.js';

/** Summary files read at once; enough to be quick without opening thousands together. */
const SUMMARY_READ_CONCURRENCY = 25;

export interface TransferImportDependencies {
  jobsRepo: Pick<JobsRepository, 'getById' | 'savePosting' | 'importCriteria'>;
  applicationsRepo: Pick<ApplicationsRepository, 'getById'>;
  scoresRepo: Pick<ScoresRepository, 'getAllScores' | 'setScore'>;
  summaryRepo: Pick<ApplicationSummaryRepository, 'getSummary' | 'saveSummary' | 'deleteSummary'>;
  flagsRepo: Pick<ApplicationFlagsRepository, 'getFlags' | 'setFlags'>;
  /** The connected BambooHR company; a file is only imported into the same one. */
  companySubdomain: () => string;
}

export interface ImportResult {
  /** Jobs whose posting or criteria were written. */
  jobsUpdated: number;
  /** Jobs whose posting or criteria could not be written. */
  jobsFailed: number;
  scoresFilled: number;
  scoresReplaced: number;
  /** Applicants that could not be written (the rest still were). */
  scoresFailed: number;
}

/** The file cannot be imported here; the message says why in plain language. */
export class ImportRefusedError extends Error {}

export class TransferImportService {
  private readonly dependencies: TransferImportDependencies;

  constructor(dependencies: Partial<TransferImportDependencies> = {}) {
    this.dependencies = {
      jobsRepo: new JobsRepository(),
      applicationsRepo: new ApplicationsRepository(),
      scoresRepo: new ScoresRepository(),
      summaryRepo: new ApplicationSummaryRepository(),
      flagsRepo: new ApplicationFlagsRepository(),
      companySubdomain: () => config.bambooHR.subdomain,
      ...dependencies,
    };
  }

  /** What importing this bundle would do right now. Changes nothing. */
  async preview(bundle: TransferBundle): Promise<ImportPlan> {
    this.assertSameCompany(bundle);
    const { localJobs, localApplications } = await this.readLocalState(bundle);
    return planImport(bundle, localJobs, localApplications);
  }

  async apply(bundle: TransferBundle, decisions: ImportDecisions): Promise<ImportResult> {
    // Plan again against the data as it is now, rather than trusting an earlier preview.
    const plan = await this.preview(bundle);
    const fillIds = new Set(plan.jobs.flatMap((job) => job.scores.fill));
    const jobsById = new Map(bundle.jobs.map((job) => [job.id, job]));
    const result: ImportResult = {
      jobsUpdated: 0,
      jobsFailed: 0,
      scoresFilled: 0,
      scoresReplaced: 0,
      scoresFailed: 0,
    };

    for (const work of selectWork(plan, decisions)) {
      const job = jobsById.get(work.jobId) as TransferJob;

      if (work.writeDescription || work.writeCriteria) {
        try {
          this.writeSettings(job, work.writeDescription, work.writeCriteria);
          result.jobsUpdated++;
        } catch (error) {
          console.error(`Failed to import the settings for job ${job.id}:`, error);
          result.jobsFailed++;
        }
      }

      const localTitle = this.dependencies.jobsRepo.getById(job.id)?.title ?? job.title;
      const applications = new Map(job.applications.map((application) => [application.id, application]));
      for (const applicationId of work.applicationIds) {
        const application = applications.get(applicationId);
        if (!application) continue;
        try {
          await this.writeScore(job.id, localTitle, application);
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

  /** Ids are only meaningful within one BambooHR company, so refuse a file from another. */
  private assertSameCompany(bundle: TransferBundle): void {
    const local = this.dependencies.companySubdomain().trim().toLowerCase();
    if (local === '') {
      throw new ImportRefusedError('Connect BambooHR first, then import this file.');
    }
    if (bundle.company.trim().toLowerCase() !== local) {
      throw new ImportRefusedError(
        `This file was exported from a different BambooHR company (${bundle.company}), ` +
          `and this app is connected to ${local}. Job and applicant ids would not match.`
      );
    }
  }

  private writeSettings(job: TransferJob, writeDescription: boolean, writeCriteria: boolean): void {
    const { jobsRepo } = this.dependencies;
    if (writeDescription && job.settings.description !== null) {
      jobsRepo.savePosting(job.id, { description: job.settings.description });
    }
    if (writeCriteria) {
      jobsRepo.importCriteria(job.id, {
        scoringConfigJson: job.settings.scoringConfig ? JSON.stringify(job.settings.scoringConfig) : null,
        criteriaConfirmedAt: job.settings.criteriaConfirmedAt,
      });
    }
  }

  /**
   * The report is written first and the score last: the score is what marks an applicant as
   * scored, so a failure part-way leaves them unscored (and a retry fills them) rather than
   * scored with a missing report.
   */
  private async writeScore(
    jobId: number,
    jobTitle: string,
    application: TransferApplication
  ): Promise<void> {
    const { summaryRepo, scoresRepo, flagsRepo } = this.dependencies;
    if (application.summary) {
      // Same shape as a locally scored report, tied to this machine's copy of the job.
      const summary: ApplicantSummary = {
        ...application.summary,
        confidence: application.score,
        jobId,
        jobTitle,
      };
      await summaryRepo.saveSummary(application.id, summary);
    } else {
      // A score with no report: an older local report would now contradict the new score.
      await summaryRepo.deleteSummary(application.id);
    }
    // The salary flags are worked out here from this machine's own thresholds and the
    // applicant's answer, so they are kept; only the judged flags come from the file.
    flagsRepo.setFlags(
      application.id,
      mergeScoringFlags(flagsRepo.getFlags(application.id), application.flags)
    );
    await scoresRepo.setScore(application.id, application.score);
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
        scoringConfig: parseStoredScoringConfig(local.scoringConfig),
        criteriaConfirmedAt: local.criteriaConfirmedAt ?? null,
      });
    }

    const scores = await scoresRepo.getAllScores();
    const found = bundle.jobs
      .flatMap((job) => job.applications)
      .flatMap((incoming) => {
        const local = applicationsRepo.getById(incoming.id);
        return local ? [local] : [];
      });
    const states = await mapInChunks(found, SUMMARY_READ_CONCURRENCY, async (local) => {
      const score = scores[local.id.toString()] ?? null;
      const summary = score === null ? null : await summaryRepo.getSummary(local.id);
      const state: LocalApplicationState = {
        id: local.id,
        jobId: local.jobId,
        score,
        report: summary ? { brief: summary.brief, full: summary.full, risks: summary.risks } : null,
      };
      return state;
    });
    return {
      localJobs,
      localApplications: new Map(states.map((state) => [state.id, state])),
    };
  }
}
