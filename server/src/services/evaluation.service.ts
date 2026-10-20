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
  /** Flags this evaluation judged (name / location / studying / no_exp / tenure). When
   *  provided, replaces the scoring-managed flags but preserves answer-derived
   *  salary flags; when omitted, all existing flags are left untouched. */
  flags?: ApplicationFlag[];
}

export class EvaluationService {
  private summaryRepo: ApplicationSummaryRepository;
  private scoresRepo: ScoresRepository;
  private applicationsRepo: ApplicationsRepository;
  private jobsRepo: JobsRepository;
  private flagsRepo: ApplicationFlagsRepository;
  private jobDescriptionService: JobDescriptionService;

  constructor() {
    this.summaryRepo = new ApplicationSummaryRepository();
    this.scoresRepo = new ScoresRepository();
    this.applicationsRepo = new ApplicationsRepository();
    this.jobsRepo = new JobsRepository();
    this.flagsRepo = new ApplicationFlagsRepository();
    this.jobDescriptionService = new JobDescriptionService();
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

    const { config } = this.jobDescriptionService.getScoringConfig(application.jobId);
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
