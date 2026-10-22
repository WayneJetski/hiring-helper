/**
 * Which BambooHR jobs count as closed. Pure, so the rules are tested without a database.
 *
 * A job is closed when BambooHR says so (a status such as Filled or Canceled), or when a
 * sync no longer lists it. Unknown or missing statuses count as open, so a label we
 * have not seen before never hides a job.
 */

/** The label stored for a job that disappeared from BambooHR's job list. */
export const CLOSED_STATUS_LABEL = 'Closed';

const CLOSED_STATUS_LABELS = new Set(['closed', 'filled', 'canceled', 'cancelled', 'archived']);

export function isClosedJobStatus(status: string | null | undefined): boolean {
  return status != null && CLOSED_STATUS_LABELS.has(status.trim().toLowerCase());
}

/** Shown (and returned as a 409) when someone tries to score applicants of a closed job. */
export const CLOSED_JOB_SCORING_MESSAGE =
  'This job is closed, so its applicants can no longer be scored.';

/** Returned (as a 409) when someone tries to move or reject applicants of a closed job. */
export const CLOSED_JOB_CHANGES_MESSAGE =
  'This job is closed, so its applicants can no longer be moved or rejected.';

/**
 * Stored jobs that BambooHR no longer lists and are not already closed. An empty
 * listing is never trusted (it more likely means a failed or partial response than
 * every job closing at once), so nothing is closed then.
 */
export function findJobsToClose(
  storedJobs: Array<{ id: number; status?: string | null }>,
  listedJobIds: ReadonlySet<number>
): number[] {
  if (listedJobIds.size === 0) return [];
  return storedJobs
    .filter((job) => !listedJobIds.has(job.id) && !isClosedJobStatus(job.status))
    .map((job) => job.id);
}
