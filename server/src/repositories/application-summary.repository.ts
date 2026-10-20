/**
 * Application Summary Repository
 * Handles caching of AI-generated summaries
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ApplicantSummary } from '../types/summary.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ApplicationSummaryRepository {
  private cacheDir: string;

  constructor() {
    this.cacheDir = join(__dirname, '../../data/cache/application/summary');
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create cache directory:', error);
      throw error;
    }
  }

  /**
   * Get cached summary for an application
   */
  async getSummary(applicationId: number): Promise<ApplicantSummary | null> {
    try {
      const filePath = join(this.cacheDir, `${applicationId}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as ApplicantSummary;
    } catch (error) {
      // File doesn't exist or is invalid - return null
      return null;
    }
  }

  /**
   * Save summary to cache
   */
  async saveSummary(
    applicationId: number,
    summary: ApplicantSummary
  ): Promise<void> {
    try {
      await this.ensureCacheDir();
      const filePath = join(this.cacheDir, `${applicationId}.json`);
      await fs.writeFile(filePath, JSON.stringify(summary, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save summary:', error);
      throw error;
    }
  }

  /**
   * Check if summary exists
   */
  async hasSummary(applicationId: number): Promise<boolean> {
    const summary = await this.getSummary(applicationId);
    return summary !== null;
  }

  /**
   * Delete cached summary
   */
  async deleteSummary(applicationId: number): Promise<void> {
    try {
      const filePath = join(this.cacheDir, `${applicationId}.json`);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to delete summary:', error);
      }
    }
  }
}

