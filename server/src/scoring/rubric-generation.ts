/**
 * Generating scoring criteria with AI.
 *
 * Pure helpers for the two prompts (a short survey tailored to the role, then
 * the criteria themselves) and for turning the model's text back into validated
 * data. Running the model is done elsewhere (ClaudeRunner), so everything here is
 * testable without a process or network.
 *
 * Output is only ever a DRAFT of evaluation areas: a person reviews it in the
 * editor and saves it. Red flags are fixed toggles and are not generated.
 */

import {
  DEFAULT_SCORING_CONFIG,
  MAX_DIMENSIONS,
  TOTAL_POINTS,
  validateScoringConfig,
  type ScoringDimension,
} from './scoring-config.js';

export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 5;
const MAX_QUESTION_LENGTH = 300;
const MAX_OPTION_LENGTH = 140;
const MAX_ANSWER_LENGTH = 300;
const MAX_POSTING_CHARS = 12000;

export interface SurveyQuestion {
  question: string;
  options: string[];
}

export interface SurveyAnswer {
  question: string;
  answer: string;
}

export interface GeneratedCriteria {
  dimensions: ScoringDimension[];
  /** One short paragraph on why the areas and weights were chosen. */
  summary: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * An example of a well-formed set of criteria, shown to the model so its output
 * has the right shape and level of detail. It is deliberately about no particular
 * profession: weights follow priorities, guidance names observable résumé
 * evidence, and the areas total exactly 100.
 */
export const EXAMPLE_CRITERIA = {
  dimensions: [
    {
      name: 'Core Technical Skills',
      maxPoints: 35,
      guidance:
        'Hands-on proficiency in the tools, languages or methods the posting names as required\nRecent use (last 2 to 3 years), not just a keyword in a skills list\nConcrete projects or results that show the skill applied',
    },
    {
      name: 'Relevant Experience & Seniority',
      maxPoints: 30,
      guidance:
        'Level of responsibility matches the role (scope, team size, autonomy)\nTime spent in comparable roles or environments\nProgression over time rather than repeated lateral moves',
    },
    {
      name: 'Impact & Problem Solving',
      maxPoints: 20,
      guidance:
        "Measurable outcomes (numbers, timelines, scale) tied to the candidate's own work\nExamples of owning a problem from start to finish\nImprovements to systems or processes that they led",
    },
    {
      name: 'Communication & Collaboration',
      maxPoints: 8,
      guidance:
        'Evidence of working with other teams or stakeholders\nClear, well-organized writing in the résumé and cover letter\nMentoring, presenting or documentation work',
    },
    {
      name: 'Motivation & Role Fit',
      maxPoints: 4,
      guidance:
        'Interest in this domain shown by career choices, not slogans\nCareer direction consistent with this role',
    },
    {
      name: 'Résumé Quality',
      maxPoints: 3,
      guidance: 'Clear structure, consistent formatting and accurate details',
    },
  ],
  summary:
    'Skills and relevant experience carry most of the weight because the posting makes them required. Impact is next because the role is judged on outcomes. Communication and fit matter but are easier to develop, so they carry less.',
};

// ---------------------------------------------------------------------------
// Reading model output
// ---------------------------------------------------------------------------

/** Pull a JSON object out of model text that may be wrapped in a code fence or prose. */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Scale whole-number points so they total exactly 100, keeping proportions
 * (largest-remainder method) and at least 1 point each. Used when the model's
 * weights are close but do not add up.
 */
export function normalizePoints(points: number[]): number[] | null {
  if (points.length === 0 || points.length > TOTAL_POINTS) return null;
  const sum = points.reduce((total, value) => total + value, 0);
  if (!points.every((value) => Number.isFinite(value) && value > 0) || sum <= 0) return null;

  const exact = points.map((value) => (value * TOTAL_POINTS) / sum);
  const result = exact.map((value) => Math.max(1, Math.floor(value)));
  let difference = TOTAL_POINTS - result.reduce((total, value) => total + value, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; difference > 0; i = (i + 1) % byRemainder.length) {
    result[byRemainder[i].index] += 1;
    difference -= 1;
  }
  // The "at least 1" floor can overshoot; take the surplus from the largest areas.
  while (difference < 0) {
    const largest = result.indexOf(Math.max(...result));
    if (result[largest] <= 1) return null;
    result[largest] -= 1;
    difference += 1;
  }
  return result;
}

export function parseQuestionsResponse(text: string): ParseResult<SurveyQuestion[]> {
  const parsed = extractJson(text);
  const raw = isRecord(parsed) ? parsed.questions : undefined;
  if (!Array.isArray(raw)) return { ok: false, error: 'The reply did not contain a list of questions.' };

  const questions: SurveyQuestion[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.question !== 'string' || !Array.isArray(item.options)) continue;
    const question = item.question.trim();
    const options = [
      ...new Set(
        item.options
          .filter((option): option is string => typeof option === 'string')
          .map((option) => option.trim())
          .filter((option) => option !== '' && option.length <= MAX_OPTION_LENGTH)
      ),
    ].slice(0, 5);
    if (question === '' || question.length > MAX_QUESTION_LENGTH || options.length < 2) continue;
    questions.push({ question, options });
  }

