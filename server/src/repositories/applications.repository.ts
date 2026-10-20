/**
 * Repository for managing application records in the database
 */

import { getDatabase } from '../db/database.js';
import type Database from 'better-sqlite3';

export interface Application {
  id: number;
  appliedDate: string;
  statusId?: number;
  rating?: number;
  applicantId: number;
  jobId: number;
  resumeFileId?: number;
  coverLetterFileId?: number;
  referredBy?: string;
  desiredSalary?: string;
  commutingAnswer?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApplicationRow {
  id: number;
  applied_date: string;
  status_id: number | null;
  bamboo_status_id: number | null;
  rating: number | null;
  applicant_id: number;
  job_id: number;
  resume_file_id: number | null;
  cover_letter_file_id: number | null;
  referred_by: string | null;
  desired_salary: string | null;
  commuting_answer: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

/**
 * A single condition for a bulk action (job-scoped by the caller).
 */
export interface BulkCondition {
  field: 'match' | 'appliedDate' | 'flag';
  operator: 'greaterThan' | 'lessThan' | 'is';
  value: number | string;
}

/**
 * Lightweight projection of an application for bulk previews (joined candidate
 * name + nullable match score) so the UI can show who would be affected.
 */
export interface BulkMatch {
  id: number;
  name: string;
  email: string;
  appliedDate: string;
  score: number | null;
}

interface BulkMatchRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  applied_date: string;
  score: number | null;
}

/**
 * An application whose local working status differs from the status BambooHR
 * last reported — i.e. a status change waiting to be pushed back to BambooHR.
 */
export interface PendingStatusPush {
  id: number;
  name: string;
  appliedDate: string;
  fromStatusId: number | null;
  fromLabel: string;
  toStatusId: number;
  toLabel: string;
}

interface PendingStatusPushRow {
  id: number;
  name: string;
  applied_date: string;
  from_status_id: number | null;
  from_label: string;
  to_status_id: number;
  to_label: string;
}

export class ApplicationsRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /**
   * Convert database row to Application object
   */
  private rowToApplication(row: ApplicationRow): Application {
    return {
      id: row.id,
      appliedDate: row.applied_date,
      statusId: row.status_id || undefined,
      rating: row.rating || undefined,
      applicantId: row.applicant_id,
      jobId: row.job_id,
      resumeFileId: row.resume_file_id || undefined,
      coverLetterFileId: row.cover_letter_file_id || undefined,
      referredBy: row.referred_by || undefined,
      desiredSalary: row.desired_salary || undefined,
      commutingAnswer: row.commuting_answer || undefined,
      active: row.active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get application by ID
   */
  getById(id: number): Application | null {
    const row = this.db
      .prepare<[number], ApplicationRow>('SELECT * FROM applications WHERE id = ?')
      .get(id);
    return row ? this.rowToApplication(row) : null;
  }

  /**
   * Get all applications
   */
  getAll(limit?: number, offset?: number): Application[] {
    let query = 'SELECT * FROM applications ORDER BY applied_date DESC';
    const params: (number | undefined)[] = [];

    if (limit !== undefined) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset !== undefined) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    const rows = this.db.prepare<(number | undefined)[], ApplicationRow>(query).all(...params);
    return rows.map((row) => this.rowToApplication(row));
  }

  /**
   * Get applications by status ID
   */
  getByStatusId(statusId: number): Application[] {
    const rows = this.db
      .prepare<[number], ApplicationRow>(
        'SELECT * FROM applications WHERE status_id = ? ORDER BY applied_date DESC'
      )
      .all(statusId);
    return rows.map((row) => this.rowToApplication(row));
  }

  /**
   * Get applications by multiple status IDs
   */
  getByStatusIds(statusIds: number[]): Application[] {
    if (statusIds.length === 0) return [];
    
    const placeholders = statusIds.map(() => '?').join(', ');
    const query = `SELECT * FROM applications WHERE status_id IN (${placeholders}) ORDER BY applied_date DESC`;
    
    const rows = this.db
      .prepare<number[], ApplicationRow>(query)
      .all(...statusIds);
    return rows.map((row) => this.rowToApplication(row));
  }

  /**
   * Get applications by job ID
   */
  getByJobId(jobId: number): Application[] {
    const rows = this.db
      .prepare<[number], ApplicationRow>(
        'SELECT * FROM applications WHERE job_id = ? ORDER BY applied_date DESC'
      )
      .all(jobId);
    return rows.map((row) => this.rowToApplication(row));
  }

  /**
   * Get application by applicant ID
   */
  getByApplicantId(applicantId: number): Application | null {
    const row = this.db
      .prepare<[number], ApplicationRow>(
        'SELECT * FROM applications WHERE applicant_id = ? ORDER BY applied_date DESC LIMIT 1'
      )
      .get(applicantId);
    return row ? this.rowToApplication(row) : null;
  }

  /**
   * Search applications by applicant name or email
   */
  search(searchTerm: string): Application[] {
    const rows = this.db
      .prepare<[string, string, string], ApplicationRow>(
        `SELECT a.* FROM applications a
         INNER JOIN applicants ap ON a.applicant_id = ap.id
         WHERE ap.first_name LIKE ? OR ap.last_name LIKE ? OR ap.email LIKE ?
         ORDER BY a.applied_date DESC`
      )
      .all(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
    return rows.map((row) => this.rowToApplication(row));
  }

  /**
   * Upsert (insert or update) an application
   */
  upsert(application: {
    id: number;
    appliedDate: string;
    statusId?: number;
    rating?: number;
    applicantId: number;
    jobId: number;
    resumeFileId?: number;
    coverLetterFileId?: number;
    referredBy?: string;
    desiredSalary?: string;
    commutingAnswer?: string;
    active?: boolean;
  }): void {
    // This is the sync ingest path. `bamboo_status_id` always tracks what
    // BambooHR reports, but the working `status_id` is only advanced when it
    // has NOT been locally diverged (status_id = bamboo_status_id). That CASE
    // guard is what lets an un-pushed local triage decision survive a sync
    // instead of being overwritten by BambooHR's stale status. On first insert
    // both columns start equal (reconciled). SQLite evaluates the SET
    // expressions against the pre-update row, so the CASE compares OLD values.
    this.db
      .prepare(
        `INSERT INTO applications (
          id, applied_date, status_id, bamboo_status_id, rating, applicant_id, job_id,
          resume_file_id, cover_letter_file_id, referred_by, desired_salary, commuting_answer,
          active, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          applied_date = excluded.applied_date,
          status_id = CASE
            WHEN status_id IS bamboo_status_id THEN excluded.status_id
            ELSE status_id
          END,
          bamboo_status_id = excluded.bamboo_status_id,
          rating = excluded.rating,
          applicant_id = excluded.applicant_id,
          job_id = excluded.job_id,
          resume_file_id = excluded.resume_file_id,
          cover_letter_file_id = excluded.cover_letter_file_id,
          referred_by = excluded.referred_by,
          -- Preserve stored answers if a sync couldn't fetch them (excluded is null).
          desired_salary = COALESCE(excluded.desired_salary, desired_salary),
          commuting_answer = COALESCE(excluded.commuting_answer, commuting_answer),
          active = excluded.active,
          updated_at = datetime('now')`
      )
      .run(
        application.id,
        application.appliedDate,
        application.statusId || null,
        application.statusId || null,
        application.rating || null,
        application.applicantId,
        application.jobId,
        application.resumeFileId || null,
        application.coverLetterFileId || null,
        application.referredBy || null,
        application.desiredSalary || null,
        application.commutingAnswer || null,
        application.active !== undefined ? (application.active ? 1 : 0) : 1
      );
  }

  /**
   * Delete application by ID
   */
  delete(id: number): void {
    this.db.prepare('DELETE FROM applications WHERE id = ?').run(id);
  }

  /**
   * Get total count of applications
   */
  count(): number {
    const result = this.db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM applications').get();
    return result?.count || 0;
  }

  /**
   * Get applications with filtering, sorting, and pagination
   */
  getFiltered(options: {
    statusIds?: number[];
    jobId?: number;
    searchTerm?: string;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
    activeOnly?: boolean;
  }): Application[] {
    const { statusIds, jobId, searchTerm, sortBy = 'applied_date', sortDirection = 'desc', limit, offset, activeOnly } = options;

    // Build WHERE clause
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    if (statusIds && statusIds.length > 0) {
      const placeholders = statusIds.map(() => '?').join(', ');
      whereClauses.push(`a.status_id IN (${placeholders})`);
      params.push(...statusIds);
    }

    if (jobId) {
      whereClauses.push('a.job_id = ?');
      params.push(jobId);
    }

    if (searchTerm) {
      whereClauses.push('(ap.first_name LIKE ? OR ap.last_name LIKE ? OR ap.email LIKE ?)');
      const searchPattern = `%${searchTerm}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (activeOnly !== undefined) {
      whereClauses.push('a.active = ?');
      params.push(activeOnly ? 1 : 0);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Build ORDER BY clause with support for confidence (from application_scores table) and status
    const validSortColumns: Record<string, string> = {
      'applied_date': 'a.applied_date',
      'appliedDate': 'a.applied_date',
      'stage': 'st.status',
      'rating': 'a.rating',
      'name': 'ap.last_name, ap.first_name',
      'email': 'ap.email',
      'confidence': 'COALESCE(sc.score, -1)', // Sort by score, put NULL at end
    };

    const sortColumn = validSortColumns[sortBy] || 'a.applied_date';
    const orderByClause = `ORDER BY ${sortColumn} ${sortDirection.toUpperCase()}`;

    // Build pagination clause
    let paginationClause = '';
    if (limit !== undefined) {
      paginationClause = `LIMIT ?`;
      params.push(limit);
      if (offset !== undefined) {
        paginationClause += ` OFFSET ?`;
        params.push(offset);
      }
    }

    // Add JOINs for applicant, status, and scores
    const query = `
      SELECT a.*
      FROM applications a
      INNER JOIN applicants ap ON a.applicant_id = ap.id
      LEFT JOIN application_states st ON a.status_id = st.id
      LEFT JOIN application_scores sc ON a.id = sc.application_id
      ${whereClause}
      ${orderByClause}
      ${paginationClause}
    `;

    const rows = this.db.prepare<(string | number)[], ApplicationRow>(query).all(...params);
    return rows.map((row) => this.rowToApplication(row));
  }

  /**
   * Get count of filtered applications
   */
  countFiltered(options: {
    statusIds?: number[];
    jobId?: number;
    searchTerm?: string;
    activeOnly?: boolean;
  }): number {
    const { statusIds, jobId, searchTerm, activeOnly } = options;

    // Build WHERE clause
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    if (statusIds && statusIds.length > 0) {
      const placeholders = statusIds.map(() => '?').join(', ');
      whereClauses.push(`a.status_id IN (${placeholders})`);
      params.push(...statusIds);
    }

    if (jobId) {
      whereClauses.push('a.job_id = ?');
      params.push(jobId);
    }

    if (searchTerm) {
      whereClauses.push('(ap.first_name LIKE ? OR ap.last_name LIKE ? OR ap.email LIKE ?)');
      const searchPattern = `%${searchTerm}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (activeOnly !== undefined) {
      whereClauses.push('a.active = ?');
      params.push(activeOnly ? 1 : 0);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT COUNT(*) as count
      FROM applications a
      INNER JOIN applicants ap ON a.applicant_id = ap.id
      ${whereClause}
    `;

    const result = this.db.prepare<(string | number)[], { count: number }>(query).get(...params);
    return result?.count || 0;
  }

  /**
   * All application IDs matching a filter (same WHERE as getFiltered/countFiltered),
   * with no pagination. Used to scope a bulk operation (e.g. re-scoring) to
   * exactly the set the list is currently showing.
   */
  getFilteredIds(options: {
    statusIds?: number[];
    jobId?: number;
    searchTerm?: string;
    activeOnly?: boolean;
  }): number[] {
    const { statusIds, jobId, searchTerm, activeOnly } = options;
    const whereClauses: string[] = [];
    const params: (string | number)[] = [];

    if (statusIds && statusIds.length > 0) {
      const placeholders = statusIds.map(() => '?').join(', ');
      whereClauses.push(`a.status_id IN (${placeholders})`);
      params.push(...statusIds);
    }
    if (jobId) {
      whereClauses.push('a.job_id = ?');
      params.push(jobId);
    }
    if (searchTerm) {
      whereClauses.push('(ap.first_name LIKE ? OR ap.last_name LIKE ? OR ap.email LIKE ?)');
      const pattern = `%${searchTerm}%`;
      params.push(pattern, pattern, pattern);
    }
    if (activeOnly !== undefined) {
      whereClauses.push('a.active = ?');
      params.push(activeOnly ? 1 : 0);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `
      SELECT a.id
      FROM applications a
      INNER JOIN applicants ap ON a.applicant_id = ap.id
      ${whereClause}
      ORDER BY a.applied_date DESC
    `;
    const rows = this.db.prepare<(string | number)[], { id: number }>(query).all(...params);
    return rows.map((row) => row.id);
  }

  /**
   * Pull BambooHR's current status for an application, OVERWRITING the local
   * working status (BambooHR is authoritative on a status pull). Sets both
   * status_id and bamboo_status_id to the pulled value, so the row is no longer
   * considered a pending push. Only affects an existing row.
   */
  pullBambooStatus(applicationId: number, bambooStatusId: number): void {
    this.db
      .prepare(
        `UPDATE applications
         SET status_id = ?, bamboo_status_id = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(bambooStatusId, bambooStatusId, applicationId);
  }

  /** Map of application id -> current local status_id (for diffing a status pull). */
  getLocalStatusMap(): Map<number, number | null> {
    const rows = this.db
      .prepare<[], { id: number; status_id: number | null }>('SELECT id, status_id FROM applications')
      .all();
    return new Map(rows.map((r) => [r.id, r.status_id]));
  }

  /**
   * Update status for an application
   */
  updateStatus(applicationId: number, statusId: number): void {
    this.db
      .prepare(
        `UPDATE applications 
         SET status_id = ?, updated_at = datetime('now') 
         WHERE id = ?`
      )
      .run(statusId, applicationId);
  }

  /**
   * Get all application IDs for a specific job
   */
  getApplicationIdsByJobId(jobId: number): number[] {
    const rows = this.db
      .prepare<[number], { id: number }>('SELECT id FROM applications WHERE job_id = ?')
      .all(jobId);
    return rows.map(row => row.id);
  }

  /**
   * Set active = 0 for applications NOT in the provided list (per job)
   * This marks applications as inactive if they're no longer in BambooHR
   */
  markInactiveExcept(jobId: number, activeApplicationIds: number[]): number {
    if (activeApplicationIds.length === 0) {
      // If no applications are active, mark all for this job as inactive
      const result = this.db
        .prepare(
          `UPDATE applications 
           SET active = 0, updated_at = datetime('now') 
           WHERE job_id = ?`
        )
        .run(jobId);
      return result.changes;
    }

    const placeholders = activeApplicationIds.map(() => '?').join(', ');
    const result = this.db
      .prepare(
        `UPDATE applications 
         SET active = 0, updated_at = datetime('now') 
         WHERE job_id = ? AND id NOT IN (${placeholders})`
      )
      .run(jobId, ...activeApplicationIds);
    return result.changes;
  }

  /**
   * Batch update application statuses
   * Useful for syncing status changes from BambooHR
   */
  batchUpdateStatuses(updates: Array<{ id: number; statusId: number }>): number {
    const stmt = this.db.prepare(
      `UPDATE applications 
       SET status_id = ?, updated_at = datetime('now') 
       WHERE id = ?`
    );

    let updatedCount = 0;
    for (const update of updates) {
      const result = stmt.run(update.statusId, update.id);
      updatedCount += result.changes;
    }
    return updatedCount;
  }

  /**
   * Translate a single BulkCondition into a job-scoped SQL fragment + params.
   *
   * Match (application_scores.score): NULL-score rows are EXCLUDED for both
   * operators — unscored candidates have no match value to compare, so a Match
   * condition never sweeps them up (the UI surfaces this).
   *
   * Applied date (ISO strings sort lexicographically): 'greaterThan' = applied
   * after the given date; 'lessThan' = before it.
   */
  private buildConditionClause(
    jobId: number,
    condition: BulkCondition,
    excludeStatusIds: number[] = []
  ): { where: string; params: (string | number)[] } {
    let where: string;
    const params: (string | number)[] = [];

    if (condition.field === 'flag') {
      // Applications in this job carrying the given flag.
      where = `a.job_id = ? AND a.id IN (SELECT application_id FROM application_flags WHERE flag = ?)`;
      params.push(jobId, String(condition.value));
    } else {
      const comparator = condition.operator === 'greaterThan' ? '>' : '<';
      if (condition.field === 'match') {
        // NULL-score rows are excluded: an unscored candidate has no match value.
        where = `a.job_id = ? AND sc.score IS NOT NULL AND sc.score ${comparator} ?`;
        params.push(jobId, Number(condition.value));
      } else {
        // Applied date: ISO strings sort lexicographically.
        where = `a.job_id = ? AND a.applied_date ${comparator} ?`;
        params.push(jobId, String(condition.value));
      }
    }

    // Skip candidates already in an excluded (e.g. rejected) status so a bulk
    // action does not re-touch decided candidates and clutter the preview.
    if (excludeStatusIds.length > 0) {
      const placeholders = excludeStatusIds.map(() => '?').join(', ');
      where += ` AND (a.status_id IS NULL OR a.status_id NOT IN (${placeholders}))`;
      params.push(...excludeStatusIds);
    }

    return { where, params };
  }

  /**
   * IDs of all applications in a job matching a bulk condition.
   */
  findIdsByCondition(
    jobId: number,
    condition: BulkCondition,
    excludeStatusIds: number[] = []
  ): number[] {
    const { where, params } = this.buildConditionClause(jobId, condition, excludeStatusIds);
    const query = `
      SELECT a.id
      FROM applications a
      LEFT JOIN application_scores sc ON a.id = sc.application_id
      WHERE ${where}
    `;
    const rows = this.db.prepare<(string | number)[], { id: number }>(query).all(...params);
    return rows.map((row) => row.id);
  }

  /**
   * Count applications in a job matching a bulk condition.
   */
  countByCondition(
    jobId: number,
    condition: BulkCondition,
    excludeStatusIds: number[] = []
  ): number {
    const { where, params } = this.buildConditionClause(jobId, condition, excludeStatusIds);
    const query = `
      SELECT COUNT(*) as count
      FROM applications a
      LEFT JOIN application_scores sc ON a.id = sc.application_id
      WHERE ${where}
    `;
    const result = this.db.prepare<(string | number)[], { count: number }>(query).get(...params);
    return result?.count || 0;
  }

  /**
   * A sample of matching applications (name + score) for previewing a bulk action.
   */
  findMatchesByCondition(
    jobId: number,
    condition: BulkCondition,
    limit: number,
    excludeStatusIds: number[] = []
  ): BulkMatch[] {
    const { where, params } = this.buildConditionClause(jobId, condition, excludeStatusIds);
    const query = `
      SELECT a.id, ap.first_name, ap.last_name, ap.email, a.applied_date, sc.score
      FROM applications a
      INNER JOIN applicants ap ON a.applicant_id = ap.id
      LEFT JOIN application_scores sc ON a.id = sc.application_id
      WHERE ${where}
      ORDER BY a.applied_date DESC
      LIMIT ?
    `;
    const rows = this.db
      .prepare<(string | number)[], BulkMatchRow>(query)
      .all(...params, limit);
    return rows.map((row) => ({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      email: row.email,
      appliedDate: row.applied_date,
      score: row.score,
    }));
  }

  /**
   * Active applications in a job with applicant name + email, newest first
   * (applied_date desc, then id desc as a stable tiebreak). Used to detect
   * duplicate applications by the same person (same email) within a job.
   */
  findActiveForDuplicateCheck(
    jobId: number
  ): Array<{ id: number; name: string; email: string; appliedDate: string; statusLabel: string }> {
    const query = `
      SELECT a.id,
             (ap.first_name || ' ' || ap.last_name) AS name,
             ap.email,
             a.applied_date,
             COALESCE(st.status, '') AS status_label
      FROM applications a
      INNER JOIN applicants ap ON a.applicant_id = ap.id
      LEFT JOIN application_states st ON a.status_id = st.id
      WHERE a.job_id = ? AND a.active = 1
      ORDER BY a.applied_date DESC, a.id DESC
    `;
    const rows = this.db
      .prepare<
        [number],
        { id: number; name: string; email: string; applied_date: string; status_label: string }
      >(query)
      .all(jobId);
    return rows.map((row) => ({
      id: row.id,
      name: (row.name || '').trim(),
      email: row.email,
      appliedDate: row.applied_date,
      statusLabel: row.status_label,
    }));
  }

  /**
   * Current working status of each given application (rows with a null status
   * are omitted, since a null status cannot be restored). Used to build an
   * undo list before a bulk status change.
   */
  getStatusesForIds(applicationIds: number[]): Array<{ id: number; statusId: number }> {
    if (applicationIds.length === 0) return [];
    const stmt = this.db.prepare<[number], { status_id: number | null }>(
      'SELECT status_id FROM applications WHERE id = ?'
    );
    const entries: Array<{ id: number; statusId: number }> = [];
    for (const id of applicationIds) {
      const row = stmt.get(id);
      if (row && row.status_id !== null) entries.push({ id, statusId: row.status_id });
    }
    return entries;
  }

  /**
   * Put each application back to the given status in one transaction. Returns
   * the number of rows updated. Restoring to BambooHR's last-known status makes
   * the row no longer "pending a push".
   */
  restoreStatuses(entries: Array<{ id: number; statusId: number }>): number {
    if (entries.length === 0) return 0;
    const stmt = this.db.prepare<[number, number]>(
      `UPDATE applications SET status_id = ?, updated_at = datetime('now') WHERE id = ?`
    );
    const transaction = this.db.transaction(
      (rows: Array<{ id: number; statusId: number }>): number => {
        let updated = 0;
        for (const row of rows) updated += stmt.run(row.statusId, row.id).changes;
        return updated;
      }
    );
    return transaction(entries);
  }

  /**
   * Set the same status on many applications in one transaction.
   * Returns the number of rows updated.
   */
  setStatusForIds(applicationIds: number[], statusId: number): number {
    if (applicationIds.length === 0) return 0;

    const stmt = this.db.prepare<[number, number]>(
      `UPDATE applications
       SET status_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    );

    const transaction = this.db.transaction((ids: number[]): number => {
      let updated = 0;
      for (const id of ids) {
        updated += stmt.run(statusId, id).changes;
      }
      return updated;
    });

    return transaction(applicationIds);
  }

  /**
   * Active applications whose working status differs from BambooHR's last-known
   * status (status_id IS NOT bamboo_status_id, null-safe) — the set of local
   * changes pending a push back to BambooHR. Optionally scoped to one job.
   * `to_status_id` is guaranteed non-null (a null working status can't be pushed).
   */
  findPendingStatusPushes(jobId?: number): PendingStatusPush[] {
    const params: number[] = [];
    let jobClause = '';
    if (jobId !== undefined) {
      jobClause = 'AND a.job_id = ?';
      params.push(jobId);
    }

    const query = `
      SELECT a.id,
             (ap.first_name || ' ' || ap.last_name) AS name,
             a.applied_date,
             a.bamboo_status_id AS from_status_id,
             COALESCE(fromst.status, '(unknown)') AS from_label,
             a.status_id AS to_status_id,
             COALESCE(tost.status, '') AS to_label
      FROM applications a
      INNER JOIN applicants ap ON a.applicant_id = ap.id
      LEFT JOIN application_states fromst ON a.bamboo_status_id = fromst.id
      LEFT JOIN application_states tost ON a.status_id = tost.id
      WHERE a.active = 1
        AND a.status_id IS NOT NULL
        AND a.status_id IS NOT a.bamboo_status_id
        ${jobClause}
      ORDER BY a.applied_date DESC, a.id DESC
    `;

    const rows = this.db.prepare<number[], PendingStatusPushRow>(query).all(...params);
    return rows.map((row) => ({
      id: row.id,
      name: (row.name || '').trim(),
      appliedDate: row.applied_date,
      fromStatusId: row.from_status_id,
      fromLabel: row.from_label,
      toStatusId: row.to_status_id,
      toLabel: row.to_label,
    }));
  }

  /**
   * Mark an application's status as reconciled with BambooHR after a successful
   * push, by recording the status that was actually sent as the new
   * bamboo_status_id. Passing the pushed status (rather than reading the current
   * status_id) means a local edit made after the push is preserved as still
   * pending, instead of being falsely marked reconciled.
   */
  markStatusPushed(applicationId: number, pushedStatusId: number): void {
    this.db
      .prepare('UPDATE applications SET bamboo_status_id = ? WHERE id = ?')
      .run(pushedStatusId, applicationId);
  }
}

