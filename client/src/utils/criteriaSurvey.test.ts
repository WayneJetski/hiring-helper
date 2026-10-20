import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OTHER_CHOICE, buildAnswers, isSurveyComplete, type SurveySelection } from './criteriaSurvey.js';
import type { SurveyQuestion } from '../types/applicant.types';

const questions: SurveyQuestion[] = [
  { question: 'Seniority?', options: ['Junior', 'Senior'] },
  { question: 'Depth or breadth?', options: ['Depth', 'Breadth'] },
];

test('a chosen option becomes the answer text', () => {
  const selections: SurveySelection[] = [
    { choice: 1, otherText: '' },
    { choice: 0, otherText: '' },
  ];
  assert.deepEqual(buildAnswers(questions, selections), [
    { question: 'Seniority?', answer: 'Senior' },
    { question: 'Depth or breadth?', answer: 'Depth' },
  ]);
});

test('"Other" uses the written text, trimmed', () => {
  const selections: SurveySelection[] = [
    { choice: OTHER_CHOICE, otherText: '  Someone who can mentor  ' },
    { choice: 0, otherText: '' },
  ];
  assert.equal(buildAnswers(questions, selections)[0].answer, 'Someone who can mentor');
});

test('"Other" with nothing written does not count as answered', () => {
  const selections: SurveySelection[] = [
    { choice: OTHER_CHOICE, otherText: '   ' },
    { choice: 0, otherText: '' },
  ];
  assert.equal(isSurveyComplete(questions, selections), false);
  assert.equal(buildAnswers(questions, selections).length, 1);
});

test('the survey is complete only when every question is answered', () => {
  assert.equal(isSurveyComplete(questions, [{ choice: 0, otherText: '' }]), false);
  assert.equal(isSurveyComplete(questions, [{ choice: 0, otherText: '' }, { choice: null, otherText: '' }]), false);
  assert.equal(
    isSurveyComplete(questions, [{ choice: 0, otherText: '' }, { choice: OTHER_CHOICE, otherText: 'x' }]),
    true
  );
  assert.equal(isSurveyComplete([], []), false);
});

test('an over-long written answer is cut to the limit the server accepts', () => {
  const selections: SurveySelection[] = [{ choice: OTHER_CHOICE, otherText: 'x'.repeat(500) }];
  assert.equal(buildAnswers([questions[0]], selections)[0].answer.length, 300);
});
