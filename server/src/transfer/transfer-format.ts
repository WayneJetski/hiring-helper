/**
 * The file used to share job settings and applicant scores between people who use
 * Hiring Helper on the same BambooHR account (so scoring is not paid for twice).
 *
 * The file is untrusted input: `parseTransferBundle` checks every field, drops anything
 * it does not know and caps sizes, so only well-formed data can reach the database.
 * Jobs and applications are matched by their BambooHR ids, which are the same on every
 * machine connected to the same company.
 */

import { validateScoringConfig, type ScoringConfig } from '../scoring/scoring-config.js';
import { isApplicationFlag, type ApplicationFlag } from '../types/flags.js';
import type { ApplicantSummary } from '../types/summary.types.js';

export const TRANSFER_FORMAT = 'hiring-helper-export';
export const TRANSFER_VERSION = 1;

const MAX_JOBS = 500;
const MAX_APPLICATIONS_PER_JOB = 20_000;
const MAX_POSTING_LENGTH = 200_000;
const MAX_TEXT_LENGTH = 50_000;
const MAX_SHORT_TEXT_LENGTH = 500;
const MAX_LIST_LENGTH = 100;

export interface TransferJobSettings {
  /** The job posting text; null when none is stored. */
  description: string | null;
  /** Saved scoring criteria; null when the job uses the defaults. */
  scoringConfig: ScoringConfig | null;
  /** When a person confirmed the criteria; null when not yet confirmed. */
  criteriaConfirmedAt: string | null;
}

export interface TransferApplication {
  /** BambooHR application id. */
  id: number;
  /** For showing the person what will change; never used for matching. */
  name: string;
  score: number;
  /** The AI report (assessment, risks, score breakdown); null if only a score exists. */
  summary: ApplicantSummary | null;
  flags: ApplicationFlag[];
}

export interface TransferJob {
  /** BambooHR job id. */
  id: number;
  title: string;
  settings: TransferJobSettings;
  /** Only scored applications are included. */
  applications: TransferApplication[];
}

export interface TransferBundle {
  format: typeof TRANSFER_FORMAT;
  version: typeof TRANSFER_VERSION;
  /**
   * The BambooHR company the data came from. Ids are only meaningful within one company,
   * so a file is only imported into the same one.
   */
  company: string;
  exportedAt: string;
  jobs: TransferJob[];
}

export type ParseResult = { ok: true; bundle: TransferBundle } | { ok: false; error: string };

type Fail = { ok: false; error: string };
type Parsed<T> = { ok: true; value: T } | Fail;

const fail = (error: string): Fail => ({ ok: false, error });
const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseText(value: unknown, label: string, maxLength: number): Parsed<string> {
  if (typeof value !== 'string') return fail(`${label} must be text`);
  if (value.length > maxLength) return fail(`${label} is too long`);
  return ok(value);
}

function parseOptionalText(value: unknown, label: string, maxLength: number): Parsed<string | null> {
  if (value === undefined || value === null) return ok(null);
  return parseText(value, label, maxLength);
}

function parseInteger(value: unknown, label: string): Parsed<number> {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return fail(`${label} must be a whole number`);
  }
  return ok(value);
}

