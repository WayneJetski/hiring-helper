/**
 * Repository for managing job records in the database
 */

import { getDatabase } from '../db/database.js';
import type Database from 'better-sqlite3';

export interface Job {
  id: number;
  title: string;
  postedDate?: string;
  status?: string;
  postingUrl?: string;
  description?: string;
  systemPrompt?: string;
  /** Structured scoring criteria as JSON text (see scoring/scoring-config.ts). */
  scoringConfig?: string;
  /** When a person confirmed the scoring criteria; undefined until then. */
  criteriaConfirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface JobRow {
  id: number;
  title: string;
  posted_date: string | null;
  status: string | null;
  posting_url: string | null;
  description: string | null;
  system_prompt: string | null;
  scoring_config: string | null;
  criteria_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class JobsRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /**
   * Convert database row to Job object
   */
  private rowToJob(row: JobRow): Job {
    return {
      id: row.id,
      title: row.title,
      postedDate: row.posted_date || undefined,
      status: row.status || undefined,
      postingUrl: row.posting_url || undefined,
      description: row.description || undefined,
      systemPrompt: row.system_prompt || undefined,
      scoringConfig: row.scoring_config || undefined,
      criteriaConfirmedAt: row.criteria_confirmed_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get job by ID
   */
  getById(id: number): Job | null {
    const row = this.db
      .prepare<[number], JobRow>('SELECT * FROM jobs WHERE id = ?')
      .get(id);
    return row ? this.rowToJob(row) : null;
  }

  /**
   * Get all jobs
   */
  getAll(): Job[] {
    const rows = this.db
      .prepare<[], JobRow>('SELECT * FROM jobs ORDER BY posted_date DESC')
      .all();
    return rows.map((row) => this.rowToJob(row));
  }

  /**
   * Upsert (insert or update) a job
   */
  upsert(job: {
    id: number;
    title: string;
    postedDate?: string;
    status?: string;
    postingUrl?: string;
  }): void {
    // COALESCE preserves fields the BambooHR sync does not provide (it only
    // supplies id + title), so a sync cannot wipe a Claude-written posting_url
    // or description.
    this.db
      .prepare(
        `INSERT INTO jobs (id, title, posted_date, status, posting_url, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           posted_date = COALESCE(excluded.posted_date, jobs.posted_date),
           status = COALESCE(excluded.status, jobs.status),
           posting_url = COALESCE(excluded.posting_url, jobs.posting_url),
           updated_at = datetime('now')`
      )
      .run(
        job.id,
        job.title,
        job.postedDate || null,
        job.status || null,
        job.postingUrl || null
      );
  }

  /**
   * Enrich an existing job with metadata from BambooHR's jobs endpoint
   * (title, posted date, status, posting URL). Update-only: does nothing if the
   * job row does not exist yet, and COALESCE keeps any Claude-written posting
   * (`description`) and never clobbers fields with null. Returns false if no
   * matching job row exists.
   */
  updateMetadata(
    id: number,
    meta: { title?: string; postedDate?: string; status?: string; postingUrl?: string }
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE jobs
         SET title = COALESCE(?, title),
             posted_date = COALESCE(?, posted_date),
             status = COALESCE(?, status),
             posting_url = COALESCE(?, posting_url),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(
        meta.title ?? null,
        meta.postedDate ?? null,
        meta.status ?? null,
        meta.postingUrl ?? null,
        id
      );
    return result.changes > 0;
  }

  /**
   * Save the job posting text (and optional URL) for a job.
   * Returns false if no job with the given id exists.
   */
  savePosting(jobId: number, posting: { description: string; postingUrl?: string }): boolean {
    const result = this.db
      .prepare(
        `UPDATE jobs
         SET description = ?,
             posting_url = COALESCE(?, posting_url),
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(posting.description, posting.postingUrl ?? null, jobId);
    return result.changes > 0;
  }

  /**
   * Save (or clear, with null) the per-job structured scoring criteria as JSON.
   * `upsert`/`updateMetadata` never touch this column, so a BambooHR sync cannot
   * wipe it. Returns false if no job with the given id exists.
   */
  saveScoringConfig(jobId: number, scoringConfigJson: string | null): boolean {
    const result = this.db
      .prepare(`UPDATE jobs SET scoring_config = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(scoringConfigJson, jobId);
    return result.changes > 0;
  }

  /** Record that a person confirmed this job's scoring criteria. */
  confirmCriteria(jobId: number): boolean {
    const result = this.db
      .prepare(
        `UPDATE jobs SET criteria_confirmed_at = COALESCE(criteria_confirmed_at, datetime('now')),
                         updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(jobId);
    return result.changes > 0;
  }

  /** Drop the legacy hand-written rubric (used when criteria are reset to the default). */
  clearLegacyPrompt(jobId: number): boolean {
    const result = this.db
      .prepare(`UPDATE jobs SET system_prompt = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(jobId);
    return result.changes > 0;
  }

  /**
   * Delete job by ID
   */
  delete(id: number): void {
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  }
}

