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

