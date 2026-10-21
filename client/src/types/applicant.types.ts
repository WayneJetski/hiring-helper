/**
 * Type definitions for applicant data
 */

export interface ApplicantListItem {
  id: number;
  name: string;
  email: string;
  stage: string;
  appliedDate: string;
  rating?: number;
  confidence?: number; // AI-generated confidence score (0-100)
  summaryBrief?: string; // one-paragraph AI summary shown under the name in the list
  applicantId?: number; // BambooHR's id for the person (its "candidate"), used to link into BambooHR
  flags?: string[]; // triage flags: location | name | studying | no_exp | tenure | salary-low | salary-high
}

export interface ApplicantAddress {
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
}

export interface ApplicantDetail extends ApplicantListItem {
  /** The job this application is for. */
  jobId: number;
  jobTitle: string;
  phoneNumber?: string;
  address?: ApplicantAddress;
  source?: string;
  linkedInUrl?: string;
  websiteUrl?: string;
  coverLetter?: string;
  resumeFileId?: number;
  aiSummary?: ApplicantSummary;
  createdDate: string;
  modifiedDate?: string;
  availableStartDate?: string;
  desiredSalary?: string; // free-text "Desired Pay" from the BambooHR application
  commutingAnswer?: string; // answer to the commuting-distance application question
}

export interface ApplicantSummary {
  confidence: number; // 0-100
  brief: string;
  full: string;
  risks: string;
  suggestedScreeningQuestions?: string[]; // Array of screening questions to ask
  generatedAt: string;
  jobTitle?: string;
  jobId?: number;
  /** Points given to each evaluation area (they add up to the model's merit score). */
  areaScores?: Array<{ name: string; points: number; maxPoints: number }>;
  /** Present when red-flag penalties lowered the score: the model's merit score and what applied. */
  scoreAdjustment?: {
    meritScore: number;
    penalties: Array<{ flag: string; penalty: Exclude<FlagPenalty, 'none'> }>;
  };
}

export interface JobSummary {
  id: number;
  title: string;
  applicationCount: number;
  activeCount: number;
  latestAppliedDate: string | null;
  hasPosting: boolean;
  postingUrl: string | null;
  unscoredCount: number; // active applications with no AI score yet
  isCriteriaConfirmed: boolean; // a person confirmed the scoring criteria
  isReadyToScore: boolean; // posting text exists and criteria are confirmed
}

/** Status of a headless scoring run (polled while it runs). */
export interface ScoringStatus {
  running: boolean;
  jobId: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  scored: number;
  total: number | null; // how many this run set out to score (null when unknown)
  cancelled: boolean;
  ok: boolean | null;
  error: string | null;
  message: string | null;
}

export interface StartScoringResult {
  started: boolean;
  alreadyRunning?: boolean;
  status: ScoringStatus;
}

/** A job's editable scoring config (description + effective system prompt). */
export interface JobDetail {
  id: number;
  title: string;
  postingUrl: string | null;
  description: string;
  scoringConfig: ScoringConfig; // effective: saved for this job, or the defaults
  scoringConfigIsCustom: boolean;
  /** A hand-written prompt that could not be converted is still in use. */
  isLegacyPromptActive: boolean;
  /** Setup state: scoring is blocked until the posting exists and criteria are confirmed. */
  hasPosting: boolean;
  isCriteriaConfirmed: boolean;
  isReadyToScore: boolean;
}

/** One question of the short survey used to tailor generated criteria. */
export interface SurveyQuestion {
  question: string;
  options: string[];
}

export interface SurveyAnswer {
  question: string;
  answer: string;
}

export interface SuggestedQuestions {
  questions: SurveyQuestion[];
  /** True when role-specific questions could not be written and general ones are shown. */
  isGeneric: boolean;
}

/** Draft evaluation areas written by AI; applied to the editor, not saved. */
export interface SuggestedCriteria {
  dimensions: ScoringDimension[];
  summary: string;
}

/** One weighted area of the scoring framework. */
export interface ScoringDimension {
  id: string;
  name: string;
  maxPoints: number;
  /** What to look for, one point per line. */
  guidance: string;
}

/** How much a red flag lowers the score when it applies. */
export type FlagPenalty = 'none' | 'bit' | 'lot' | 'dealbreaker';

export interface RedFlagSetting {
  enabled: boolean;
  penalty: FlagPenalty;
}

