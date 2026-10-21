/**
 * Errors from services we depend on (BambooHR, Claude Code), already translated
 * into something safe to show a person.
 *
 * `message` is always written for the user: it never carries a response body,
 * an HTML error page or a CLI stack. The raw detail is logged where the failure
 * is caught and kept on `cause`, so nothing is lost for debugging.
 */

export type UpstreamService = 'bamboohr' | 'claude';

export type UpstreamFailureKind =
  | 'unavailable' // the service is down or erroring (HTTP 5xx)
  | 'rate_limited' // HTTP 429 or a usage limit
  | 'unauthorized' // our credentials were refused
  | 'forbidden' // credentials are valid but lack permission
  | 'not_found' // the record does not exist upstream
  | 'timeout' // no answer in time
  | 'network' // could not connect at all
  | 'rejected' // the service refused the request itself (other 4xx)
  | 'unknown';

/** The status our own API answers with for each kind of upstream failure. */
const RESPONSE_STATUS_BY_KIND: Record<UpstreamFailureKind, number> = {
  unavailable: 503,
  rate_limited: 429,
  unauthorized: 502,
  forbidden: 502,
  not_found: 404,
  timeout: 504,
  network: 502,
  rejected: 502,
  unknown: 502,
};

/** Failures that tend to clear up by themselves, so "try again" is sensible advice. */
const RETRYABLE_KINDS: ReadonlySet<UpstreamFailureKind> = new Set([
  'unavailable',
  'rate_limited',
  'timeout',
  'network',
]);

export class UpstreamServiceError extends Error {
  readonly service: UpstreamService;
  readonly kind: UpstreamFailureKind;
  /** The status the upstream service returned, when there was one. */
  readonly upstreamStatus: number | undefined;

  constructor(options: {
    service: UpstreamService;
    kind: UpstreamFailureKind;
    userMessage: string;
    upstreamStatus?: number;
    cause?: unknown;
  }) {
    super(options.userMessage, { cause: options.cause });
    this.name = 'UpstreamServiceError';
    this.service = options.service;
    this.kind = options.kind;
    this.upstreamStatus = options.upstreamStatus;
  }

  /** The HTTP status this app should answer its own client with. */
  get responseStatus(): number {
    return RESPONSE_STATUS_BY_KIND[this.kind];
  }

  get isRetryable(): boolean {
    return RETRYABLE_KINDS.has(this.kind);
  }
}

export function isRateLimitedUpstreamError(error: unknown): boolean {
  return error instanceof UpstreamServiceError && error.kind === 'rate_limited';
}