function parseSettings(value: unknown, label: string): Parsed<TransferJobSettings> {
  if (!isRecord(value)) return fail(`${label}: settings are missing`);

  const description = parseOptionalText(value.description, `${label} posting`, MAX_POSTING_LENGTH);
  if (!description.ok) return description;
  const confirmedAt = parseOptionalText(
    value.criteriaConfirmedAt,
    `${label} confirmation date`,
    MAX_SHORT_TEXT_LENGTH
  );
  if (!confirmedAt.ok) return confirmedAt;

  let scoringConfig: ScoringConfig | null = null;
  if (value.scoringConfig !== undefined && value.scoringConfig !== null) {
    const validated = validateScoringConfig(value.scoringConfig);
    if (!validated.ok) return fail(`${label} scoring criteria: ${validated.error}`);
    scoringConfig = validated.config;
  }

  return ok({
    description: description.value,
    scoringConfig,
    criteriaConfirmedAt: confirmedAt.value,
  });
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseSummary(value: unknown, label: string): Parsed<ApplicantSummary | null> {
  if (value === undefined || value === null) return ok(null);
  if (!isRecord(value)) return fail(`${label} report must be an object`);

  const brief = parseText(value.brief, `${label} brief`, MAX_TEXT_LENGTH);
  if (!brief.ok) return brief;
  const full = parseText(value.full, `${label} assessment`, MAX_TEXT_LENGTH);
  if (!full.ok) return full;
  const risks = parseText(value.risks ?? '', `${label} risks`, MAX_TEXT_LENGTH);
  if (!risks.ok) return risks;
  const generatedAt = parseText(value.generatedAt ?? '', `${label} date`, MAX_SHORT_TEXT_LENGTH);
  if (!generatedAt.ok) return generatedAt;
  if (!isNumber(value.confidence)) return fail(`${label} report score must be a number`);

  const summary: ApplicantSummary = {
    confidence: value.confidence,
    brief: brief.value,
    full: full.value,
    risks: risks.value,
    generatedAt: generatedAt.value,
  };

  if (value.suggestedScreeningQuestions !== undefined) {
    const questions = value.suggestedScreeningQuestions;
    if (
      !Array.isArray(questions) ||
      questions.length > MAX_LIST_LENGTH ||
      questions.some((question) => typeof question !== 'string' || question.length > MAX_TEXT_LENGTH)
    ) {
      return fail(`${label} screening questions are not valid`);
    }
    summary.suggestedScreeningQuestions = questions as string[];
  }

  if (value.areaScores !== undefined) {
    const areas = value.areaScores;
    if (
      !Array.isArray(areas) ||
      areas.length > MAX_LIST_LENGTH ||
      !areas.every(
        (area) =>
          isRecord(area) &&
          typeof area.name === 'string' &&
          area.name.length <= MAX_SHORT_TEXT_LENGTH &&
          isNumber(area.points) &&
          isNumber(area.maxPoints)
      )
    ) {
      return fail(`${label} score breakdown is not valid`);
    }
    summary.areaScores = (areas as Array<Record<string, unknown>>).map((area) => ({
      name: area.name as string,
      points: area.points as number,
      maxPoints: area.maxPoints as number,
    }));
  }

  if (value.scoreAdjustment !== undefined) {
    const adjustment = value.scoreAdjustment;
    const levels = ['bit', 'lot', 'dealbreaker'];
    if (
      !isRecord(adjustment) ||
      !isNumber(adjustment.meritScore) ||
      !Array.isArray(adjustment.penalties) ||
      adjustment.penalties.length > MAX_LIST_LENGTH ||
      !adjustment.penalties.every(
        (penalty) =>
          isRecord(penalty) &&
          typeof penalty.flag === 'string' &&
          penalty.flag.length <= MAX_SHORT_TEXT_LENGTH &&
          levels.includes(penalty.penalty as string)
      )
    ) {
      return fail(`${label} score adjustment is not valid`);
    }
    summary.scoreAdjustment = {
      meritScore: adjustment.meritScore,
      penalties: (adjustment.penalties as Array<Record<string, unknown>>).map((penalty) => ({
        flag: penalty.flag as string,
        penalty: penalty.penalty as 'bit' | 'lot' | 'dealbreaker',
      })),
    };
  }

  return ok(summary);
}

function parseApplication(value: unknown, jobLabel: string): Parsed<TransferApplication> {
  if (!isRecord(value)) return fail(`${jobLabel}: an applicant entry is not valid`);
  const id = parseInteger(value.id, `${jobLabel} applicant id`);
  if (!id.ok) return id;
  const label = `${jobLabel}, applicant ${id.value}`;

  const name = parseOptionalText(value.name, `${label} name`, MAX_SHORT_TEXT_LENGTH);
  if (!name.ok) return name;
  if (!isNumber(value.score) || !Number.isInteger(value.score) || value.score < 0 || value.score > 100) {
    return fail(`${label}: score must be a whole number from 0 to 100`);
  }
  const summary = parseSummary(value.summary, label);
  if (!summary.ok) return summary;

  const rawFlags = value.flags ?? [];
  if (
    !Array.isArray(rawFlags) ||
    rawFlags.length > MAX_LIST_LENGTH ||
    rawFlags.some((flag) => typeof flag !== 'string' || !isApplicationFlag(flag))
  ) {
    return fail(`${label}: flags are not valid`);
  }

  return ok({
    id: id.value,
    name: name.value ?? '',
    score: value.score,
    summary: summary.value,
    flags: [...new Set(rawFlags as ApplicationFlag[])],
  });
}

function parseJob(value: unknown, position: number): Parsed<TransferJob> {
  if (!isRecord(value)) return fail(`Job ${position + 1} is not valid`);
  const id = parseInteger(value.id, `Job ${position + 1} id`);
  if (!id.ok) return id;
  const title = parseText(value.title ?? '', `Job ${id.value} title`, MAX_SHORT_TEXT_LENGTH);
  if (!title.ok) return title;
  const label = `Job "${title.value || id.value}"`;

  const settings = parseSettings(value.settings, label);
  if (!settings.ok) return settings;

  const rawApplications = value.applications ?? [];
  if (!Array.isArray(rawApplications) || rawApplications.length > MAX_APPLICATIONS_PER_JOB) {
    return fail(`${label}: the applicant list is not valid`);
  }
  const applications: TransferApplication[] = [];
  const seen = new Set<number>();
  for (const raw of rawApplications) {
    const parsed = parseApplication(raw, label);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.id)) return fail(`${label}: applicant ${parsed.value.id} appears twice`);
    seen.add(parsed.value.id);
    applications.push(parsed.value);
  }

  return ok({ id: id.value, title: title.value, settings: settings.value, applications });
}

