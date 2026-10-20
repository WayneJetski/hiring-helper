/**
 * Applicant Query Service
 * Assembles applicant list items, details, and resume text from the local
 * database and BambooHR file API. Shared by the REST controller and the MCP
 * server so both expose identical read behavior.
 */

import { getDatabase } from '../db/database.js';
import { ApplicationsRepository } from '../repositories/applications.repository.js';
import { ApplicantsRepository } from '../repositories/applicants.repository.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import { ApplicationStatesRepository } from '../repositories/application-states.repository.js';
import { ScoresRepository } from '../repositories/scores.repository.js';
import { ApplicationSummaryRepository } from '../repositories/application-summary.repository.js';
import { ApplicationFlagsRepository } from '../repositories/application-flags.repository.js';
import { BambooHRService } from './bamboohr.service.js';
import { ResumeParserService } from './resume-parser.service.js';
import { getJobReadiness } from '../scoring/job-readiness.js';
import type { ApplicantListItem, ApplicantDetail } from '../types/bamboohr.types.js';

const DEFAULT_PAGE = 1;
const MAX_LIMIT = 50;
const UNKNOWN_STATUS = 'Unknown';

export interface ListApplicantsFilters {
  statusIds?: number[];
  jobId?: number;
  search?: string;
  activeOnly?: boolean;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface ListApplicantsResult {
  items: ApplicantListItem[];
  totalCount: number;
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
    totalPages: number;
  };
}

export interface UnscoredApplicant {
  applicationId: number;
  name: string;
  email: string;
  jobTitle: string;
  appliedDate: string;
}

export interface JobSummary {
  id: number;
  title: string;
  applicationCount: number;
  activeCount: number;
  latestAppliedDate: string | null;
  hasPosting: boolean;
  postingUrl: string | null;
  /** Active applications with no AI score yet. */
  unscoredCount: number;
  /** A person has confirmed this job's scoring criteria. */
  isCriteriaConfirmed: boolean;
  /** Posting text exists and the criteria are confirmed: scoring is allowed. */
  isReadyToScore: boolean;
}

/**
 * Raised when an application exists but references a missing applicant or job.
 * Callers map this to a 500 (REST) or an error result (MCP).
 */
export class DataIntegrityError extends Error {}

export class ApplicantQueryService {
  private applicationsRepo: ApplicationsRepository;
  private applicantsRepo: ApplicantsRepository;
  private jobsRepo: JobsRepository;
  private statesRepo: ApplicationStatesRepository;
  private scoresRepo: ScoresRepository;
  private summaryRepo: ApplicationSummaryRepository;
  private flagsRepo: ApplicationFlagsRepository;
  private bambooHRService: BambooHRService;
  private resumeParserService: ResumeParserService;

  constructor() {
    this.applicationsRepo = new ApplicationsRepository();
    this.applicantsRepo = new ApplicantsRepository();
    this.jobsRepo = new JobsRepository();
    this.statesRepo = new ApplicationStatesRepository();
    this.scoresRepo = new ScoresRepository();
    this.summaryRepo = new ApplicationSummaryRepository();
    this.flagsRepo = new ApplicationFlagsRepository();
    this.bambooHRService = new BambooHRService();
    this.resumeParserService = new ResumeParserService();
  }

  /**
   * Resolve a status_id to its human label, defaulting to "Unknown".
   */
  private statusLabel(statusId?: number): string {
    if (!statusId) return UNKNOWN_STATUS;
    return this.statesRepo.getById(statusId)?.status || UNKNOWN_STATUS;
  }

