/**
 * Progress math for a running scoring job.
 */

export interface ScoringProgress {
  /** 0 to 100, or null when the total is unknown. */
  percent: number | null;
  /** Estimated seconds left, or null until enough has been scored to estimate. */
  secondsRemaining: number | null;
}

/**
 * Estimate remaining time from the pace so far. Needs at least one scored
 * candidate and some elapsed time, otherwise there is nothing to extrapolate.
 */
export function computeScoringProgress(
  scored: number,
  total: number | null,
  startedAt: string | null,
  now: Date = new Date()
): ScoringProgress {
  if (total === null || total <= 0) return { percent: null, secondsRemaining: null };

  const percent = Math.min(100, Math.round((scored / total) * 100));
  if (!startedAt || scored <= 0) return { percent, secondsRemaining: null };

  const elapsedSeconds = (now.getTime() - new Date(startedAt).getTime()) / 1000;
  if (elapsedSeconds <= 0) return { percent, secondsRemaining: null };

  const secondsPerCandidate = elapsedSeconds / scored;
  const remaining = Math.max(0, total - scored);
  return { percent, secondsRemaining: Math.round(remaining * secondsPerCandidate) };
}
