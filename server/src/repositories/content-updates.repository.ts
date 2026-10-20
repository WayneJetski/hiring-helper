/**
 * Repository for managing content update records (sync history)
 */

import { getDatabase } from '../db/database.js';
import type Database from 'better-sqlite3';

export interface ContentUpdate {
  id: number;
  timestamp: string;
  syncType: string;
  applicationsSynced: number;
  notes?: string;
}

interface ContentUpdateRow {
  id: number;
  timestamp: string;
  sync_type: string;
  applications_synced: number;
  notes: string | null;
}

export class ContentUpdatesRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /**
   * Convert database row to ContentUpdate object
   */
  private rowToContentUpdate(row: ContentUpdateRow): ContentUpdate {
    return {
      id: row.id,
      timestamp: row.timestamp,
      syncType: row.sync_type,
      applicationsSynced: row.applications_synced,
      notes: row.notes || undefined,
    };
  }

  /**
   * Get the most recent content update
   */
  getLatest(): ContentUpdate | null {
    const row = this.db
      .prepare<[], ContentUpdateRow>(
        'SELECT * FROM content_updates ORDER BY timestamp DESC LIMIT 1'
      )
      .get();
    return row ? this.rowToContentUpdate(row) : null;
  }

  /**
   * Timestamp of the last SUCCESSFUL sync, used as BambooHR's `newSince`.
   * Failed and rate-limited attempts are recorded in the same table but must not
   * advance this watermark, or changes made before the failure would be skipped.
   */
  getLastSyncTimestamp(): string | null {
    const row = this.db
      .prepare<[], { timestamp: string }>(
        `SELECT timestamp FROM content_updates
         WHERE sync_type IN ('full', 'incremental')
         ORDER BY timestamp DESC LIMIT 1`
      )
      .get();
    return row ? row.timestamp : null;
  }

  /**
   * Get all content updates (for history)
   */
  getAll(limit: number = 50): ContentUpdate[] {
    const rows = this.db
      .prepare<[number], ContentUpdateRow>(
        'SELECT * FROM content_updates ORDER BY timestamp DESC LIMIT ?'
      )
      .all(limit);
    return rows.map((row) => this.rowToContentUpdate(row));
  }

  /**
   * Create a new content update record
   */
  create(update: {
    syncType?: string;
    applicationsSynced: number;
    notes?: string;
  }): ContentUpdate {
    const result = this.db
      .prepare(
        `INSERT INTO content_updates (sync_type, applications_synced, notes)
         VALUES (?, ?, ?)
         RETURNING *`
      )
      .get(
        update.syncType || 'full',
        update.applicationsSynced,
        update.notes || null
      ) as ContentUpdateRow;

    return this.rowToContentUpdate(result);
  }

  /**
   * Delete old sync records (keep only last N)
   */
  cleanup(keepCount: number = 100): void {
    this.db
      .prepare(
        `DELETE FROM content_updates
         WHERE id NOT IN (
           SELECT id FROM content_updates
           ORDER BY timestamp DESC
           LIMIT ?
         )`
      )
      .run(keepCount);
  }
}

