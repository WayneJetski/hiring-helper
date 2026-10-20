/**
 * Resume Repository
 * Handles caching of parsed resumes
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { CachedResume } from '../types/summary.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ResumeRepository {
  private cacheDir: string;

  constructor() {
    this.cacheDir = join(__dirname, '../../data/cache/application/resume');
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
   * Get cached resume
   */
  async getResume(resumeFileId: number): Promise<CachedResume | null> {
    try {
      const filePath = join(this.cacheDir, `${resumeFileId}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as CachedResume;
    } catch (error) {
      // File doesn't exist or is invalid - return null
      return null;
    }
  }

  /**
   * Save resume to cache
   */
  async saveResume(resumeFileId: number, resume: CachedResume): Promise<void> {
    try {
      await this.ensureCacheDir();
      const filePath = join(this.cacheDir, `${resumeFileId}.json`);
      await fs.writeFile(filePath, JSON.stringify(resume, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save resume:', error);
      throw error;
    }
  }

  /**
   * Check if resume exists in cache
   */
  async hasResume(resumeFileId: number): Promise<boolean> {
    const resume = await this.getResume(resumeFileId);
    return resume !== null;
  }

  /**
   * Delete cached resume
   */
  async deleteResume(resumeFileId: number): Promise<void> {
    try {
      const filePath = join(this.cacheDir, `${resumeFileId}.json`);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to delete resume:', error);
      }
    }
  }
}

