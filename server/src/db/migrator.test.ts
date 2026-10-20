/**
 * Tests for the migration runner, using throwaway databases.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  DatabaseTooNewError,
  MigrationError,
  addColumnIfMissing,
  assertValidMigrations,
  isEmptyDatabase,
  migrateDatabase,
  type Migration,
} from './migrator.js';

const quiet = <T>(run: () => T): T => {
  const original = console.info;
  console.info = () => undefined;
  try {
    return run();
  } finally {
    console.info = original;
  }
};

const version = (db: Database.Database): number => db.pragma('user_version', { simple: true }) as number;
const tableNames = (db: Database.Database): string[] =>
  db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);

const createPeople: Migration = {
  version: 1,
  name: 'create people',
  up: (db) => db.exec('CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL)'),
};
const addEmail: Migration = {
  version: 2,
  name: 'add email',
  up: (db) => db.exec('ALTER TABLE people ADD COLUMN email TEXT'),
};

test('a new database runs every migration in order and records the version', async () => {
  const db = new Database(':memory:');
  const result = await quiet(() => migrateDatabase(db, [createPeople, addEmail]));
  assert.deepEqual(result.applied, ['create people', 'add email']);
  assert.equal(result.fromVersion, 0);
  assert.equal(version(db), 2);
  assert.deepEqual(tableNames(db), ['people']);
});

test('only migrations newer than the database version run', async () => {
  const db = new Database(':memory:');
  await quiet(() => migrateDatabase(db, [createPeople]));
  db.prepare('INSERT INTO people (name) VALUES (?)').run('Alex');

  const result = await quiet(() => migrateDatabase(db, [createPeople, addEmail]));
  assert.deepEqual(result.applied, ['add email']);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM people').get().c, 1, 'existing data is kept');
});

test('running again when up to date does nothing', async () => {
  const db = new Database(':memory:');
  await quiet(() => migrateDatabase(db, [createPeople, addEmail]));
  const again = await quiet(() => migrateDatabase(db, [createPeople, addEmail]));
  assert.deepEqual(again.applied, []);
  assert.equal(version(db), 2);
});

test('a failing migration rolls back completely and keeps the old version', async () => {
  const db = new Database(':memory:');
  await quiet(() => migrateDatabase(db, [createPeople]));

  const broken: Migration = {
    version: 2,
    name: 'half done',
    up: (database) => {
      database.exec('ALTER TABLE people ADD COLUMN email TEXT');
      throw new Error('boom');
    },
  };
  await assert.rejects(quiet(() => migrateDatabase(db, [createPeople, broken])), (error: Error) => {
    assert.ok(error instanceof MigrationError);
    assert.match(error.message, /version 2 \(half done\): boom\. Nothing was changed/);
    return true;
  });

  assert.equal(version(db), 1);
  const columns = db.prepare<[], { name: string }>('PRAGMA table_info(people)').all().map((c) => c.name);
  assert.deepEqual(columns, ['id', 'name'], 'the partial ALTER was undone');
});

test('a database from a newer app is refused, not touched', async () => {
  const db = new Database(':memory:');
  db.pragma('user_version = 7');
  await assert.rejects(migrateDatabase(db, [createPeople]), DatabaseTooNewError);
  assert.equal(version(db), 7);
});

test('a backup is taken once, before migrating, only when the database already has data', async () => {
  const calls: Array<{ fromVersion: number; toVersion: number }> = [];
  const backup = async (info: { fromVersion: number; toVersion: number }): Promise<string> => {
    calls.push(info);
    return '/backups/copy.db';
  };

  const fresh = new Database(':memory:');
  await quiet(() => migrateDatabase(fresh, [createPeople, addEmail], { backup }));
  assert.equal(calls.length, 0, 'nothing to protect in an empty database');

  const existing = new Database(':memory:');
  await quiet(() => migrateDatabase(existing, [createPeople]));
  const result = await quiet(() => migrateDatabase(existing, [createPeople, addEmail], { backup }));
  assert.deepEqual(calls, [{ fromVersion: 1, toVersion: 2 }]);
  assert.equal(result.backupPath, '/backups/copy.db');

  await quiet(() => migrateDatabase(existing, [createPeople, addEmail], { backup }));
  assert.equal(calls.length, 1, 'no backup when there is nothing to apply');
});

test('a failed migration reports where the backup is', async () => {
  const db = new Database(':memory:');
  await quiet(() => migrateDatabase(db, [createPeople]));
  const broken: Migration = { version: 2, name: 'bad', up: () => { throw new Error('nope'); } };
  await assert.rejects(
    quiet(() => migrateDatabase(db, [createPeople, broken], { backup: async () => '/backups/before.db' })),
    /backup from before the update is at \/backups\/before\.db/
  );
});

test('migrations must be numbered 1, 2, 3 with no gaps', () => {
  assert.throws(() => assertValidMigrations([createPeople, { ...addEmail, version: 3 }]), /numbered 1, 2, 3/);
  assert.throws(() => assertValidMigrations([{ ...createPeople, version: 2 }]), /numbered 1, 2, 3/);
  assert.doesNotThrow(() => assertValidMigrations([createPeople, addEmail]));
});

test('a table-rebuild migration keeps child rows and checks foreign keys', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const setup: Migration = {
    version: 1,
    name: 'parent and child',
    up: (database) =>
      database.exec(`
        CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT);
        CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id) ON DELETE CASCADE);
        INSERT INTO parent VALUES (1, 'a'), (2, 'b');
        INSERT INTO child VALUES (10, 1), (11, 2);`),
  };
  await quiet(() => migrateDatabase(db, [setup]));

  const rebuild: Migration = {
    version: 2,
    name: 'rename parent.label to title',
    disableForeignKeys: true,
    up: (database) =>
      database.exec(`
        CREATE TABLE parent_new (id INTEGER PRIMARY KEY, title TEXT);
        INSERT INTO parent_new (id, title) SELECT id, label FROM parent;
        DROP TABLE parent;
        ALTER TABLE parent_new RENAME TO parent;`),
  };
  await quiet(() => migrateDatabase(db, [setup, rebuild]));

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM child').get().c, 2, 'children were not cascade-deleted');
  assert.equal(db.prepare('SELECT title FROM parent WHERE id = 2').get().title, 'b');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'foreign keys are back on');
});

test('a rebuild that strands child rows is rejected and undone', async () => {
  const db = new Database(':memory:');
  const setup: Migration = {
    version: 1,
    name: 'parent and child',
    up: (database) =>
      database.exec(`
        CREATE TABLE parent (id INTEGER PRIMARY KEY);
        CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
        INSERT INTO parent VALUES (1);
        INSERT INTO child VALUES (10, 1);`),
  };
  await quiet(() => migrateDatabase(db, [setup]));
  const lossy: Migration = {
    version: 2,
    name: 'forgot to copy the parents',
    disableForeignKeys: true,
    up: (database) => database.exec('DELETE FROM parent'),
  };
  await assert.rejects(quiet(() => migrateDatabase(db, [setup, lossy])), /pointing at missing records/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM parent').get().c, 1);
  assert.equal(version(db), 1);
});

test('addColumnIfMissing adds a column once and leaves existing ones alone', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  quiet(() => addColumnIfMissing(db, 't', 'note', 'TEXT'));
  quiet(() => addColumnIfMissing(db, 't', 'note', 'TEXT'));
  assert.deepEqual(
    db.prepare<[], { name: string }>('PRAGMA table_info(t)').all().map((c) => c.name),
    ['id', 'note']
  );
});

test('an empty database is recognised, and one with a table is not', () => {
  const db = new Database(':memory:');
  assert.equal(isEmptyDatabase(db), true);
  db.exec('CREATE TABLE t (id INTEGER)');
  assert.equal(isEmptyDatabase(db), false);
});
