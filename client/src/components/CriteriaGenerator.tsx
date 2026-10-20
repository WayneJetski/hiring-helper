/**
 * CriteriaGenerator
 *
 * Suggests scoring criteria with AI, two ways:
 *   - "Generate from job description": one click, no questions.
 *   - "Help me generate criteria": a short multiple-choice survey tailored to
 *     the role (with a write-your-own option) that shapes the result.
 *
 * Either way the result is a draft shown for review. Applying it fills the
 * editor but saves nothing; the user decides whether to keep it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api.service';
import type {
  ScoringDimension,
  SuggestedCriteria,
  SurveyAnswer,
  SurveyQuestion,
} from '../types/applicant.types';
import {
  OTHER_CHOICE,
  buildAnswers,
  isSurveyComplete,
  type SurveySelection,
} from '../utils/criteriaSurvey';
import { Icon } from './icons/Icon';
import './CriteriaGenerator.css';

interface CriteriaGeneratorProps {
  jobId: number;
  /** Suggestions are based on the saved posting; without one there is nothing to read. */
  hasPosting: boolean;
  /** Called with the chosen areas; the parent fills its editor (nothing is saved). */
  onApply: (dimensions: ScoringDimension[]) => void;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'survey'; questions: SurveyQuestion[]; isGeneric: boolean }
  | { kind: 'review'; criteria: SuggestedCriteria; answers: SurveyAnswer[]; questions: SurveyQuestion[] | null }
  | { kind: 'error'; message: string };

