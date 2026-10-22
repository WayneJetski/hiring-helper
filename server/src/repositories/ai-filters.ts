/**
 * List filters that depend on scoring: whether an application has a score, and
 * whether it carries any red flags. Pure, so the SQL can be tested without a database.
 */

export type ScoreFilter = 'all' | 'scored' | 'unscored';
export type FlagFilter = 'all' | 'flagged' | 'unflagged';

export interface AiFilters {
  scoreFilter?: ScoreFilter;
  flagFilter?: FlagFilter;
}

const HAS_SCORE = 'EXISTS (SELECT 1 FROM application_scores s WHERE s.application_id = a.id)';
const HAS_FLAG = 'EXISTS (SELECT 1 FROM application_flags f WHERE f.application_id = a.id)';

/** WHERE fragments (no parameters) for the application table aliased as `a`. */
export function buildAiFilterClauses({ scoreFilter, flagFilter }: AiFilters): string[] {
  const clauses: string[] = [];
  if (scoreFilter === 'scored') clauses.push(HAS_SCORE);
  if (scoreFilter === 'unscored') clauses.push(`NOT ${HAS_SCORE}`);
  if (flagFilter === 'flagged') clauses.push(HAS_FLAG);
  if (flagFilter === 'unflagged') clauses.push(`NOT ${HAS_FLAG}`);
  return clauses;
}

export function parseScoreFilter(value: unknown): ScoreFilter | undefined {
  return value === 'scored' || value === 'unscored' ? value : undefined;
}

export function parseFlagFilter(value: unknown): FlagFilter | undefined {
  return value === 'flagged' || value === 'unflagged' ? value : undefined;
}
