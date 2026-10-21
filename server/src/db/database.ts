/**
 * Database connection and initialization
 */

import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { backupDatabase } from './backup.js';
import { migrateDatabase } from './migrator.js';
import { MIGRATIONS } from './migrations/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '../../data/hiring-helper.db');

let dbInstance: Database.Database | null = null;

/**
 * Get or create database connection
 */
export function getDatabase(): Database.Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return dbInstance;
}

/**
 * Initialize database and bring its schema up to date
 */
export async function initializeDatabase(): Promise<Database.Database> {
  try {
    // Ensure data directory exists
    const dataDir = dirname(DB_PATH);
    // Applicant PII lives under here (database, backups, résumé and summary caches):
    // keep it readable by this user only. Windows ignores the mode bits.
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    await fs.chmod(dataDir, 0o700);

    // Create or open database
    dbInstance = new Database(DB_PATH);

    // Enable foreign keys
    dbInstance.pragma('foreign_keys = ON');

    // Use WAL so the Express server and the MCP server can access the same
    // database file concurrently without SQLITE_BUSY errors.
    dbInstance.pragma('journal_mode = WAL');

    // Run any migrations newer than the database's recorded version, with a backup
    // of existing data first (see migrator.ts and DATABASE.md).
    const database = dbInstance;
    await migrateDatabase(database, MIGRATIONS, {
      backup: async ({ toVersion }) => {
        const backupPath = await backupDatabase(database, join(dataDir, 'backups'), toVersion);
        console.info(`💾 Backed up the database before updating it: ${backupPath}`);
        return backupPath;
      },
    });

    repairData(dbInstance);

    console.info('✅ Database initialized successfully');
    return dbInstance;
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Self-healing that runs on every start (idempotent, a no-op once clean). This is
 * not a migration: it is not tied to a schema version and may need to run again.
 *
 * Reconcile any row with a NULL bamboo_status_id to its current status: a row can be
 * inserted by code that predates the column, or by a stale second process. A genuinely
 * pending local change carries the PREVIOUS (non-null) BambooHR status, so this can
 * never erase one; it only treats an untracked row as already matching BambooHR.
 */
function repairData(db: Database.Database): void {
  const reconciled = db
    .prepare(
      'UPDATE applications SET bamboo_status_id = status_id WHERE bamboo_status_id IS NULL AND status_id IS NOT NULL'
    )
    .run().changes;
  if (reconciled > 0) {
    console.info(`🛠️  Repair: reconciled ${reconciled} application(s) with a NULL bamboo_status_id`);
  }
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    console.info('Database connection closed');
  }
}

/**
 * Run database in transaction
 */
export function runInTransaction<T>(fn: (db: Database.Database) => T): T {
  const db = getDatabase();
  const transaction = db.transaction(fn);
  return transaction(db);
}

