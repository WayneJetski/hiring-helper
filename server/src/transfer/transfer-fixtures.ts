/** Shared builders for the transfer tests. */

import { cloneDefaultScoringConfig } from '../scoring/scoring-config.js';
import type { ApplicantSummary } from '../types/summary.types.js';
import {
  TRANSFER_FORMAT,
  TRANSFER_VERSION,
  type TransferApplication,
  type TransferBundle,
  type TransferJob,
} from './transfer-format.js';

export function makeSummary(overrides: Partial<ApplicantSummary> = {}): ApplicantSummary {
  return {
    confidence: 80,
    brief: 'Strong fit',
    full: 'Detailed assessment',
    risks: 'None',
    generatedAt: '2026-10-01T00:00:00.000Z',
    areaScores: [{ name: 'Skills', points: 80, maxPoints: 100 }],
    ...overrides,
  };
}

export function makeApplication(
  id: number,
  overrides: Partial<TransferApplication> = {}
): TransferApplication {
  return {
    id,
    name: `Person ${id}`,
    score: 80,
    summary: makeSummary(),
    flags: [],
    ...overrides,
  };
}

export function makeJob(overrides: Partial<TransferJob> = {}): TransferJob {
  return {
    id: 7,
    title: 'Analyst',
    settings: {
      description: 'We are hiring an analyst.',
      scoringConfig: cloneDefaultScoringConfig(),
      legacyPrompt: null,
      criteriaConfirmedAt: '2026-10-01 10:00:00',
    },
    applications: [makeApplication(101)],
    ...overrides,
  };
}

export function makeBundle(jobs: TransferJob[] = [makeJob()]): TransferBundle {
  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: '2026-10-22T12:00:00.000Z',
    jobs,
  };
}
