/**
 * Persistence for the applicants list filter selection.
 *
 * Keeps the selected status IDs and the selected job across page reloads via
 * localStorage. All reads are defensive: a missing, malformed, or
 * non-browser (SSR/test) environment simply yields the empty/null default so
 * callers never have to guard themselves.
 *
 * Stale-ID handling is intentionally left to the caller, which knows the set
 * of currently-valid IDs (see reconcile helpers below).
 */

import { getLocalStorage } from './safeStorage';

const SELECTED_STATUS_IDS_KEY = 'hiringHelper.selectedStatusIds';
const SELECTED_JOB_ID_KEY = 'hiringHelper.selectedJobId';

export const FILTER_STORAGE_KEYS = {
  selectedStatusIds: SELECTED_STATUS_IDS_KEY,
  selectedJobId: SELECTED_JOB_ID_KEY,
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

/**
 * Read the persisted job ID, or null if nothing valid is stored.
 */
export function loadSelectedJobId(): number | null {
  const storage = getStorage();
  if (!storage) return null;

  const raw = storage.getItem(SELECTED_JOB_ID_KEY);
  if (raw === null) return null;

  // Explicit "all jobs" selection is persisted as an empty string.
  if (raw === '') return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function saveSelectedJobId(jobId: number | null): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(SELECTED_JOB_ID_KEY, jobId === null ? '' : String(jobId));
  } catch {
    // Non-fatal, see saveSelectedStatusIds.
  }
}

/**
 * Distinguishes "user has never made a choice" (no key present) from "user
 * explicitly chose all jobs" (empty string persisted). Used so the default
 * "current job" behavior only kicks in on a truly fresh session.
 */
export function hasPersistedJobSelection(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  return storage.getItem(SELECTED_JOB_ID_KEY) !== null;
}
