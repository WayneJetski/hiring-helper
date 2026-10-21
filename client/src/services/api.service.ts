/**
 * API Service
 * Handles all HTTP requests to the backend API
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import type {
  ApplicantListItem,
  ApplicantDetail,
  ApiResponse,
  PaginationInfo,
  JobSummary,
  JobDetail,
  ScoringConfig,
  SuggestedQuestions,
  SuggestedCriteria,
  SurveyAnswer,
  ScoringStatus,
  StartScoringResult,
  Status,
  BulkCondition,
  BulkPreviewResult,
  BulkActionResult,
  DuplicatePreviewResult,
  PushPreviewResult,
  PushResult,
  PreviousStatus,
  SetupStatus,
  UpdateStatus,
  ConnectionResult,
  BambooHRConnection,
  LastSync,
} from '../types/applicant.types';

/** AI generation can take a minute, far longer than an ordinary request. */
const GENERATION_TIMEOUT_MS = 200_000;

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: '/api',
      timeout: 45000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get list of applicants with optional filters and pagination
   */
  async getApplicants(params?: {
    status?: string;
    jobId?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    active?: boolean;
  }): Promise<{ 
    applicants: ApplicantListItem[]; 
    pagination?: PaginationInfo;
    totalCount?: number;
  }> {
    try {
      // Default to active=true to filter out inactive applications
      const finalParams = params ? {
        ...params,
        active: params.active !== undefined ? params.active : true,
      } : { active: true };
      
      const response = await this.client.get<ApiResponse<ApplicantListItem[]>>('/applicants', {
        params: finalParams,
      });
      return {
        applicants: response.data.data,
        pagination: response.data.pagination,
        totalCount: response.data.totalCount,
      };
    } catch (error) {
      this.handleError(error, 'Failed to fetch applicants');
    }
  }

  /**
   * Get the list of jobs (with counts), most recent first
   */
  async getJobs(): Promise<JobSummary[]> {
    try {
      const response = await this.client.get<ApiResponse<JobSummary[]>>('/jobs');
      return response.data.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch jobs');
    }
  }

  /**
   * Get a job's editable scoring config (description + effective system prompt).
   */
  async getJobDetail(id: number): Promise<JobDetail> {
    try {
      const response = await this.client.get<ApiResponse<JobDetail>>(`/jobs/${id}`);
      return response.data.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch job ${id}`);
    }
  }

  /**
   * Update a job's scoring config (description / posting URL / system prompt).
   * `resetScoringConfig` puts the job back on the default scoring criteria.
   */
  async updateJob(
    id: number,
    update: {
      description?: string;
      postingUrl?: string;
      scoringConfig?: ScoringConfig;
      /** Put the job back on the default scoring criteria. */
      resetScoringConfig?: boolean;
      /** Mark the scoring criteria as reviewed and accepted. */
      criteriaConfirmed?: boolean;
    }
  ): Promise<JobDetail> {
    try {
      const response = await this.client.patch<ApiResponse<JobDetail>>(`/jobs/${id}`, update);
      return response.data.data;
    } catch (error) {
      this.handleError(error, `Failed to update job ${id}`);
    }
  }

  /**
   * Get all application statuses (id + label + active)
   */
  async getStatuses(): Promise<Status[]> {
    try {
      const response = await this.client.get<Status[]>('/applicants/statuses');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch statuses');
    }
  }

  /**
   * Preview how many candidates in a job match a bulk condition (read-only)
   */
  async bulkPreview(jobId: number, condition: BulkCondition): Promise<BulkPreviewResult> {
    try {
      const response = await this.client.post<BulkPreviewResult>('/applicants/bulk-preview', {
        jobId,
        condition,
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to preview bulk action');
    }
  }

  /**
   * Bulk reject matching candidates (sets their status to the chosen reason)
   */
  async bulkReject(
    jobId: number,
    condition: BulkCondition,
    statusId: number
  ): Promise<BulkActionResult> {
    try {
      const response = await this.client.post<BulkActionResult>('/applicants/bulk-reject', {
        jobId,
        condition,
        statusId,
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to bulk reject');
    }
  }

  /**
   * Bulk move matching candidates to a target stage
   */
  async bulkMove(
    jobId: number,
    condition: BulkCondition,
    statusId: number
  ): Promise<BulkActionResult> {
    try {
      const response = await this.client.post<BulkActionResult>('/applicants/bulk-move', {
        jobId,
        condition,
        statusId,
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to bulk move');
    }
  }

  /**
   * Undo a bulk reject/move/duplicate cleanup by restoring each application's
   * previous status (local only).
   */
  async restoreStatuses(entries: PreviousStatus[]): Promise<{ restored: number }> {
    try {
      const response = await this.client.post<{ restored: number }>('/applicants/bulk-restore', {
        entries,
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to undo');
    }
  }

  /**
   * Preview which older duplicate applications would be rejected (job-scoped)
   */
  async previewDuplicates(jobId: number): Promise<DuplicatePreviewResult> {
    try {
      const response = await this.client.post<DuplicatePreviewResult>(
        '/applicants/duplicates/preview',
        { jobId }
      );
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to preview duplicates');
    }
  }

  /**
   * Reject the older duplicate applications (move them to the Duplicate status)
   */
  async cleanupDuplicates(
    jobId: number
  ): Promise<{ updated: number; statusLabel: string; previousStatuses: PreviousStatus[] }> {
    try {
      const response = await this.client.post<{
        updated: number;
        statusLabel: string;
        previousStatuses: PreviousStatus[];
      }>('/applicants/duplicates/cleanup',
        { jobId }
      );
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to clean up duplicates');
    }
  }

  /**
   * Preview local status changes pending a push to BambooHR (read-only).
   * Scoped to jobId when given, otherwise across all jobs.
   */
  async getPendingPush(jobId?: number): Promise<PushPreviewResult> {
    try {
      const response = await this.client.get<PushPreviewResult>('/applicants/push/preview', {
        params: jobId !== undefined ? { jobId } : undefined,
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to load pending changes');
    }
  }

  /**
   * Push pending local status changes to BambooHR (status only — never emails).
   * `ids` must be exactly the changes the person reviewed; the server refuses a push
   * that does not name them.
   */
  async pushToBambooHR(jobId: number | undefined, ids: number[]): Promise<PushResult> {
    try {
      const response = await this.client.post<PushResult>('/applicants/push', { jobId, ids });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to push to BambooHR');
    }
  }

  /**
   * Roll back pending local status changes instead of sending them: each
   * applicant returns to the stage BambooHR has. Local only; omit ids to roll
   * back everything pending in scope.
   */
  async discardPendingPush(
    jobId?: number,
    ids?: number[]
  ): Promise<{ discarded: number; skipped: number }> {
    try {
      const response = await this.client.post<{ discarded: number; skipped: number }>(
        '/applicants/push/discard',
        { jobId, ids }
      );
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to roll back changes');
    }
  }

  /**
   * Get single applicant details
   */
  async getApplicant(id: number): Promise<ApplicantDetail> {
    try {
      const response = await this.client.get<ApiResponse<ApplicantDetail>>(
        `/applicants/${id}`
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch applicant ${id}`);
    }
  }

  /**
   * Get applicant resume as parsed JSON
   */
  async getApplicantResume(id: number): Promise<unknown> {
    try {
      const response = await this.client.get(`/applicants/${id}/resume`);
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch resume for applicant ${id}`);
    }
  }

  /**
   * Move a single applicant to a hiring stage (local status update)
   */
  async moveApplicantStage(
    id: number,
    statusId: number
  ): Promise<{ statusId: number; statusLabel: string }> {
    try {
      const response = await this.client.patch<{
        ok: boolean;
        statusId: number;
        statusLabel: string;
      }>(`/applicants/${id}/status`, { statusId });
      return { statusId: response.data.statusId, statusLabel: response.data.statusLabel };
    } catch (error) {
      this.handleError(error, `Failed to move applicant ${id}`);
    }
  }

  /**
   * Start a headless scoring run for a job's unscored candidates (or the
   * current job when jobId is omitted).
   */
  async startScoring(jobId?: number): Promise<StartScoringResult> {
    try {
      const response = await this.client.post<StartScoringResult>('/score', { jobId });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to start scoring');
    }
  }

  /**
   * Preview how many candidates match the active filter for a re-score (read-only).
   */
  async rescorePreview(filter: {
    jobId: number;
    statusIds?: number[];
    search?: string;
    active?: boolean;
  }): Promise<{ count: number }> {
    try {
      const response = await this.client.post<{ count: number }>('/score/rescore/preview', filter);
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to preview re-score');
    }
  }

  /**
   * Re-score every candidate matching the active filter (overwrites their scores).
   */
  async rescore(filter: {
    jobId: number;
    statusIds?: number[];
    search?: string;
    active?: boolean;
  }): Promise<StartScoringResult & { count?: number }> {
    try {
      const response = await this.client.post<StartScoringResult & { count?: number }>(
        '/score/rescore',
        filter
      );
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to start re-score');
    }
  }

  /**
   * Current/last scoring-run status (for polling).
   */
  async getScoringStatus(): Promise<ScoringStatus> {
    try {
      const response = await this.client.get<ScoringStatus>('/score/status');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch scoring status');
    }
  }

  /**
   * Stop the running scoring run (candidates already scored keep their scores).
   */
  async cancelScoring(): Promise<void> {
    try {
      await this.client.post('/score/cancel');
    } catch (error) {
      this.handleError(error, 'Failed to cancel scoring');
    }
  }

  /**
   * Whether BambooHR is connected and Claude Code is installed (first-run setup).
   */
  async getSetupStatus(): Promise<SetupStatus> {
    try {
      const response = await this.client.get<SetupStatus>('/setup/status');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to check setup status');
    }
  }

  /** The current version and whether a newer one exists. The server reuses a recent check. */
  async getUpdateStatus(): Promise<UpdateStatus> {
    try {
      const response = await this.client.get<UpdateStatus>('/update/status');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Could not check for updates');
    }
  }

  /** Start updating (download, build, restart). Poll getUpdateStatus for progress. */
  async applyUpdate(): Promise<UpdateStatus> {
    try {
      const response = await this.client.post<UpdateStatus>('/update/apply');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Could not start the update');
    }
  }

  /** Open Claude Code's sign-in in the browser (SSO forces the company single sign-on flow). */
  async startClaudeSignIn(useSso: boolean): Promise<SetupStatus> {
    try {
      const response = await this.client.post<SetupStatus>('/setup/claude/signin', { sso: useSso });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Could not start the Claude sign-in');
    }
  }

  async cancelClaudeSignIn(): Promise<SetupStatus> {
    try {
      const response = await this.client.post<SetupStatus>('/setup/claude/signin/cancel');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Could not cancel the Claude sign-in');
    }
  }

  /**
   * Test the BambooHR credentials that are already saved. The server caches the
   * answer for a minute, so calling this on every visit is safe.
   */
  async getBambooHRConnection(): Promise<BambooHRConnection> {
    try {
      const response = await this.client.get<BambooHRConnection>('/setup/bamboohr/connection');
      return response.data;
    } catch (error) {
      this.handleError(error, 'Could not check the BambooHR connection');
    }
  }

  /**
   * Try BambooHR credentials without saving them.
   */
  async testBambooHR(apiKey: string, subdomain: string): Promise<ConnectionResult> {
    return this.postCredentials('/setup/bamboohr/test', apiKey, subdomain);
  }

  /**
   * Test, save and apply BambooHR credentials, then start the first sync.
   */
  async saveBambooHR(apiKey: string, subdomain: string): Promise<ConnectionResult> {
    return this.postCredentials('/setup/bamboohr', apiKey, subdomain);
  }

  /**
   * The setup endpoints answer 400 with a plain-language { ok: false, message }
   * for bad credentials; surface that as a result instead of an exception.
   */
  private async postCredentials(
    path: string,
    apiKey: string,
    subdomain: string
  ): Promise<ConnectionResult> {
    try {
      const response = await this.client.post<ConnectionResult>(path, { apiKey, subdomain });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data?.message) {
        return { ok: false, message: String(error.response.data.message) };
      }
      this.handleError(error, 'Could not reach the app server');
    }
  }

  /**
   * When BambooHR was last synced (null if never).
   */
  async getLastSync(): Promise<LastSync | null> {
    try {
      const response = await this.client.get<{ lastSync: LastSync | null }>('/sync/status');
      return response.data.lastSync;
    } catch (error) {
      this.handleError(error, 'Failed to fetch sync status');
    }
  }

  /**
   * A short multiple-choice survey tailored to the role (written by AI).
   * Generation takes a while, so this waits longer than other calls and can be
   * cancelled.
   */
  async getCriteriaQuestions(jobId: number, signal?: AbortSignal): Promise<SuggestedQuestions> {
    try {
      const response = await this.client.post<ApiResponse<SuggestedQuestions>>(
        `/jobs/${jobId}/criteria/questions`,
        undefined,
        { timeout: GENERATION_TIMEOUT_MS, signal }
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, 'Could not write the questions');
    }
  }

  /**
   * Draft scoring criteria written by AI: from the job posting alone, or shaped
   * by survey answers. Not saved; the editor applies and saves it.
   */
  async suggestCriteria(
    jobId: number,
    answers?: SurveyAnswer[],
    signal?: AbortSignal
  ): Promise<SuggestedCriteria> {
    try {
      const response = await this.client.post<ApiResponse<SuggestedCriteria>>(
        `/jobs/${jobId}/criteria/suggest`,
        answers ? { answers } : {},
        { timeout: GENERATION_TIMEOUT_MS, signal }
      );
      return response.data.data;
    } catch (error) {
      this.handleError(error, 'Could not generate criteria');
    }
  }

  /**
   * Fetch a job's public posting text from BambooHR for review (not saved).
   */
  async importJobPosting(id: number): Promise<string> {
    try {
      const response = await this.client.post<ApiResponse<{ description: string }>>(
        `/jobs/${id}/import-posting`
      );
      return response.data.data.description;
    } catch (error) {
      this.handleError(error, 'Failed to import the posting from BambooHR');
    }
  }

  /**
   * Trigger manual sync from BambooHR
   * @param force - If true, performs a full sync and marks inactive applications
   */
  async triggerSync(force: boolean = false): Promise<{ 
    success: boolean; 
    message: string; 
    syncedCount: number;
    rateLimited?: boolean;
  }> {
    try {
      const response = await this.client.post<{
        success: boolean;
        message: string;
        syncedCount: number;
        rateLimited?: boolean;
      }>('/sync', { force });
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to trigger sync');
    }
  }

  /**
   * Handle API errors consistently
   */
  private handleError(error: unknown, defaultMessage: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const message = (axiosError.response?.data as { message?: string })?.message || 
        axiosError.message || 
        defaultMessage;
      throw new Error(message);
    }
    throw new Error(defaultMessage);
  }
}

export const apiService = new ApiService();