  if (questions.length < MIN_QUESTIONS) {
    return { ok: false, error: `Expected at least ${MIN_QUESTIONS} usable questions.` };
  }
  return { ok: true, value: questions.slice(0, MAX_QUESTIONS) };
}

/** Questions to fall back on when the model cannot supply role-specific ones. */
export const FALLBACK_QUESTIONS: SurveyQuestion[] = [
  {
    question: 'What level of experience are you hiring for?',
    options: ['Early career (0 to 2 years)', 'Mid-level (3 to 6 years)', 'Senior (7 or more years)', 'Mixed, depending on the person'],
  },
  {
    question: 'Which matters most when comparing candidates?',
    options: [
      'Depth in the specific skills and tools named in the posting',
      'Results and impact in past roles',
      'Breadth across related areas',
      'Potential to learn quickly',
    ],
  },
  {
    question: 'How should candidates from a different background or industry be treated?',
    options: [
      'Prefer direct experience in this field',
      'Welcome them if their skills transfer',
      'Treat them the same as everyone else',
    ],
  },
  {
    question: 'How important is communication and working with other teams in this role?',
    options: ['Central to the job', 'Important but not the main thing', 'A minor factor'],
  },
];

export function parseCriteriaResponse(text: string): ParseResult<GeneratedCriteria> {
  const parsed = extractJson(text);
  const raw = isRecord(parsed) ? parsed.dimensions : undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'The reply did not contain any evaluation areas.' };
  }
  if (raw.length > MAX_DIMENSIONS) return { ok: false, error: 'The reply had too many evaluation areas.' };

  const drafts: Array<{ name: string; points: number; guidance: string }> = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.name !== 'string') return { ok: false, error: 'An evaluation area was malformed.' };
    const points = typeof item.maxPoints === 'number' ? item.maxPoints : Number(item.maxPoints);
    const guidance = Array.isArray(item.guidance)
      ? item.guidance.filter((line): line is string => typeof line === 'string').join('\n')
      : typeof item.guidance === 'string'
        ? item.guidance
        : '';
    drafts.push({ name: item.name.trim(), points, guidance: guidance.trim() });
  }

  const normalized = normalizePoints(drafts.map((draft) => Math.round(draft.points)));
  if (!normalized) return { ok: false, error: 'The evaluation areas had unusable point values.' };

  const dimensions: ScoringDimension[] = drafts.map((draft, index) => ({
    id: `generated-${index + 1}`,
    name: draft.name,
    maxPoints: normalized[index],
    guidance: draft.guidance,
  }));

  // Run it through the same rules a saved configuration must meet.
  const validated = validateScoringConfig({ dimensions, redFlags: DEFAULT_SCORING_CONFIG.redFlags });
  if (!validated.ok) return { ok: false, error: validated.error };

  const summary = isRecord(parsed) && typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  return { ok: true, value: { dimensions: validated.config.dimensions, summary } };
}

