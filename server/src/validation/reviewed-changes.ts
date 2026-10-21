/**
 * Parsing for the request body of a push to BambooHR.
 */

export const MAX_REVIEWED_CHANGES = 5000;

/** One change the person saw in the preview: this application, moved to this status. */
export interface ReviewedChange {
  id: number;
  toStatusId: number;
}

export type ReviewedChangesSelection =
  | { ok: true; jobId: number | undefined; changes: ReviewedChange[] }
  | { ok: false; message: string };

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * `{ jobId?, changes: [{ id, toStatusId }] }`: exactly what the person reviewed. The
 * push sends a row only if it still matches (same application, same target status),
 * so a change made after the preview is never sent under the old confirmation.
 */
export function parseReviewedChanges(body: unknown): ReviewedChangesSelection {
  const { jobId, changes } = (body ?? {}) as { jobId?: unknown; changes?: unknown };

  if (jobId !== undefined && !isWholeNumber(jobId)) {
    return { ok: false, message: 'jobId must be a whole number' };
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: false, message: 'changes must list the status changes you reviewed' };
  }
  if (changes.length > MAX_REVIEWED_CHANGES) {
    return { ok: false, message: `changes can list at most ${MAX_REVIEWED_CHANGES} items` };
  }

  const reviewed: ReviewedChange[] = [];
  for (const change of changes) {
    const { id, toStatusId } = (change ?? {}) as { id?: unknown; toStatusId?: unknown };
    if (!isWholeNumber(id) || !isWholeNumber(toStatusId)) {
      return { ok: false, message: 'each change needs a whole-number id and toStatusId' };
    }
    reviewed.push({ id, toStatusId });
  }

  return { ok: true, jobId, changes: reviewed };
}
