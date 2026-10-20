/**
 * Tests for pre-migration database backups. Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BACKUPS_TO_KEEP, backupDatabase, pruneBackups } from './backup.js';

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'hh-backup-'));
}

test('writes a usable copy of the database, named by time and target version', async () => {
  const dir = makeDir();
  const db = new Database(join(dir, 'live.db'));
  db.exec('CREATE TABLE people (name TEXT); INSERT INTO people VALUES (\'Alex\'), (\'Sam\')');

  const path = await backupDatabase(db, join(dir, 'backups'), 3, new Date('2026-10-21T10:30:00.000Z'));

  assert.match(path, /hiring-helper-2026-10-21T10-30-00-000Z-before-v3\.db$/);
  const copy = new Database(path, { readonly: true });
  assert.equal((copy.prepare('SELECT COUNT(*) AS c FROM people').get() as { c: number }).c, 2);
  copy.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('keeps only the newest few backups and leaves other files alone', async () => {
  const dir = makeDir();
  const names = [
    'hiring-helper-2026-01-01T00-00-00-000Z-before-v2.db',
    'hiring-helper-2026-02-01T00-00-00-000Z-before-v3.db',
    'hiring-helper-2026-03-01T00-00-00-000Z-before-v10.db',
    'hiring-helper-2026-04-01T00-00-00-000Z-before-v11.db',
    'hiring-helper-2026-05-01T00-00-00-000Z-before-v12.db',
  ];
  for (const name of [...names, 'notes.txt']) writeFileSync(join(dir, name), 'x');

  await pruneBackups(dir, BACKUPS_TO_KEEP);

  assert.deepEqual(readdirSync(dir).sort(), [...names.slice(2), 'notes.txt'].sort());
  rmSync(dir, { recursive: true, force: true });
});