/** Check survey answers sent by the browser before they are placed in a prompt. */
export function validateSurveyAnswers(input: unknown): ParseResult<SurveyAnswer[]> {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_QUESTIONS) {
    return { ok: false, error: `Send between 1 and ${MAX_QUESTIONS} answers.` };
  }
  const answers: SurveyAnswer[] = [];
  for (const item of input) {
    const question = isRecord(item) && typeof item.question === 'string' ? item.question.trim() : '';
    const answer = isRecord(item) && typeof item.answer === 'string' ? item.answer.trim() : '';
    if (question === '' || question.length > MAX_QUESTION_LENGTH) return { ok: false, error: 'A question was missing or too long.' };
    if (answer === '' || answer.length > MAX_ANSWER_LENGTH) {
      return { ok: false, error: 'Every question needs an answer of up to 300 characters.' };
    }
    answers.push({ question, answer });
  }
  return { ok: true, value: answers };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function jobBlock(title: string, posting: string): string {
  const clipped = posting.length > MAX_POSTING_CHARS ? `${posting.slice(0, MAX_POSTING_CHARS)}\n[posting truncated]` : posting;
  return ['=== JOB ===', `Title: ${title}`, '', 'Posting:', clipped, '==========='].join('\n');
}

export function buildQuestionsPrompt(job: { title: string; description: string }): string {
  return [
    'You help an HR team decide how job applicants should be scored.',
    'Write a short survey that will let you tailor the scoring criteria to THIS role.',
    '',
    jobBlock(job.title, job.description),
    '',
    `Write between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} multiple-choice questions. Each question has 3 to 5 short, clearly different options.`,
    'Ask about the trade-offs the posting leaves open, for example: which skills are must-haves versus trainable, the seniority really expected, depth versus breadth, how to treat a candidate from a different background, or what should outweigh what.',
    'Do not ask about anything the posting already answers clearly. Do not ask about pay, benefits, or protected characteristics. Use plain language an HR coordinator would understand.',
    '',
    'Respond with ONLY a JSON object, no commentary and no code fence, in exactly this shape:',
    '{"questions":[{"question":"...","options":["...","...","..."]}]}',
  ].join('\n');
}

export function buildCriteriaPrompt(
  job: { title: string; description: string },
  answers: SurveyAnswer[] = []
): string {
  const lines = [
    'You help an HR team decide how job applicants are scored.',
    'Design the evaluation criteria used to score each applicant\'s résumé for THIS role. An applicant earns points in each area; the points across all areas total exactly 100.',
    '',
    jobBlock(job.title, job.description),
    '',
  ];

  if (answers.length > 0) {
    lines.push(
      'The hiring team answered these questions about the role. Follow their answers over your own assumptions:',
      ...answers.map((item) => `- Q: ${item.question}\n  A: ${item.answer}`),
      ''
    );
  }

  lines.push(
    'Rules:',
    `- Use between 4 and 6 evaluation areas. The maxPoints are whole numbers that total exactly ${TOTAL_POINTS}.`,
    '- Give more points to what matters most for this role. Do not spread points evenly out of caution.',
    '- Name each area in a few words. Give each 2 to 4 short guidance lines naming observable evidence in a résumé (what to look for, and what counts only partially), not generic virtues.',
    '- Base the areas on the posting itself: its required skills, responsibilities and seniority. Give required items more weight than preferred ones.',
    '- Keep soft areas (culture, motivation, communication, résumé presentation) small, about 15 points together at most: a résumé shows little about them, so they separate candidates poorly.',
    '- Write guidance as what earns credit. Do not write harsh deductions; partial or adjacent experience should still earn partial points.',
    '- Guidance lines are alternative ways to earn points, not a checklist. A candidate who shows some of the lines should earn a solid share of the area, and full marks should not need every line. A solid, well-matched candidate should be able to earn roughly 70 to 85 percent of each area.',
    '- Treat named tools, methods and employers as examples ("such as"), not requirements: a comparable tool or situation earns credit.',
    '- Keep the areas independent. Do not make several areas reward the same evidence (for example, working with product managers in three places), because one missing background would then cost points in each of them. Merge areas that look for the same thing.',
    '- Do not turn every bullet of the posting into its own area; group related requirements and weight the groups.',
    '- Do NOT make areas for these, because they are handled separately as flags: location, name capitalization, being a student, lack of relevant experience, short job tenures or gaps.',
    '',
    'Here is an example of the expected shape and level of detail for a different role. Do not copy its areas; match its quality:',
    JSON.stringify(EXAMPLE_CRITERIA, null, 2),
    '',
    'Respond with ONLY a JSON object, no commentary and no code fence, with the keys "dimensions" (a list of {name, maxPoints, guidance}, guidance lines separated by \\n) and "summary" (one or two sentences on why you chose these areas and weights).'
  );
  return lines.join('\n');
}
