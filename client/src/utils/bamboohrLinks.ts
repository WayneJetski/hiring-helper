/**
 * Links into BambooHR's own web app, for sharing a candidate internally or
 * opening them. Anyone opening them needs their own BambooHR access.
 */

/** Same shape the server accepts for a BambooHR company address. */
const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

/**
 * The BambooHR page for a candidate:
 * `https://<company>.bamboohr.com/hiring/candidates/<id>`. Despite the "candidates"
 * path, BambooHR expects the APPLICATION id here (our `applications.id`), not the
 * person's `applicant.id`: the person id opened a different applicant. Returns null when the company address or id is not usable, so a malformed
 * link is never copied or opened.
 */
export function buildCandidateLink(
  subdomain: string | null | undefined,
  applicationId: number | null | undefined
): string | null {
  const company = subdomain?.trim() ?? '';
  if (
    !SUBDOMAIN_PATTERN.test(company) ||
    typeof applicationId !== 'number' ||
    !Number.isInteger(applicationId) ||
    applicationId <= 0
  ) {
    return null;
  }
  return `https://${company}.bamboohr.com/hiring/candidates/${applicationId}`;
}
