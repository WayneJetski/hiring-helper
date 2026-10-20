/**
 * Tests for the desired-pay flags. Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveSalaryFlags, parseSalary, reconcileSalaryFlags } from './salary.js';
import { cloneDefaultScoringConfig, type ScoringConfig } from './scoring-config.js';

function checks(low: number | null, high: number | null): ScoringConfig['redFlags'] {
  const { redFlags } = cloneDefaultScoringConfig();
  redFlags.salaryLow = { enabled: low !== null, penalty: 'none', threshold: low };
  redFlags.salaryHigh = { enabled: high !== null, penalty: 'none', threshold: high };
  return redFlags;
}

test('reads yearly figures written in common ways', () => {
  assert.equal(parseSalary('$95,000'), 95000);
  assert.equal(parseSalary('110k'), 110000);
  assert.equal(parseSalary('90,000 - 110,000'), 100000);
});

test('leaves hourly, blank and non-numeric answers alone', () => {
  assert.equal(parseSalary('$45/hour'), null);
  assert.equal(parseSalary(''), null);
  assert.equal(parseSalary(null), null);
  assert.equal(parseSalary('negotiable'), null);
});

test('flags pay below the low threshold and above the high one, not at them', () => {
  const redFlags = checks(100000, 135000);
  assert.deepEqual(deriveSalaryFlags('$90,000', redFlags), ['salary-low']);
  assert.deepEqual(deriveSalaryFlags('$150,000', redFlags), ['salary-high']);
  assert.deepEqual(deriveSalaryFlags('$100,000', redFlags), []);
  assert.deepEqual(deriveSalaryFlags('$135,000', redFlags), []);
  assert.deepEqual(deriveSalaryFlags('$120,000', redFlags), []);
});

test('a check that is off flags nothing', () => {
  assert.deepEqual(deriveSalaryFlags('$50,000', checks(null, 135000)), []);
  assert.deepEqual(deriveSalaryFlags('$200,000', checks(100000, null)), []);
});

test('an unreadable or missing answer flags nothing', () => {
  const redFlags = checks(100000, 135000);
  assert.deepEqual(deriveSalaryFlags(undefined, redFlags), []);
  assert.deepEqual(deriveSalaryFlags('$40/hr', redFlags), []);
});

test('reconciling swaps in the new flags for the checks that are on', () => {
  const redFlags = checks(100000, 135000);
  assert.deepEqual(reconcileSalaryFlags(['salary-low', 'studying'], ['salary-high'], redFlags), [
    'studying',
    'salary-high',
  ]);
  assert.deepEqual(reconcileSalaryFlags(['salary-low', 'tenure'], [], redFlags), ['tenure']);
});

test('reconciling leaves flags alone for a check that is off', () => {
  // The older one-off script may have set this; the job is not managing it.
  assert.deepEqual(reconcileSalaryFlags(['salary-low'], [], checks(null, null)), ['salary-low']);
});
