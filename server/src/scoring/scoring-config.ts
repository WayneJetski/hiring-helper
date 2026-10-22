/**
 * Scoring configuration
 *
 * The part of the scoring rubric a user may change, kept as structured data
 * instead of a raw prompt: the weighted evaluation framework and which red flags
 * are on (location with a locale), each with a penalty level. The model never
 * adjusts its score for a flag; the app applies the penalty afterwards (see
 * flag-penalties.ts). Everything else in the rubric (safety
 * instructions, scoring rules, the JSON output format) lives in the fixed
 * template `server/prompts/ai-evaluation-system.txt` and is never exposed.
 *
 * This module is pure: validation, composing the final rubric from the template,
 * and converting a legacy hand-written rubric into a config.
 */

export interface ScoringDimension {
  /** Stable key for the editor; not shown to the model. */
  id: string;
  name: string;
  /** Maximum points this area contributes; all areas must total 100. */
  maxPoints: number;
  /** What to look for, one point per line. */
  guidance: string;
}

/** How much a red flag lowers the score when it applies. */
export const FLAG_PENALTIES = ['none', 'bit', 'lot', 'dealbreaker'] as const;
export type FlagPenalty = (typeof FLAG_PENALTIES)[number];

export interface RedFlagSetting {
  enabled: boolean;
  /** Score penalty when the flag applies. Absent in older saved configs, which means 'none'. */
  penalty: FlagPenalty;
}

/**
 * A flag the app works out itself from the applicant's desired-pay answer (the
 * model does not judge it, so it is not in the rubric). Off until a yearly
 * threshold is entered.
 */
export interface SalaryFlagSetting extends RedFlagSetting {
  /** Yearly pay in dollars: low flags pay below it, high flags pay above it. */
  threshold: number | null;
}

export interface ScoringConfig {
  dimensions: ScoringDimension[];
  redFlags: {
    /** Name is improperly capitalized (judged on the submitted name only). */
    nameCapitalization: RedFlagSetting;
    /** Candidate is not in the role's area. */
    location: RedFlagSetting & { locale: string };
    /** Currently a student. */
    studying: RedFlagSetting;
    /** No relevant professional experience. */
    noExperience: RedFlagSetting;
    /** A pattern of short tenures, or unexplained gaps between roles. */
    tenureGaps: RedFlagSetting;
    /** Desired pay below the threshold (checked by the app, not the model). */
    salaryLow: SalaryFlagSetting;
    /** Desired pay above the threshold (checked by the app, not the model). */
    salaryHigh: SalaryFlagSetting;
  };
}

export const TOTAL_POINTS = 100;
export const MAX_DIMENSIONS = 10;
const MAX_NAME_LENGTH = 80;
const MAX_GUIDANCE_LENGTH = 1500;
const MAX_LOCALE_LENGTH = 150;
const MAX_SALARY_THRESHOLD = 10_000_000;

/** The rubric as it shipped before it became configurable. */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  dimensions: [
    {
      id: 'technical',
      name: 'Technical Skill Alignment',
      maxPoints: 35,
      guidance:
        'Proficiency and recency in the languages, frameworks, and technologies the posting requires (preferred ones count for less)\nEvidence of applied expertise through projects or measurable accomplishments',
    },
    {
      id: 'role',
      name: 'Role & Experience Match',
      maxPoints: 30,
      guidance:
        'Alignment of seniority, responsibilities, and environment\nContinuous and relevant work experience',
    },
    {
      id: 'impact',
      name: 'Problem-Solving & Impact',
      maxPoints: 20,
      guidance:
        'Ownership, measurable results, system improvements, or complex problem resolution',
    },
    {
      id: 'culture',
      name: 'Cultural & Motivational Fit',
      maxPoints: 5,
      guidance:
        'Communication and motivation shown by career choices and how the experience is described, not by slogans (a résumé rarely shows more; no signal either way is a middling score)',
    },
    {
      id: 'presentation',
      name: 'Professional Presentation',
      maxPoints: 10,
      guidance: 'Resume/cover letter clarity, grammar, structure, and reliability indicators',
    },
  ],
  redFlags: {
    nameCapitalization: { enabled: true, penalty: 'none' },
    // Off until a job says where it is based; there is no sensible place to assume.
    location: { enabled: false, penalty: 'none', locale: '' },
    studying: { enabled: true, penalty: 'none' },
    noExperience: { enabled: true, penalty: 'none' },
    tenureGaps: { enabled: true, penalty: 'none' },
    salaryLow: { enabled: false, penalty: 'none', threshold: null },
    salaryHigh: { enabled: false, penalty: 'none', threshold: null },
  },
};

