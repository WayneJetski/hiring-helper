/**
 * Applicants Controller
 * Handles HTTP requests for applicant-related endpoints.
 * Read/assembly logic lives in ApplicantQueryService so the same behavior is
 * shared with the MCP server.
 */

import type { Request, Response } from 'express';
import { ApplicantQueryService, DataIntegrityError } from '../services/applicant-query.service.js';
import { ApplicationStatesRepository } from '../repositories/application-states.repository.js';
import { BulkActionService } from '../services/bulk-action.service.js';
import { BambooPushService } from '../services/bamboo-push.service.js';
import type { BulkCondition } from '../repositories/applications.repository.js';
import { APPLICATION_FLAGS, isApplicationFlag } from '../types/flags.js';

const applicantQueryService = new ApplicantQueryService();
const statesRepository = new ApplicationStatesRepository();
const bulkActionService = new BulkActionService();
const bambooPushService = new BambooPushService();

/** Raw (untrusted) body of a bulk action request. */
interface BulkRequestBody {
  jobId?: number;
  condition?: { field?: string; operator?: string; value?: number | string };
  statusId?: number;
}

/**
 * Validate and normalize a bulk request body. Returns typed values or a
 * user-facing error string the controller maps to a 400. Bulk actions are
 * always job-scoped.
 */
function parseBulkRequest(
  body: BulkRequestBody,
  requireStatus: boolean
): { jobId: number; condition: BulkCondition; statusId?: number } | { error: string } {
  const { jobId, condition, statusId } = body;

  if (typeof jobId !== 'number' || Number.isNaN(jobId)) {
    return { error: 'jobId is required and must be a number (bulk actions are job-scoped)' };
  }
  if (!condition || typeof condition !== 'object') {
    return { error: 'condition is required' };
  }

  const { field, operator, value } = condition;
  if (field !== 'match' && field !== 'appliedDate' && field !== 'flag') {
    return { error: "condition.field must be 'match', 'appliedDate', or 'flag'" };
  }

  let normalizedCondition: BulkCondition;
  if (field === 'flag') {
    if (operator !== 'is') {
      return { error: "condition.operator for a flag condition must be 'is'" };
    }
    if (typeof value !== 'string' || !isApplicationFlag(value)) {
      return { error: `condition.value for a flag condition must be one of: ${APPLICATION_FLAGS.join(', ')}` };
    }
    normalizedCondition = { field, operator, value };
  } else {
    if (operator !== 'greaterThan' && operator !== 'lessThan') {
      return { error: "condition.operator must be 'greaterThan' or 'lessThan'" };
    }
    if (field === 'match') {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isNaN(numeric) || numeric < 1 || numeric > 100) {
        return { error: 'condition.value for a match condition must be a number between 1 and 100' };
      }
      normalizedCondition = { field, operator, value: numeric };
    } else {
      if (typeof value !== 'string' || value.trim() === '') {
        return { error: 'condition.value for an appliedDate condition must be a non-empty date string' };
      }
      normalizedCondition = { field, operator, value };
    }
  }

  const parsed: { jobId: number; condition: BulkCondition; statusId?: number } = {
    jobId,
    condition: normalizedCondition,
  };
  if (requireStatus) {
    if (typeof statusId !== 'number' || Number.isNaN(statusId)) {
      return { error: 'statusId is required and must be a number' };
    }
    parsed.statusId = statusId;
  }
  return parsed;
}

/**
 * Query parameters for filtering applicants
 */
interface ApplicantQueryParams {
  statusIds?: string; // Comma-separated list of status IDs
  jobId?: string;
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  active?: string; // Filter by active status (true/false)
}

export class ApplicantsController {
  /**
   * GET /api/applicants
   * Get list of all applicants with optional filtering and pagination
   */
  async getApplicants(
    req: Request<unknown, unknown, unknown, ApplicantQueryParams>,
    res: Response
  ): Promise<void> {
    try {
      const {
        statusIds: statusIdsStr,
        jobId,
        search,
        page: pageStr,
        limit: limitStr,
        sortBy,
        sortDirection = 'desc',
        active: activeStr,
      } = req.query;

      const statusIds = statusIdsStr
        ? statusIdsStr.split(',').map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))
        : undefined;

