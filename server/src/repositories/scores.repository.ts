/**
 * Scores Repository
 * Manages confidence score mappings for applications in SQLite database
 */

import { getDatabase } from '../db/database.js';
import type Database from 'better-sqlite3';

interface ScoresDatabase {
  [applicationId: string]: number;
}

interface ScoreRow {
  id: number;
  application_id: number;
  score: number;
  created_at: string;
  updated_at: string;
}

export class ScoresRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /**
   * Get confidence score for an application
   */
  async getScore(applicationId: number): Promise<number | null> {
    const row = this.db
      .prepare<[number], ScoreRow>('SELECT score FROM application_scores WHERE application_id = ?')
      .get(applicationId);
    return row ? row.score : null;
  }

  /**
   * Set confidence score for an application
   */
  async setScore(applicationId: number, confidence: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO application_scores (application_id, score, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(application_id) DO UPDATE SET
           score = excluded.score,
           updated_at = datetime('now')`
      )
      .run(applicationId, confidence);
  }

  /**
   * Get all scores as a map (applicationId -> score)
   */
  async getAllScores(): Promise<ScoresDatabase> {
    const rows = this.db
      .prepare<[], { application_id: number; score: number }>(
        'SELECT application_id, score FROM application_scores'
      )
      .all();
    
    const scores: ScoresDatabase = {};
    for (const row of rows) {
      scores[row.application_id.toString()] = row.score;
    }
    return scores;
  }

  /**
   * Delete score for an application
   */
  async deleteScore(applicationId: number): Promise<void> {
    this.db
      .prepare('DELETE FROM application_scores WHERE application_id = ?')
      .run(applicationId);
  }

  /**
   * Bulk update scores
   */
  async bulkSetScores(scoreMap: Record<number, number>): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO application_scores (application_id, score, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(application_id) DO UPDATE SET
         score = excluded.score,
         updated_at = datetime('now')`
    );

    const transaction = this.db.transaction((scores: [number, number][]) => {
      for (const [appId, score] of scores) {
        stmt.run(appId, score);
      }
    });

    const entries = Object.entries(scoreMap).map(([appId, score]) => [parseInt(appId, 10), score] as [number, number]);
    transaction(entries);
  }

  /**
   * Clear all scores
   */
  async clearAllScores(): Promise<void> {
    this.db.prepare('DELETE FROM application_scores').run();
  }
}

