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
import { validateScoringConfig, type ScoringConfig } from '../scoring/scoring-config.js';
import {
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  type TransferApplication,
  type TransferBundle,
  type TransferJob,
  type TransferJobSettings,
} from './transfer-format.js';

export interface TransferExportDependencies {
  jobsRepo: Pick<JobsRepository, 'getAll'>;
  applicationsRepo: Pick<ApplicationsRepository, 'getFiltered'>;
  applicantsRepo: Pick<ApplicantsRepository, 'getById'>;
  scoresRepo: Pick<ScoresRepository, 'getAllScores'>;
  summaryRepo: Pick<ApplicationSummaryRepository, 'getSummary'>;
  flagsRepo: Pick<ApplicationFlagsRepository, 'getFlagsMap'>;
  now: () => Date;
}

/** The saved criteria as a validated config; corrupt stored JSON counts as "defaults". */
function readScoringConfig(json: string | undefined): ScoringConfig | null {
  if (!json) return null;
  try {
    const validated = validateScoringConfig(JSON.parse(json));
    return validated.ok ? validated.config : null;
  } catch {
    return null;
  }
}

function toSettings(job: Job): TransferJobSettings {
  return {
    description: job.description ?? null,
    scoringConfig: readScoringConfig(job.scoringConfig),
    legacyPrompt: job.systemPrompt ?? null,
    criteriaConfirmedAt: job.criteriaConfirmedAt ?? null,
  };
}

function hasSettings(settings: TransferJobSettings): boolean {
  return (
    settings.description !== null ||
    settings.scoringConfig !== null ||
    settings.legacyPrompt !== null ||
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
      const applications: TransferApplication[] = [];
      for (const application of applicationsRepo.getFiltered({ jobId: job.id })) {
        const score = scores[application.id.toString()];
        if (score === undefined) continue;
        const applicant = applicantsRepo.getById(application.applicantId);
        applications.push({
          id: application.id,
          name: applicant ? `${applicant.firstName} ${applicant.lastName}`.trim() : '',
          score,
          summary: await summaryRepo.getSummary(application.id),
          flags: flagsByApplication[application.id] ?? [],
        });
      }

      const settings = toSettings(job);
      // A job with nothing to share only adds noise to the file.
      if (!hasSettings(settings) && applications.length === 0) continue;
      jobs.push({ id: job.id, title: job.title, settings, applications });
    }

    return {
      format: TRANSFER_FORMAT,
      version: TRANSFER_VERSION,
      exportedAt: this.dependencies.now().toISOString(),
      jobs,
    };
  }
}
