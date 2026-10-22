/**
 * Scoring Controller
 * Starts / reports a headless-Claude-Code scoring run. See ScoringService.
 */

import { parseFlagFilter, parseScoreFilter, type FlagFilter, type ScoreFilter } from '../repositories/ai-filters.js';
import type { Request, Response } from 'express';
import { scoringService } from '../services/scoring-runtime.js';
import { ApplicantQueryService } from '../services/applicant-query.service.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import { describeMissingSetup, getJobReadiness } from '../scoring/job-readiness.js';
import { CLOSED_JOB_SCORING_MESSAGE, isClosedJobStatus } from '../services/job-status.js';

const applicantQueryService = new ApplicantQueryService();
const jobsRepository = new JobsRepository();

/**
 * Scoring is blocked for a closed job, and until the job is set up (posting text
 * present, criteria confirmed). Returns the 409 body to send when it is blocked, or
 * null when scoring may proceed.
 */
function blockedFromScoring(jobId: number | undefined): { error: string; message: string } | null {
  if (jobId === undefined) return null;
  const job = jobsRepository.getById(jobId);
  if (!job) return null; // an unknown job is reported by the scoring run itself
  if (isClosedJobStatus(job.status)) {
    return { error: 'Job closed', message: CLOSED_JOB_SCORING_MESSAGE };
  }
  const message = describeMissingSetup(getJobReadiness(job));
  return message ? { error: 'Job not set up', message } : null;
}

/** Raw (untrusted) body of a re-score request: a job + the active list filter. */
interface RescoreBody {
  jobId?: number;
  statusIds?: number[];
  search?: string;
  active?: boolean;
  scored?: string;
  flagged?: string;
}

interface RescoreFilter {
  jobId: number;
  statusIds?: number[];
  search?: string;
  activeOnly: boolean;
  scoreFilter?: ScoreFilter;
  flagFilter?: FlagFilter;
}

/** Validate a re-score filter body → typed filter, or an error string. */
function parseRescoreBody(
  body: RescoreBody
): RescoreFilter | { error: string } {
  const { jobId, statusIds, search, active, scored, flagged } = body ?? {};
  if (typeof jobId !== 'number' || Number.isNaN(jobId)) {
    return { error: 'jobId is required and must be a number (re-score is job-scoped)' };
  }
  if (statusIds !== undefined && (!Array.isArray(statusIds) || statusIds.some((id) => typeof id !== 'number'))) {
    return { error: 'statusIds must be an array of numbers' };
  }
  if (search !== undefined && typeof search !== 'string') {
    return { error: 'search must be a string' };
  }
  if (active !== undefined && typeof active !== 'boolean') {
    return { error: 'active must be a boolean' };
  }
  return {
    jobId,
    statusIds: statusIds && statusIds.length > 0 ? statusIds : undefined,
    search: search && search.trim() !== '' ? search : undefined,
    activeOnly: active ?? true,
    scoreFilter: parseScoreFilter(scored),
    flagFilter: parseFlagFilter(flagged),
  };
}

