/**
 * Tests for red-flag score penalties. Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyFlagPenalties, DEALBREAKER_SCORE_CAP } from './flag-penalties.js';
import { cloneDefaultScoringConfig, type FlagPenalty } from './scoring-config.js';

function configWith(penalties: Partial<Record<'location' | 'studying' | 'tenureGaps' | 'noExperience' | 'nameCapitalization' | 'salaryLow' | 'salaryHigh', FlagPenalty>>) {
  const config = cloneDefaultScoringConfig();
  for (const [key, penalty] of Object.entries(penalties)) {
    const flag = config.redFlags[key as keyof typeof config.redFlags];
    flag.penalty = penalty as FlagPenalty;
    flag.enabled = true; // a flag with a penalty is one the job has switched on
  }
  config.redFlags.location.locale = 'Denver, Colorado, USA';
  return config;
}

test('by default no flag changes the score', () => {
  const result = applyFlagPenalties(80, ['location', 'studying', 'tenure'], cloneDefaultScoringConfig());
  assert.equal(result.score, 80);
  assert.deepEqual(result.appliedPenalties, []);
});

test('"a bit" takes 5 points and "a lot" takes 15', () => {
  assert.equal(applyFlagPenalties(80, ['location'], configWith({ location: 'bit' })).score, 75);
  assert.equal(applyFlagPenalties(80, ['location'], configWith({ location: 'lot' })).score, 65);
});

test('penalties from several flags add up', () => {
  const config = configWith({ location: 'lot', studying: 'bit' });
  const result = applyFlagPenalties(80, ['location', 'studying'], config);
  assert.equal(result.score, 60);
  assert.deepEqual(result.appliedPenalties, [
    { flag: 'location', penalty: 'lot' },
    { flag: 'studying', penalty: 'bit' },
  ]);
});

test('a dealbreaker caps the score well below the "do not advance" line', () => {
  const result = applyFlagPenalties(92, ['tenure'], configWith({ tenureGaps: 'dealbreaker' }));
  assert.equal(result.score, DEALBREAKER_SCORE_CAP);
  assert.ok(result.score < 60);
});

test('a dealbreaker never raises a score that is already lower', () => {
  const result = applyFlagPenalties(12, ['tenure'], configWith({ tenureGaps: 'dealbreaker' }));
  assert.equal(result.score, 12);
  assert.deepEqual(result.appliedPenalties, [], 'nothing changed, so nothing to report');
});

test('the score never goes below zero', () => {
  const config = configWith({ location: 'lot', studying: 'lot', noExperience: 'lot' });
  assert.equal(applyFlagPenalties(20, ['location', 'studying', 'no_exp'], config).score, 0);
});

test('only flags that apply are penalized, and each counts once', () => {
  const config = configWith({ location: 'lot', studying: 'lot' });
  assert.equal(applyFlagPenalties(80, ['location', 'location'], config).score, 65);
});

test('a flag turned off for the job costs nothing even if it has a penalty', () => {
  const config = configWith({ location: 'lot' });
  config.redFlags.location.enabled = false;
  assert.equal(applyFlagPenalties(80, ['location'], config).score, 80);
});

test('no flags leave the score alone', () => {
  assert.equal(applyFlagPenalties(80, [], configWith({ location: 'dealbreaker' })).score, 80);
});

test('salary flags are penalized only when that check is on for the job', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags.salaryLow.penalty = 'lot';
  config.redFlags.salaryHigh.penalty = 'bit';
  assert.equal(applyFlagPenalties(80, ['salary-low'], config).score, 80, 'check is off by default');

  config.redFlags.salaryLow = { enabled: true, penalty: 'lot', threshold: 100000 };
  config.redFlags.salaryHigh = { enabled: true, penalty: 'bit', threshold: 135000 };
  assert.equal(applyFlagPenalties(80, ['salary-low'], config).score, 65);
  assert.equal(applyFlagPenalties(80, ['salary-high'], config).score, 75);
});
