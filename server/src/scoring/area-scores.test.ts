import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateAreaScores } from './area-scores.js';
import type { ScoringDimension } from './scoring-config.js';

const dimensions: ScoringDimension[] = [
  { id: 'a', name: 'Technical Skills', maxPoints: 60, guidance: '' },
  { id: 'b', name: 'Experience', maxPoints: 40, guidance: '' },
];

test('a complete breakdown that adds up is stored in the job’s area order', () => {
  const result = validateAreaScores(
    [
      { name: 'experience', points: 30 },
      { name: 'Technical Skills', points: 45 },
    ],
    dimensions,
    75
  );
  assert.deepEqual(result, {
    ok: true,
    areaScores: [
      { name: 'Technical Skills', points: 45, maxPoints: 60 },
      { name: 'Experience', points: 30, maxPoints: 40 },
    ],
  });
});

test('an unknown area is rejected and the valid names are listed', () => {
  const result = validateAreaScores([{ name: 'Vibes', points: 5 }], dimensions, 5);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /unknown area "Vibes".*"Technical Skills", "Experience"/);
});

test('points above an area’s maximum, or fractional, are rejected', () => {
  const tooHigh = validateAreaScores(
    [{ name: 'Technical Skills', points: 61 }, { name: 'Experience', points: 0 }],
    dimensions,
    61
  );
  assert.equal(tooHigh.ok, false);
  const fractional = validateAreaScores(
    [{ name: 'Technical Skills', points: 40.5 }, { name: 'Experience', points: 0 }],
    dimensions,
    40
  );
  assert.equal(fractional.ok, false);
});

test('a missing or repeated area is rejected', () => {
  const missing = validateAreaScores([{ name: 'Technical Skills', points: 30 }], dimensions, 30);
  assert.match(!missing.ok ? missing.error : '', /missing: "Experience"/);
  const repeated = validateAreaScores(
    [
      { name: 'Technical Skills', points: 30 },
      { name: 'technical skills', points: 30 },
    ],
    dimensions,
    60
  );
  assert.match(!repeated.ok ? repeated.error : '', /more than once/);
});

test('a breakdown that does not add up to the total is rejected', () => {
  const result = validateAreaScores(
    [{ name: 'Technical Skills', points: 40 }, { name: 'Experience', points: 20 }],
    dimensions,
    70
  );
  assert.match(!result.ok ? result.error : '', /add up to 60 but confidence is 70/);
});
