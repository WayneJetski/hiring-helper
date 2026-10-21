/**
 * ORDER BY for the applicant list. `sortBy` and `sortDirection` come straight from
 * the query string, so only known columns and the two keywords ever reach the SQL.
 */

const SORT_COLUMNS: Record<string, string> = {
  applied_date: 'a.applied_date',
  appliedDate: 'a.applied_date',
  stage: 'st.status',
  rating: 'a.rating',
  name: 'ap.last_name, ap.first_name',
  email: 'ap.email',
  confidence: 'COALESCE(sc.score, -1)', // sort by score, with unscored last
};

const DEFAULT_COLUMN = 'a.applied_date';

export function buildOrderByClause(sortBy: string, sortDirection: string): string {
  const column = Object.hasOwn(SORT_COLUMNS, sortBy) ? SORT_COLUMNS[sortBy] : DEFAULT_COLUMN;
  const keyword = String(sortDirection).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${column} ${keyword}`;
}
