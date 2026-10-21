/**
 * Jobs Controller
 * Handles HTTP requests for job postings, including per-job scoring config
 * (job description + system prompt) editable from the web UI.
 */

import type { Request, Response } from 'express';
import { UpstreamServiceError } from '../errors/upstream-error.js';
import { respondWithError } from '../errors/respond-with-error.js';
import { ApplicantQueryService } from '../services/applicant-query.service.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import { JobDescriptionService } from '../services/job-description.service.js';
import { fetchPostingText } from '../services/job-posting-fetcher.js';
import { validateScoringConfig, type ScoringConfig } from '../scoring/scoring-config.js';
import { getJobReadiness } from '../scoring/job-readiness.js';
import { validateSurveyAnswers } from '../scoring/rubric-generation.js';
import { ClaudeRunCancelledError, ClaudeRunError } from '../services/claude-runner.js';
import {
  GeneratorBusyError,
  JobNotFoundError,
  MissingPostingError,
  RubricGeneratorService,
  UnusableSuggestionError,
} from '../services/rubric-generator.service.js';
import { config } from '../config/env.config.js';

const applicantQueryService = new ApplicantQueryService();
const jobsRepository = new JobsRepository();
const jobDescriptionService = new JobDescriptionService();
const rubricGeneratorService = new RubricGeneratorService();

/**
 * Map a generation failure to an HTTP response. A cancelled request (the browser
 * went away) gets no response at all. Returns true when it handled the error.
 */
function respondToGenerationError(error: unknown, res: Response): void {
  if (error instanceof ClaudeRunCancelledError) return;
  if (error instanceof UpstreamServiceError) {
    respondWithError(res, error, 'Failed to generate criteria');
    return;
  }
  const known: Array<[new (...args: never[]) => Error, number, string]> = [
    [JobNotFoundError, 404, 'Not found'],
    [MissingPostingError, 400, 'No job posting'],
    [GeneratorBusyError, 409, 'Busy'],
    [UnusableSuggestionError, 502, 'Suggestion failed'],
    [ClaudeRunError, 502, 'Claude Code problem'],
  ];
  for (const [errorClass, status, label] of known) {
    if (error instanceof errorClass) {
      res.status(status).json({ error: label, message: (error as Error).message });
      return;
    }
  }
  console.error('Failed to generate criteria:', error);
  respondWithError(res, error, 'Failed to generate criteria');
}

