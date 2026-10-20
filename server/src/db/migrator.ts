/**
 * Versioned database migrations.
 *
 * The database records its schema version in SQLite's `PRAGMA user_version`.
 * On startup, every migration newer than that version runs once, in order, each
 * inside its own transaction together with the version bump, so a failure leaves
 * the database exactly as it was. A fresh database simply replays every migration
 * from version 0, so fresh and upgraded databases cannot drift apart.
 *
 * To change the schema, add a new migration to ./migrations/index.ts; never edit
 * one that has shipped. See DATABASE.md.
 */

import type Database from 'better-sqlite3';

export interface Migration {
  /** 1, 2, 3 ... with no gaps. */
  version: number;
  /** Short description, shown in logs and errors. */
  name: string;
  /** Change the schema and/or data. Runs inside a transaction; throw to abort. */
  up: (db: Database.Database) => void;
  /**
   * Set for migrations that rebuild a table (create new, copy, drop old, rename).
   * Foreign keys cannot be switched off inside a transaction, so the runner turns
   * them off around it, then verifies nothing was left dangling before committing.
   */
  disableForeignKeys?: boolean;
}

export interface MigrationOptions {
  /**
   * Called once, before the first pending migration, when the database already has
   * data. Returns where the backup was written (or null if none was made).
   */
  backup?: (info: { fromVersion: number; toVersion: number }) => Promise<string | null>;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: string[];
  backupPath: string | null;
}

/** The database was written by a newer version of the app than this one. */
export class DatabaseTooNewError extends Error {
  constructor(databaseVersion: number, supportedVersion: number) {
    super(
      `This database was created by a newer version of Hiring Helper (database version ${databaseVersion}; ` +
        `this app supports up to ${supportedVersion}). Update the app, or restore a backup from server/data/backups.`
    );
    this.name = 'DatabaseTooNewError';
  }
}

/** A migration failed; its transaction was rolled back. */
export class MigrationError extends Error {
  constructor(migration: Migration, cause: unknown, backupPath: string | null) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const backupNote = backupPath ? ` A backup from before the update is at ${backupPath}.` : '';
    super(
      `Could not update the database to version ${migration.version} (${migration.name}): ${reason}. ` +
        `Nothing was changed.${backupNote}`
    );
    this.name = 'MigrationError';
  }
}

function readVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function writeVersion(db: Database.Database, version: number): void {
  if (!Number.isInteger(version) || version < 0) throw new Error(`Invalid database version ${version}`);
  db.pragma(`user_version = ${version}`);
}

/** True when the database has no tables of its own yet. */
export function isEmptyDatabase(db: Database.Database): boolean {
  const row = db
    .prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    .get();
  return (row?.count ?? 0) === 0;
}

/** A list that skips or repeats a number is a programming error, caught at startup. */
export function assertValidMigrations(migrations: Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migrations must be numbered 1, 2, 3 ... in order; found version ${migration.version} at position ${index + 1}.`
      );
    }
  });
}

/** Add a column unless the table already has it (for migrations that must tolerate older databases). */
export function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  columnType: string
): void {
  const columns = db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all();
  if (!columns.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${columnType}`);
    console.info(`🛠️  Migration: added ${table}.${column}`);
  }
}

function applyOne(db: Database.Database, migration: Migration): boolean {
  if (migration.disableForeignKeys) db.pragma('foreign_keys = OFF');
  try {
    // IMMEDIATE takes the write lock up front, so a second process starting at the same
    // moment waits, then sees the new version below and skips.
    const run = db.transaction((): boolean => {
      if (readVersion(db) >= migration.version) return false;
      migration.up(db);
      if (migration.disableForeignKeys) {
        const violations = db.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new Error(`the change left ${violations.length} row(s) pointing at missing records`);
        }
      }
      writeVersion(db, migration.version);
      return true;
    });
    return run.immediate();
  } finally {
    if (migration.disableForeignKeys) db.pragma('foreign_keys = ON');
  }
}

export async function migrateDatabase(
  db: Database.Database,
  migrations: Migration[],
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  assertValidMigrations(migrations);
  const latestVersion = migrations.length;
  const fromVersion = readVersion(db);

  if (fromVersion > latestVersion) throw new DatabaseTooNewError(fromVersion, latestVersion);
  if (fromVersion === latestVersion) {
    return { fromVersion, toVersion: fromVersion, applied: [], backupPath: null };
  }

  console.info(`🛠️  Updating the database from version ${fromVersion} to ${latestVersion}...`);

  let backupPath: string | null = null;
  if (options.backup && !isEmptyDatabase(db)) {
    backupPath = await options.backup({ fromVersion, toVersion: latestVersion });
  }

  const applied: string[] = [];
  for (const migration of migrations.filter((candidate) => candidate.version > fromVersion)) {
    try {
      if (applyOne(db, migration)) {
        applied.push(migration.name);
        console.info(`🛠️  Migration ${migration.version} applied: ${migration.name}`);
      }
    } catch (error) {
      throw new MigrationError(migration, error, backupPath);
    }
  }

  return { fromVersion, toVersion: readVersion(db), applied, backupPath };
}
