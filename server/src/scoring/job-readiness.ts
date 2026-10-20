/**
 * Whether a job is set up well enough to be scored.
 *
 * Scoring spends tokens and writes scores that are hard to take back, so it is
 * blocked until a person has made sure the job posting text exists (it is what
 * every résumé is compared against) and has confirmed the scoring criteria
 * (the defaults only count once someone has looked at them).
 */

export interface JobReadiness {
  hasPosting: boolean;
  isCriteriaConfirmed: boolean;
  isReadyToScore: boolean;
}

export function getJobReadiness(job: {
  description?: string | null;
  criteriaConfirmedAt?: string | null;
}): JobReadiness {
  const hasPosting = (job.description ?? '').trim().length > 0;
  const isCriteriaConfirmed = !!job.criteriaConfirmedAt;
  return { hasPosting, isCriteriaConfirmed, isReadyToScore: hasPosting && isCriteriaConfirmed };
}

/** Plain-language explanation of what is still missing, or null when ready. */
export function describeMissingSetup(readiness: JobReadiness): string | null {
  if (readiness.isReadyToScore) return null;
  const missing: string[] = [];
  if (!readiness.hasPosting) missing.push('load or paste the job posting');
  if (!readiness.isCriteriaConfirmed) missing.push('confirm the scoring criteria');
  return `Set up this job before scoring: ${missing.join(' and ')}. Open Job settings to finish.`;
}