/** A flag the app works out from the desired-pay answer; off until a yearly figure is entered. */
export interface SalaryFlagSetting extends RedFlagSetting {
  /** Yearly pay in dollars: low flags pay below it, high flags pay above it. */
  threshold: number | null;
}

/** The scoring criteria a user can change; the rest of the prompt is managed for them. */
export interface ScoringConfig {
  dimensions: ScoringDimension[];
  redFlags: {
    nameCapitalization: RedFlagSetting;
    location: RedFlagSetting & { locale: string };
    studying: RedFlagSetting;
    noExperience: RedFlagSetting;
    tenureGaps: RedFlagSetting;
    salaryLow: SalaryFlagSetting;
    salaryHigh: SalaryFlagSetting;
  };
}

export interface Status {
  id: number;
  label: string;
  active: boolean;
}

export interface BulkCondition {
  field: 'match' | 'appliedDate' | 'flag';
  operator: 'greaterThan' | 'lessThan' | 'is';
  value: number | string;
}

export interface BulkMatch {
  id: number;
  name: string;
  email: string;
  appliedDate: string;
  score: number | null;
}

export interface BulkPreviewResult {
  count: number;
  sample: BulkMatch[];
}

/** An application's status before a bulk change, used to undo it. */
export interface PreviousStatus {
  id: number;
  statusId: number;
}

export interface BulkActionResult {
  updated: number;
  previousStatuses: PreviousStatus[];
}

/** First-run setup state: is BambooHR connected, is Claude Code installed. */
export interface SetupStatus {
  bambooHR: { configured: boolean; subdomain: string | null };
  claude: {
    installed: boolean;
    version: string | null;
    /** Null when unknown (not installed, or the status could not be read). */
    signedIn: boolean | null;
    account: string | null;
    isSigningIn: boolean;
  };
}

/** Whether a newer version exists, and how an update in progress is going. */
export interface UpdateStatus {
  currentVersion: string;
  currentCommit: string | null;
  branch: string | null;
  /** Installed and started by `hiring-helper`, so it may update itself. */
  isManagedInstall: boolean;
  update: {
    available: boolean;
    latestCommit: string | null;
    /** A page showing what changed (when the remote is on GitHub). */
    compareUrl: string | null;
    checkedAt: string | null;
    error: string | null;
  };
  apply: {
    state: 'idle' | 'updating' | 'restarting' | 'failed';
    step: string | null;
    error: string | null;
    startedAt: string | null;
  };
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

/** Result of testing the BambooHR credentials that are already saved. */
export interface BambooHRConnection {
  configured: boolean;
  subdomain: string | null;
  ok: boolean | null; // null when nothing is saved to test
  message: string;
  /** The check failed for a reason unrelated to the key (outage, rate limit, offline): keep the key. */
  isTemporaryFailure: boolean;
  checkedAt: string | null; // when BambooHR was actually asked (ISO)
}

export interface LastSync {
  timestamp: string;
  syncType: string;
  applicationsSynced: number;
  notes: string | null;
}

export interface DuplicateGroup {
  email: string;
  name: string;
  keep: { id: number; appliedDate: string } | null;
  reject: { id: number; name: string; appliedDate: string }[];
  reason: string;
}

export interface DuplicatePreviewResult {
  groupCount: number;
  rejectCount: number;
  groups: DuplicateGroup[];
}

/** A local status change waiting to be pushed back to BambooHR. */
export interface PendingPush {
  id: number;
  name: string;
  appliedDate: string;
  fromStatusId: number | null;
  fromLabel: string;
  toStatusId: number;
  toLabel: string;
}

export interface PushPreviewResult {
  count: number;
  pending: PendingPush[];
}

export interface PushItemResult {
  id: number;
  ok: boolean;
  toStatusId: number;
  toLabel: string;
  error?: string;
}

export interface PushResult {
  total: number;
  pushed: number;
  failed: number;
  rateLimited: boolean;
  /** Reviewed changes not sent because the applicant was edited after the preview. */
  changedSinceReview: number;
  results: PushItemResult[];
}

export interface PaginationInfo {
  page: number;
  limit: number;
  hasMore: boolean;
  totalPages: number;
}

export interface ApiResponse<T> {
  data: T;
  count?: number;
  totalCount?: number; // Total count across all pages
  pagination?: PaginationInfo;
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