      const result = await applicantQueryService.listApplicants({
        statusIds,
        jobId: jobId ? parseInt(jobId, 10) : undefined,
        search,
        activeOnly: activeStr === 'true' ? true : activeStr === 'false' ? false : undefined,
        sortBy,
        sortDirection,
        page: pageStr ? parseInt(pageStr, 10) : undefined,
        limit: limitStr ? parseInt(limitStr, 10) : undefined,
      });

      res.json({
        data: result.items,
        count: result.items.length,
        totalCount: result.totalCount,
        pagination: result.pagination,
      });
    } catch (error) {
      console.error('Failed to get applicants:', error);
      res.status(500).json({
        error: 'Failed to fetch applicants',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/applicants/:id
   * Get detailed information about a specific applicant
   */
  async getApplicant(req: Request<{ id: string }>, res: Response): Promise<void> {
    try {
      const applicationId = parseInt(req.params.id, 10);
      const detail = await applicantQueryService.getApplicantDetail(applicationId);

      if (!detail) {
        res.status(404).json({
          error: 'Application not found',
          message: `No application found with ID ${applicationId}`,
        });
        return;
      }

      res.json({ data: detail });
    } catch (error) {
      if (error instanceof DataIntegrityError) {
        res.status(500).json({ error: 'Data integrity error', message: error.message });
        return;
      }
      console.error('Failed to get applicant:', error);
      res.status(500).json({
        error: 'Failed to fetch applicant',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/applicants/:id/resume
   * Get the applicant's resume parsed to text
   */
  async getApplicantResume(req: Request<{ id: string }>, res: Response): Promise<void> {
    try {
      const applicationId = parseInt(req.params.id, 10);
      const text = await applicantQueryService.getResumeText(applicationId);

      if (text === null) {
        res.status(404).json({
          error: 'Resume not available',
          message: `No resume file found for application ${applicationId}`,
        });
        return;
      }

      res.json({ data: { applicationId, text } });
    } catch (error) {
      console.error('Failed to get resume:', error);
      res.status(500).json({
        error: 'Failed to fetch resume',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/applicants/statuses
   * Get list of all available application statuses
   */
  async getStatuses(
    req: Request<unknown, unknown, unknown, { active?: string }>,
    res: Response
  ): Promise<void> {
    try {
      const activeParam = req.query.active;
      const activeOnly = activeParam === 'true' ? true : activeParam === 'false' ? false : undefined;

      const states = statesRepository.getAll(activeOnly);
      const statuses = states.map((state) => ({
        id: state.id,
        label: state.status,
        active: state.active,
      }));
      res.json(statuses);
    } catch (error) {
      console.error('Failed to get statuses:', error);
      res.status(500).json({
        error: 'Failed to fetch statuses',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/applicants/:id/resume/file
   * Stream the raw résumé PDF (proxied from BambooHR) for inline viewing/download.
   */
  async getApplicantResumeFile(req: Request<{ id: string }>, res: Response): Promise<void> {
    try {
      const applicationId = parseInt(req.params.id, 10);
      const buffer = await applicantQueryService.getResumeFile(applicationId);
      if (!buffer) {
        res.status(404).json({
          error: 'Resume not available',
          message: `No résumé file found for application ${applicationId}`,
        });
        return;
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="resume-${applicationId}.pdf"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      console.error('Failed to fetch résumé file:', error);
      res.status(500).json({
        error: 'Failed to fetch résumé file',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * PATCH /api/applicants/:id/status
   * Move a single application to a chosen hiring stage (local store only —
   * no BambooHR push, no notifications).
   */
  async moveApplicantStage(
    req: Request<{ id: string }, unknown, { statusId?: number }>,
    res: Response
  ): Promise<void> {
    try {
      const applicationId = parseInt(req.params.id, 10);
      const statusId = req.body?.statusId;
      if (typeof statusId !== 'number' || Number.isNaN(statusId)) {
        res.status(400).json({ error: 'Invalid request', message: 'statusId (number) is required' });
        return;
      }
      const result = applicantQueryService.moveToStage(applicationId, statusId);
      if (!result) {
        res.status(404).json({
          error: 'Not found',
          message: `No application ${applicationId} or status ${statusId}`,
        });
        return;
      }
      res.json({ ok: true, applicationId, ...result });
    } catch (error) {
      console.error('Failed to move applicant stage:', error);
      res.status(500).json({
        error: 'Failed to move applicant stage',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/applicants/bulk-preview
   * Read-only preview of how many candidates in a job match a condition (+ sample).
   */
  async bulkPreview(
    req: Request<unknown, unknown, BulkRequestBody>,
    res: Response
  ): Promise<void> {
    try {
      const parsed = parseBulkRequest(req.body, false);
      if ('error' in parsed) {
        res.status(400).json({ error: 'Invalid request', message: parsed.error });
        return;
      }
      res.json(bulkActionService.preview(parsed.jobId, parsed.condition));
    } catch (error) {
      console.error('Failed to preview bulk action:', error);
      res.status(500).json({
        error: 'Failed to preview bulk action',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/applicants/bulk-reject
   * Set matching applications to the chosen rejection reason (local store only).
   */
  async bulkReject(
    req: Request<unknown, unknown, BulkRequestBody>,
    res: Response
  ): Promise<void> {
    await this.applyBulkStatusChange(req, res, 'reject');
  }

  /**
   * POST /api/applicants/bulk-move
   * Set matching applications to the chosen target stage (local store only).
   */
  async bulkMove(
    req: Request<unknown, unknown, BulkRequestBody>,
    res: Response
  ): Promise<void> {
    await this.applyBulkStatusChange(req, res, 'move');
  }

  /**
   * Shared handler for bulk reject/move: both apply a status change to all
   * matching applications and differ only in intent/label.
   */
  private async applyBulkStatusChange(
    req: Request<unknown, unknown, BulkRequestBody>,
    res: Response,
    action: 'reject' | 'move'
  ): Promise<void> {
    try {
      const parsed = parseBulkRequest(req.body, true);
      if ('error' in parsed) {
        res.status(400).json({ error: 'Invalid request', message: parsed.error });
        return;
      }
      const statusId = parsed.statusId as number; // guaranteed by requireStatus
      const result =
        action === 'reject'
          ? bulkActionService.reject(parsed.jobId, parsed.condition, statusId)
          : bulkActionService.move(parsed.jobId, parsed.condition, statusId);
      res.json(result);
    } catch (error) {
      console.error(`Failed to run bulk ${action}:`, error);
      res.status(500).json({
        error: `Failed to run bulk ${action}`,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/applicants/bulk-restore  { entries: [{ id, statusId }] }
   * Undo a bulk reject/move/duplicate cleanup using the `previousStatuses` the
   * action returned. Local only.
   */
  async bulkRestore(
    req: Request<unknown, unknown, { entries?: unknown }>,
    res: Response
  ): Promise<void> {
    try {
      const entries = req.body?.entries;
      const isValid =
        Array.isArray(entries) &&
        entries.every(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            Number.isInteger((entry as { id?: unknown }).id) &&
            Number.isInteger((entry as { statusId?: unknown }).statusId)
        );
      if (!isValid) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'entries must be an array of { id, statusId } integers',
        });
        return;
      }
      res.json(bulkActionService.restore(entries as Array<{ id: number; statusId: number }>));
    } catch (error) {
      console.error('Failed to restore statuses:', error);
      res.status(500).json({
        error: 'Failed to restore statuses',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/applicants/duplicates/preview
   * Read-only: which older duplicate applications would be rejected (job-scoped).
   */
  async duplicatesPreview(
    req: Request<unknown, unknown, { jobId?: number }>,
    res: Response
  ): Promise<void> {
    try {
      const jobId = req.body?.jobId;
      if (typeof jobId !== 'number' || Number.isNaN(jobId)) {
        res.status(400).json({ error: 'Invalid request', message: 'jobId (number) is required' });
        return;
      }
      res.json(bulkActionService.previewDuplicates(jobId));
    } catch (error) {
      console.error('Failed to preview duplicates:', error);
      res.status(500).json({
        error: 'Failed to preview duplicates',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/applicants/duplicates/cleanup
   * Reject the older duplicate applications (move them to the Duplicate status).
   */
  async duplicatesCleanup(
    req: Request<unknown, unknown, { jobId?: number }>,
    res: Response
  ): Promise<void> {
    try {
      const jobId = req.body?.jobId;
      if (typeof jobId !== 'number' || Number.isNaN(jobId)) {
        res.status(400).json({ error: 'Invalid request', message: 'jobId (number) is required' });
        return;
      }
      res.json(bulkActionService.cleanupDuplicates(jobId));
    } catch (error) {
      console.error('Failed to clean up duplicates:', error);
      res.status(500).json({
        error: 'Failed to clean up duplicates',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * GET /api/applicants/push/preview?jobId=
   * Read-only: local status changes pending a push to BambooHR (from → to per
   * candidate). Scoped to jobId when given, otherwise across all jobs.
   */
  async pushPreview(
    req: Request<unknown, unknown, unknown, { jobId?: string }>,
    res: Response
  ): Promise<void> {
    try {
      const jobIdStr = req.query.jobId;
      const jobId = jobIdStr !== undefined ? parseInt(jobIdStr, 10) : undefined;
      if (jobId !== undefined && Number.isNaN(jobId)) {
        res.status(400).json({ error: 'Invalid request', message: 'jobId must be a number' });
        return;
      }
      res.json(bambooPushService.previewPush(jobId));
    } catch (error) {
      console.error('Failed to preview push:', error);
      res.status(500).json({
        error: 'Failed to preview push',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/applicants/push/discard  { jobId?, ids? }
   * Roll back pending local status changes instead of sending them (each
   * applicant returns to the stage BambooHR has). Local only.
   */
  async discardPendingPush(
    req: Request<unknown, unknown, { jobId?: number; ids?: number[] }>,
    res: Response
  ): Promise<void> {
    try {
      const { jobId, ids } = req.body ?? {};
      if (jobId !== undefined && (typeof jobId !== 'number' || Number.isNaN(jobId))) {
        res.status(400).json({ error: 'Invalid request', message: 'jobId must be a number' });
        return;
      }
      if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'number'))) {
        res.status(400).json({ error: 'Invalid request', message: 'ids must be an array of numbers' });
        return;
      }
      res.json(bambooPushService.discardPending(jobId, ids));
    } catch (error) {
      console.error('Failed to discard pending changes:', error);
      res.status(500).json({
        error: 'Failed to discard pending changes',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * POST /api/applicants/push
   * Push pending local status changes to BambooHR (status only — never emails
   * candidates). Body: { jobId?, ids? } — omit ids to push all pending in scope.
   */
  async pushToBambooHR(
    req: Request<unknown, unknown, { jobId?: number; ids?: number[] }>,
    res: Response
  ): Promise<void> {
    try {
      const { jobId, ids } = req.body ?? {};
      if (jobId !== undefined && (typeof jobId !== 'number' || Number.isNaN(jobId))) {
        res.status(400).json({ error: 'Invalid request', message: 'jobId must be a number' });
        return;
      }
      if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'number'))) {
        res.status(400).json({ error: 'Invalid request', message: 'ids must be an array of numbers' });
        return;
      }
      const result = await bambooPushService.pushStatuses(jobId, ids);
      res.json(result);
    } catch (error) {
      console.error('Failed to push to BambooHR:', error);
      res.status(500).json({
        error: 'Failed to push to BambooHR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
