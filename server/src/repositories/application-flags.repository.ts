/**
 * Repository for application flags (structured reasons attached to applications).
 */

import { getDatabase } from '../db/database.js';
import type Database from 'better-sqlite3';
import type { ApplicationFlag } from '../types/flags.js';

export class ApplicationFlagsRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /**
   * Flags for a single application.
   */
  getFlags(applicationId: number): ApplicationFlag[] {
    const rows = this.db
      .prepare<[number], { flag: string }>(
        'SELECT flag FROM application_flags WHERE application_id = ? ORDER BY flag'
      )
      .all(applicationId);
    return rows.map((row) => row.flag as ApplicationFlag);
  }

  /**
   * Flags for every application as a map of application_id -> flags[].
   * Used to decorate the applicant list without an N+1 query.
   */
  getFlagsMap(): Record<number, ApplicationFlag[]> {
    const rows = this.db
      .prepare<[], { application_id: number; flag: string }>(
        'SELECT application_id, flag FROM application_flags'
      )
      .all();
    const map: Record<number, ApplicationFlag[]> = {};
    for (const row of rows) {
      (map[row.application_id] ??= []).push(row.flag as ApplicationFlag);
    }
    return map;
  }

  /**
   * Replace all flags for an application with the given set (transactional).
   */
  setFlags(applicationId: number, flags: ApplicationFlag[]): void {
    const del = this.db.prepare('DELETE FROM application_flags WHERE application_id = ?');
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO application_flags (application_id, flag) VALUES (?, ?)'
    );
    const transaction = this.db.transaction((id: number, list: ApplicationFlag[]) => {
      del.run(id);
      for (const flag of list) {
        ins.run(id, flag);
      }
    });
    transaction(applicationId, flags);
  }

  /**
   * Remove all flags for an application.
   */
  clearFlags(applicationId: number): void {
    this.db.prepare('DELETE FROM application_flags WHERE application_id = ?').run(applicationId);
  }
}
