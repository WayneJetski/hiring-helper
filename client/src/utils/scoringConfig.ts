/**
 * Rules for the scoring criteria editor. These mirror the server's validation
 * (server/src/scoring/scoring-config.ts) so problems show as the user types; the
 * server remains the authority and rejects anything invalid on save.
 */

import type { FlagPenalty, ScoringConfig, ScoringDimension } from '../types/applicant.types';

export const TOTAL_POINTS = 100;
export const MAX_DIMENSIONS = 10;

/**
 * The penalty slider's steps, in order. The numbers mirror the server
 * (server/src/scoring/flag-penalties.ts), which applies them when a score is saved.
 */
export const FLAG_PENALTY_LEVELS: Array<{ value: FlagPenalty; label: string; effect: string }> = [
  { value: 'none', label: 'None', effect: 'The flag is only a tag. It does not change the score.' },
  { value: 'bit', label: 'A bit', effect: 'Takes 5 points off the score.' },
  { value: 'lot', label: 'A lot', effect: 'Takes 15 points off the score.' },
  {
    value: 'dealbreaker',
    label: 'Dealbreaker',
    effect: 'Caps the score at 20, so the applicant is not advanced.',
  },
];

export function totalPoints(dimensions: ScoringDimension[]): number {
  return dimensions.reduce((sum, dimension) => sum + (Number.isFinite(dimension.maxPoints) ? dimension.maxPoints : 0), 0);
}

/** Plain-language summary of how the points currently add up. */
export function describePointsTotal(total: number): { isValid: boolean; text: string } {
  if (total === TOTAL_POINTS) return { isValid: true, text: `Total ${total} of ${TOTAL_POINTS} points` };
  if (total < TOTAL_POINTS) {
    return { isValid: false, text: `Total ${total} of ${TOTAL_POINTS}: add ${TOTAL_POINTS - total} more` };
  }
  return { isValid: false, text: `Total ${total} of ${TOTAL_POINTS}: remove ${total - TOTAL_POINTS}` };
}

/** Everything that would stop these criteria from saving, in plain language. */
export function findScoringConfigProblems(config: ScoringConfig): string[] {
  const problems: string[] = [];

  if (config.dimensions.length === 0) problems.push('Add at least one evaluation area.');
  if (config.dimensions.length > MAX_DIMENSIONS) {
    problems.push(`Use at most ${MAX_DIMENSIONS} evaluation areas.`);
  }

  config.dimensions.forEach((dimension, index) => {
    if (dimension.name.trim() === '') problems.push(`Evaluation area ${index + 1} needs a name.`);
    const isWholePoints = Number.isInteger(dimension.maxPoints) && dimension.maxPoints >= 1 && dimension.maxPoints <= TOTAL_POINTS;
    if (!isWholePoints) {
      problems.push(`"${dimension.name.trim() || `Area ${index + 1}`}" needs a whole number of points from 1 to ${TOTAL_POINTS}.`);
    }
  });

  const total = totalPoints(config.dimensions);
  if (config.dimensions.length > 0 && total !== TOTAL_POINTS) {
    problems.push(`The points add up to ${total}; they need to total exactly ${TOTAL_POINTS}.`);
  }

  if (config.redFlags.location.enabled && config.redFlags.location.locale.trim() === '') {
    problems.push('Enter the location candidates should be in, or turn the location flag off.');
  }

  const { salaryLow, salaryHigh } = config.redFlags;
  for (const [setting, title] of [
    [salaryLow, 'low desired pay'],
    [salaryHigh, 'high desired pay'],
  ] as const) {
    const hasWholeThreshold =
      setting.threshold !== null && Number.isInteger(setting.threshold) && setting.threshold >= 1;
    if (setting.enabled && !hasWholeThreshold) {
      problems.push(`Enter the yearly pay for the ${title} flag, or turn it off.`);
    }
  }
  if (
    salaryLow.enabled &&
    salaryHigh.enabled &&
    salaryLow.threshold !== null &&
    salaryHigh.threshold !== null &&
    salaryLow.threshold > salaryHigh.threshold
  ) {
    problems.push('The low desired pay must not be above the high desired pay.');
  }
  return problems;
}

let newDimensionCounter = 0;

/** A blank area for the editor's "Add area" button. */
export function createDimension(): ScoringDimension {
  newDimensionCounter += 1;
  return { id: `area-new-${Date.now()}-${newDimensionCounter}`, name: '', maxPoints: 5, guidance: '' };
}

/** Move an area up (-1) or down (+1); returns the same order when it is already at the edge. */
export function moveDimension(
  dimensions: ScoringDimension[],
  index: number,
  direction: -1 | 1
): ScoringDimension[] {
  const target = index + direction;
  if (target < 0 || target >= dimensions.length) return dimensions;
  const next = [...dimensions];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Whether two configs are the same, ignoring object identity (for "unsaved changes"). */
export function areConfigsEqual(a: ScoringConfig, b: ScoringConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
