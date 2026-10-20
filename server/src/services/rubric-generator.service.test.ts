/**
 * Tests for RubricGeneratorService with a fake runner and job store (no model).
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GeneratorBusyError,
  JobNotFoundError,
  MissingPostingError,
  RubricGeneratorService,
  UnusableSuggestionError,
} from './rubric-generator.service.js';
import { EXAMPLE_CRITERIA, FALLBACK_QUESTIONS } from '../scoring/rubric-generation.js';

class ScriptedRunner {
  prompts: string[] = [];
  constructor(private replies: Array<string | (() => Promise<string>)>) {}
  async run(prompt: string): Promise<string> {
    this.prompts.push(prompt);
    const next = this.replies.shift();
    if (next === undefined) throw new Error('unexpected extra call');
    return typeof next === 'function' ? next() : next;
  }
}

interface FakeJobStore {
  getById(id: number): { title: string; description?: string } | null;
}

const jobStore = (description: string | undefined = 'Own the dashboards.'): FakeJobStore => ({
  getById: (id: number): { title: string; description?: string } | null =>
    id === 1 ? { title: 'Analyst', description } : null,
});

const goodQuestions = JSON.stringify({
  questions: [
    { question: 'Seniority?', options: ['Junior', 'Senior'] },
    { question: 'Depth or breadth?', options: ['Depth', 'Breadth'] },
    { question: 'Background?', options: ['Direct', 'Transferable'] },
  ],
});
const goodCriteria = JSON.stringify(EXAMPLE_CRITERIA);

test('suggests tailored survey questions from the posting', async () => {
  const runner = new ScriptedRunner([goodQuestions]);
  const result = await new RubricGeneratorService(runner, jobStore()).suggestQuestions(1);
  assert.equal(result.isGeneric, false);
  assert.equal(result.questions.length, 3);
  assert.match(runner.prompts[0], /Own the dashboards/);
});

test('falls back to a general survey when the reply is unusable, rather than failing', async () => {
  const runner = new ScriptedRunner(['sorry, I cannot']);
  const result = await new RubricGeneratorService(runner, jobStore()).suggestQuestions(1);
  assert.equal(result.isGeneric, true);
  assert.deepEqual(result.questions, FALLBACK_QUESTIONS);
});

test('generates criteria straight from the posting with no answers', async () => {
  const runner = new ScriptedRunner([goodCriteria]);
  const result = await new RubricGeneratorService(runner, jobStore()).suggestCriteria(1);
  assert.equal(result.dimensions.reduce((sum, d) => sum + d.maxPoints, 0), 100);
  assert.equal(runner.prompts[0].includes('answered these questions'), false);
});

test('survey answers are passed into the prompt', async () => {
  const runner = new ScriptedRunner([goodCriteria]);
  await new RubricGeneratorService(runner, jobStore()).suggestCriteria(1, [{ question: 'Seniority?', answer: 'Senior' }]);
  assert.match(runner.prompts[0], /A: Senior/);
});

test('retries once when the first criteria reply cannot be read, then succeeds', async () => {
  const runner = new ScriptedRunner(['not json at all', goodCriteria]);
  const result = await new RubricGeneratorService(runner, jobStore()).suggestCriteria(1);
  assert.equal(result.dimensions.length, 6);
  assert.equal(runner.prompts.length, 2);
  assert.match(runner.prompts[1], /previous reply could not be used/);
});

test('gives up after one retry with a plain error', async () => {
  const runner = new ScriptedRunner(['nope', 'still nope']);
  await assert.rejects(new RubricGeneratorService(runner, jobStore()).suggestCriteria(1), UnusableSuggestionError);
});

test('needs a posting to base suggestions on, and a real job', () => {
  const noPosting = new RubricGeneratorService(new ScriptedRunner([]), jobStore('   '));
  assert.throws(() => noPosting.suggestCriteria(1), MissingPostingError);
  assert.throws(() => noPosting.suggestQuestions(1), MissingPostingError);
  assert.throws(() => new RubricGeneratorService(new ScriptedRunner([]), jobStore()).suggestCriteria(99), JobNotFoundError);
});

test('only one generation runs at a time, and the lock is released afterwards', async () => {
  let release: (value: string) => void = () => {};
  const slow = (): Promise<string> => new Promise((resolve) => (release = resolve));
  const runner = new ScriptedRunner([slow, goodCriteria]);
  const service = new RubricGeneratorService(runner, jobStore());

  const first = service.suggestCriteria(1);
  await assert.rejects(service.suggestCriteria(1), GeneratorBusyError);

  release(goodCriteria);
  await first;
  await service.suggestCriteria(1); // the lock was released
});

test('the lock is released even when a run fails', async () => {
  const failing = (): Promise<string> => Promise.reject(new Error('boom'));
  const runner = new ScriptedRunner([failing, goodCriteria]);
  const service = new RubricGeneratorService(runner, jobStore());
  await assert.rejects(service.suggestCriteria(1), /boom/);
  await service.suggestCriteria(1);
});
