import { isRateLimitedUpstreamError } from '../errors/upstream-error.js';

/**
 * Shared detection for BambooHR rate-limit (HTTP 429) errors, used by both the
 * sync and the push paths. The BambooHR client wraps every failure in an
 * UpstreamServiceError (see `raiseBambooHRError`), so this reads its `kind`.
 */
export function isBambooRateLimitError(error: unknown): boolean {
  return isRateLimitedUpstreamError(error);
}
