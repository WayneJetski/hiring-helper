/**
 * Evaluation Service
 * Persists candidate evaluations (confidence score + written summary) to the
 * local store. Scoring itself is performed by Claude through the MCP layer;
 * this service only validates and writes the result.
 */

import { ApplicationSummaryRepository } from '../repositories/application-summary.repository.js';
import { ScoresRepository } from '../repositories/scores.repository.js';
import { ApplicationsRepository } from '../repositories/applications.repository.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import { ApplicationFlagsRepository } from '../repositories/application-flags.repository.js';
import { JobDescriptionService } from './job-description.service.js';
import { applyFlagPenalties } from '../scoring/flag-penalties.js';
import { validateAreaScores, type AreaScoreInput, type AreaScore } from '../scoring/area-scores.js';
import { deriveSalaryFlags, reconcileSalaryFlags } from '../scoring/salary.js';
import type { ApplicantSummary } from '../types/summary.types.js';
import { mergeScoringFlags, type ApplicationFlag } from '../types/flags.js';

const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 100;

export interface EvaluationInput {
  confidence: number;
  brief: string;
  full: string;
  risks?: string;
  suggestedScreeningQuestions?: string[];
  /** Points given to each evaluation area; must cover every area and add up to `confidence`.
   *  Ignored for a job still scored on a legacy hand-written rubric (its areas are not known). */
  areaScores?: AreaScoreInput[];
  /** Flags this evaluation judged (name / location / studying / no_exp / tenure). When
   *  provided, replaces the scoring-managed flags but preserves answer-derived
   *  salary flags; when omitted, all existing flags are left untouched. */
  flags?: ApplicationFlag[];
}

/** What the service reads and writes; injectable so tests need no database or disk. */
export interface EvaluationDependencies {
  summaryRepo: Pick<ApplicationSummaryRepository, 'saveSummary' | 'getSummary'>;
  scoresRepo: Pick<ScoresRepository, 'setScore'>;
  applicationsRepo: Pick<ApplicationsRepository, 'getById'>;
  jobsRepo: Pick<JobsRepository, 'getById'>;
  flagsRepo: Pick<ApplicationFlagsRepository, 'getFlags' | 'setFlags'>;
  jobDescriptionService: Pick<JobDescriptionService, 'getScoringConfig'>;
}

export class EvaluationService {
  private summaryRepo: EvaluationDependencies['summaryRepo'];
  private scoresRepo: EvaluationDependencies['scoresRepo'];
  private applicationsRepo: EvaluationDependencies['applicationsRepo'];
  private jobsRepo: EvaluationDependencies['jobsRepo'];
  private flagsRepo: EvaluationDependencies['flagsRepo'];
  private jobDescriptionService: EvaluationDependencies['jobDescriptionService'];

  constructor(dependencies: Partial<EvaluationDependencies> = {}) {
    this.summaryRepo = dependencies.summaryRepo ?? new ApplicationSummaryRepository();
    this.scoresRepo = dependencies.scoresRepo ?? new ScoresRepository();
    this.applicationsRepo = dependencies.applicationsRepo ?? new ApplicationsRepository();
    this.jobsRepo = dependencies.jobsRepo ?? new JobsRepository();
    this.flagsRepo = dependencies.flagsRepo ?? new ApplicationFlagsRepository();
    this.jobDescriptionService = dependencies.jobDescriptionService ?? new JobDescriptionService();
  }

  /**
   * Save a full evaluation for an application: the written summary is cached to
   * disk and the numeric confidence is written to the scores table. The model's
   * score is a merit score; when it reports flags, the job's configured flag
   * penalties are applied here and the saved score is the final one.
   * @throws Error when the application is unknown or the confidence is out of range.
   */
  async saveEvaluation(
    applicationId: number,
    input: EvaluationInput
  ): Promise<ApplicantSummary> {
    const application = this.applicationsRepo.getById(applicationId);
    if (!application) {
      throw new Error(`No application found with ID ${applicationId}`);
    }

    if (
      !Number.isInteger(input.confidence) ||
      input.confidence < MIN_CONFIDENCE ||
      input.confidence > MAX_CONFIDENCE
    ) {
      throw new Error(
        `confidence must be an integer between ${MIN_CONFIDENCE} and ${MAX_CONFIDENCE}`
      );
    }

    const job = this.jobsRepo.getById(application.jobId);

    const { config, isLegacyPromptActive } = this.jobDescriptionService.getScoringConfig(
      application.jobId
    );

    let areaScores: AreaScore[] | undefined;
    if (input.areaScores !== undefined && !isLegacyPromptActive) {
      const checked = validateAreaScores(input.areaScores, config.dimensions, input.confidence);
      if (!checked.ok) throw new Error(checked.error);
      areaScores = checked.areaScores;
    }
    // Desired pay is checked by the app, from the stored application answer.
    const salaryFlags = deriveSalaryFlags(application.desiredSalary, config.redFlags);
    const { score, appliedPenalties } = applyFlagPenalties(
      input.confidence,
      [...(input.flags ?? []), ...salaryFlags],
      config
    );

    const summary: ApplicantSummary = {
      confidence: score,
      brief: input.brief,
      full: input.full,
      risks: input.risks ?? '',
      suggestedScreeningQuestions: input.suggestedScreeningQuestions,
      generatedAt: new Date().toISOString(),
      jobTitle: job?.title,
      jobId: job?.id,
      ...(areaScores && { areaScores }),
      ...(appliedPenalties.length > 0 && {
        scoreAdjustment: { meritScore: input.confidence, penalties: appliedPenalties },
      }),
    };

    await this.summaryRepo.saveSummary(applicationId, summary);
    await this.scoresRepo.setScore(applicationId, score);

    // Update flags only when the caller provides them. Scoring owns the
    // resume-judged flags (name/location/studying/no_exp/tenure) and replaces them, but
    // must PRESERVE the answer-derived salary flags — otherwise (re)scoring would
    // silently wipe them. Omitting `flags` leaves all existing flags untouched.
    // Salary flags this job checks are recomputed on every save (a changed
    // threshold or corrected pay takes effect when re-scored).
    const isSalaryChecked = config.redFlags.salaryLow.enabled || config.redFlags.salaryHigh.enabled;
    if (input.flags !== undefined || isSalaryChecked) {
      const existing = this.flagsRepo.getFlags(applicationId);
      const scored = input.flags !== undefined ? mergeScoringFlags(existing, input.flags) : existing;
      this.flagsRepo.setFlags(
        applicationId,
        reconcileSalaryFlags(scored, salaryFlags, config.redFlags)
      );
    }

    return summary;
  }

  /**
   * Get the cached evaluation summary for an application, or null.
   */
  async getEvaluation(applicationId: number): Promise<ApplicantSummary | null> {
    return this.summaryRepo.getSummary(applicationId);
  }
}
