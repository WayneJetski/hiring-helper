import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  areConfigsEqual,
  createDimension,
  describePointsTotal,
  FLAG_PENALTY_LEVELS,
  findScoringConfigProblems,
  moveDimension,
  totalPoints,
} from './scoringConfig.js';
import type { ScoringConfig } from '../types/applicant.types';

function validConfig(): ScoringConfig {
  return {
    dimensions: [
      { id: 'a', name: 'Skills', maxPoints: 60, guidance: 'x' },
      { id: 'b', name: 'Experience', maxPoints: 40, guidance: '' },
    ],
    redFlags: {
      nameCapitalization: { enabled: true, penalty: 'none' },
      location: { enabled: true, penalty: 'none', locale: 'Colorado, USA' },
      studying: { enabled: true, penalty: 'none' },
      noExperience: { enabled: true, penalty: 'none' },
      tenureGaps: { enabled: true, penalty: 'none' },
      salaryLow: { enabled: false, penalty: 'none', threshold: null },
      salaryHigh: { enabled: false, penalty: 'none', threshold: null },
    },
  };
}

test('a valid configuration has no problems', () => {
  assert.deepEqual(findScoringConfigProblems(validConfig()), []);
});

test('says how far the points are from 100', () => {
  assert.deepEqual(describePointsTotal(100), { isValid: true, text: 'Total 100 of 100 points' });
  assert.deepEqual(describePointsTotal(70), { isValid: false, text: 'Total 70 of 100: add 30 more' });
  assert.deepEqual(describePointsTotal(112), { isValid: false, text: 'Total 112 of 100: remove 12' });
});

test('reports points that do not total 100 as a problem', () => {
  const config = validConfig();
  config.dimensions[0].maxPoints = 50;
  assert.match(findScoringConfigProblems(config).join(' '), /add up to 90/);
});

test('reports a missing name, bad points and an empty list', () => {
  const unnamed = validConfig();
  unnamed.dimensions[1].name = ' ';
  assert.match(findScoringConfigProblems(unnamed).join(' '), /Evaluation area 2 needs a name/);

  const fractional = validConfig();
  fractional.dimensions[0].maxPoints = 12.5;
  assert.match(findScoringConfigProblems(fractional).join(' '), /whole number of points/);

  assert.match(findScoringConfigProblems({ ...validConfig(), dimensions: [] }).join(' '), /at least one/);
});

test('a turned-on location flag needs a locale; turning it off clears the requirement', () => {
  const config = validConfig();
  config.redFlags.location.locale = '  ';
  assert.match(findScoringConfigProblems(config).join(' '), /location candidates should be in/);
  config.redFlags.location.enabled = false;
  assert.deepEqual(findScoringConfigProblems(config), []);
});

test('totals points and ignores a blank points field while typing', () => {
  const config = validConfig();
  config.dimensions[0].maxPoints = Number.NaN;
  assert.equal(totalPoints(config.dimensions), 40);
});

test('new areas get unique ids and start with a small, non-zero weight', () => {
  const first = createDimension();
  const second = createDimension();
  assert.notEqual(first.id, second.id);
  assert.equal(first.maxPoints, 5);
});

test('moves an area up or down and stops at the edges', () => {
  const { dimensions } = validConfig();
  assert.deepEqual(moveDimension(dimensions, 0, 1).map((d) => d.id), ['b', 'a']);
  assert.deepEqual(moveDimension(dimensions, 0, -1).map((d) => d.id), ['a', 'b']);
  assert.deepEqual(moveDimension(dimensions, 1, 1).map((d) => d.id), ['a', 'b']);
});

test('detects unsaved changes by value, not identity', () => {
  assert.equal(areConfigsEqual(validConfig(), validConfig()), true);
  const changed = validConfig();
  changed.redFlags.studying.enabled = false;
  assert.equal(areConfigsEqual(validConfig(), changed), false);
});

test('the penalty slider runs from none to dealbreaker in order', () => {
  assert.deepEqual(
    FLAG_PENALTY_LEVELS.map((level) => level.value),
    ['none', 'bit', 'lot', 'dealbreaker']
  );
});

test('a desired-pay flag that is on needs a yearly figure', () => {
  const config = validConfig();
  config.redFlags.salaryLow.enabled = true;
  assert.deepEqual(findScoringConfigProblems(config), [
    'Enter the yearly pay for the low desired pay flag, or turn it off.',
  ]);
  config.redFlags.salaryLow.threshold = 100000;
  assert.deepEqual(findScoringConfigProblems(config), []);
});

test('the low desired pay cannot be above the high one', () => {
  const config = validConfig();
  config.redFlags.salaryLow = { enabled: true, penalty: 'none', threshold: 150000 };
  config.redFlags.salaryHigh = { enabled: true, penalty: 'none', threshold: 100000 };
  assert.deepEqual(findScoringConfigProblems(config), [
    'The low desired pay must not be above the high desired pay.',
  ]);
});
