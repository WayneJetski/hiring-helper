/**
 * Persistence for the applicants list filter selection.
 *
 * Keeps each job's selected status IDs across page reloads via
 * localStorage. All reads are defensive: a missing, malformed, or
 * non-browser (SSR/test) environment simply yields the empty/null default so
 * callers never have to guard themselves.
 *
 * Stale-ID handling is intentionally left to the caller, which knows the set
 * of currently-valid IDs (see reconcile helpers below).
 */

import { getLocalStorage } from './safeStorage';

const SELECTED_STATUS_IDS_KEY = 'hiringHelper.selectedStatusIds';

export const FILTER_STORAGE_KEYS = {
  selectedStatusIds: SELECTED_STATUS_IDS_KEY,
} as const;

const getStorage = getLocalStorage;

/** Storage key for a job's status selection ("all" when no single job is selected). */
function statusKeyForJob(jobId: number | null): string {
  return `${SELECTED_STATUS_IDS_KEY}.${jobId ?? 'all'}`;
}

function parseStatusIds(raw: string | null): number[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is number => typeof value === 'number');
  } catch {
    return [];
  }
}

/**
 * Read the status selection remembered for a job. Each job keeps its own, so
 * switching postings does not carry over a filter that made sense for another
 * one. Falls back to the older single global selection the first time a job is
 * opened. Non-numeric entries are dropped rather than failing the whole read.
 */
export function loadSelectedStatusIds(jobId: number | null): number[] {
  const storage = getStorage();
  if (!storage) return [];
  return (
    parseStatusIds(storage.getItem(statusKeyForJob(jobId))) ??
    parseStatusIds(storage.getItem(SELECTED_STATUS_IDS_KEY)) ??
    []
  );
}

export function saveSelectedStatusIds(jobId: number | null, statusIds: number[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(statusKeyForJob(jobId), JSON.stringify(statusIds));
  } catch {
    // Quota or privacy errors are non-fatal for a filter preference.
  }
}
