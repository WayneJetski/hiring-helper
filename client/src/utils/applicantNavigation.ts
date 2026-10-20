/**
 * Remembers the order of the applicants last shown in the list so the detail
 * page and résumé viewer can step to the previous or next person.
 */

import { getSessionStorage } from './safeStorage';

const NAVIGATION_IDS_KEY = 'hiringHelper.navigationIds';

export interface Neighbors {
  previousId: number | null;
  nextId: number | null;
  /** 1-based position of the current applicant, and how many are in the list. */
  position: number;
  total: number;
}

export function saveNavigationIds(ids: number[]): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(NAVIGATION_IDS_KEY, JSON.stringify(ids));
  } catch {
    // Non-fatal: the arrows just will not appear.
  }
}

export function loadNavigationIds(): number[] {
  const storage = getSessionStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(NAVIGATION_IDS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : [];
  } catch {
    return [];
  }
}

/** Previous/next neighbors of `currentId`, or null when it is not in the list. */
export function getNeighbors(ids: number[], currentId: number): Neighbors | null {
  const index = ids.indexOf(currentId);
  if (index === -1) return null;
  return {
    previousId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
    position: index + 1,
    total: ids.length,
  };
}
