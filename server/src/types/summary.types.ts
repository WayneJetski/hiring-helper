/**
 * Type definitions for AI-generated summaries
 */

export interface ApplicantSummary {
  confidence: number; // 0-100
  brief: string;
  full: string;
  risks: string;
  suggestedScreeningQuestions?: string[]; // Array of screening questions to ask
  generatedAt: string;
  jobTitle?: string;
  jobId?: number;
  /** Points given to each evaluation area (they add up to the model's merit score). */
  areaScores?: Array<{ name: string; points: number; maxPoints: number }>;
  /** Present when red-flag penalties lowered the score: the model's merit score and what applied. */
  scoreAdjustment?: {
    meritScore: number;
    penalties: Array<{ flag: string; penalty: 'bit' | 'lot' | 'dealbreaker' }>;
  };
}

export interface CachedResume {
  text: string;
  metadata?: {
    pages?: number;
    info?: Record<string, unknown>;
  };
  extractedData?: {
    emails: string[];
    phones: string[];
    urls: string[];
    lines: string[];
  };
  cachedAt: string;
}

