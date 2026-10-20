/**
 * Tests for the pure parts of AI criteria generation. No model is run.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXAMPLE_CRITERIA,
  FALLBACK_QUESTIONS,
  buildCriteriaPrompt,
  buildQuestionsPrompt,
  extractJson,
  normalizePoints,
  parseCriteriaResponse,
  parseQuestionsResponse,
  validateSurveyAnswers,
} from './rubric-generation.js';
import { DEFAULT_SCORING_CONFIG, totalPoints, validateScoringConfig } from './scoring-config.js';

// ---- the example we show the model ----

test('the example criteria are themselves valid and total 100', () => {
  const dimensions = EXAMPLE_CRITERIA.dimensions.map((d, i) => ({ id: `e${i}`, ...d }));
  assert.equal(totalPoints(dimensions), 100);
  assert.equal(validateScoringConfig({ dimensions, redFlags: DEFAULT_SCORING_CONFIG.redFlags }).ok, true);
});

test('the fallback survey is a usable size', () => {
  assert.ok(FALLBACK_QUESTIONS.length >= 3 && FALLBACK_QUESTIONS.length <= 5);
  assert.ok(FALLBACK_QUESTIONS.every((q) => q.options.length >= 2));
});

// ---- extracting JSON ----

test('extracts JSON from plain text, a code fence, or surrounding prose', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Here you go:\n{"a":3}\nHope that helps'), { a: 3 });
  assert.equal(extractJson('no json here'), null);
});

// ---- normalizing points ----

test('leaves points that already total 100 unchanged', () => {
  assert.deepEqual(normalizePoints([40, 30, 20, 10]), [40, 30, 20, 10]);
});

test('scales points that are off so they total exactly 100, keeping proportions', () => {
  const result = normalizePoints([35, 30, 20, 10]); // 95
  assert.equal(result?.reduce((a, b) => a + b, 0), 100);
  assert.ok(result && result[0] > result[1] && result[1] > result[2] && result[2] > result[3]);
});

test('gives every area at least one point and still totals 100', () => {
  const result = normalizePoints([1, 1, 1, 200]);
  assert.equal(result?.reduce((a, b) => a + b, 0), 100);
  assert.ok(result?.every((points) => points >= 1));
});

test('rejects unusable points', () => {
  assert.equal(normalizePoints([]), null);
  assert.equal(normalizePoints([0, 10]), null);
  assert.equal(normalizePoints([Number.NaN, 10]), null);
});

// ---- parsing the survey ----

const goodQuestions = {
  questions: [
    { question: 'Which matters more?', options: ['Depth', 'Breadth', 'Depth'] },
    { question: 'Seniority?', options: ['Junior', 'Senior'] },
    { question: 'Background?', options: ['Direct', 'Transferable', 'Either'] },
  ],
};

test('parses a survey and removes duplicate options', () => {
  const result = parseQuestionsResponse(JSON.stringify(goodQuestions));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.length, 3);
    assert.deepEqual(result.value[0].options, ['Depth', 'Breadth']);
  }
});

test('keeps at most five questions', () => {
  const many = { questions: Array.from({ length: 8 }, (_, i) => ({ question: `Q${i}?`, options: ['a', 'b'] })) };
  const result = parseQuestionsResponse(JSON.stringify(many));
  assert.equal(result.ok && result.value.length, 5);
});

test('rejects a survey with too few usable questions', () => {
  const sparse = { questions: [{ question: 'Only one?', options: ['a', 'b'] }, { question: '', options: ['a', 'b'] }, { question: 'No options?', options: ['a'] }] };
  assert.equal(parseQuestionsResponse(JSON.stringify(sparse)).ok, false);
  assert.equal(parseQuestionsResponse('not json').ok, false);
});

// ---- parsing criteria ----

test('parses generated criteria that total 100', () => {
  const result = parseCriteriaResponse(JSON.stringify(EXAMPLE_CRITERIA));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(totalPoints(result.value.dimensions), 100);
    assert.equal(result.value.dimensions[0].name, 'Core Technical Skills');
    assert.match(result.value.summary, /carry most of the weight/);
  }
});

test('repairs weights that are slightly off instead of failing', () => {
  const off = { dimensions: EXAMPLE_CRITERIA.dimensions.map((d, i) => (i === 0 ? { ...d, maxPoints: 35 } : d)) }; // totals 105
  const result = parseCriteriaResponse(JSON.stringify(off));
  assert.equal(result.ok && totalPoints(result.value.dimensions), 100);
});

test('accepts guidance given as a list of lines', () => {
  const listy = { dimensions: [{ name: 'Skills', maxPoints: 100, guidance: ['one', 'two'] }] };
  const result = parseCriteriaResponse(JSON.stringify(listy));
  assert.equal(result.ok && result.value.dimensions[0].guidance, 'one\ntwo');
});

test('rejects replies with no areas, a nameless area, or too many areas', () => {
  assert.equal(parseCriteriaResponse('{}').ok, false);
  assert.equal(parseCriteriaResponse(JSON.stringify({ dimensions: [{ name: '  ', maxPoints: 100, guidance: '' }] })).ok, false);
  const twelve = { dimensions: Array.from({ length: 12 }, (_, i) => ({ name: `A${i}`, maxPoints: 8, guidance: '' })) };
  assert.equal(parseCriteriaResponse(JSON.stringify(twelve)).ok, false);
});

// ---- survey answers from the browser ----

test('validates survey answers', () => {
  assert.equal(validateSurveyAnswers([{ question: 'Q?', answer: 'A' }]).ok, true);
  assert.equal(validateSurveyAnswers([]).ok, false);
  assert.equal(validateSurveyAnswers([{ question: 'Q?', answer: '  ' }]).ok, false);
  assert.equal(validateSurveyAnswers([{ question: 'Q?', answer: 'x'.repeat(301) }]).ok, false);
  assert.equal(validateSurveyAnswers('nope').ok, false);
});

// ---- prompts ----

const job = { title: 'Product Operations Analyst', description: 'Own dashboards and planning.' };

test('the survey prompt contains the role and asks for multiple-choice questions as JSON', () => {
  const prompt = buildQuestionsPrompt(job);
  assert.match(prompt, /Product Operations Analyst/);
  assert.match(prompt, /Own dashboards and planning/);
  assert.match(prompt, /multiple-choice/);
  assert.match(prompt, /"questions"/);
});

test('the criteria prompt works with no answers (generate straight from the posting)', () => {
  const prompt = buildCriteriaPrompt(job);
  assert.match(prompt, /total exactly 100/);
  assert.match(prompt, /Core Technical Skills/, 'includes the example');
  assert.equal(prompt.includes('answered these questions'), false);
});

test('the criteria prompt includes the survey answers and tells the model to follow them', () => {
  const prompt = buildCriteriaPrompt(job, [{ question: 'Seniority?', answer: 'Senior (7+ years)' }]);
  assert.match(prompt, /Follow their answers over your own assumptions/);
  assert.match(prompt, /Q: Seniority\?\n {2}A: Senior \(7\+ years\)/);
});

test('flags are kept out of the generated areas', () => {
  assert.match(buildCriteriaPrompt(job), /Do NOT make areas for these, because they are handled separately as flags/);
});

test('a very long posting is truncated in the prompt', () => {
  const long = { title: 'X', description: 'word '.repeat(10000) };
  assert.match(buildCriteriaPrompt(long), /\[posting truncated\]/);
});

test('the example criteria keep soft areas small so they are not over-weighted', () => {
  const soft = EXAMPLE_CRITERIA.dimensions.filter((d) =>
    /communication|motivation|résumé/i.test(d.name)
  );
  assert.equal(soft.length, 3);
  assert.ok(soft.reduce((sum, d) => sum + d.maxPoints, 0) <= 15);
  assert.equal(EXAMPLE_CRITERIA.dimensions.reduce((sum, d) => sum + d.maxPoints, 0), 100);
});

test('the criteria prompt asks for alternative evidence, independent areas and no harsh deductions', () => {
  const prompt = buildCriteriaPrompt(job);
  assert.match(prompt, /alternative ways to earn points, not a checklist/);
  assert.match(prompt, /named tools[^.]*examples/);
  assert.match(prompt, /Keep the areas independent/);
  assert.match(prompt, /Do not write harsh deductions/);
  assert.equal(/what to discount/.test(prompt), false);
  assert.match(prompt, /between 4 and 6 evaluation areas/);
});
