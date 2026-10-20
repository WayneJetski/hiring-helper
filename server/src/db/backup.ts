/**
 * Copies of the database taken before it is migrated, so an update can always be
 * undone by putting a copy back. Uses SQLite's online backup, which is consistent
 * even while the file is in use (WAL mode).
 */

import type Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import { join } from 'path';

// Timestamp first, so sorting by name is sorting by time.
const BACKUP_FILE_PATTERN = /^hiring-helper-\d{4}-.+-before-v\d+\.db$/;

/** How many pre-migration backups are kept; older ones are deleted. */
export const BACKUPS_TO_KEEP = 3;

/** Write a backup into `backupDir` and return its path. */
export async function backupDatabase(
  db: Database.Database,
  backupDir: string,
  targetVersion: number,
  now: Date = new Date()
): Promise<string> {
  await fs.mkdir(backupDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const destination = join(backupDir, `hiring-helper-${stamp}-before-v${targetVersion}.db`);
  await db.backup(destination);
  await pruneBackups(backupDir, BACKUPS_TO_KEEP);
  return destination;
}

/** Delete all but the newest `keep` backups (names sort by time). */
export async function pruneBackups(backupDir: string, keep: number): Promise<void> {
  const names = (await fs.readdir(backupDir)).filter((name) => BACKUP_FILE_PATTERN.test(name)).sort();
  const stale = names.slice(0, Math.max(0, names.length - keep));
  await Promise.all(stale.map((name) => fs.unlink(join(backupDir, name))));
}
