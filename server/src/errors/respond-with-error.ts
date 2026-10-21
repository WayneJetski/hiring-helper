import type { Response } from 'express';
import { UpstreamServiceError } from './upstream-error.js';

/**
 * Answer a failed request. A BambooHR or Claude failure is already worded for
 * the user and carries the right status; anything else keeps the caller's
 * label and the legacy 500 shape.
 */
export function respondWithError(res: Response, error: unknown, fallbackLabel: string): void {
  if (error instanceof UpstreamServiceError) {
    res.status(error.responseStatus).json({
      error: error.service === 'bamboohr' ? 'BambooHR problem' : 'Claude problem',
      message: error.message,
      kind: error.kind,
      isRetryable: error.isRetryable,
    });
    return;
  }
  res.status(500).json({
    error: fallbackLabel,
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}