export function cloneDefaultScoringConfig(): ScoringConfig {
  return JSON.parse(JSON.stringify(DEFAULT_SCORING_CONFIG)) as ScoringConfig;
}

export function totalPoints(dimensions: ScoringDimension[]): number {
  return dimensions.reduce((sum, dimension) => sum + dimension.maxPoints, 0);
}

export type ValidationResult = { ok: true; config: ScoringConfig } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Check untrusted input (an API body or stored JSON) and return a normalized
 * config. Errors are plain-language so they can be shown to the user.
 */
export function validateScoringConfig(input: unknown): ValidationResult {
  if (!isRecord(input)) return { ok: false, error: 'The scoring criteria are missing.' };

  const rawDimensions = input.dimensions;
  if (!Array.isArray(rawDimensions) || rawDimensions.length === 0) {
    return { ok: false, error: 'Add at least one evaluation area.' };
  }
  if (rawDimensions.length > MAX_DIMENSIONS) {
    return { ok: false, error: `Use at most ${MAX_DIMENSIONS} evaluation areas.` };
  }

  const dimensions: ScoringDimension[] = [];
  for (const [index, raw] of rawDimensions.entries()) {
    if (!isRecord(raw)) return { ok: false, error: `Evaluation area ${index + 1} is not valid.` };
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const guidance = typeof raw.guidance === 'string' ? raw.guidance.trim() : '';
    const maxPoints = raw.maxPoints;
    const label = name || `Evaluation area ${index + 1}`;

    if (name === '') return { ok: false, error: `Evaluation area ${index + 1} needs a name.` };
    if (name.length > MAX_NAME_LENGTH) {
      return { ok: false, error: `"${label}" has a name longer than ${MAX_NAME_LENGTH} characters.` };
    }
    if (typeof maxPoints !== 'number' || !Number.isInteger(maxPoints) || maxPoints < 1 || maxPoints > TOTAL_POINTS) {
      return { ok: false, error: `"${label}" needs a whole number of points from 1 to ${TOTAL_POINTS}.` };
    }
    if (guidance.length > MAX_GUIDANCE_LENGTH) {
      return { ok: false, error: `"${label}" has more than ${MAX_GUIDANCE_LENGTH} characters of guidance.` };
    }
    dimensions.push({
      id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `area-${index + 1}`,
      name,
      maxPoints,
      guidance,
    });
  }

  const total = totalPoints(dimensions);
  if (total !== TOTAL_POINTS) {
    return {
      ok: false,
      error: `The points add up to ${total}. They need to total exactly ${TOTAL_POINTS}.`,
    };
  }

  const redFlags = isRecord(input.redFlags) ? input.redFlags : {};
  const enabled = (key: string): boolean => {
    const flag = redFlags[key];
    return isRecord(flag) ? flag.enabled !== false : true; // all on by default
  };
  // Penalty must be one of the known levels; an absent one (older saved configs) is 'none'.
  const penalties: Partial<Record<string, FlagPenalty>> = {};
  for (const key of [
    'nameCapitalization',
    'location',
    'studying',
    'noExperience',
    'tenureGaps',
    'salaryLow',
    'salaryHigh',
  ]) {
    const flag = redFlags[key];
    const raw = isRecord(flag) ? flag.penalty : undefined;
    if (raw === undefined) {
      penalties[key] = 'none';
    } else if (FLAG_PENALTIES.includes(raw as FlagPenalty)) {
      penalties[key] = raw as FlagPenalty;
    } else {
      return { ok: false, error: 'Each red flag penalty must be none, a bit, a lot or dealbreaker.' };
    }
  }
  const penaltyFor = (key: string): FlagPenalty => penalties[key] ?? 'none';

  const isLocationProvided = isRecord(redFlags.location);
  const locationFlag = isRecord(redFlags.location) ? redFlags.location : {};
  const locale = typeof locationFlag.locale === 'string' ? locationFlag.locale.trim() : '';
  // There is no default place, so a location rule that is not given is off.
  const isLocationOn = isLocationProvided && enabled('location');

  // A location rule that is turned on needs somewhere to be local to.
  if (isLocationOn && locale === '') {
    return { ok: false, error: 'Enter the location candidates should be in, or turn the location flag off.' };
  }
  if (locale.length > MAX_LOCALE_LENGTH) {
    return { ok: false, error: `The location is longer than ${MAX_LOCALE_LENGTH} characters.` };
  }

  // Salary checks are off unless asked for (older configs have none), and a
  // turned-on check needs a yearly figure to compare against.
  const salarySettings: Record<'salaryLow' | 'salaryHigh', SalaryFlagSetting> = {
    salaryLow: { enabled: false, penalty: penaltyFor('salaryLow'), threshold: null },
    salaryHigh: { enabled: false, penalty: penaltyFor('salaryHigh'), threshold: null },
  };
  const salaryTitles = { salaryLow: 'low desired pay', salaryHigh: 'high desired pay' };
  for (const key of ['salaryLow', 'salaryHigh'] as const) {
    const raw = redFlags[key];
    if (!isRecord(raw)) continue;
    const threshold = raw.threshold;
    const isOn = raw.enabled === true;
    const hasThreshold = typeof threshold === 'number';
    if (hasThreshold && (!Number.isInteger(threshold) || threshold < 1 || threshold > MAX_SALARY_THRESHOLD)) {
      return { ok: false, error: `Enter a yearly figure in whole dollars for the ${salaryTitles[key]} flag.` };
    }
    if (isOn && !hasThreshold) {
      return {
        ok: false,
        error: `Enter the yearly pay for the ${salaryTitles[key]} flag, or turn it off.`,
      };
    }
    salarySettings[key] = {
      enabled: isOn,
      penalty: penaltyFor(key),
      threshold: hasThreshold ? threshold : null,
    };
  }
  const { salaryLow, salaryHigh } = salarySettings;
  if (
    salaryLow.enabled &&
    salaryHigh.enabled &&
    salaryLow.threshold !== null &&
    salaryHigh.threshold !== null &&
    salaryLow.threshold > salaryHigh.threshold
  ) {
    return { ok: false, error: 'The low desired pay must not be above the high desired pay.' };
  }

  return {
    ok: true,
    config: {
      dimensions,
      redFlags: {
        nameCapitalization: {
          enabled: enabled('nameCapitalization'),
          penalty: penaltyFor('nameCapitalization'),
        },
        location: {
          enabled: isLocationOn,
          penalty: penaltyFor('location'),
          locale,
        },
        studying: { enabled: enabled('studying'), penalty: penaltyFor('studying') },
        noExperience: { enabled: enabled('noExperience'), penalty: penaltyFor('noExperience') },
        tenureGaps: { enabled: enabled('tenureGaps'), penalty: penaltyFor('tenureGaps') },
        salaryLow,
        salaryHigh,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Composing the rubric
// ---------------------------------------------------------------------------

/** The job placeholders (`{{JOB_TITLE}}`, ...) are filled later; users must not inject them. */
function stripPlaceholders(text: string): string {
  return text.replace(/\{\{|\}\}/g, '');
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function evaluationFrameworkSection(dimensions: ScoringDimension[]): string {
  const count = NUMBER_WORDS[dimensions.length] ?? String(dimensions.length);
  const areas = dimensions.map((dimension, index) => {
    const bullets = stripPlaceholders(dimension.guidance)
      .split('\n')
      .map((line) => line.trim().replace(/^[-*•]\s*/, ''))
      .filter((line) => line !== '')
      .map((line) => `   - ${line}`);
    return [`${index + 1}. ${stripPlaceholders(dimension.name)} (0–${dimension.maxPoints})`, ...bullets].join('\n');
  });
  return [
    '### Evaluation Framework',
    `Assess the candidate across ${count} weighted area${dimensions.length === 1 ? '' : 's'}. The number in brackets is the most points that area can earn; the points you give must add up to the fit score:`,
    '',
    areas.join('\n'),
  ].join('\n');
}

function redFlagsSection(redFlags: ScoringConfig['redFlags']): string {
  const lines: string[] = [];
  if (redFlags.nameCapitalization.enabled) {
    lines.push(
      '- **Name capitalization (`name`):** judged ONLY on the candidate\'s name exactly as submitted (the Name line in the candidate details), not on how the name appears inside the résumé. If that name is in ALL CAPS, all-lowercase, partially/inconsistently capitalized, or otherwise not properly capitalized (e.g., "JOHN smith", "jane DOE", "MARY JANE"), set the `name` flag.'
    );
  }
  if (redFlags.location.enabled) {
    const locale = stripPlaceholders(redFlags.location.locale);
    lines.push(
      `- **Location (\`location\`):** This role is based in ${locale}. Treat a candidate as local if ANY signal places them there: the Location field, a phone area code from that area, an address or phone number in the résumé, or an answer to the commuting-distance question (when provided) confirming they are within commuting distance or willing to relocate. If the candidate left the commuting-distance question unanswered, or you cannot confirm they are local, set the \`location\` flag. Do not flag someone only because the Location field is blank when the résumé or phone shows they are local.`
    );
  }
  if (redFlags.studying.enabled) {
    lines.push(
      '- **Still studying (`studying`):** the candidate is currently a student or still completing a degree, with no substantial post-graduation professional experience.'
    );
  }
  if (redFlags.noExperience.enabled) {
    lines.push(
      '- **No relevant experience (`no_exp`):** the candidate has no relevant professional experience for this role (only non-technical jobs, or unrelated roles).'
    );
  }
  if (redFlags.tenureGaps.enabled) {
    lines.push(
      "- **Short tenures or gaps (`tenure`):** read the dates in the résumé's work history. Set the `tenure` flag when there is a pattern of short tenures (several roles each held for roughly a year or less) or noticeable gaps of about six months or more between roles that the résumé does not explain. Do NOT count a role that is short by agreement: internships, co-ops, placements, apprenticeships, and anything described as a contract, contractor, freelance, seasonal or temporary engagement. Do not count a gap the résumé explains (for example study, parental or medical leave, travel, or the end of a stated contract). One short role on its own is not a pattern. When you set this flag, name the roles or periods in \"risks\"."
    );
  }

  if (lines.length === 0) {
    return [
      '### Red Flags',
      'No red flags are enabled for this role. Do not set any flag.',
    ].join('\n');
  }
  return [
    '### Red Flags (report, but do NOT change the score)',
    'Flags are for triage only. Never raise, lower or zero the confidence because of a flag: score the candidate on merit using the framework above, then add the flag. When you set a flag, say why in "risks".',
    ...lines,
  ].join('\n');
}

function flagsToPassSection(redFlags: ScoringConfig['redFlags']): string {
  const allowed: string[] = [];
  if (redFlags.nameCapitalization.enabled) allowed.push('name');
  if (redFlags.location.enabled) allowed.push('location');
  if (redFlags.studying.enabled) allowed.push('studying');
  if (redFlags.noExperience.enabled) allowed.push('no_exp');
  if (redFlags.tenureGaps.enabled) allowed.push('tenure');

  const lines = ['### Flags to pass to save_evaluation'];
  if (allowed.length === 0) {
    lines.push('No flags are enabled for this role. Always pass an empty `flags` list.');
  } else {
    lines.push(
      `In the \`flags\` argument, pass only the flags from this list that clearly apply: ${allowed.map((flag) => `\`${flag}\``).join(', ')}. Never pass any other flag. If none apply, pass an empty list.`
    );
    if (redFlags.studying.enabled && redFlags.noExperience.enabled) {
      lines.push('If both `studying` and `no_exp` could apply, pass only `studying` (it takes precedence).');
    }
  }
  return lines.join('\n');
}

/**
 * Fill the configurable sections of the fixed template. The job placeholders
 * ({{JOB_TITLE}}, {{JOB_DESCRIPTION}}) are left for the caller to substitute.
 */
export function composeRubric(template: string, config: ScoringConfig): string {
  return template
    .replace('{{EVALUATION_FRAMEWORK}}', () => evaluationFrameworkSection(config.dimensions))
    .replace('{{RED_FLAGS}}', () => redFlagsSection(config.redFlags))
    .replace('{{FLAGS_TO_PASS}}', () => flagsToPassSection(config.redFlags));
}

// ---------------------------------------------------------------------------
// Converting a legacy hand-written rubric
// ---------------------------------------------------------------------------

function sectionBody(prompt: string, heading: string): string | null {
  const start = prompt.indexOf(heading);
  if (start === -1) return null;
  const after = prompt.slice(start + heading.length);
  const next = after.search(/\n###\s/);
  return next === -1 ? after : after.slice(0, next);
}

/**
 * Convert a rubric written by hand in the old free-text format into a config.
 * Returns null when it cannot be done faithfully (so the caller keeps using the
 * original text). Only the evaluation framework and which flags are mentioned
 * are read; the template carries everything else.
 */
export function parseLegacyRubric(prompt: string): ScoringConfig | null {
  const framework = sectionBody(prompt, '### Evaluation Framework');
  if (!framework) return null;

  const dimensions: ScoringDimension[] = [];
  for (const line of framework.split('\n')) {
    const header = /^\s*\d+\.\s+(.+?)\s*\(0[–-](\d+)\)\s*$/.exec(line);
    if (header) {
      dimensions.push({
        id: `area-${dimensions.length + 1}`,
        name: header[1],
        maxPoints: parseInt(header[2], 10),
        guidance: '',
      });
      continue;
    }
    const bullet = /^\s+-\s+(.+?)\s*$/.exec(line);
    const current = dimensions[dimensions.length - 1];
    if (bullet && current) {
      current.guidance = current.guidance === '' ? bullet[1] : `${current.guidance}\n${bullet[1]}`;
    }
  }
  if (dimensions.length === 0 || totalPoints(dimensions) !== TOTAL_POINTS) return null;

  const redFlagText = sectionBody(prompt, '### Red Flags') ?? '';
  const contentText = sectionBody(prompt, '### Content Flags') ?? '';
  // The old location rule named its place in one sentence: "This role is based in X."
  const legacyLocale = /based in ([^.\n]+)/i.exec(redFlagText)?.[1].trim() ?? '';
  const config: ScoringConfig = {
    dimensions,
    redFlags: {
      nameCapitalization: { enabled: /name capitalization/i.test(redFlagText), penalty: 'none' },
      location: {
        enabled: /\*\*Location/i.test(redFlagText) && legacyLocale !== '',
        penalty: 'none',
        locale: legacyLocale,
      },
      studying: { enabled: /\*\*studying\*\*/.test(contentText), penalty: 'none' },
      noExperience: { enabled: /\*\*no_exp\*\*/.test(contentText), penalty: 'none' },
      // A newer flag the old rubrics never had; on by default like the rest.
      tenureGaps: { enabled: true, penalty: 'none' },
      salaryLow: { enabled: false, penalty: 'none', threshold: null },
      salaryHigh: { enabled: false, penalty: 'none', threshold: null },
    },
  };
  // The migration must produce something the editor will accept on save.
  return validateScoringConfig(config).ok ? config : null;
}

/** A job's saved criteria as a validated config; missing or corrupt JSON means "defaults" (null). */
export function parseStoredScoringConfig(json: string | null | undefined): ScoringConfig | null {
  if (!json) return null;
  try {
    const validated = validateScoringConfig(JSON.parse(json));
    return validated.ok ? validated.config : null;
  } catch {
    return null;
  }
}
