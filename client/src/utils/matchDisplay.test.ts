import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAG_DISPLAY,
  formatPhoneNumber,
  getConfidenceBadge,
  getConfidenceClass,
  getConfidenceLevel,
} from './matchDisplay.js';

test('Match levels: 75+ strong, 60 to 74 maybe, below 60 weak', () => {
  assert.deepEqual([75, 74, 60, 59].map(getConfidenceLevel), ['Strong', 'Maybe', 'Maybe', 'Weak']);
  assert.deepEqual([75, 60, 59].map(getConfidenceClass), ['confidence-high', 'confidence-medium', 'confidence-low']);
});

test('an unscored applicant shows a dash and says so in words', () => {
  assert.equal(getConfidenceBadge(undefined), '—');
  assert.equal(getConfidenceLevel(undefined), 'Not scored yet');
  assert.equal(getConfidenceClass(undefined), '');
  assert.equal(getConfidenceBadge(82), '82%');
});

test('every flag the app can set has a label and an icon', () => {
  for (const flag of ['location', 'name', 'studying', 'no_exp', 'tenure', 'salary-low', 'salary-high']) {
    assert.ok(FLAG_DISPLAY[flag]?.label && FLAG_DISPLAY[flag]?.icon, flag);
  }
});

test('formats 10-digit North American numbers for reading', () => {
  assert.equal(formatPhoneNumber('3432091360'), '(343) 209-1360');
  assert.equal(formatPhoneNumber('+1 343-209-1360'), '(343) 209-1360');
  assert.equal(formatPhoneNumber('1 (343) 209 1360'), '(343) 209-1360');
});

test('leaves anything else exactly as the applicant typed it', () => {
  assert.equal(formatPhoneNumber('+44 20 7946 0958'), '+44 20 7946 0958');
  assert.equal(formatPhoneNumber('ext 5'), 'ext 5');
  assert.equal(formatPhoneNumber('343-209-1360 ext 5'), '343-209-1360 ext 5');
});
