/**
 * Turning survey selections into the answers sent with a criteria suggestion.
 * Each question is answered by picking an option or writing one's own ("Other").
 */

import type { SurveyAnswer, SurveyQuestion } from '../types/applicant.types';

export const OTHER_CHOICE = 'other' as const;
export const MAX_ANSWER_LENGTH = 300;

export interface SurveySelection {
  /** Index of the chosen option, or "other" for a written answer. */
  choice: number | typeof OTHER_CHOICE | null;
  otherText: string;
}

/** The answer text for one question, or null while it is unanswered. */
export function answerFor(question: SurveyQuestion, selection: SurveySelection | undefined): string | null {
  if (!selection || selection.choice === null) return null;
  if (selection.choice === OTHER_CHOICE) {
    const text = selection.otherText.trim();
    return text === '' ? null : text.slice(0, MAX_ANSWER_LENGTH);
  }
  return question.options[selection.choice] ?? null;
}

export function isSurveyComplete(questions: SurveyQuestion[], selections: SurveySelection[]): boolean {
  return questions.length > 0 && questions.every((question, index) => answerFor(question, selections[index]) !== null);
}

/** Answers in question order; questions still unanswered are left out. */
export function buildAnswers(questions: SurveyQuestion[], selections: SurveySelection[]): SurveyAnswer[] {
  return questions.flatMap((question, index) => {
    const answer = answerFor(question, selections[index]);
    return answer === null ? [] : [{ question: question.question, answer }];
  });
}