/** Check an uploaded file's contents and return a clean bundle, or a plain-language reason. */
export function parseTransferBundle(raw: unknown): ParseResult {
  if (!isRecord(raw) || raw.format !== TRANSFER_FORMAT) {
    return fail('This is not a Hiring Helper export file.');
  }
  if (typeof raw.version !== 'number' || raw.version > TRANSFER_VERSION) {
    return fail('This file was made by a newer version of Hiring Helper. Update the app and try again.');
  }
  if (raw.version !== TRANSFER_VERSION) return fail('This export file version is not supported.');
  if (!Array.isArray(raw.jobs) || raw.jobs.length > MAX_JOBS) {
    return fail('The export file has no valid list of jobs.');
  }

  const exportedAt = parseOptionalText(raw.exportedAt, 'Export date', MAX_SHORT_TEXT_LENGTH);
  if (!exportedAt.ok) return exportedAt;
  const company = parseText(raw.company, 'The company', MAX_SHORT_TEXT_LENGTH);
  if (!company.ok || company.value.trim() === '') {
    return fail('This file does not say which BambooHR company it came from.');
  }

  const jobs: TransferJob[] = [];
  const seen = new Set<number>();
  for (const [position, rawJob] of raw.jobs.entries()) {
    const parsed = parseJob(rawJob, position);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.id)) return fail(`Job ${parsed.value.id} appears twice in the file.`);
    seen.add(parsed.value.id);
    jobs.push(parsed.value);
  }

  return {
    ok: true,
    bundle: {
      format: TRANSFER_FORMAT,
      version: TRANSFER_VERSION,
      company: company.value,
      exportedAt: exportedAt.value ?? '',
      jobs,
    },
  };
}
