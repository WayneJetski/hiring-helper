/**
 * Bulk Action Service
 *
 * Orchestrates job-scoped bulk operations over applications: previewing which
 * candidates match a condition, and applying a status change (reject / move)
 * to all matches.
 *
 * IMPORTANT: This service only mutates the LOCAL SQLite store. It deliberately
 * does NOT push status changes to BambooHR and does NOT send any emails or
 * notifications. See the note in `applyStatusToMatches` for where a future
 * BambooHR-push hook would go.
 */

import {
  ApplicationsRepository,
  type BulkCondition,
  type BulkMatch,
} from '../repositories/applications.repository.js';
import { ApplicationStatesRepository } from '../repositories/application-states.repository.js';
import { JobsRepository } from '../repositories/jobs.repository.js';

/** Number of matching candidates included in a preview sample. */
const PREVIEW_SAMPLE_SIZE = 10;

export interface BulkPreviewResult {
  count: number;
  sample: BulkMatch[];
}

/** A status change that can be reversed via `restore`. */
export interface PreviousStatus {
  id: number;
  statusId: number;
}

export interface BulkActionResult {
  updated: number;
  /** What each changed application's status was before, so the action can be undone. */
  previousStatuses: PreviousStatus[];
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

const DUPLICATE_STATUS_LABEL = 'Duplicate';

/** Terminal/decided statuses — a candidate here has already been screened out. */
const REJECTION_STATUSES = new Set<string>([
  'Not a Fit',
  'P&C to Reject',
  'Wrong Geographical Location',
  'Lacking Skill(s)/Qualification(s)',
  'Over Qualified',
  'Duplicate',
  'Never Replied',
  'Removed themselves from process',
  'Accepted another Role',
]);

/** Unreviewed early stages — the only applications the cleanup will reject. */
const REVIEWABLE_STATUSES = new Set<string>(['New', 'Reviewed', 'Bench']);

export class BulkActionService {
  private applicationsRepo: ApplicationsRepository;
  private statesRepo: ApplicationStatesRepository;
  private jobsRepo: JobsRepository;

  constructor() {
    this.applicationsRepo = new ApplicationsRepository();
    this.statesRepo = new ApplicationStatesRepository();
    this.jobsRepo = new JobsRepository();
  }

  private assertJobExists(jobId: number): void {
    if (!this.jobsRepo.getById(jobId)) {
      throw new Error(`No job found with ID ${jobId}`);
    }
  }

  private assertStatusExists(statusId: number): void {
    if (!this.statesRepo.getById(statusId)) {
      throw new Error(`No application status found with ID ${statusId}`);
    }
  }

  /**
   * Status IDs for the rejection reasons. Bulk actions skip candidates already
   * in one of these so a preview/apply never re-touches an already-rejected
   * candidate (they are decided and out of the active pipeline).
   */
  private rejectionStatusIds(): number[] {
    return [...REJECTION_STATUSES]
      .map((label) => this.statesRepo.getByStatus(label)?.id)
      .filter((id): id is number => id !== undefined);
  }

  /**
   * Read-only: how many candidates in this job match the condition, plus a
   * small sample for the confirmation UI. Already-rejected candidates are
   * excluded so the preview reflects only candidates the action would change.
   */
  preview(jobId: number, condition: BulkCondition): BulkPreviewResult {
    this.assertJobExists(jobId);
    const exclude = this.rejectionStatusIds();
    return {
      count: this.applicationsRepo.countByCondition(jobId, condition, exclude),
      sample: this.applicationsRepo.findMatchesByCondition(
        jobId,
        condition,
        PREVIEW_SAMPLE_SIZE,
        exclude
      ),
    };
  }

  /**
   * Apply a status change to every application in the job matching the
   * condition. Shared by reject and move; only the target status differs.
   */
  private applyStatusToMatches(
    jobId: number,
    condition: BulkCondition,
    statusId: number
  ): BulkActionResult {
    this.assertJobExists(jobId);
    this.assertStatusExists(statusId);

    // Exclude already-rejected candidates so a bulk action only touches those
    // still in play — matching the preview the user confirmed.
    const matchingIds = this.applicationsRepo.findIdsByCondition(
      jobId,
      condition,
      this.rejectionStatusIds()
    );
    const previousStatuses = this.applicationsRepo.getStatusesForIds(matchingIds);
    const updated = this.applicationsRepo.setStatusForIds(matchingIds, statusId);

    // FUTURE: a BambooHR-push hook could go here to mirror these local status
    // changes back to BambooHR (and/or trigger rejection notifications). This
    // is intentionally out of scope; bulk actions stay local-only for now.

    return { updated, previousStatuses };
  }

  /** Bulk reject: set matching applications to the chosen rejection status. */
  reject(jobId: number, condition: BulkCondition, statusId: number): BulkActionResult {
    return this.applyStatusToMatches(jobId, condition, statusId);
  }

