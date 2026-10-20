/**
 * Application flags: structured reasons attached to an application, shown beside
 * the match score and usable as bulk-action filters.
 *
 * Three kinds:
 *  - SKIP flags come from cheap metadata (no resume read) and imply a 0% match
 *    (evaluation skipped): `location`, `name`.
 *  - CONTENT flags are added by scoring during a real evaluation (the match score
 *    is kept): `studying`, `no_exp`, `tenure` (short tenures or unexplained gaps).
 *  - INFO flags come from application answers and are purely informational for
 *    triage (the match score is kept): `salary-low`, `salary-high`.
 */

export type ApplicationFlag =
  | 'location'
  | 'name'
  | 'studying'
  | 'no_exp'
  | 'tenure'
  | 'salary-low'
  | 'salary-high';

export const APPLICATION_FLAGS: ApplicationFlag[] = [
  'location',
  'name',
  'studying',
  'no_exp',
  'tenure',
  'salary-low',
  'salary-high',
];

/** Flags derived from metadata that imply a 0% skip. */
export const SKIP_FLAGS: ApplicationFlag[] = ['location', 'name'];

/** Flags derived from resume content; the candidate is still scored normally. */
export const CONTENT_FLAGS: ApplicationFlag[] = ['studying', 'no_exp', 'tenure'];

/** Informational flags from application answers; the score is kept. */
export const INFO_FLAGS: ApplicationFlag[] = ['salary-low', 'salary-high'];

/** Human-facing labels. */
export const FLAG_LABELS: Record<ApplicationFlag, string> = {
  location: 'Location',
  name: 'Name',
  studying: 'Studying',
  no_exp: 'No Exp',
  tenure: 'Tenure / Gaps',
  'salary-low': 'Salary Low',
  'salary-high': 'Salary High',
};

export function isApplicationFlag(value: string): value is ApplicationFlag {
  return (APPLICATION_FLAGS as string[]).includes(value);
}

/**
 * Merge the flags a scoring run produced with a candidate's existing flags.
 *
 * Scoring owns the resume/LLM-judged flags (name, location, studying, no_exp, tenure)
 * and replaces them each run. It must NOT touch INFO flags (salary-low/high),
 * which are derived from application answers by a separate flow — those are
 * preserved. Fixes evaluations silently wiping script-set flags.
 */
export function mergeScoringFlags(
  existing: ApplicationFlag[],
  incoming: ApplicationFlag[]
): ApplicationFlag[] {
  const preserved = existing.filter((flag) => (INFO_FLAGS as string[]).includes(flag));
  const scored = incoming.filter((flag) => !(INFO_FLAGS as string[]).includes(flag));
  return [...new Set([...preserved, ...scored])];
}
