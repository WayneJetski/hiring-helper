/**
 * Links into BambooHR's own web app, for sharing a candidate internally or
 * opening them. Anyone opening them needs their own BambooHR access.
 */

/** Same shape the server accepts for a BambooHR company address. */
const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

/**
 * The BambooHR page for a candidate:
 * `https://<company>.bamboohr.com/hiring/candidates/<candidateId>`. The id is
 * BambooHR's id for the person (the API's `applicant.id`), not the application
 * id. Returns null when the company address or id is not usable, so a malformed
 * link is never copied or opened.
 */
export function buildCandidateLink(
  subdomain: string | null | undefined,
  candidateId: number | null | undefined
): string | null {
  const company = subdomain?.trim() ?? '';
  if (
    !SUBDOMAIN_PATTERN.test(company) ||
    typeof candidateId !== 'number' ||
    !Number.isInteger(candidateId) ||
    candidateId <= 0
  ) {
    return null;
  }
  return `https://${company}.bamboohr.com/hiring/candidates/${candidateId}`;
}
