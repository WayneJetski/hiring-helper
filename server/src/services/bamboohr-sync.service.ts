/**
 * BambooHR Sync Service
 * Handles synchronization of data from BambooHR API to local SQLite database
 */

import { SingleFlight } from '../utils/single-flight.js';
import { CLOSED_STATUS_LABEL, findJobsToClose } from './job-status.js';
import { BambooHRService } from './bamboohr.service.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import { ApplicantsRepository } from '../repositories/applicants.repository.js';
import { ApplicationsRepository } from '../repositories/applications.repository.js';
import { ContentUpdatesRepository } from '../repositories/content-updates.repository.js';
import { ApplicationStatesRepository } from '../repositories/application-states.repository.js';
import { isBambooRateLimitError } from '../utils/rate-limit.js';
import { selectApplicationsForUnknownJobs } from './sync-discovery.js';
import { JobDescriptionService } from './job-description.service.js';
import { fetchPostingText } from './job-posting-fetcher.js';
import { config } from '../config/env.config.js';
import type { BambooHRApplication } from '../types/bamboohr.types.js';

// Shared by every instance (the server start-up, setup and sync controllers each create
// one), so overlapping syncs join one run instead of racing each other and BambooHR's limit.
const syncFlight = new SingleFlight<number>();
let lastStatusUpdatesPulled = 0;

export class BambooHRSyncService {
  private bambooHRService: BambooHRService;
  private jobsRepo: JobsRepository;
  private applicantsRepo: ApplicantsRepository;
  private applicationsRepo: ApplicationsRepository;
  private statesRepo: ApplicationStatesRepository;
  private contentUpdatesRepo: ContentUpdatesRepository;
  private jobDescriptionService: JobDescriptionService;
  constructor() {
    this.bambooHRService = new BambooHRService();
    this.jobsRepo = new JobsRepository();
    this.applicantsRepo = new ApplicantsRepository();
    this.applicationsRepo = new ApplicationsRepository();
    this.statesRepo = new ApplicationStatesRepository();
    this.contentUpdatesRepo = new ContentUpdatesRepository();
    this.jobDescriptionService = new JobDescriptionService();
  }

  /**
   * Check if an error is a rate limit (429) error
   */
  private isRateLimitError(error: unknown): boolean {
    return isBambooRateLimitError(error);
  }

