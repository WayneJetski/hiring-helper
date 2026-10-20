/**
 * Flag penalties: how much a job's red flags lower an applicant's score.
 *
 * The model scores on merit and reports which flags apply; this applies the
 * job's configured penalties afterwards, so the arithmetic is exact and a
 * penalty never depends on the model remembering a rule. Pure, so it is tested
 * without a database.
 */

import type { ApplicationFlag } from '../types/flags.js';
import type { FlagPenalty, ScoringConfig } from './scoring-config.js';

/** Points taken off the score for each level (dealbreaker is a cap instead, below). */
export const PENALTY_POINTS: Record<Exclude<FlagPenalty, 'dealbreaker'>, number> = {
  none: 0,
  bit: 5,
  lot: 15,
};

/** A dealbreaker pulls the score down to at most this, well under the 60 "do not advance" line. */
export const DEALBREAKER_SCORE_CAP = 20;

/** Which config entry each flag belongs to. */
const CONFIG_KEY_BY_FLAG: Partial<Record<ApplicationFlag, keyof ScoringConfig['redFlags']>> = {
  name: 'nameCapitalization',
  location: 'location',
  studying: 'studying',
  no_exp: 'noExperience',
  tenure: 'tenureGaps',
  'salary-low': 'salaryLow',
  'salary-high': 'salaryHigh',
};

export interface AppliedPenalty {
  flag: ApplicationFlag;
  penalty: Exclude<FlagPenalty, 'none'>;
}

export interface PenaltyResult {
  /** The score after penalties, 0 to 100. */
  score: number;
  /** The penalties that took effect; empty when the score is unchanged. */
  appliedPenalties: AppliedPenalty[];
}

export function applyFlagPenalties(
  meritScore: number,
  flags: ApplicationFlag[],
  config: ScoringConfig
): PenaltyResult {
  const appliedPenalties: AppliedPenalty[] = [];

  for (const flag of new Set(flags)) {
    const key = CONFIG_KEY_BY_FLAG[flag];
    if (!key) continue;
    const setting = config.redFlags[key];
    if (!setting.enabled || setting.penalty === 'none') continue;
    appliedPenalties.push({ flag, penalty: setting.penalty });
  }

  const pointsOff = appliedPenalties.reduce(
    (sum, applied) => (applied.penalty === 'dealbreaker' ? sum : sum + PENALTY_POINTS[applied.penalty]),
    0
  );
  const hasDealbreaker = appliedPenalties.some((applied) => applied.penalty === 'dealbreaker');

  let score = Math.max(0, meritScore - pointsOff);
  if (hasDealbreaker) score = Math.min(score, DEALBREAKER_SCORE_CAP);

  // A penalty that changes nothing (already below the cap, or zero) is not worth reporting.
  return { score, appliedPenalties: score === meritScore ? [] : appliedPenalties };
}