  /**
   * List applicants with filtering, sorting, and pagination.
   */
  async listApplicants(filters: ListApplicantsFilters): Promise<ListApplicantsResult> {
    const page = filters.page && filters.page > 0 ? filters.page : DEFAULT_PAGE;
    const limit = filters.limit ? Math.min(filters.limit, MAX_LIMIT) : MAX_LIMIT;
    const offset = (page - 1) * limit;

    const totalCount = this.applicationsRepo.countFiltered({
      statusIds: filters.statusIds,
      jobId: filters.jobId,
      searchTerm: filters.search,
      activeOnly: filters.activeOnly,
    });

    const applications = this.applicationsRepo.getFiltered({
      statusIds: filters.statusIds,
      jobId: filters.jobId,
      searchTerm: filters.search,
      activeOnly: filters.activeOnly,
      sortBy: filters.sortBy,
      sortDirection: filters.sortDirection,
      limit: limit + 1, // +1 to detect whether more pages exist
      offset,
    });

    const hasMore = applications.length > limit;
    const pageApplications = hasMore ? applications.slice(0, limit) : applications;

    const scores = await this.scoresRepo.getAllScores();
    const flagsMap = this.flagsRepo.getFlagsMap();

    const items = pageApplications
      .map((app): ApplicantListItem | null => {
        const applicant = this.applicantsRepo.getById(app.applicantId);
        const job = this.jobsRepo.getById(app.jobId);
        if (!applicant || !job) {
          return null; // Skip orphaned rows (should not happen with FK constraints)
        }

        const item: ApplicantListItem = {
          id: app.id,
          applicantId: applicant.id,
          name: `${applicant.firstName} ${applicant.lastName}`.trim(),
          email: applicant.email,
          stage: this.statusLabel(app.statusId),
          appliedDate: app.appliedDate,
          rating: app.rating,
        };

        const confidence = scores[app.id.toString()];
        if (confidence !== undefined) {
          item.confidence = confidence;
        }

        const flags = flagsMap[app.id];
        if (flags?.length) {
          item.flags = flags;
        }

        return item;
      })
      .filter((item): item is ApplicantListItem => item !== null);

    // Attach each scored candidate's one-line AI summary (cached on disk).
    await Promise.all(
      items
        .filter((item) => item.confidence !== undefined)
        .map(async (item) => {
          const summary = await this.summaryRepo.getSummary(item.id);
          if (summary?.brief) item.summaryBrief = summary.brief;
        })
    );

    return {
      items,
      totalCount,
      pagination: {
        page,
        limit,
        hasMore,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  /**
   * Get a single applicant's full detail, including any cached AI summary.
   * Returns null when the application does not exist.
   * @throws DataIntegrityError when the application references a missing applicant/job.
   */
  async getApplicantDetail(applicationId: number): Promise<ApplicantDetail | null> {
    const application = this.applicationsRepo.getById(applicationId);
    if (!application) {
      return null;
    }

    const applicant = this.applicantsRepo.getById(application.applicantId);
    const job = this.jobsRepo.getById(application.jobId);
    if (!applicant || !job) {
      throw new DataIntegrityError(
        `Application ${applicationId} references a missing applicant or job`
      );
    }

    // Return the structured address object the client renders (line1/line2/city/
    // state/zip/country), not a flattened string. Undefined only when there is
    // no address data at all.
    const hasAddress =
      applicant.addressLine1 ||
      applicant.addressLine2 ||
      applicant.city ||
      applicant.state ||
      applicant.zipcode ||
      applicant.country;
    const address = hasAddress
      ? {
          addressLine1: applicant.addressLine1,
          addressLine2: applicant.addressLine2,
          city: applicant.city,
          state: applicant.state,
          zipcode: applicant.zipcode,
          country: applicant.country,
        }
      : undefined;

    const detail: ApplicantDetail = {
      id: application.id,
      name: `${applicant.firstName} ${applicant.lastName}`.trim(),
      email: applicant.email,
      stage: this.statusLabel(application.statusId),
      appliedDate: application.appliedDate,
      jobId: job.id,
      jobTitle: job.title,
      rating: application.rating,
      phoneNumber: applicant.phoneNumber,
      address,
      source: applicant.source,
      linkedInUrl: applicant.linkedInUrl,
      websiteUrl: undefined, // Not stored locally
      coverLetter: undefined, // Not stored locally
      resumeFileId: application.resumeFileId,
      createdDate: application.createdAt,
      modifiedDate: application.updatedAt,
      availableStartDate: applicant.availableStartDate,
      desiredSalary: application.desiredSalary,
      commutingAnswer: application.commutingAnswer,
      aiSummary: undefined,
    };

    const score = await this.scoresRepo.getScore(applicationId);
    if (score !== null) {
      detail.confidence = score;
    }

    const flags = this.flagsRepo.getFlags(applicationId);
    if (flags.length) {
      detail.flags = flags;
    }

    const summary = await this.summaryRepo.getSummary(applicationId);
    if (summary) {
      detail.aiSummary = summary;
    }

    return detail;
  }

  /**
   * Fetch and parse the resume text for an application.
   * Returns null when the application or its resume file is unavailable.
   */
  async getResumeText(applicationId: number): Promise<string | null> {
    const application = this.applicationsRepo.getById(applicationId);
    if (!application || !application.resumeFileId) {
      return null;
    }

    const resumeBuffer = await this.bambooHRService.getResumeFile(
      applicationId,
      application.resumeFileId
    );
    const parsed = await this.resumeParserService.parsePdfToJson(
      resumeBuffer,
      application.resumeFileId
    );
    return parsed.text;
  }

  /**
   * Fetch the raw résumé PDF bytes for an application (proxied from BambooHR).
   * Returns null when the application has no résumé file on record.
   */
  async getResumeFile(applicationId: number): Promise<Uint8Array | null> {
    const application = this.applicationsRepo.getById(applicationId);
    if (!application || !application.resumeFileId) {
      return null;
    }
    return this.bambooHRService.getResumeFile(applicationId, application.resumeFileId);
  }

  /**
   * Update the hiring stage (status) of a single application in the local store.
   * Returns the resolved status label, or null if the application/status is unknown.
   */
  moveToStage(applicationId: number, statusId: number): { statusId: number; statusLabel: string } | null {
    const application = this.applicationsRepo.getById(applicationId);
    const status = this.statesRepo.getById(statusId);
    if (!application || !status) {
      return null;
    }
    this.applicationsRepo.updateStatus(applicationId, statusId);
    return { statusId, statusLabel: status.status };
  }

  /**
   * Gather everything needed to evaluate a candidate: name, job, and resume
   * text. Used by the MCP `evaluate_candidate` prompt.
   * Returns null when the application does not exist.
   * @throws DataIntegrityError when the application references a missing applicant/job.
   */
  async getScoringContext(applicationId: number): Promise<{
    candidateName: string;
    email: string;
    location: string;
    phone: string;
    commutingAnswer: string;
    jobId: number;
    jobTitle: string;
    appliedDate: string;
    resumeText: string | null;
  } | null> {
    const application = this.applicationsRepo.getById(applicationId);
    if (!application) {
      return null;
    }

    const applicant = this.applicantsRepo.getById(application.applicantId);
    const job = this.jobsRepo.getById(application.jobId);
    if (!applicant || !job) {
      throw new DataIntegrityError(
        `Application ${applicationId} references a missing applicant or job`
      );
    }

    const resumeText = await this.getResumeText(applicationId);

    const location =
      [applicant.city, applicant.state, applicant.country].filter(Boolean).join(', ') || 'Unknown';

    return {
      candidateName: `${applicant.firstName} ${applicant.lastName}`.trim(),
      email: applicant.email,
      location,
      phone: applicant.phoneNumber || 'Unknown',
      commutingAnswer: application.commutingAnswer || 'Not answered',
      jobId: job.id,
      jobTitle: job.title,
      appliedDate: application.appliedDate,
      resumeText,
    };
  }

  /**
   * Find active applications that do not yet have an AI score.
   * This is the work queue Claude pulls from when scoring candidates.
   * @param jobId - Optional: restrict to a single job posting.
   */
  findUnscoredApplicants(jobId?: number): UnscoredApplicant[] {
    const db = getDatabase();
    const jobFilter = jobId !== undefined ? 'AND a.job_id = ?' : '';
    const query = `
      SELECT a.id AS application_id,
             ap.first_name,
             ap.last_name,
             ap.email,
             j.title AS job_title,
             a.applied_date
      FROM applications a
      INNER JOIN applicants ap ON a.applicant_id = ap.id
      LEFT JOIN jobs j ON a.job_id = j.id
      LEFT JOIN application_scores s ON s.application_id = a.id
      WHERE s.score IS NULL AND a.active = 1 ${jobFilter}
      ORDER BY a.applied_date DESC
    `;

    const params = jobId !== undefined ? [jobId] : [];
    const rows = db
      .prepare<
        number[],
        {
          application_id: number;
          first_name: string;
          last_name: string;
          email: string;
          job_title: string | null;
          applied_date: string;
        }
      >(query)
      .all(...params);

    return rows.map((row) => ({
      applicationId: row.application_id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      email: row.email,
      jobTitle: row.job_title || UNKNOWN_STATUS,
      appliedDate: row.applied_date,
    }));
  }

  /**
   * List all jobs with application counts and latest activity, most recent first.
   */
  listJobs(): JobSummary[] {
    const db = getDatabase();
    const query = `
      SELECT j.id,
             j.title,
             j.posting_url,
             j.criteria_confirmed_at,
             COUNT(a.id) AS application_count,
             SUM(CASE WHEN a.active = 1 THEN 1 ELSE 0 END) AS active_count,
             SUM(CASE WHEN a.active = 1 AND s.score IS NULL THEN 1 ELSE 0 END) AS unscored_count,
             MAX(a.applied_date) AS latest_applied_date,
             CASE WHEN j.description IS NOT NULL AND length(j.description) > 0 THEN 1 ELSE 0 END AS has_posting
      FROM jobs j
      LEFT JOIN applications a ON a.job_id = j.id
      LEFT JOIN application_scores s ON s.application_id = a.id
      GROUP BY j.id
      ORDER BY latest_applied_date DESC
    `;

    const rows = db
      .prepare<
        [],
        {
          id: number;
          title: string;
          posting_url: string | null;
          criteria_confirmed_at: string | null;
          application_count: number;
          active_count: number | null;
          unscored_count: number | null;
          latest_applied_date: string | null;
          has_posting: number;
        }
      >(query)
      .all();

    return rows.map((row) => {
      const readiness = getJobReadiness({
        description: row.has_posting === 1 ? 'x' : '',
        criteriaConfirmedAt: row.criteria_confirmed_at,
      });
      return {
      id: row.id,
      title: row.title,
      applicationCount: row.application_count,
      activeCount: row.active_count ?? 0,
      unscoredCount: row.unscored_count ?? 0,
      latestAppliedDate: row.latest_applied_date,
      hasPosting: row.has_posting === 1,
      postingUrl: row.posting_url,
      isCriteriaConfirmed: readiness.isCriteriaConfirmed,
      isReadyToScore: readiness.isReadyToScore,
      };
    });
  }

  /**
   * The "current" job: the one with the most recent application activity.
   * Used as the default scope when no job is specified. Returns null if empty.
   */
  resolveCurrentJobId(): number | null {
    const db = getDatabase();
    const row = db
      .prepare<[], { job_id: number }>(
        'SELECT job_id FROM applications ORDER BY applied_date DESC LIMIT 1'
      )
      .get();
    return row ? row.job_id : null;
  }

  /**
   * All application IDs matching a list filter (no pagination) — the exact set
   * the applicants list shows for that filter. Used to scope a re-scoring run.
   */
  findFilteredApplicationIds(filter: {
    statusIds?: number[];
    jobId?: number;
    search?: string;
    activeOnly?: boolean;
  }): number[] {
    return this.applicationsRepo.getFilteredIds({
      statusIds: filter.statusIds,
      jobId: filter.jobId,
      searchTerm: filter.search,
      activeOnly: filter.activeOnly,
    });
  }
}
