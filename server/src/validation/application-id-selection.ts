/**
 * Parsing for request bodies that name a set of applications.
 */

export const MAX_SELECTED_APPLICATIONS = 5000;

export type ApplicationIdSelection =
  | { ok: true; jobId: number | undefined; ids: number[] }
  | { ok: false; message: string };

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * `{ jobId?, ids }` where `ids` is a non-empty list of whole numbers. Used by the
 * push to BambooHR: the person has reviewed a specific list, and exactly that list
 * is what may be sent, never "everything pending".
 */
export function parseRequiredApplicationIds(body: unknown): ApplicationIdSelection {
  const { jobId, ids } = (body ?? {}) as { jobId?: unknown; ids?: unknown };

  if (jobId !== undefined && !isWholeNumber(jobId)) {
    return { ok: false, message: 'jobId must be a whole number' };
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, message: 'ids must list the applications you reviewed' };
  }
  if (ids.length > MAX_SELECTED_APPLICATIONS) {
    return { ok: false, message: `ids can list at most ${MAX_SELECTED_APPLICATIONS} applications` };
  }
  if (!ids.every(isWholeNumber)) {
    return { ok: false, message: 'ids must be an array of whole numbers' };
  }

  return { ok: true, jobId, ids };
}
