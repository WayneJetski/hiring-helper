/**
 * Job Description Service
 * Manages job descriptions for AI candidate matching
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JobsRepository } from '../repositories/jobs.repository.js';
import {
  cloneDefaultScoringConfig,
  composeRubric,
  validateScoringConfig,
  type ScoringConfig,
} from '../scoring/scoring-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** The fixed rubric template; the configurable sections are filled from a ScoringConfig. */
const RUBRIC_TEMPLATE_PATH = join(__dirname, '../../prompts/ai-evaluation-system.txt');

export class JobDescriptionService {
  private jobDescriptionsPath: string;
  private cache: Map<string, string> = new Map();
  private jobsRepo: JobsRepository;

  constructor(jobsRepo: JobsRepository = new JobsRepository()) {
    // Path to job-descriptions directory
    this.jobDescriptionsPath = join(__dirname, '../../data/job-descriptions');
    this.jobsRepo = jobsRepo;
  }

  /**
   * A job's scoring criteria: its saved configuration when it has one, otherwise
   * the defaults. `isLegacyPromptActive` is true only for a hand-written rubric
   * that could not be converted to structured criteria and so is still used
   * as written.
   */
  getScoringConfig(jobId: number): {
    config: ScoringConfig;
    isCustom: boolean;
    isLegacyPromptActive: boolean;
  } {
    const job = this.jobsRepo.getById(jobId);

    if (job?.scoringConfig) {
      try {
        const validated = validateScoringConfig(JSON.parse(job.scoringConfig));
        if (validated.ok) {
          return { config: validated.config, isCustom: true, isLegacyPromptActive: false };
        }
      } catch {
        // Corrupt stored JSON: fall through to the defaults rather than failing scoring.
      }
    }

    const hasLegacyPrompt = !!(job?.systemPrompt && job.systemPrompt.trim().length > 0);
    return {
      config: cloneDefaultScoringConfig(),
      isCustom: false,
      isLegacyPromptActive: hasLegacyPrompt,
    };
  }

  /**
   * The effective scoring rubric for a job, as a template: the fixed rubric with
   * the job's criteria filled in. `{{JOB_TITLE}}`/`{{JOB_DESCRIPTION}}` are
   * substituted by the caller (the evaluate_candidate prompt, or Claude in the
   * scoring skill). A legacy hand-written rubric that could not be converted is
   * returned as written.
   */
  async getSystemPrompt(jobId: number): Promise<string> {
    const { config, isLegacyPromptActive } = this.getScoringConfig(jobId);
    if (isLegacyPromptActive) {
      return this.jobsRepo.getById(jobId)?.systemPrompt as string;
    }
    const template = await fs.readFile(RUBRIC_TEMPLATE_PATH, 'utf-8');
    return composeRubric(template, config);
  }

  /**
   * Save a job's scoring criteria. Invalid input is rejected with a plain-language
   * message; an unknown job id yields `unknownJob`.
   */
  saveScoringConfig(
    jobId: number,
    input: unknown
  ): { ok: true } | { ok: false; error: string; unknownJob?: boolean } {
    const validated = validateScoringConfig(input);
    if (!validated.ok) return validated;
    const saved = this.jobsRepo.saveScoringConfig(jobId, JSON.stringify(validated.config));
    if (!saved) return { ok: false, error: `No job with ID ${jobId}`, unknownJob: true };
    // Saving criteria is a person deciding on them, so it counts as confirming.
    this.jobsRepo.confirmCriteria(jobId);
    return { ok: true };
  }

  /** Record that a person looked at this job's criteria and is happy with them. */
  confirmCriteria(jobId: number): boolean {
    return this.jobsRepo.confirmCriteria(jobId);
  }

  /**
   * Put a job back on the default criteria. Also drops any legacy hand-written
   * rubric, which would otherwise take over again. Returns false for an unknown job.
   */
  resetScoringConfig(jobId: number): boolean {
    const cleared = this.jobsRepo.saveScoringConfig(jobId, null);
    this.jobsRepo.clearLegacyPrompt(jobId);
    return cleared;
  }

  /**
   * Get the job posting text for a job.
   * DB-first: uses the posting stored via MCP (`jobs.description`); falls back
   * to local `server/data/job-descriptions/*.txt` files for backward compat.
   */
  async getJobDescription(jobIdOrTitle: string | number): Promise<string | null> {
    // Prefer the posting stored in the database (Claude-writable, always fresh)
    if (typeof jobIdOrTitle === 'number') {
      const job = this.jobsRepo.getById(jobIdOrTitle);
      if (job?.description) {
        return job.description;
      }
    }

    try {
      // Fall back to local .txt files (cache first)
      const cacheKey = String(jobIdOrTitle);
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey)!;
      }

      // Try multiple filename patterns
      const possibleFilenames = [
        `job-${jobIdOrTitle}.txt`,
        `${String(jobIdOrTitle).toLowerCase().replace(/\s+/g, '-')}.txt`,
      ];

      for (const filename of possibleFilenames) {
        try {
          const filePath = join(this.jobDescriptionsPath, filename);
          const content = await fs.readFile(filePath, 'utf-8');
          
          // Cache the result
          this.cache.set(cacheKey, content);
          
          return content;
        } catch (error) {
          // Try next filename pattern
          continue;
        }
      }

      // No file found
      return null;
    } catch (error) {
      console.error('Error reading job description:', error);
      return null;
    }
  }

  /**
   * Get job description by title with fuzzy matching
   */
  async getJobDescriptionByTitle(title: string): Promise<string | null> {
    try {
      // Normalize title for matching
      const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      
      // List all files in job-descriptions directory
      const files = await fs.readdir(this.jobDescriptionsPath);
      
      // Find best match
      for (const file of files) {
        if (!file.endsWith('.txt') || file === 'README.md') continue;
        
        const filename = file.replace('.txt', '').toLowerCase();
        
        // Check if normalized title is in filename or vice versa
        if (
          filename.includes(normalizedTitle) ||
          normalizedTitle.includes(filename)
        ) {
          const content = await fs.readFile(
            join(this.jobDescriptionsPath, file),
            'utf-8'
          );
          
          // Cache the result
          this.cache.set(title, content);
          
          return content;
        }
      }

      return null;
    } catch (error) {
      console.error('Error searching job descriptions:', error);
      return null;
    }
  }

  /**
   * List all available job description files
   */
  async listAvailableJobDescriptions(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.jobDescriptionsPath);
      return files
        .filter(f => f.endsWith('.txt') && f !== 'README.md')
        .map(f => f.replace('.txt', ''));
    } catch (error) {
      console.error('Error listing job descriptions:', error);
      return [];
    }
  }

  /**
   * Save the job posting text (and optional URL) for a job. Used by the MCP
   * `save_job_posting` tool. Returns false if the job id is unknown.
   */
  saveJobPosting(
    jobId: number,
    posting: { description: string; postingUrl?: string }
  ): boolean {
    const saved = this.jobsRepo.savePosting(jobId, posting);
    if (saved) {
      // Drop any stale file-based fallback cached for this job
      this.cache.delete(String(jobId));
    }
    return saved;
  }

  /**
   * Clear the cache (useful for development/testing)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

