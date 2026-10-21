/**
 * Turns a failed BambooHR call into an UpstreamServiceError.
 *
 * The mapping is pure (status and network code in, kind and wording out) so it
 * can be tested without a network. BambooHR sits behind a gateway that answers
 * outages with an HTML page, which must never reach the screen.
 */

import { UpstreamServiceError, type UpstreamFailureKind } from './upstream-error.js';

const USER_MESSAGE_BY_KIND: Record<UpstreamFailureKind, string> = {
  unavailable:
    'BambooHR is having trouble right now and may be down for maintenance. Your saved applicants are still available. Try again in a few minutes.',
  rate_limited: 'BambooHR is limiting requests right now. Wait a minute and try again.',
  unauthorized: 'BambooHR rejected the saved API key. Open Setup and check the key.',
  forbidden:
    'The BambooHR API key does not have permission to do this. Ask a BambooHR admin to give its user Hiring (applicant tracking) access.',
  not_found: 'BambooHR could not find that record. It may have been removed.',
  timeout: 'BambooHR took too long to respond. Try again in a moment.',
  network: 'Could not reach BambooHR. Check that this computer is online and try again.',
  rejected:
    'BambooHR did not accept the request. Try again, and check the server log if it keeps happening.',
  unknown:
    'Something went wrong talking to BambooHR. Try again, and check the server log if it keeps happening.',
};

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED']);

export function classifyBambooHRFailure(
  upstreamStatus: number | undefined,
  networkCode: string | undefined
): UpstreamFailureKind {
  if (upstreamStatus === undefined) {
    if (networkCode !== undefined && TIMEOUT_CODES.has(networkCode)) return 'timeout';
    return networkCode === undefined ? 'unknown' : 'network';
  }
  if (upstreamStatus === 401) return 'unauthorized';
  if (upstreamStatus === 403) return 'forbidden';
  if (upstreamStatus === 404) return 'not_found';
  if (upstreamStatus === 429) return 'rate_limited';
  if (upstreamStatus === 408 || upstreamStatus === 504) return 'timeout';
  if (upstreamStatus >= 500) return 'unavailable';
  if (upstreamStatus >= 400) return 'rejected';
  return 'unknown';
}

export function buildBambooHRError(
  kind: UpstreamFailureKind,
  upstreamStatus: number | undefined,
  cause: unknown
): UpstreamServiceError {
  return new UpstreamServiceError({
    service: 'bamboohr',
    kind,
    userMessage: USER_MESSAGE_BY_KIND[kind],
    upstreamStatus,
    cause,
  });
}
