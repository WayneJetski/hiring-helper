/**
 * Turns Claude Code's failure text (CLI output or the reply's error result)
 * into an UpstreamServiceError with wording that is safe to show.
 *
 * The CLI relays API problems as free text (for example an overloaded-service
 * JSON blob), so this recognises the common ones by pattern. Text it does not
 * recognise becomes a generic message rather than being shown as written.
 */

import { NOT_SIGNED_IN_MESSAGE, isNotSignedInText } from '../services/claude-auth.service.js';
import { UpstreamServiceError, type UpstreamFailureKind } from './upstream-error.js';

const GENERIC_MESSAGE =
  'Claude Code reported a problem. Try again, and check the server log if it keeps happening.';

const USER_MESSAGE_BY_KIND: Partial<Record<UpstreamFailureKind, string>> = {
  unavailable:
    'Claude is overloaded or temporarily unavailable. Nothing was lost; try again in a few minutes.',
  rate_limited:
    'Your Claude usage limit has been reached. Wait for it to reset, or sign in with another account, then try again.',
  unauthorized: NOT_SIGNED_IN_MESSAGE,
  forbidden:
    'The Claude account Claude Code is signed in to cannot be used right now (for example, no credit left). Check its billing, then try again.',
  network: 'Claude Code could not reach Anthropic. Check that this computer is online and try again.',
  timeout: 'Claude took too long to respond. Try again in a moment.',
};

const PATTERNS: Array<[RegExp, UpstreamFailureKind]> = [
  [/credit balance|billing|payment required|\b402\b/i, 'forbidden'],
  [/overloaded|\b529\b|\b50[0234]\b|service unavailable|internal server error/i, 'unavailable'],
  [/rate.?limit|usage limit|limit reached|quota|\b429\b|too many requests/i, 'rate_limited'],
  [/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|fetch failed|network|offline/i, 'network'],
  [/timed? ?out|ETIMEDOUT/i, 'timeout'],
];

export function classifyClaudeFailureText(text: string): UpstreamFailureKind {
  if (isNotSignedInText(text)) return 'unauthorized';
  for (const [pattern, kind] of PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return 'unknown';
}

/**
 * The user-facing sentence for a Claude Code failure, logging the raw text so
 * it is still available for debugging.
 */
export function describeClaudeFailure(rawText: string, context: string): string {
  console.error(`Claude Code failure (${context}):`, rawText.slice(0, 2000));
  return buildClaudeError(rawText).message;
}

/** Wrap Claude Code's raw failure text. The text is kept on `cause` for the log, never in the message. */
export function buildClaudeError(rawText: string): UpstreamServiceError {
  const kind = classifyClaudeFailureText(rawText);
  return new UpstreamServiceError({
    service: 'claude',
    kind,
    userMessage: USER_MESSAGE_BY_KIND[kind] ?? GENERIC_MESSAGE,
    cause: new Error(rawText.slice(0, 2000)),
  });
}
