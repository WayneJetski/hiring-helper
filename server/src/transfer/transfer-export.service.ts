/**
 * Builds the export file: every job's settings and every scored applicant's score,
 * report and flags. Read-only.
 */

import { ApplicantsRepository } from '../repositories/applicants.repository.js';
import { ApplicationFlagsRepository } from '../repositories/application-flags.repository.js';
import { ApplicationSummaryRepository } from '../repositories/application-summary.repository.js';
import { ApplicationsRepository } from '../repositories/applications.repository.js';
import { JobsRepository, type Job } from '../repositories/jobs.repository.js';
import { ScoresRepository } from '../repositories/scores.repository.js';
import { parseStoredScoringConfig } from '../scoring/scoring-config.js';
import { config } from '../config/env.config.js';
import { mapInChunks } from './map-in-chunks.js';
import {
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  type TransferApplication,
  type TransferBundle,
  type TransferJob,
  type TransferJobSettings,
} from './transfer-format.js';

/** Summary files read at once; enough to be quick without opening thousands together. */
const SUMMARY_READ_CONCURRENCY = 25;

export interface TransferExportDependencies {
  jobsRepo: Pick<JobsRepository, 'getAll'>;
  applicationsRepo: Pick<ApplicationsRepository, 'getFiltered'>;
  applicantsRepo: Pick<ApplicantsRepository, 'getById'>;
  scoresRepo: Pick<ScoresRepository, 'getAllScores'>;
  summaryRepo: Pick<ApplicationSummaryRepository, 'getSummary'>;
  flagsRepo: Pick<ApplicationFlagsRepository, 'getFlagsMap'>;
  /** The connected BambooHR company, written into the file so it is only imported into the same one. */
  companySubdomain: () => string;
  now: () => Date;
}

function toSettings(job: Job): TransferJobSettings {
  return {
    description: job.description ?? null,
    scoringConfig: parseStoredScoringConfig(job.scoringConfig),
    criteriaConfirmedAt: job.criteriaConfirmedAt ?? null,
  };
}

function hasSettings(settings: TransferJobSettings): boolean {
  return (
    settings.description !== null ||
    settings.scoringConfig !== null ||
    settings.criteriaConfirmedAt !== null
  );
}

export class TransferExportService {
  private readonly dependencies: TransferExportDependencies;

  constructor(dependencies: Partial<TransferExportDependencies> = {}) {
    this.dependencies = {
      jobsRepo: new JobsRepository(),
      applicationsRepo: new ApplicationsRepository(),
      applicantsRepo: new ApplicantsRepository(),
      scoresRepo: new ScoresRepository(),
      summaryRepo: new ApplicationSummaryRepository(),
      flagsRepo: new ApplicationFlagsRepository(),
      companySubdomain: () => config.bambooHR.subdomain,
      now: () => new Date(),
      ...dependencies,
    };
  }

  async buildBundle(): Promise<TransferBundle> {
    const { jobsRepo, applicationsRepo, applicantsRepo, scoresRepo, summaryRepo, flagsRepo } =
      this.dependencies;
    const scores = await scoresRepo.getAllScores();
    const flagsByApplication = flagsRepo.getFlagsMap();

    const jobs: TransferJob[] = [];
    for (const job of jobsRepo.getAll()) {
      const scoredApplications = applicationsRepo
        .getFiltered({ jobId: job.id })
        .filter((application) => scores[application.id.toString()] !== undefined);
      const applications: TransferApplication[] = await mapInChunks(
        scoredApplications,
        SUMMARY_READ_CONCURRENCY,
        async (application) => {
          const applicant = applicantsRepo.getById(application.applicantId);
          return {
            id: application.id,
            name: applicant ? `${applicant.firstName} ${applicant.lastName}`.trim() : '',
            score: scores[application.id.toString()],
            summary: await summaryRepo.getSummary(application.id),
            flags: flagsByApplication[application.id] ?? [],
          };
        }
      );

      const settings = toSettings(job);
      // A job with nothing to share only adds noise to the file.
      if (!hasSettings(settings) && applications.length === 0) continue;
      jobs.push({ id: job.id, title: job.title, settings, applications });
    }

    return {
      format: TRANSFER_FORMAT,
      version: TRANSFER_VERSION,
      company: this.dependencies.companySubdomain(),
      exportedAt: this.dependencies.now().toISOString(),
      jobs,
    };
  }
}