  /** Bulk move: set matching applications to the chosen target stage. */
  move(jobId: number, condition: BulkCondition, statusId: number): BulkActionResult {
    return this.applyStatusToMatches(jobId, condition, statusId);
  }

  /**
   * Group a job's active applications by applicant email and decide which to
   * reject as duplicates. Only unreviewed applications (New/Reviewed/Bench) are
   * ever rejected — applications in an interview/offer stage or already in a
   * rejection status are never touched.
   *
   * Per candidate:
   *  - If the candidate already has a decided (rejected) application, or another
   *    copy already in progress, every unreviewed application is a redundant
   *    re-application and is rejected as Duplicate (e.g. rejected "Not a Fit",
   *    then reapplied).
   *  - Otherwise, among the unreviewed copies keep the newest and reject the rest.
   */
  private computeDuplicates(jobId: number): { groups: DuplicateGroup[]; rejectIds: number[] } {
    const rows = this.applicationsRepo.findActiveForDuplicateCheck(jobId); // newest first
    const byEmail = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = (row.email || '').trim().toLowerCase();
      if (!key) continue; // can't dedupe without an email
      const list = byEmail.get(key);
      if (list) list.push(row);
      else byEmail.set(key, [row]);
    }

    const groups: DuplicateGroup[] = [];
    const rejectIds: number[] = [];
    for (const [email, list] of byEmail) {
      const reviewable = list.filter((r) => REVIEWABLE_STATUSES.has(r.statusLabel)); // newest first
      if (reviewable.length === 0) continue; // nothing safe to reject

      // A "prior rejection" must be an independent decision — NOT the "Duplicate"
      // status, which this cleanup itself assigns. Counting Duplicate here would
      // cause a re-run to reject the surviving (kept) application, looping forever.
      const priorRejection = list.find(
        (r) => REJECTION_STATUSES.has(r.statusLabel) && r.statusLabel !== DUPLICATE_STATUS_LABEL
      );
      const hasAdvancing = list.some(
        (r) => !REVIEWABLE_STATUSES.has(r.statusLabel) && !REJECTION_STATUSES.has(r.statusLabel)
      );

      let keep: { id: number; appliedDate: string } | null;
      let rejectRows: typeof reviewable;
      let reason: string;

      if (priorRejection) {
        keep = null;
        rejectRows = reviewable; // re-applications of an already-rejected candidate
        reason = `re-application; already "${priorRejection.statusLabel}"`;
      } else if (hasAdvancing) {
        keep = null;
        rejectRows = reviewable; // another copy is already in the pipeline
        reason = 'redundant copy; another application is in progress';
      } else {
        if (reviewable.length < 2) continue; // single application, not a duplicate
        keep = { id: reviewable[0].id, appliedDate: reviewable[0].appliedDate };
        rejectRows = reviewable.slice(1);
        reason = 'duplicate (newest kept)';
      }

      if (rejectRows.length === 0) continue;
      groups.push({
        email,
        name: (keep ? list.find((r) => r.id === keep!.id)?.name : reviewable[0].name) ?? reviewable[0].name,
        keep,
        reject: rejectRows.map((r) => ({ id: r.id, name: r.name, appliedDate: r.appliedDate })),
        reason,
      });
      for (const r of rejectRows) rejectIds.push(r.id);
    }
    return { groups, rejectIds };
  }

  /**
   * Preview which duplicate applications would be rejected (older copies),
   * keeping the newest of each set. Read-only.
   */
  previewDuplicates(jobId: number): DuplicatePreviewResult {
    this.assertJobExists(jobId);
    const { groups, rejectIds } = this.computeDuplicates(jobId);
    return { groupCount: groups.length, rejectCount: rejectIds.length, groups };
  }

  /**
   * Reject the older duplicate applications by moving them to the "Duplicate"
   * status (local only). Keeps the newest of each set.
   */
  cleanupDuplicates(jobId: number): BulkActionResult & { statusLabel: string } {
    this.assertJobExists(jobId);
    const duplicateStatus = this.statesRepo.getByStatus(DUPLICATE_STATUS_LABEL);
    if (!duplicateStatus) {
      throw new Error(`No "${DUPLICATE_STATUS_LABEL}" status exists in BambooHR to reject into`);
    }
    const { rejectIds } = this.computeDuplicates(jobId);
    const previousStatuses = this.applicationsRepo.getStatusesForIds(rejectIds);
    const updated = this.applicationsRepo.setStatusForIds(rejectIds, duplicateStatus.id);
    return { updated, previousStatuses, statusLabel: duplicateStatus.status };
  }

  /**
   * Undo a bulk action by putting each application back to its previous status.
   * Local only, like the actions it reverses. Unknown status ids are rejected up
   * front so a bad request cannot half-apply.
   */
  restore(entries: PreviousStatus[]): { restored: number } {
    for (const entry of entries) this.assertStatusExists(entry.statusId);
    return { restored: this.applicationsRepo.restoreStatuses(entries) };
  }
}
