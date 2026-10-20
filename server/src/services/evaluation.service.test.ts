/**
 * EvaluationService tests with in-memory fakes (no database, no disk).
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EvaluationService, type EvaluationDependencies } from './evaluation.service.js';
import { cloneDefaultScoringConfig, type ScoringConfig } from '../scoring/scoring-config.js';
import type { ApplicantSummary } from '../types/summary.types.js';

function twoAreaConfig(): ScoringConfig {
  const config = cloneDefaultScoringConfig();
  config.dimensions = [
    { id: 'a', name: 'Technical Skills', maxPoints: 60, guidance: '' },
    { id: 'b', name: 'Experience', maxPoints: 40, guidance: '' },
  ];
  return config;
}

function setup(options: { config?: ScoringConfig; isLegacyPromptActive?: boolean } = {}): {
  service: EvaluationService;
  saved: { summary?: ApplicantSummary; score?: number };
} {
  const saved: { summary?: ApplicantSummary; score?: number } = {};
  const dependencies = {
    summaryRepo: {
      saveSummary: async (_id: number, summary: ApplicantSummary) => {
        saved.summary = summary;
      },
      getSummary: async () => saved.summary ?? null,
    },
    scoresRepo: {
      setScore: async (_id: number, score: number) => {
        saved.score = score;
      },
    },
    applicationsRepo: { getById: (id: number) => ({ id, jobId: 7, desiredSalary: null }) },
    jobsRepo: { getById: (id: number) => ({ id, title: 'Analyst' }) },
    flagsRepo: { getFlags: () => [], setFlags: () => undefined },
    jobDescriptionService: {
      getScoringConfig: () => ({
        config: options.config ?? twoAreaConfig(),
        isCustom: true,
        isLegacyPromptActive: options.isLegacyPromptActive ?? false,
      }),
    },
  } as unknown as EvaluationDependencies;
  return { service: new EvaluationService(dependencies), saved };
}

const baseInput = { brief: 'Fit', full: 'Details' };

test('a valid area breakdown is stored with each area’s maximum', async () => {
  const { service, saved } = setup();
  const summary = await service.saveEvaluation(1, {
    ...baseInput,
    confidence: 70,
    areaScores: [
      { name: 'Technical Skills', points: 45 },
      { name: 'Experience', points: 25 },
    ],
  });

  assert.deepEqual(summary.areaScores, [
    { name: 'Technical Skills', points: 45, maxPoints: 60 },
    { name: 'Experience', points: 25, maxPoints: 40 },
  ]);
  assert.equal(saved.score, 70);
  assert.deepEqual(saved.summary?.areaScores, summary.areaScores);
});

test('a breakdown that does not add up is rejected and nothing is saved', async () => {
  const { service, saved } = setup();
  await assert.rejects(
    service.saveEvaluation(1, {
      ...baseInput,
      confidence: 80,
      areaScores: [
        { name: 'Technical Skills', points: 45 },
        { name: 'Experience', points: 25 },
      ],
    }),
    /add up to 70 but confidence is 80/
  );
  assert.equal(saved.summary, undefined);
  assert.equal(saved.score, undefined);
});

test('an unknown area name is rejected with the valid names', async () => {
  const { service } = setup();
  await assert.rejects(
    service.saveEvaluation(1, {
      ...baseInput,
      confidence: 10,
      areaScores: [{ name: 'Vibes', points: 10 }],
    }),
    /unknown area "Vibes".*Technical Skills/
  );
});

test('without a breakdown the evaluation saves as before', async () => {
  const { service, saved } = setup();
  const summary = await service.saveEvaluation(1, { ...baseInput, confidence: 64 });
  assert.equal(summary.areaScores, undefined);
  assert.equal(saved.score, 64);
});

test('a job still on a legacy rubric ignores the breakdown, whose areas are unknown', async () => {
  const { service, saved } = setup({ isLegacyPromptActive: true });
  const summary = await service.saveEvaluation(1, {
    ...baseInput,
    confidence: 55,
    areaScores: [{ name: 'Whatever the old rubric said', points: 55 }],
  });
  assert.equal(summary.areaScores, undefined);
  assert.equal(saved.score, 55);
});

test('flag penalties lower the saved score but the breakdown still adds up to the merit score', async () => {
  const config = twoAreaConfig();
  config.redFlags.studying = { enabled: true, penalty: 'lot' };
  const { service, saved } = setup({ config });

  const summary = await service.saveEvaluation(1, {
    ...baseInput,
    confidence: 70,
    flags: ['studying'],
    areaScores: [
      { name: 'Technical Skills', points: 45 },
      { name: 'Experience', points: 25 },
    ],
  });

  assert.equal(saved.score, 55, 'a lot = -15');
  assert.equal(summary.scoreAdjustment?.meritScore, 70);
  assert.equal(summary.areaScores?.reduce((sum, area) => sum + area.points, 0), 70);
});

test('a confidence outside 0-100 is rejected', async () => {
  const { service } = setup();
  await assert.rejects(service.saveEvaluation(1, { ...baseInput, confidence: 101 }), /between 0 and 100/);
});
