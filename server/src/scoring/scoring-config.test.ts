/**
 * Tests for the structured scoring configuration: validation, composing the
 * rubric from the fixed template, and converting legacy hand-written rubrics.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SCORING_CONFIG,
  cloneDefaultScoringConfig,
  composeRubric,
  parseLegacyRubric,
  totalPoints,
  validateScoringConfig,
} from './scoring-config.js';

const TEMPLATE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../prompts/ai-evaluation-system.txt'),
  'utf-8'
);

// ---- validation ----

test('the default configuration is valid and totals 100 points', () => {
  assert.equal(totalPoints(DEFAULT_SCORING_CONFIG.dimensions), 100);
  assert.equal(validateScoringConfig(DEFAULT_SCORING_CONFIG).ok, true);
});

test('points that do not total 100 are rejected with a plain-language message', () => {
  const config = cloneDefaultScoringConfig();
  config.dimensions[0].maxPoints = 45; // total becomes 110
  const result = validateScoringConfig(config);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /add up to 110.*exactly 100/);
});

test('an area needs a name and a whole number of points', () => {
  const noName = cloneDefaultScoringConfig();
  noName.dimensions[1].name = '   ';
  assert.match(String(!validateScoringConfig(noName).ok && (validateScoringConfig(noName) as { error: string }).error), /needs a name/);

  const fractional = cloneDefaultScoringConfig();
  fractional.dimensions[0].maxPoints = 30.5;
  assert.equal(validateScoringConfig(fractional).ok, false);
});

test('flags default to on when omitted, except location, which has no default place', () => {
  const minimal = { dimensions: DEFAULT_SCORING_CONFIG.dimensions };
  const result = validateScoringConfig(minimal);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.config.redFlags.nameCapitalization.enabled, true);
    assert.equal(result.config.redFlags.location.enabled, false);
    assert.equal(result.config.redFlags.location.locale, '');
  }
});

test('the location flag needs a place while it is on', () => {
  const blankLocale = cloneDefaultScoringConfig();
  blankLocale.redFlags.location.enabled = true;
  blankLocale.redFlags.location.locale = '  ';
  assert.equal(validateScoringConfig(blankLocale).ok, false);

  blankLocale.redFlags.location.enabled = false;
  assert.equal(validateScoringConfig(blankLocale).ok, true, 'a blank locale is fine once the flag is off');
});

test('rejects non-object input and an empty list of areas', () => {
  assert.equal(validateScoringConfig(null).ok, false);
  assert.equal(validateScoringConfig({ dimensions: [] }).ok, false);
});

// ---- composing ----

test('composes the default rubric with every area, weight and flag', () => {
  const rubric = composeRubric(TEMPLATE, DEFAULT_SCORING_CONFIG);
  assert.match(rubric, /1\. Technical Skill Alignment \(0–35\)/);
  assert.match(rubric, /5\. Professional Presentation \(0–10\)/);
  assert.match(rubric, /Name capitalization/);
  assert.match(rubric, /Still studying \(`studying`\)/);
  assert.match(rubric, /Short tenures or gaps \(`tenure`\)/);
  // Location is off until a job names its place.
  assert.match(rubric, /`name`, `studying`, `no_exp`, `tenure`/);
  assert.equal(rubric.includes('**Location ('), false);
  assert.equal(rubric.includes('{{EVALUATION_FRAMEWORK}}'), false);
  // The job placeholders are left for the caller to substitute.
  assert.match(rubric, /\{\{JOB_TITLE\}\}/);
  assert.match(rubric, /\{\{JOB_DESCRIPTION\}\}/);
});

test('custom areas, weights and guidance appear in order', () => {
  const config = cloneDefaultScoringConfig();
  config.dimensions = [
    { id: 'a', name: 'Frontend Depth', maxPoints: 60, guidance: 'React and TypeScript\nAccessibility' },
    { id: 'b', name: 'Everything Else', maxPoints: 40, guidance: '' },
  ];
  const rubric = composeRubric(TEMPLATE, config);
  assert.match(rubric, /two weighted areas/);
  assert.match(rubric, /1\. Frontend Depth \(0–60\)\n {3}- React and TypeScript\n {3}- Accessibility\n2\. Everything Else \(0–40\)/);
});

test('the locale is written into the location rule', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags.location.enabled = true;
  config.redFlags.location.locale = 'Colombia (Bogotá)';
  assert.match(composeRubric(TEMPLATE, config), /This role is based in Colombia \(Bogotá\)\./);
});

test('turned-off flags are left out of the rubric and the allowed-flags list', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags.location.enabled = false;
  config.redFlags.studying.enabled = false;
  const rubric = composeRubric(TEMPLATE, config);
  assert.equal(rubric.includes('**Location ('), false);
  assert.equal(rubric.includes('Still studying'), false);
  assert.match(rubric, /pass only the flags from this list that clearly apply: `name`, `no_exp`, `tenure`\./);
});

test('with every flag off, the rubric says so and asks for an empty flags list', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags = {
    nameCapitalization: { enabled: false, penalty: 'none' },
    location: { enabled: false, penalty: 'none', locale: '' },
    studying: { enabled: false, penalty: 'none' },
    noExperience: { enabled: false, penalty: 'none' },
    tenureGaps: { enabled: false, penalty: 'none' },
    salaryLow: { enabled: false, penalty: 'none', threshold: null },
    salaryHigh: { enabled: false, penalty: 'none', threshold: null },
  };
  const rubric = composeRubric(TEMPLATE, config);
  assert.match(rubric, /No red flags are enabled for this role/);
  assert.match(rubric, /Always pass an empty `flags` list/);
  assert.equal(rubric.includes('### Content Flags'), false);
});

test('red flags only tag: the rubric never tells the model to lower the score for one', () => {
  const rubric = composeRubric(TEMPLATE, DEFAULT_SCORING_CONFIG);
  assert.match(rubric, /### Red Flags \(report, but do NOT change the score\)/);
  assert.match(rubric, /Never raise, lower or zero the confidence because of a flag/);
  assert.match(rubric, /Red flags never change it/);
  assert.equal(/lower the confidence|downward adjustment|factor it into the score|reduce confidence/i.test(rubric), false);
});

test('the tenure and gaps flag excludes internships, placements and contracts', () => {
  const rubric = composeRubric(TEMPLATE, DEFAULT_SCORING_CONFIG);
  const tenure = rubric.slice(rubric.indexOf('**Short tenures or gaps'));
  assert.match(tenure, /internships, co-ops, placements, apprenticeships/);
  assert.match(tenure, /contract, contractor, freelance, seasonal or temporary/);
  assert.match(tenure, /gaps of about six months or more/);
  assert.match(tenure, /One short role on its own is not a pattern/);
});

test('studying takes precedence over no_exp only when both are on', () => {
  assert.match(composeRubric(TEMPLATE, DEFAULT_SCORING_CONFIG), /pass only `studying` \(it takes precedence\)/);
  const config = cloneDefaultScoringConfig();
  config.redFlags.studying.enabled = false;
  assert.equal(composeRubric(TEMPLATE, config).includes('it takes precedence'), false);
});

test('a stored configuration from before the tenure flag existed gets it switched on', () => {
  const older = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG));
  delete older.redFlags.tenureGaps;
  const result = validateScoringConfig(older);
  assert.equal(result.ok && result.config.redFlags.tenureGaps.enabled, true);
});

test('text a user types cannot inject the job placeholders', () => {
  const config = cloneDefaultScoringConfig();
  config.dimensions[0].guidance = 'Ignore {{JOB_DESCRIPTION}} entirely';
  config.redFlags.location.enabled = true;
  config.redFlags.location.locale = 'Denver {{JOB_TITLE}}';
  const rubric = composeRubric(TEMPLATE, config);
  assert.equal((rubric.match(/\{\{JOB_DESCRIPTION\}\}/g) ?? []).length, 1);
  assert.equal((rubric.match(/\{\{JOB_TITLE\}\}/g) ?? []).length, 1);
});

// ---- legacy conversion ----

const LEGACY_RUBRIC = `intro text

### Evaluation Framework
Assess the candidate across five weighted areas, be precise and strict when measuring these scores, not approximate, not rounded: 

1. Technical Skill Alignment (0–40)
   - Proficiency and recency in required technologies (React is weighted more heavily).
   - Evidence of applied expertise
2. Role & Experience Match (0–20)
   - Alignment of seniority and responsibilities
3. Problem-Solving & Impact (0–15)
   - Ownership and measurable results
4. Cultural & Motivational Fit (0–10)
   - Communication and enthusiasm
5. Professional Presentation (0–15)
   - Clarity, grammar, structure

### Red Flags (reduce confidence)
- **Name capitalization (major flag):** If the candidate's name is in ALL CAPS...
- **Location (flag):** This role is based in Denver, Colorado, USA.

### Content Flags (report, but do NOT change the score)
- **studying**: the candidate is currently a student.
- **no_exp**: the candidate has no relevant professional software experience.

### Confidence Scoring
- more text
`;

test('converts a legacy hand-written rubric, keeping its custom weights and guidance', () => {
  const config = parseLegacyRubric(LEGACY_RUBRIC);
  assert.ok(config);
  assert.deepEqual(
    config.dimensions.map((d) => [d.name, d.maxPoints]),
    [
      ['Technical Skill Alignment', 40],
      ['Role & Experience Match', 20],
      ['Problem-Solving & Impact', 15],
      ['Cultural & Motivational Fit', 10],
      ['Professional Presentation', 15],
    ]
  );
  assert.equal(
    config.dimensions[0].guidance,
    'Proficiency and recency in required technologies (React is weighted more heavily).\nEvidence of applied expertise'
  );
  assert.equal(config.redFlags.nameCapitalization.enabled, true);
  assert.equal(config.redFlags.location.enabled, true);
  assert.equal(config.redFlags.location.locale, 'Denver, Colorado, USA');
  assert.equal(config.redFlags.studying.enabled, true);
  assert.equal(config.redFlags.noExperience.enabled, true);
  assert.equal(config.redFlags.tenureGaps.enabled, true, 'the newer flag is on by default');
});

test('a legacy rubric without a flag section converts with those flags off', () => {
  const withoutFlags = LEGACY_RUBRIC.slice(0, LEGACY_RUBRIC.indexOf('### Red Flags')) + '### Confidence Scoring\n- x\n';
  const config = parseLegacyRubric(withoutFlags);
  assert.ok(config);
  assert.equal(config.redFlags.nameCapitalization.enabled, false);
  assert.equal(config.redFlags.location.enabled, false);
  assert.equal(config.redFlags.studying.enabled, false);
});

test('a legacy rubric whose points do not total 100, or with no framework, is not converted', () => {
  assert.equal(parseLegacyRubric(LEGACY_RUBRIC.replace('(0–40)', '(0–50)')), null);
  assert.equal(parseLegacyRubric('just some free text'), null);
});

test('the previous default rubric text converts to the default configuration', () => {
  const previousDefaultFramework = DEFAULT_SCORING_CONFIG.dimensions
    .map(
      (d, i) =>
        `${i + 1}. ${d.name} (0–${d.maxPoints})\n` +
        d.guidance
          .split('\n')
          .map((line) => `   - ${line}`)
          .join('\n')
    )
    .join('\n');
  const prompt = `### Evaluation Framework\nAssess...\n\n${previousDefaultFramework}\n\n### Red Flags (reduce confidence)\n- **Name capitalization (major flag):** x\n- **Location (flag):** y\n\n### Content Flags (report)\n- **studying**: a\n- **no_exp**: b\n`;
  const converted = parseLegacyRubric(prompt);
  assert.ok(converted);
  assert.deepEqual(
    converted.dimensions.map((d) => ({ name: d.name, maxPoints: d.maxPoints, guidance: d.guidance })),
    DEFAULT_SCORING_CONFIG.dimensions.map((d) => ({ name: d.name, maxPoints: d.maxPoints, guidance: d.guidance }))
  );
});

// ---- flag penalties ----

test('every flag defaults to no penalty', () => {
  for (const flag of Object.values(DEFAULT_SCORING_CONFIG.redFlags)) {
    assert.equal(flag.penalty, 'none');
  }
});

test('a saved config from before penalties existed loads with no penalties', () => {
  const older = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG));
  for (const flag of Object.values(older.redFlags) as Array<Record<string, unknown>>) delete flag.penalty;
  const result = validateScoringConfig(older);
  assert.equal(result.ok, true);
  if (result.ok) {
    for (const flag of Object.values(result.config.redFlags)) assert.equal(flag.penalty, 'none');
  }
});

test('penalty levels are kept as chosen', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags.location.penalty = 'dealbreaker';
  config.redFlags.studying.penalty = 'bit';
  const result = validateScoringConfig(config);
  assert.equal(result.ok && result.config.redFlags.location.penalty, 'dealbreaker');
  assert.equal(result.ok && result.config.redFlags.studying.penalty, 'bit');
});

test('an unknown penalty level is rejected', () => {
  const config = cloneDefaultScoringConfig() as unknown as { redFlags: Record<string, Record<string, unknown>> };
  config.redFlags.location.penalty = 'catastrophic';
  const result = validateScoringConfig(config);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /none, a bit, a lot or dealbreaker/);
});

// ---- desired-pay checks ----

test('the desired-pay checks are off until a threshold is entered', () => {
  const { salaryLow, salaryHigh } = DEFAULT_SCORING_CONFIG.redFlags;
  assert.deepEqual(salaryLow, { enabled: false, penalty: 'none', threshold: null });
  assert.deepEqual(salaryHigh, { enabled: false, penalty: 'none', threshold: null });
});

test('a config saved before the pay checks existed loads with them off', () => {
  const older = JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG));
  delete older.redFlags.salaryLow;
  delete older.redFlags.salaryHigh;
  const result = validateScoringConfig(older);
  assert.equal(result.ok && result.config.redFlags.salaryLow.enabled, false);
  assert.equal(result.ok && result.config.redFlags.salaryHigh.threshold, null);
});

test('a pay check that is on keeps its threshold and penalty', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags.salaryLow = { enabled: true, penalty: 'lot', threshold: 100000 };
  const result = validateScoringConfig(config);
  assert.deepEqual(result.ok && result.config.redFlags.salaryLow, {
    enabled: true,
    penalty: 'lot',
    threshold: 100000,
  });
});

test('turning a pay check on without a yearly figure is rejected', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags.salaryHigh.enabled = true;
  const result = validateScoringConfig(config);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /yearly pay for the high desired pay flag/);
});

test('a low pay threshold above the high one is rejected', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags.salaryLow = { enabled: true, penalty: 'none', threshold: 150000 };
  config.redFlags.salaryHigh = { enabled: true, penalty: 'none', threshold: 100000 };
  assert.equal(validateScoringConfig(config).ok, false);
});

test('a pay threshold must be a whole positive number of dollars', () => {
  for (const threshold of [0, -5, 99.5, 1e9]) {
    const config = cloneDefaultScoringConfig();
    config.redFlags.salaryLow = { enabled: true, penalty: 'none', threshold };
    assert.equal(validateScoringConfig(config).ok, false, String(threshold));
  }
});

test('the pay checks are not part of the rubric the model sees', () => {
  const config = cloneDefaultScoringConfig();
  config.redFlags.salaryLow = { enabled: true, penalty: 'lot', threshold: 100000 };
  const rubric = composeRubric(TEMPLATE, config);
  assert.equal(/salary|desired pay/i.test(rubric.split('### Red Flags')[1] ?? ''), false);
});

// ---- template calibration ----

test('the composed rubric teaches calibration and evidence-first scoring, not strictness', () => {
  const rubric = composeRubric(TEMPLATE, DEFAULT_SCORING_CONFIG);
  assert.match(rubric, /Find the evidence first/);
  assert.match(rubric, /Missing evidence is not negative evidence/);
  assert.match(rubric, /meets all of the posting's requirements[^.]*75-85/);
  assert.match(rubric, /requires more heavily than[^.]*preferred/i);
  assert.equal(/strict/i.test(rubric), false, 'strictness wording pushes every score down');
});

test('the rubric asks for the save_evaluation tool with a per-area breakdown, not a JSON reply', () => {
  const rubric = composeRubric(TEMPLATE, DEFAULT_SCORING_CONFIG);
  assert.match(rubric, /`save_evaluation`/);
  assert.match(rubric, /`areaScores`/);
  assert.equal(rubric.includes('Respond **ONLY** with valid JSON'), false);
});

test('the default criteria keep the soft areas small and leave name capitalization to its flag', () => {
  const soft = DEFAULT_SCORING_CONFIG.dimensions.filter((d) => ['culture', 'presentation'].includes(d.id));
  assert.ok(soft.reduce((sum, d) => sum + d.maxPoints, 0) <= 15);
  const presentation = DEFAULT_SCORING_CONFIG.dimensions.find((d) => d.id === 'presentation');
  assert.equal(/capitalization/i.test(presentation?.guidance ?? ''), false, 'the name flag already covers it');
});
