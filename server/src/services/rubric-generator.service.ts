/**
 * Rubric Generator Service
 *
 * Suggests scoring criteria for a job using Claude (through ClaudeRunner), in
 * two ways: straight from the job posting, or after a short survey whose
 * questions are tailored to the role. Results are drafts only; nothing is saved
 * here, a person reviews them in the editor and saves.
 *
 * One generation runs at a time, since each one spends tokens on the host's
 * Claude account.
 */

import { ClaudeRunner } from './claude-runner.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import {
  FALLBACK_QUESTIONS,
  buildCriteriaPrompt,
  buildQuestionsPrompt,
  parseCriteriaResponse,
  parseQuestionsResponse,
  type GeneratedCriteria,
  type SurveyAnswer,
  type SurveyQuestion,
} from '../scoring/rubric-generation.js';

export class JobNotFoundError extends Error {}
/** The job has no posting text to base suggestions on. */
export class MissingPostingError extends Error {
  constructor() {
    super('Load or paste the job posting first. Suggestions are based on it.');
  }
}
/** Another suggestion is already being generated. */
export class GeneratorBusyError extends Error {
  constructor() {
    super('A suggestion is already being generated. Please wait for it to finish.');
  }
}
/** The model replied, but not with anything usable, even after a retry. */
export class UnusableSuggestionError extends Error {
  constructor() {
    super('The suggestion could not be understood. Please try again.');
  }
}

interface TextRunner {
  run(prompt: string, signal?: AbortSignal): Promise<string>;
}

interface JobLookup {
  getById(id: number): { title: string; description?: string } | null;
}

export class RubricGeneratorService {
  private isBusy = false;

  constructor(
    private readonly runner: TextRunner = new ClaudeRunner(),
    private readonly jobs: JobLookup = new JobsRepository()
  ) {}

  private loadJob(jobId: number): { title: string; description: string } {
    const job = this.jobs.getById(jobId);
    if (!job) throw new JobNotFoundError(`No job with ID ${jobId}`);
    const description = (job.description ?? '').trim();
    if (description === '') throw new MissingPostingError();
    return { title: job.title, description };
  }

  /** Run one generation exclusively, releasing the lock however it ends. */
  private async exclusively<T>(work: () => Promise<T>): Promise<T> {
    if (this.isBusy) throw new GeneratorBusyError();
    this.isBusy = true;
    try {
      return await work();
    } finally {
      this.isBusy = false;
    }
  }

  /**
   * A short multiple-choice survey tailored to the role. If the model's reply is
   * not usable, a sensible general survey is returned instead (and flagged), so
   * the user is never stuck at this step.
   */
  suggestQuestions(
    jobId: number,
    signal?: AbortSignal
  ): Promise<{ questions: SurveyQuestion[]; isGeneric: boolean }> {
    const job = this.loadJob(jobId);
    return this.exclusively(async () => {
      const parsed = parseQuestionsResponse(await this.runner.run(buildQuestionsPrompt(job), signal));
      return parsed.ok
        ? { questions: parsed.value, isGeneric: false }
        : { questions: FALLBACK_QUESTIONS, isGeneric: true };
    });
  }

  /**
   * Suggested evaluation areas and weights. With survey answers they shape the
   * result; without any, it is generated straight from the posting. One retry is
   * made if the first reply cannot be read.
   */
  suggestCriteria(
    jobId: number,
    answers: SurveyAnswer[] = [],
    signal?: AbortSignal
  ): Promise<GeneratedCriteria> {
    const job = this.loadJob(jobId);
    return this.exclusively(async () => {
      const prompt = buildCriteriaPrompt(job, answers);
      const first = parseCriteriaResponse(await this.runner.run(prompt, signal));
      if (first.ok) return first.value;

      const retry = parseCriteriaResponse(
        await this.runner.run(
          `${prompt}\n\nYour previous reply could not be used (${first.error}). Reply again with ONLY the JSON object described above.`,
          signal
        )
      );
      if (retry.ok) return retry.value;
      throw new UnusableSuggestionError();
    });
  }
}
