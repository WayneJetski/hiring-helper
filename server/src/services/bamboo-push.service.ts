/**
 * Bamboo Push Service
 *
 * Pushes locally-decided status changes (stage moves and rejections-with-reason)
 * back to BambooHR. A "pending" change is an active application whose working
 * status_id differs from the status BambooHR last reported (bamboo_status_id);
 * see `ApplicationsRepository.findPendingStatusPushes`.
 *
 * IMPORTANT — never emails candidates: the only BambooHR write performed here is
 * `BambooHRStatusWriter.updateApplicationStatus`, which sends the status field only.
 * No BambooHR email / disposition / notification endpoint is called. Do not add
 * one.
 */

import {
  BambooHRStatusWriter,
  type ApplicationStatusWriter,
} from './bamboohr-status-writer.service.js';
import {
  ApplicationsRepository,
  type PendingStatusPush,
} from '../repositories/applications.repository.js';
import { ContentUpdatesRepository } from '../repositories/content-updates.repository.js';
import { isBambooRateLimitError } from '../utils/rate-limit.js';
import type { ReviewedChange } from '../validation/reviewed-changes.js';

export interface PushPreviewResult {
  count: number;
  pending: PendingStatusPush[];
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
  /** Reviewed changes that were not sent because the row changed after the preview. */
  changedSinceReview: number;
  results: PushItemResult[];
}

export interface DiscardResult {
  /** Applications put back to the stage BambooHR has. */
  discarded: number;
  /** Pending changes left alone because BambooHR's stage for them is unknown. */
  skipped: number;
}

export class BambooPushService {
  private statusWriter: ApplicationStatusWriter;
  private applicationsRepo: ApplicationsRepository;
  private contentUpdatesRepo: ContentUpdatesRepository;

  // Dependencies are injectable (with sensible defaults) so the push logic can
  // be tested against a fake BambooHR client without touching the network.
  constructor(
    statusWriter: ApplicationStatusWriter = new BambooHRStatusWriter(),
    applicationsRepo: ApplicationsRepository = new ApplicationsRepository(),
    contentUpdatesRepo: ContentUpdatesRepository = new ContentUpdatesRepository()
  ) {
    this.statusWriter = statusWriter;
    this.applicationsRepo = applicationsRepo;
    this.contentUpdatesRepo = contentUpdatesRepo;
  }

  /**
   * Read-only: the status changes waiting to be pushed. Scoped to `jobId` when
   * given, otherwise across all jobs.
   */
  previewPush(jobId?: number): PushPreviewResult {
    const pending = this.applicationsRepo.findPendingStatusPushes(jobId);
    return { count: pending.length, pending };
  }

  /**
   * Push pending status changes to BambooHR, one at a time (BambooHR rate-limits
   * under load). When `reviewed` is given, only a pending row that still matches a
   * reviewed change (same application AND same target status) is sent; the rest are
   * counted in `changedSinceReview`.
   *
   * A per-item failure is recorded and the run continues. A rate-limit (429)
   * halts the run: already-pushed changes are reconciled and returned as partial
   * progress, and the halt is logged to sync history. Each success advances that
   * row's bamboo_status_id so it no longer shows as pending.
   */
  async pushStatuses(jobId?: number, reviewed?: ReviewedChange[]): Promise<PushResult> {
    const pending = this.applicationsRepo.findPendingStatusPushes(jobId);
    const toPush = reviewed
      ? pending.filter((item) =>
          reviewed.some((change) => change.id === item.id && change.toStatusId === item.toStatusId)
        )
      : pending;
    const changedSinceReview = reviewed
      ? reviewed.filter(
          (change) =>
            !toPush.some((item) => item.id === change.id && item.toStatusId === change.toStatusId)
        ).length
      : 0;

    const results: PushItemResult[] = [];
    let pushed = 0;
    let failed = 0;
    let rateLimited = false;

    for (const item of toPush) {
      try {
        await this.statusWriter.updateApplicationStatus(item.id, item.toStatusId);
        this.applicationsRepo.markStatusPushed(item.id, item.toStatusId);
        pushed += 1;
        results.push({
          id: item.id,
          ok: true,
          toStatusId: item.toStatusId,
          toLabel: item.toLabel,
        });
      } catch (error) {
        if (isBambooRateLimitError(error)) {
          rateLimited = true;
          this.contentUpdatesRepo.create({
            syncType: 'rate_limited',
            applicationsSynced: pushed,
            notes:
              'Push to BambooHR halted: API rate limit reached. Already-pushed changes are saved; retry the rest later.',
          });
          break;
        }
        failed += 1;
        results.push({
          id: item.id,
          ok: false,
          toStatusId: item.toStatusId,
          toLabel: item.toLabel,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { total: toPush.length, pushed, failed, rateLimited, changedSinceReview, results };
  }

  /**
   * Roll back pending local status changes instead of sending them: each
   * application returns to the stage BambooHR last reported (bamboo_status_id),
   * so it stops showing as pending. Local only; never calls BambooHR. Optionally
   * restrict to a subset of application `ids`. A pending change whose BambooHR
   * stage is unknown cannot be rolled back and is counted as skipped.
   */
  discardPending(jobId?: number, ids?: number[]): DiscardResult {
    const pending = this.applicationsRepo.findPendingStatusPushes(jobId);
    const selected =
      ids && ids.length > 0 ? pending.filter((item) => ids.includes(item.id)) : pending;

    const restorable = selected.filter(
      (item): item is PendingStatusPush & { fromStatusId: number } => item.fromStatusId !== null
    );
    const discarded = this.applicationsRepo.restoreStatuses(
      restorable.map((item) => ({ id: item.id, statusId: item.fromStatusId }))
    );
    return { discarded, skipped: selected.length - restorable.length };
  }
}