export function CriteriaGenerator({ jobId, hasPosting, onApply }: CriteriaGeneratorProps): JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [selections, setSelections] = useState<SurveySelection[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any request still running if the window is closed or the job changes.
  useEffect(() => () => abortRef.current?.abort(), [jobId]);

  const begin = (): AbortSignal => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    return abortRef.current.signal;
  };

  const fail = (error: unknown, signal: AbortSignal): void => {
    if (signal.aborted) return; // the user cancelled; nothing to report
    setStep({ kind: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
  };

  const generate = useCallback(
    async (answers: SurveyAnswer[], questions: SurveyQuestion[] | null): Promise<void> => {
      const signal = begin();
      setStep({
        kind: 'working',
        label: answers.length > 0 ? 'Building criteria from your answers…' : 'Reading the job posting and drafting criteria…',
      });
      try {
        const criteria = await apiService.suggestCriteria(jobId, answers.length > 0 ? answers : undefined, signal);
        if (!signal.aborted) setStep({ kind: 'review', criteria, answers, questions });
      } catch (error) {
        fail(error, signal);
      }
    },
    [jobId]
  );

  const startSurvey = useCallback(async (): Promise<void> => {
    const signal = begin();
    setStep({ kind: 'working', label: 'Writing a few questions about this role…' });
    try {
      const { questions, isGeneric } = await apiService.getCriteriaQuestions(jobId, signal);
      if (signal.aborted) return;
      setSelections(questions.map(() => ({ choice: null, otherText: '' })));
      setStep({ kind: 'survey', questions, isGeneric });
    } catch (error) {
      fail(error, signal);
    }
  }, [jobId]);

  const cancel = (): void => {
    abortRef.current?.abort();
    setStep({ kind: 'idle' });
  };

  const setSelection = (index: number, change: Partial<SurveySelection>): void => {
    setSelections((current) =>
      current.map((selection, i) => (i === index ? { ...selection, ...change } : selection))
    );
  };

  // ---- idle: the two ways in ----
  if (step.kind === 'idle') {
    return (
      <div className="criteria-generator">
        <h3>
          <Icon name="sparkles" /> Suggest criteria with AI
        </h3>
        <p className="criteria-generator-hint">
          Get a starting point based on this role, then adjust it as you like. Nothing is saved until
          you save.
        </p>
        <div className="criteria-generator-options">
          <button
            type="button"
            className="criteria-generator-option"
            onClick={() => void generate([], null)}
            disabled={!hasPosting}
          >
            <span className="criteria-generator-option-title">Generate from job description</span>
            <span className="criteria-generator-option-text">
              One click. Uses the posting alone, with no questions.
            </span>
          </button>
          <button
            type="button"
            className="criteria-generator-option"
            onClick={() => void startSurvey()}
            disabled={!hasPosting}
          >
            <span className="criteria-generator-option-title">Help me generate criteria</span>
            <span className="criteria-generator-option-text">
              Answer a few quick questions first, so the result reflects what matters to you.
            </span>
          </button>
        </div>
        {!hasPosting && (
          <p className="criteria-generator-warning">
            <Icon name="alertTriangle" /> Load or paste the job posting (and save it) first. The
            suggestions are based on it.
          </p>
        )}
      </div>
    );
  }

  // ---- working ----
  if (step.kind === 'working') {
    return (
      <div className="criteria-generator" role="status" aria-live="polite">
        <p className="criteria-generator-working">
          <Icon name="loader" isSpinning /> {step.label}
        </p>
        <p className="criteria-generator-hint">This usually takes 10 to 30 seconds.</p>
        <button type="button" className="criteria-generator-secondary" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  // ---- error ----
  if (step.kind === 'error') {
    return (
      <div className="criteria-generator">
        <p className="criteria-generator-error" role="alert">
          <Icon name="xCircle" /> {step.message}
        </p>
        <button type="button" className="criteria-generator-secondary" onClick={() => setStep({ kind: 'idle' })}>
          Back
        </button>
      </div>
    );
  }

  // ---- survey ----
  if (step.kind === 'survey') {
    const { questions } = step;
    const canGenerate = isSurveyComplete(questions, selections);
    return (
      <div className="criteria-generator">
        <h3>A few quick questions</h3>
        <p className="criteria-generator-hint">
          {step.isGeneric
            ? 'These are general questions, because role-specific ones could not be written this time. '
            : 'Written for this role. '}
          Pick the closest answer, or write your own.
        </p>

        <ol className="criteria-survey">
          {questions.map((question, index) => {
            const selection = selections[index];
            return (
              <li key={question.question} className="criteria-survey-question">
                <fieldset>
                  <legend>{question.question}</legend>
                  {question.options.map((option, optionIndex) => (
                    <label key={option} className="criteria-survey-option">
                      <input
                        type="radio"
                        name={`criteria-q-${index}`}
                        checked={selection?.choice === optionIndex}
                        onChange={() => setSelection(index, { choice: optionIndex })}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                  <label className="criteria-survey-option">
                    <input
                      type="radio"
                      name={`criteria-q-${index}`}
                      checked={selection?.choice === OTHER_CHOICE}
                      onChange={() => setSelection(index, { choice: OTHER_CHOICE })}
                    />
                    <span>Other (write your own)</span>
                  </label>
                  {selection?.choice === OTHER_CHOICE && (
                    <input
                      type="text"
                      className="criteria-survey-other"
                      value={selection.otherText}
                      maxLength={300}
                      onChange={(event) => setSelection(index, { otherText: event.target.value })}
                      placeholder="Your answer"
                      aria-label={`Your own answer to: ${question.question}`}
                      autoFocus
                    />
                  )}
                </fieldset>
              </li>
            );
          })}
        </ol>

        <div className="criteria-generator-buttons">
          <button
            type="button"
            className="criteria-generator-primary"
            onClick={() => void generate(buildAnswers(questions, selections), questions)}
            disabled={!canGenerate}
          >
            Generate criteria
          </button>
          <button type="button" className="criteria-generator-secondary" onClick={cancel}>
            Cancel
          </button>
          {!canGenerate && <span className="criteria-generator-hint">Answer every question to continue.</span>}
        </div>
      </div>
    );
  }

  // ---- review ----
  const { criteria, answers, questions } = step;
  return (
    <div className="criteria-generator">
      <h3>Suggested criteria</h3>
      {criteria.summary && <p className="criteria-generator-summary">{criteria.summary}</p>}

      <ol className="criteria-review">
        {criteria.dimensions.map((dimension) => (
          <li key={dimension.id} className="criteria-review-area">
            <div className="criteria-review-top">
              <span className="criteria-review-name">{dimension.name}</span>
              <span className="criteria-review-points">{dimension.maxPoints} points</span>
            </div>
            <ul>
              {dimension.guidance
                .split('\n')
                .filter((line) => line.trim() !== '')
                .map((line) => (
                  <li key={line}>{line}</li>
                ))}
            </ul>
          </li>
        ))}
      </ol>

      <div className="criteria-generator-buttons">
        <button
          type="button"
          className="criteria-generator-primary"
          onClick={() => {
            onApply(criteria.dimensions);
            setStep({ kind: 'idle' });
          }}
        >
          Use these criteria
        </button>
        <button
          type="button"
          className="criteria-generator-secondary"
          onClick={() => void generate(answers, questions)}
        >
          Try again
        </button>
        {questions && (
          <button
            type="button"
            className="criteria-generator-secondary"
            onClick={() => setStep({ kind: 'survey', questions, isGeneric: false })}
          >
            Change my answers
          </button>
        )}
        <button type="button" className="criteria-generator-link" onClick={() => setStep({ kind: 'idle' })}>
          Discard
        </button>
      </div>
      <p className="criteria-generator-hint">
        Using these fills in the editor below. You can still change anything, and nothing is saved
        until you press Save.
      </p>
    </div>
  );
}
