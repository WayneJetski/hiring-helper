/**
 * Desired-pay flags: parse the free-text pay an applicant entered and compare it
 * with a job's thresholds. Pure, so it is tested without a database.
 */

import type { ApplicationFlag } from '../types/flags.js';
import type { ScoringConfig } from './scoring-config.js';

/** Midpoint annual salary from a free-text desired-pay string, or null. */
export function parseSalary(raw: string | null): number | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (/\/\s*(hour|hr)\b|per\s*(hour|hr)\b|\bhourly\b|\d\s*\/\s*hr/.test(lower)) return null; // hourly
  const s = lower
    .replace(/\(.*?\)/g, ' ')
    .replace(/,/g, '')
    .replace(/\$/g, ' ')
    .replace(/per\s*(year|annum)|annually|\/\s*year|yearly|base salary|flexible|open to discussion|cad|usd/g, ' ');
  const tokens = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(k)?/g)]
    .map((m) => (m[2] ? parseFloat(m[1]) * 1000 : parseFloat(m[1])))
    .filter((n) => !Number.isNaN(n) && n >= 1000);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0];
  return Math.round((Math.min(...tokens) + Math.max(...tokens)) / 2);
}

const SALARY_FLAGS: ApplicationFlag[] = ['salary-low', 'salary-high'];

/**
 * The salary flags this job's thresholds give a desired-pay answer: `salary-low`
 * below the low threshold, `salary-high` above the high one (both exclusive).
 * A turned-off check, a blank answer, or one that is not a yearly figure
 * (hourly, text) gives nothing.
 */
export function deriveSalaryFlags(
  desiredPay: string | null | undefined,
  redFlags: Pick<ScoringConfig['redFlags'], 'salaryLow' | 'salaryHigh'>
): ApplicationFlag[] {
  const annual = parseSalary(desiredPay ?? null);
  if (annual === null) return [];

  const flags: ApplicationFlag[] = [];
  const { salaryLow, salaryHigh } = redFlags;
  if (salaryLow.enabled && salaryLow.threshold !== null && annual < salaryLow.threshold) {
    flags.push('salary-low');
  }
  if (salaryHigh.enabled && salaryHigh.threshold !== null && annual > salaryHigh.threshold) {
    flags.push('salary-high');
  }
  return flags;
}

/**
 * Replace the stored salary flags the job's checks cover with freshly derived
 * ones. A check that is turned off leaves any existing flag of its kind alone
 * (the older one-off script may have set it).
 */
export function reconcileSalaryFlags(
  existing: ApplicationFlag[],
  derived: ApplicationFlag[],
  redFlags: Pick<ScoringConfig['redFlags'], 'salaryLow' | 'salaryHigh'>
): ApplicationFlag[] {
  const managed = new Set<ApplicationFlag>();
  if (redFlags.salaryLow.enabled) managed.add('salary-low');
  if (redFlags.salaryHigh.enabled) managed.add('salary-high');

  const kept = existing.filter((flag) => !managed.has(flag));
  const added = derived.filter((flag) => SALARY_FLAGS.includes(flag));
  return [...new Set([...kept, ...added])];
}