export class ScoringController {
  /**
   * POST /api/score  { jobId? }
   * Start scoring a job's unscored candidates (or the current job).
   */
  async startScoring(
    req: Request<unknown, unknown, { jobId?: number }>,
    res: Response
  ): Promise<void> {
    try {
      const jobId = req.body?.jobId;
      if (jobId !== undefined && (typeof jobId !== 'number' || Number.isNaN(jobId))) {
        res.status(400).json({ error: 'Invalid request', message: 'jobId must be a number' });
        return;
      }
      const scopeJobId = jobId ?? applicantQueryService.resolveCurrentJobId() ?? undefined;
      const blocked = blockedFromScoring(scopeJobId);
      if (blocked) {
        res.status(409).json(blocked);
        return;
      }
      const applicationIds = applicantQueryService
        .findUnscoredApplicants(scopeJobId)
        .map((applicant) => applicant.applicationId);
      // Named ids let the service score them in batches, each in a fresh Claude session.
      res.json(
        scoringService.start({
          jobId: scopeJobId,
          applicationIds,
          total: applicationIds.length,
          isRescore: false,
        })
      );
    } catch (error) {
      console.error('Failed to start scoring:', error);
      res.status(500).json({
        error: 'Failed to start scoring',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/score/applicant  { applicationId }
   * Score (or re-score, when a score exists) a single applicant, so a job's
   * criteria can be tried on a few people before running the whole list.
   */
  async scoreApplicant(
    req: Request<unknown, unknown, { applicationId?: number }>,
    res: Response
  ): Promise<void> {
    try {
      const applicationId = req.body?.applicationId;
      if (typeof applicationId !== 'number' || !Number.isInteger(applicationId)) {
        res
          .status(400)
          .json({ error: 'Invalid request', message: 'applicationId must be a whole number' });
        return;
      }
      const target = await applicantQueryService.findScoringTarget(applicationId);
      if (!target) {
        res.status(404).json({ error: 'Not found', message: 'Applicant not found' });
        return;
      }
      const blocked = blockedFromScoring(target.jobId);
      if (blocked) {
        res.status(409).json(blocked);
        return;
      }
      res.json(
        scoringService.start({
          jobId: target.jobId,
          applicationIds: [applicationId],
          total: 1,
          isRescore: target.hasScore,
        })
      );
    } catch (error) {
      console.error('Failed to start single-applicant scoring:', error);
      res.status(500).json({
        error: 'Failed to start scoring',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/score/rescore/preview  { jobId, statusIds?, search?, active? }
   * Read-only: how many candidates match the active filter (would be re-scored).
   */
  async rescorePreview(req: Request<unknown, unknown, RescoreBody>, res: Response): Promise<void> {
    try {
      const parsed = parseRescoreBody(req.body);
      if ('error' in parsed) {
        res.status(400).json({ error: 'Invalid request', message: parsed.error });
        return;
      }
      const ids = applicantQueryService.findFilteredApplicationIds(parsed);
      res.json({ count: ids.length });
    } catch (error) {
      console.error('Failed to preview re-score:', error);
      res.status(500).json({
        error: 'Failed to preview re-score',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/score/rescore  { jobId, statusIds?, search?, active? }
   * Re-score every candidate matching the active filter (overwriting scores).
   */
  async rescore(req: Request<unknown, unknown, RescoreBody>, res: Response): Promise<void> {
    try {
      const parsed = parseRescoreBody(req.body);
      if ('error' in parsed) {
        res.status(400).json({ error: 'Invalid request', message: parsed.error });
        return;
      }
      const blocked = blockedFromScoring(parsed.jobId);
      if (blocked) {
        res.status(409).json(blocked);
        return;
      }
      const applicationIds = applicantQueryService.findFilteredApplicationIds(parsed);
      if (applicationIds.length === 0) {
        res.json({ started: false, count: 0, status: scoringService.getStatus() });
        return;
      }
      const result = scoringService.start({
        jobId: parsed.jobId,
        applicationIds,
        total: applicationIds.length,
      });
      res.json({ ...result, count: applicationIds.length });
    } catch (error) {
      console.error('Failed to start re-score:', error);
      res.status(500).json({
        error: 'Failed to start re-score',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/score/cancel
   * Stop the running scoring run (already-saved scores are kept).
   */
  async cancelScoring(_req: Request, res: Response): Promise<void> {
    res.json({ cancelled: scoringService.cancel(), status: scoringService.getStatus() });
  }

  /**
   * GET /api/score/status
   * Current/last scoring-run status (for polling).
   */
  async getScoringStatus(_req: Request, res: Response): Promise<void> {
    try {
      res.json(scoringService.getStatus());
    } catch (error) {
      console.error('Failed to get scoring status:', error);
      res.status(500).json({
        error: 'Failed to fetch scoring status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
