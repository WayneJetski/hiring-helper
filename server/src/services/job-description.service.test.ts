/**
 * Unit tests for JobDescriptionService's scoring criteria handling, using a fake
 * JobsRepository (no DB). The rubric template is the real
 * server/prompts/ai-evaluation-system.txt.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { JobDescriptionService } from './job-description.service.js';
import type { JobsRepository } from '../repositories/jobs.repository.js';
import { cloneDefaultScoringConfig } from '../scoring/scoring-config.js';

interface FakeJob {
  systemPrompt?: string;
  scoringConfig?: string;
}

function serviceWith(job: FakeJob | null): {
  service: JobDescriptionService;
  savedConfigs: Array<string | null>;
  legacyCleared: number[];
  confirmed: number[];
} {
  const savedConfigs: Array<string | null> = [];
  const legacyCleared: number[] = [];
  const confirmed: number[] = [];
  const fakeRepo = {
    getById: (id: number) => (job ? { id, title: 'X', ...job } : null),
    saveScoringConfig: (_id: number, json: string | null) => {
      savedConfigs.push(json);
      return job !== null;
    },
    clearLegacyPrompt: (id: number) => {
      legacyCleared.push(id);
      return true;
    },
    confirmCriteria: (id: number) => {
      confirmed.push(id);
      return true;
    },
  } as unknown as JobsRepository;
  return { service: new JobDescriptionService(fakeRepo), savedConfigs, legacyCleared, confirmed };
}

test('a job with no saved criteria is scored on the default criteria', async () => {
  const { service } = serviceWith({});
  const prompt = await service.getSystemPrompt(1);
  assert.match(prompt, /1\. Technical Skill Alignment \(0–35\)/);
  assert.match(prompt, /\{\{JOB_TITLE\}\}/, 'job placeholders are left for the caller');
  assert.deepEqual(
    { isCustom: service.getScoringConfig(1).isCustom, legacy: service.getScoringConfig(1).isLegacyPromptActive },
    { isCustom: false, legacy: false }
  );
});

test('a job with saved criteria is scored on them', async () => {
  const config = cloneDefaultScoringConfig();
  config.dimensions = [
    { id: 'a', name: 'Frontend Depth', maxPoints: 70, guidance: 'React' },
    { id: 'b', name: 'Everything Else', maxPoints: 30, guidance: '' },
  ];
  const { service } = serviceWith({ scoringConfig: JSON.stringify(config) });

  const prompt = await service.getSystemPrompt(1);
  assert.match(prompt, /1\. Frontend Depth \(0–70\)/);
  assert.equal(prompt.includes('Technical Skill Alignment'), false);
  assert.equal(service.getScoringConfig(1).isCustom, true);
});

test('a hand-written rubric that could not be converted is still used as written', async () => {
  const { service } = serviceWith({ systemPrompt: 'CUSTOM RUBRIC FOR THIS ROLE' });
  assert.equal(await service.getSystemPrompt(1), 'CUSTOM RUBRIC FOR THIS ROLE');
  assert.equal(service.getScoringConfig(1).isLegacyPromptActive, true);
});

test('saved criteria take over from a legacy rubric kept as a backup', async () => {
  const { service } = serviceWith({
    systemPrompt: 'OLD HAND-WRITTEN RUBRIC',
    scoringConfig: JSON.stringify(cloneDefaultScoringConfig()),
  });
  assert.match(await service.getSystemPrompt(1), /Technical Skill Alignment/);
  assert.equal(service.getScoringConfig(1).isLegacyPromptActive, false);
});

test('corrupt stored criteria fall back to the defaults instead of breaking scoring', async () => {
  const { service } = serviceWith({ scoringConfig: '{not json' });
  assert.match(await service.getSystemPrompt(1), /Technical Skill Alignment/);
  assert.equal(service.getScoringConfig(1).isCustom, false);
});

test('saveScoringConfig stores valid criteria as JSON', () => {
  const { service, savedConfigs } = serviceWith({});
  const result = service.saveScoringConfig(1, cloneDefaultScoringConfig());
  assert.deepEqual(result, { ok: true });
  assert.equal(JSON.parse(savedConfigs[0] as string).dimensions.length, 5);
});

test('saveScoringConfig rejects criteria whose points do not total 100 without saving', () => {
  const { service, savedConfigs } = serviceWith({});
  const config = cloneDefaultScoringConfig();
  config.dimensions[0].maxPoints = 50;
  const result = service.saveScoringConfig(1, config);
  assert.equal(result.ok, false);
  assert.deepEqual(savedConfigs, []);
});

test('saveScoringConfig reports an unknown job', () => {
  const { service } = serviceWith(null);
  const result = service.saveScoringConfig(99, cloneDefaultScoringConfig());
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.unknownJob, true);
});

test('resetScoringConfig clears the criteria and any legacy rubric', () => {
  const { service, savedConfigs, legacyCleared } = serviceWith({ systemPrompt: 'OLD' });
  assert.equal(service.resetScoringConfig(7), true);
  assert.deepEqual(savedConfigs, [null]);
  assert.deepEqual(legacyCleared, [7]);
});

test('saving criteria counts as confirming them; a rejected save does not', () => {
  const { service, confirmed } = serviceWith({});
  service.saveScoringConfig(5, cloneDefaultScoringConfig());
  assert.deepEqual(confirmed, [5]);

  const invalid = cloneDefaultScoringConfig();
  invalid.dimensions[0].maxPoints = 99;
  service.saveScoringConfig(6, invalid);
  assert.deepEqual(confirmed, [5], 'an invalid save confirms nothing');
});

test('resetting to the defaults does not undo a confirmation', () => {
  const { service, confirmed } = serviceWith({});
  service.resetScoringConfig(5);
  assert.deepEqual(confirmed, []);
});
