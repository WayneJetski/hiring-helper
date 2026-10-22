/**
 * Saved list views: a named combination of status filter, search and sort that
 * can be reapplied in one click. Built-in views come from the status groups;
 * custom ones are stored in this browser.
 */

import { getLocalStorage } from './safeStorage';
import { groupStatuses } from './statusGroups';

export type ViewSortColumn = 'name' | 'email' | 'stage' | 'confidence' | 'appliedDate';

export type ScoreFilter = 'all' | 'scored' | 'unscored';
export type FlagFilter = 'all' | 'flagged' | 'unflagged';

export interface ListView {
  id: string;
  name: string;
  statusIds: number[];
  search: string;
  scoreFilter: ScoreFilter;
  flagFilter: FlagFilter;
  sortColumn: ViewSortColumn;
  sortDirection: 'asc' | 'desc';
  isBuiltIn: boolean;
}

const SAVED_VIEWS_KEY = 'hiringHelper.savedViews';

const BUILT_IN_VIEW_DEFINITIONS: Array<{ groupName: string; id: string; name: string }> = [
  { groupName: 'To Review', id: 'builtin:to-review', name: 'To review, best matches first' },
  { groupName: 'Chosen', id: 'builtin:in-progress', name: 'In interviews and offers' },
  { groupName: 'Rejected', id: 'builtin:rejected', name: 'Rejected' },
];

/** Ready-made views built from the status groups that exist for this account. */
export function buildBuiltInViews(statuses: Array<{ id: number; label: string }>): ListView[] {
  const groups = groupStatuses(statuses);
  return BUILT_IN_VIEW_DEFINITIONS.flatMap((definition) => {
    const group = groups.find((candidate) => candidate.name === definition.groupName);
    if (!group) return [];
    return [
      {
        id: definition.id,
        name: definition.name,
        statusIds: group.statuses.map((status) => status.id),
        search: '',
        scoreFilter: 'all' as const,
        flagFilter: 'all' as const,
        sortColumn: 'confidence' as const,
        sortDirection: 'desc' as const,
        isBuiltIn: true,
      },
    ];
  });
}

/** Views saved before these filters existed have neither field; they mean "all". */
function normalizeSavedView(view: ListView): ListView {
  const { scoreFilter, flagFilter } = view as Partial<ListView>;
  return {
    ...view,
    scoreFilter: scoreFilter === 'scored' || scoreFilter === 'unscored' ? scoreFilter : 'all',
    flagFilter: flagFilter === 'flagged' || flagFilter === 'unflagged' ? flagFilter : 'all',
    isBuiltIn: false,
  };
}

function isSavedView(value: unknown): value is ListView {
  if (!value || typeof value !== 'object') return false;
  const view = value as Record<string, unknown>;
  return (
    typeof view.id === 'string' &&
    typeof view.name === 'string' &&
    Array.isArray(view.statusIds) &&
    view.statusIds.every((id) => typeof id === 'number') &&
    typeof view.search === 'string' &&
    typeof view.sortColumn === 'string' &&
    (view.sortDirection === 'asc' || view.sortDirection === 'desc')
  );
}

export function loadSavedViews(): ListView[] {
  const storage = getLocalStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(SAVED_VIEWS_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(isSavedView).map(normalizeSavedView)
      : [];
  } catch {
    return [];
  }
}

function persist(views: ListView[]): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Non-fatal: the view just will not survive a reload.
  }
}

/** Add a view (or replace one with the same name, case-insensitively). Returns the new list. */
export function saveView(view: Omit<ListView, 'id' | 'isBuiltIn'>): ListView[] {
  const name = view.name.trim();
  const others = loadSavedViews().filter(
    (existing) => existing.name.toLowerCase() !== name.toLowerCase()
  );
  const created: ListView = {
    ...view,
    name,
    id: `custom:${Date.now()}`,
    isBuiltIn: false,
  };
  const updated = [...others, created];
  persist(updated);
  return updated;
}

export function deleteView(id: string): ListView[] {
  const updated = loadSavedViews().filter((view) => view.id !== id);
  persist(updated);
  return updated;
}
