/**
 * Repository for managing application states (statuses)
 */

import { getDatabase } from '../db/database.js';
import type Database from 'better-sqlite3';

export interface ApplicationState {
  id: number;
  status: string;
  active: boolean;
}

interface ApplicationStateRow {
  id: number;
  status: string;
  active: number;
}

export class ApplicationStatesRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /**
   * Convert database row to ApplicationState object
   */
  private rowToState(row: ApplicationStateRow): ApplicationState {
    return {
      id: row.id,
      status: row.status,
      active: row.active === 1
    };
  }

  /**
   * Get state by ID
   */
  getById(id: number): ApplicationState | null {
    const row = this.db
      .prepare<[number], ApplicationStateRow>('SELECT * FROM application_states WHERE id = ?')
      .get(id);
    return row ? this.rowToState(row) : null;
  }

  /**
   * Get state by status text
   */
  getByStatus(status: string): ApplicationState | null {
    const row = this.db
      .prepare<[string], ApplicationStateRow>('SELECT * FROM application_states WHERE status = ?')
      .get(status);
    return row ? this.rowToState(row) : null;
  }

  /**
   * Get all states
   * @param activeOnly - If true, only returns active states (default: all states)
   */
  getAll(activeOnly?: boolean): ApplicationState[] {
    let query = 'SELECT * FROM application_states';
    const params: number[] = [];
    
    if (activeOnly !== undefined) {
      query += ' WHERE active = ?';
      params.push(activeOnly ? 1 : 0);
    }
    
    query += ' ORDER BY status';
    
    const rows = this.db
      .prepare<number[], ApplicationStateRow>(query)
      .all(...params);
    return rows.map((row) => this.rowToState(row));
  }

  /**
   * Upsert (insert or update) a state
   */
  upsert(state: {
    id: number;
    status: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO application_states (id, status)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status`
      )
      .run(
        state.id,
        state.status
      );
  }

  /**
   * Bulk upsert states
   */
  bulkUpsert(states: Array<{ id: number; status: string }>): void {
    const stmt = this.db.prepare(
      `INSERT INTO application_states (id, status)
       VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status`
    );

    const transaction = this.db.transaction((stateList: Array<{ id: number; status: string }>) => {
      for (const state of stateList) {
        stmt.run(
          state.id,
          state.status
        );
      }
    });

    transaction(states);
  }

  /**
   * Get or create state by status text (returns the ID)
   */
  getOrCreateByStatus(statusText: string, statusId?: number): number {
    // Try to find existing
    const existing = this.getByStatus(statusText);
    if (existing) {
      return existing.id;
    }

    // If statusId is provided, use it; otherwise generate one
    const id = statusId || this.generateId();
    this.upsert({ id, status: statusText });
    return id;
  }

  /**
   * Generate a new ID (max + 1)
   */
  private generateId(): number {
    const result = this.db
      .prepare<[], { max_id: number | null }>('SELECT MAX(id) as max_id FROM application_states')
      .get();
    return (result?.max_id || 0) + 1;
  }

  /**
   * Delete state by ID
   */
  delete(id: number): void {
    this.db.prepare('DELETE FROM application_states WHERE id = ?').run(id);
  }
}

