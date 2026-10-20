/**
 * Shared detection for BambooHR rate-limit (HTTP 429) errors.
 *
 * The BambooHR client surfaces failures as Error instances whose message
 * includes the upstream status/details (see `BambooHRService.handleError`), so
 * both the sync and the push paths recognise a rate limit by inspecting the
 * message rather than depending on the axios error shape.
 */
export function isBambooRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message).toLowerCase();
    return (
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('too many requests')
    );
  }
  return false;
}