  /**
   * Sync application statuses from BambooHR
   */
  async syncStatuses(): Promise<number> {
    try {
      console.info('📋 Syncing application statuses from BambooHR...');
      const statuses = await this.bambooHRService.getApplicationStatuses();
      
      this.statesRepo.bulkUpsert(
        statuses
          .filter(s => s.enabled)
          .map(s => ({ id: s.id, status: s.name }))
      );
      
      console.info(`✅ Synced ${statuses.length} application statuses`);
      return statuses.length;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        console.warn('⚠️  Rate limited by BambooHR API. Skipping status sync (using cached data).');
        return 0;
      }
      console.error('❌ Failed to sync statuses:', error);
      return 0;
    }
  }

  /**
   * Sync job metadata (posting URL, posted date, status, title) from BambooHR.
   * The API does not expose the posting body text, so the posting itself is
   * stored separately via the MCP `save_job_posting` tool. Update-only: only
   * enriches jobs that already exist locally.
   */
  async syncJobs(): Promise<number> {
    try {
      console.info('📋 Syncing job metadata from BambooHR...');
      const jobs = await this.bambooHRService.getJobs();
      let enriched = 0;
      for (const job of jobs) {
        const updated = this.jobsRepo.updateMetadata(job.id, {
          title: job.title?.label,
          postedDate: job.postedDate,
          status: job.status?.label,
          postingUrl: job.postingUrl,
        });
        if (updated) enriched++;
      }
      console.info(`✅ Enriched ${enriched} of ${jobs.length} job(s) with posting URL/metadata`);

      // The jobs list is not incremental, so a stored job missing from it has closed.
      const closedCount = this.jobsRepo.markClosed(
        findJobsToClose(this.jobsRepo.getAll(), new Set(jobs.map((job) => job.id))),
        CLOSED_STATUS_LABEL
      );
      if (closedCount > 0) console.info(`🔒 Marked ${closedCount} job(s) closed (no longer in BambooHR)`);
      return enriched;
    } catch (error) {
      if (this.isRateLimitError(error)) {
        console.warn('⚠️  Rate limited by BambooHR API. Skipping job metadata sync (using cached data).');
        return 0;
      }
      console.error('❌ Failed to sync jobs:', error);
      return 0;
    }
  }

  /** Whether a sync is running right now (started by any caller in this process). */
  isSyncing(): boolean {
    return syncFlight.isRunning;
  }

  /**
   * Sync applications from BambooHR to local database.
   * A call made while a sync is already running joins it (and gets its result), so a
   * request for a full sync that arrives mid-way is satisfied by the running one.
   */
  syncApplications(forceFull: boolean = false): Promise<number> {
    return syncFlight.run(() => this.runSync(forceFull));
  }

  /**
   * One sync run. Uses the last sync timestamp to only fetch new/updated applications.
   */
  private async runSync(forceFull: boolean): Promise<number> {
    console.info('🔄 Starting BambooHR sync...');

    try {
      // First, sync statuses and job metadata (posting URLs) so lookups resolve
      await this.syncStatuses();
      await this.syncJobs();
      // Get last sync timestamp
      const lastSync = this.contentUpdatesRepo.getLastSyncTimestamp() || undefined;

      // A full/forced sync fetches EVERY application (no newSince) so the active
      // set is complete and inactive-marking is safe. An incremental sync fetches
      // only what changed since the last sync and must never mark anything
      // inactive. (Previously a forced sync still fetched incrementally, so
      // marking-inactive deactivated every application that had not just changed.)
      const isFullSync = forceFull || !lastSync;
      const newSince = isFullSync ? undefined : lastSync;

      if (isFullSync) {
        console.info('📅 Performing full sync (fetching all applications)');
      } else {
        console.info(`📅 Performing incremental sync since: ${lastSync}`);
      }

      // Snapshot known jobs BEFORE ingesting: processing applications creates job
      // rows, which would hide a brand-new job from the discovery step below.
      const knownJobIds = new Set(this.jobsRepo.getAll().map((job) => job.id));

      // Fetch applications from BambooHR (incremental = changed only; full = all)
      const applications = await this.fetchAllApplications(newSince);
      console.info(`📥 Fetched ${applications.length} applications from BambooHR`);

      // Process/enrich new & changed applications (detail fetch, applicant fields).
      let syncedCount = 0;
      const syncedByJob = new Map<number, Array<{ id: number; statusId: number }>>();
      for (const application of applications) {
        try {
          const statusId = await this.processApplication(application);
          syncedCount++;
          if (!syncedByJob.has(application.job.id)) {
            syncedByJob.set(application.job.id, []);
          }
          syncedByJob.get(application.job.id)!.push({ id: application.id, statusId });
        } catch (error) {
          console.error(`Failed to process application ${application.id}:`, error);
        }
      }

      // Only a full sync fetched the complete set, so only a full sync can safely
      // mark applications missing from BambooHR as inactive. An incremental sync
      // must never do this — it only saw what changed.
      if (isFullSync) {
        let totalMarkedInactive = 0;
        for (const [jobId, jobApplications] of syncedByJob.entries()) {
          const activeIds = jobApplications.map((app) => app.id);
          totalMarkedInactive += this.applicationsRepo.markInactiveExcept(jobId, activeIds);
        }
        if (totalMarkedInactive > 0) {
          console.info(`✅ Marked ${totalMarkedInactive} application(s) inactive (no longer in BambooHR)`);
        }
      }

      // Pull CURRENT statuses from BambooHR and OVERWRITE local — BambooHR is
      // authoritative for status. A full sync already fetched the whole list; an
      // incremental sync fetches the full list here so status changes are pulled
      // even when nothing "new" came back. Candidates rejected on BambooHR are
      // excluded from its list, so their local status is left untouched.
      const statusList = isFullSync ? applications : await this.fetchAllApplications();

      // An incremental sync misses applicants who predate our access to a job (or
      // the job's first sync). Backfill every application of jobs we've never
      // stored. A full sync already ingested everything.
      let discoveredCount = 0;
      if (!isFullSync) {
        const unseenJobApplications = selectApplicationsForUnknownJobs(
          statusList,
          knownJobIds,
          new Set(this.applicationsRepo.getLocalStatusMap().keys())
        );
        for (const application of unseenJobApplications) {
          try {
            await this.processApplication(application);
            discoveredCount++;
          } catch (error) {
            console.error(`Failed to process discovered application ${application.id}:`, error);
          }
        }
        if (discoveredCount > 0) {
          const newJobCount = new Set(unseenJobApplications.map((a) => a.job.id)).size;
          console.info(
            `🆕 Discovered ${newJobCount} new job(s); ingested ${discoveredCount} existing application(s)`
          );
        }
        syncedCount += discoveredCount;
      }
      await this.fillPostingsForNewJobs(knownJobIds);

      const statusUpdatesPulled = this.pullStatuses(statusList);
      lastStatusUpdatesPulled = statusUpdatesPulled;
      if (statusUpdatesPulled > 0) {
        console.info(`✅ Pulled ${statusUpdatesPulled} status update(s) from BambooHR`);
      }

      const notes =
        (applications.length === 0
          ? 'No new applications'
          : `Synced ${syncedCount} of ${applications.length} applications`) +
        (discoveredCount > 0 ? `; discovered ${discoveredCount} application(s) in new job(s)` : '') +
        (statusUpdatesPulled > 0 ? `; pulled ${statusUpdatesPulled} status update(s)` : '');
      this.contentUpdatesRepo.create({
        syncType: isFullSync ? 'full' : 'incremental',
        applicationsSynced: syncedCount,
        notes,
      });

      console.info(`✅ Sync complete: ${syncedCount} synced, ${statusUpdatesPulled} status update(s) pulled`);
      return syncedCount;
    } catch (error) {
      // Handle rate limiting gracefully
      if (this.isRateLimitError(error)) {
        console.warn('⚠️  Rate limited by BambooHR API. Sync skipped. Local data is still available.');
        this.contentUpdatesRepo.create({
          syncType: 'rate_limited',
          applicationsSynced: 0,
          notes: 'Sync skipped: BambooHR API rate limit reached. Please try again later.',
        });
        // Don't throw - return 0 to indicate no new syncs but not a fatal error
        return 0;
      }

      console.error('❌ Sync failed:', error);
      this.contentUpdatesRepo.create({
        syncType: 'failed',
        applicationsSynced: 0,
        notes: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      throw error;
    }
  }

  /**
   * For jobs first seen in this sync, pull the public posting text into the
   * job's description so scoring has it by default. Only fills a job that has no
   * description yet (including the legacy file fallback), so an edited or pasted
   * posting is never overwritten. Failures are logged and never fail the sync;
   * the Job settings page can import the posting on demand.
   */
  private async fillPostingsForNewJobs(knownJobIds: ReadonlySet<number>): Promise<void> {
    const newJobs = this.jobsRepo.getAll().filter((job) => !knownJobIds.has(job.id));
    for (const job of newJobs) {
      try {
        if (await this.jobDescriptionService.getJobDescription(job.id)) continue;
        const text = await fetchPostingText(config.bambooHR.subdomain, job.id);
        if (!text) {
          console.info(`ℹ️  No public posting text for new job ${job.id} (${job.title}); add it in Job settings`);
          continue;
        }
        this.jobDescriptionService.saveJobPosting(job.id, { description: text });
        console.info(`📝 Imported posting text for new job ${job.id} (${job.title})`);
      } catch (error) {
        console.warn(`Could not import posting text for new job ${job.id}:`, error);
      }
    }
  }

  /**
   * Fetch all applications from BambooHR (paginated)
   */
  private async fetchAllApplications(newSince?: string): Promise<BambooHRApplication[]> {
    const allApplications: BambooHRApplication[] = [];
    let page = 1;
    const limit = 50; // BambooHR max per page
    let hasMore = true;

    while (hasMore) {
      const applications = await this.bambooHRService.getApplications(page, limit, newSince);
      
      if (applications.length === 0) {
        hasMore = false;
      } else {
        allApplications.push(...applications);
        hasMore = applications.length === limit;
        page++;
      }
    }

    return allApplications;
  }

  /**
   * Process a single application and store in database
   * Returns the statusId that was assigned
   */
  private async processApplication(application: BambooHRApplication): Promise<number> {
    const { job, status } = application;

    // The list endpoint returns a minimal applicant (id/name/email/source only),
    // so fetch the full application detail to enrich applicant fields — notably
    // the structured address (used for geo screening) — and the file IDs.
    let applicant = application.applicant;
    let resumeFileId = application.resumeFileId;
    let coverLetterFileId = application.coverLetterFileId;
    // Selected application answers live only on the detail endpoint.
    let desiredSalary: string | undefined = application.desiredSalary;
    let commutingAnswer: string | undefined;

    try {
      const fullApplication = await this.bambooHRService.getApplication(application.id);
      applicant = fullApplication.applicant ?? applicant;
      resumeFileId = resumeFileId ?? fullApplication.resumeFileId;
      coverLetterFileId = coverLetterFileId ?? fullApplication.coverLetterFileId;
      desiredSalary = fullApplication.desiredSalary ?? desiredSalary;
      commutingAnswer = this.extractCommutingAnswer(fullApplication);
    } catch (error) {
      console.warn(`Could not fetch full details for application ${application.id}:`, error);
    }

    const address = applicant.address;

    // Upsert job
    this.jobsRepo.upsert({
      id: job.id,
      title: job.title.label,
      // Note: posted date / posting URL come from the jobs endpoint (syncJobs)
    });

    // Upsert applicant (rich fields sourced from the detail response above)
    this.applicantsRepo.upsert({
      id: applicant.id,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      email: applicant.email,
      source: applicant.source,
      phoneNumber: applicant.phoneNumber,
      addressLine1: address?.addressLine1,
      addressLine2: address?.addressLine2,
      city: address?.city,
      state: address?.state,
      zipcode: address?.zipcode,
      country: address?.country,
      linkedInUrl: applicant.linkedinUrl ?? applicant.linkedInUrl,
      availableStartDate: applicant.availableStartDate,
    });

    // Get or create status ID
    const statusId = this.statesRepo.getOrCreateByStatus(status.label, status.id);

    // Upsert application (with status ID, resumeFileId, and coverLetterFileId)
    this.applicationsRepo.upsert({
      id: application.id,
      appliedDate: application.appliedDate,
      statusId,
      rating: application.rating || undefined,
      applicantId: applicant.id,
      jobId: job.id,
      resumeFileId,
      coverLetterFileId,
      desiredSalary,
      commutingAnswer,
      active: true, // Explicitly set as active since it's in BambooHR
    });

    return statusId;
  }

  /** How many local statuses the last sync overwrote with BambooHR's value. */
  getLastStatusUpdatesPulled(): number {
    return lastStatusUpdatesPulled;
  }

  /**
   * Overwrite each listed application's local status with BambooHR's current
   * status (BambooHR is authoritative). Only touches applications already in the
   * local DB; new ones are added by processApplication. Returns how many local
   * status_id values actually changed.
   */
  private pullStatuses(applications: BambooHRApplication[]): number {
    const localStatus = this.applicationsRepo.getLocalStatusMap();
    let changed = 0;
    for (const application of applications) {
      if (!localStatus.has(application.id)) continue; // not local yet
      const statusId = this.statesRepo.getOrCreateByStatus(
        application.status.label,
        application.status.id
      );
      if (localStatus.get(application.id) !== statusId) changed += 1;
      this.applicationsRepo.pullBambooStatus(application.id, statusId);
    }
    return changed;
  }

  /** The candidate's answer to the "commuting distance" application question, if any. */
  private extractCommutingAnswer(application: BambooHRApplication): string | undefined {
    const match = (application.questionsAndAnswers ?? []).find((qa) =>
      (qa.question?.label ?? '').toLowerCase().includes('commuting distance')
    );
    return match?.answer?.label ?? undefined;
  }

  /**
   * Get sync history
   */
  getSyncHistory(limit: number = 50) {
    return this.contentUpdatesRepo.getAll(limit);
  }

  /**
   * Get last sync info
   */
  getLastSync() {
    return this.contentUpdatesRepo.getLatest();
  }
}