/** An AbortSignal that fires if the browser disconnects before the reply is sent. */
function abortOnDisconnect(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

interface JobDetail {
  id: number;
  title: string;
  postingUrl: string | null;
  description: string;
  scoringConfig: ScoringConfig; // effective criteria (saved for this job, or the defaults)
  scoringConfigIsCustom: boolean;
  /** A hand-written rubric that could not be converted is still in use. */
  isLegacyPromptActive: boolean;
  /** Setup state: scoring is blocked until the posting exists and the criteria are confirmed. */
  hasPosting: boolean;
  isCriteriaConfirmed: boolean;
  isReadyToScore: boolean;
}

/** Raw (untrusted) body for a job config update. */
interface JobUpdateBody {
  description?: string;
  postingUrl?: string;
  scoringConfig?: unknown;
  /** Put the job back on the default criteria. */
  resetScoringConfig?: boolean;
  /** Mark the criteria as reviewed and accepted (saving new criteria does this too). */
  criteriaConfirmed?: boolean;
}

export class JobsController {
  /**
   * GET /api/jobs
   * List jobs with application counts and latest activity (most recent first).
   */
  async getJobs(_req: Request, res: Response): Promise<void> {
    try {
      const jobs = applicantQueryService.listJobs();
      res.json({ data: jobs, count: jobs.length });
    } catch (error) {
      console.error('Failed to get jobs:', error);
      respondWithError(res, error, 'Failed to fetch jobs');
    }
  }

  /**
   * Assemble the editable config for a job: its effective description and
   * scoring system prompt (per-job override or the global default), so the web
   * editor can be pre-filled. Returns null if the job does not exist.
   */
  private async buildJobDetail(id: number): Promise<JobDetail | null> {
    const job = jobsRepository.getById(id);
    if (!job) return null;
    const description = (await jobDescriptionService.getJobDescription(id)) ?? '';
    const scoring = jobDescriptionService.getScoringConfig(id);
    return {
      id: job.id,
      title: job.title,
      postingUrl: job.postingUrl ?? null,
      description,
      scoringConfig: scoring.config,
      scoringConfigIsCustom: scoring.isCustom,
      isLegacyPromptActive: scoring.isLegacyPromptActive,
      ...getJobReadiness(job),
    };
  }

  /**
   * GET /api/jobs/:id
   * The job's editable scoring config (description + effective system prompt).
   */
  async getJobDetail(req: Request<{ id: string }>, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid request', message: 'id must be a number' });
        return;
      }
      const detail = await this.buildJobDetail(id);
      if (!detail) {
        res.status(404).json({ error: 'Not found', message: `No job with ID ${id}` });
        return;
      }
      res.json({ data: detail });
    } catch (error) {
      console.error('Failed to get job detail:', error);
      respondWithError(res, error, 'Failed to fetch job detail');
    }
  }

  /**
   * PATCH /api/jobs/:id
   * Update a job's scoring config (local only): description / posting URL and/or
   * the per-job scoring criteria. `resetScoringConfig: true` puts the job back on
   * the default criteria.
   */
  async updateJob(
    req: Request<{ id: string }, unknown, JobUpdateBody>,
    res: Response
  ): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid request', message: 'id must be a number' });
        return;
      }
      const job = jobsRepository.getById(id);
      if (!job) {
        res.status(404).json({ error: 'Not found', message: `No job with ID ${id}` });
        return;
      }

      const { description, postingUrl, scoringConfig, resetScoringConfig, criteriaConfirmed } =
        req.body ?? {};
      for (const [key, value] of Object.entries({ description, postingUrl })) {
        if (value !== undefined && typeof value !== 'string') {
          res.status(400).json({ error: 'Invalid request', message: `${key} must be a string` });
          return;
        }
      }

      // Validate the criteria before saving anything, so a rejected change never
      // leaves the posting half-saved.
      if (scoringConfig !== undefined) {
        const validated = validateScoringConfig(scoringConfig);
        if (!validated.ok) {
          res.status(400).json({ error: 'Invalid scoring criteria', message: validated.error });
          return;
        }
      }

      if (description !== undefined || postingUrl !== undefined) {
        // savePosting requires a description; preserve the existing one when only
        // the URL is being changed.
        jobDescriptionService.saveJobPosting(id, {
          description: (description as string | undefined) ?? job.description ?? '',
          postingUrl: postingUrl as string | undefined,
        });
      }
      if (resetScoringConfig === true) {
        jobDescriptionService.resetScoringConfig(id);
      } else if (scoringConfig !== undefined) {
        jobDescriptionService.saveScoringConfig(id, scoringConfig);
      }
      if (criteriaConfirmed === true) {
        jobDescriptionService.confirmCriteria(id);
      }

      const detail = await this.buildJobDetail(id);
      res.json({ data: detail });
    } catch (error) {
      console.error('Failed to update job:', error);
      respondWithError(res, error, 'Failed to update job');
    }
  }

  /**
   * POST /api/jobs/:id/import-posting
   * Fetch the job's public posting text from the BambooHR careers site and
   * return it WITHOUT saving, so the editor can show it for review. Saving goes
   * through PATCH /api/jobs/:id like any other edit.
   */
  async importPosting(req: Request<{ id: string }>, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid request', message: 'id must be a number' });
        return;
      }
      if (!jobsRepository.getById(id)) {
        res.status(404).json({ error: 'Not found', message: `No job with ID ${id}` });
        return;
      }
      const description = await fetchPostingText(config.bambooHR.subdomain, id);
      if (!description) {
        res.status(404).json({
          error: 'No public posting',
          message:
            'BambooHR has no public posting text for this job (it may be closed or unpublished). Paste it in manually.',
        });
        return;
      }
      res.json({ data: { description } });
    } catch (error) {
      console.error('Failed to import posting:', error);
      respondWithError(res, error, 'Failed to import posting');
    }
  }

  /**
   * POST /api/jobs/:id/criteria/questions
   * A short multiple-choice survey tailored to the role (generated by Claude).
   */
  async suggestCriteriaQuestions(req: Request<{ id: string }>, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid request', message: 'id must be a number' });
        return;
      }
      const result = await rubricGeneratorService.suggestQuestions(id, abortOnDisconnect(res));
      res.json({ data: result });
    } catch (error) {
      respondToGenerationError(error, res);
    }
  }

  /**
   * POST /api/jobs/:id/criteria/suggest  { answers? }
   * A draft of evaluation areas and weights. With `answers` (from the survey)
   * they shape the result; without, it is generated straight from the posting.
   * Nothing is saved: the editor applies and saves it.
   */
  async suggestCriteria(
    req: Request<{ id: string }, unknown, { answers?: unknown }>,
    res: Response
  ): Promise<void> {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: 'Invalid request', message: 'id must be a number' });
        return;
      }
      let answers: Array<{ question: string; answer: string }> = [];
      if (req.body?.answers !== undefined) {
        const validated = validateSurveyAnswers(req.body.answers);
        if (!validated.ok) {
          res.status(400).json({ error: 'Invalid request', message: validated.error });
          return;
        }
        answers = validated.value;
      }
      const result = await rubricGeneratorService.suggestCriteria(id, answers, abortOnDisconnect(res));
      res.json({ data: result });
    } catch (error) {
      respondToGenerationError(error, res);
    }
  }
}
