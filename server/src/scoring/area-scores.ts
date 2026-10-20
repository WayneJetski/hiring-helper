/**
 * Per-area score breakdown.
 *
 * Besides the total, the model reports the points it gave each evaluation area.
 * Storing the breakdown makes a score auditable and shows which area pulls
 * scores down. This module is pure: it checks the breakdown against the job's
 * criteria and returns the form that is stored.
 */

import type { ScoringDimension } from './scoring-config.js';

export interface AreaScoreInput {
  name: string;
  points: number;
}

/** A stored area score, with the maximum it was judged against. */
export interface AreaScore {
  name: string;
  points: number;
  maxPoints: number;
}

export type AreaScoreResult = { ok: true; areaScores: AreaScore[] } | { ok: false; error: string };

const normalizeName = (name: string): string => name.trim().toLowerCase();

/**
 * Check a breakdown against the job's evaluation areas: every area appears once
 * under its own name, points are whole numbers within the area's maximum, and
 * the points add up to the total score the model gave. Errors are written for
 * the model, so it can correct itself and save again.
 */
export function validateAreaScores(
  input: AreaScoreInput[],
  dimensions: ScoringDimension[],
  totalScore: number
): AreaScoreResult {
  const byName = new Map(dimensions.map((dimension) => [normalizeName(dimension.name), dimension]));
  const given = new Map<string, number>();

  for (const entry of input) {
    const key = normalizeName(entry.name);
    const dimension = byName.get(key);
    if (!dimension) {
      const valid = dimensions.map((item) => `"${item.name}"`).join(', ');
      return { ok: false, error: `areaScores has an unknown area "${entry.name}". Use exactly: ${valid}.` };
    }
    if (given.has(key)) {
      return { ok: false, error: `areaScores lists "${dimension.name}" more than once.` };
    }
    if (!Number.isInteger(entry.points) || entry.points < 0 || entry.points > dimension.maxPoints) {
      return {
        ok: false,
        error: `"${dimension.name}" must be a whole number of points from 0 to ${dimension.maxPoints}, got ${entry.points}.`,
      };
    }
    given.set(key, entry.points);
  }

  const missing = dimensions.filter((dimension) => !given.has(normalizeName(dimension.name)));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `areaScores is missing: ${missing.map((item) => `"${item.name}"`).join(', ')}. Score every area.`,
    };
  }

  const areaScores = dimensions.map((dimension) => ({
    name: dimension.name,
    points: given.get(normalizeName(dimension.name)) ?? 0,
    maxPoints: dimension.maxPoints,
  }));
  const sum = areaScores.reduce((total, area) => total + area.points, 0);
  if (sum !== totalScore) {
    return {
      ok: false,
      error: `The area points add up to ${sum} but confidence is ${totalScore}. Make confidence the sum of the areas.`,
    };
  }
  return { ok: true, areaScores };
}
