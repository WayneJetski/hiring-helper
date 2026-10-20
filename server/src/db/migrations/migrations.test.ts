/**
 * Tests that the real migrations build the documented schema and upgrade older
 * databases without losing anything. Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { migrateDatabase } from '../migrator.js';
import { MIGRATIONS } from './index.js';

const SCHEMA_SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../schema.sql'), 'utf-8');

const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = () => undefined;
  console.warn = () => undefined;
  try {
    return await run();
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }
};

/** Tables, columns, indexes and foreign keys in a comparable form. */
function describeSchema(db: Database.Database): unknown {
  const tables = db
    .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((table) => ({
      name: table.name,
      columns: db
        .prepare<[], { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(`PRAGMA table_info(${table.name})`)
        .all()
        .map(({ name, type, notnull, dflt_value, pk }) => ({ name, type, notnull, dflt_value, pk }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      foreignKeys: db
        .prepare<[], { table: string; from: string; to: string; on_delete: string }>(`PRAGMA foreign_key_list(${table.name})`)
        .all()
        .map(({ table: target, from, to, on_delete }) => `${from}->${target}.${to} ${on_delete}`)
        .sort(),
    }));
  const indexes = db
    .prepare<[], { name: string; tbl_name: string }>("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  return { tables, indexes };
}

test('migrating a new database produces exactly the schema documented in schema.sql', async () => {
  const migrated = new Database(':memory:');
  await quiet(() => migrateDatabase(migrated, MIGRATIONS));

  const documented = new Database(':memory:');
  documented.exec(SCHEMA_SQL);

  assert.deepEqual(describeSchema(migrated), describeSchema(documented));
  assert.equal(migrated.pragma('user_version', { simple: true }), MIGRATIONS.length);
});

test('a database from before versioning, already up to date, upgrades with every row intact', async () => {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL); // what the app created before migrations were versioned (user_version 0)
  db.exec(`
    INSERT INTO application_states (id, status) VALUES (1, 'New'), (2, 'Interview');
    INSERT INTO jobs (id, title) VALUES (7, 'Engineer');
    INSERT INTO applicants (id, first_name, last_name, email) VALUES (1, 'Alex', 'Rivera', 'alex@example.com');
    INSERT INTO applications (id, applied_date, status_id, bamboo_status_id, applicant_id, job_id)
      VALUES (100, '2026-01-01', 2, 1, 1, 7);   -- a local move to Interview, pending a push
    INSERT INTO application_scores (application_id, score) VALUES (100, 81);
    INSERT INTO application_flags (application_id, flag) VALUES (100, 'tenure');`);

  await quiet(() => migrateDatabase(db, MIGRATIONS));

  const application = db.prepare('SELECT status_id, bamboo_status_id FROM applications WHERE id = 100').get() as {
    status_id: number;
    bamboo_status_id: number;
  };
  assert.deepEqual(application, { status_id: 2, bamboo_status_id: 1 }, 'the pending local change survives');
  assert.equal((db.prepare('SELECT score FROM application_scores WHERE application_id = 100').get() as { score: number }).score, 81);
  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM application_flags').get() as { c: number }).c, 1);
  assert.equal(db.pragma('user_version', { simple: true }), MIGRATIONS.length);
});

const LEGACY_RUBRIC = `### Evaluation Framework
Assess the candidate across two weighted areas:

1. Skills (0–60)
   - Relevant technologies
2. Experience (0–40)
   - Relevant roles

### Red Flags (reduce confidence)
- **Name capitalization (major flag):** If the name is in ALL CAPS...

### Confidence Scoring
- more text
`;

test('an older database gains the newer columns, and its data and rubrics are carried forward', async () => {
  const db = new Database(':memory:');
  // The shape the app had before descriptions, structured criteria, and application answers existed.
  db.exec(`
    CREATE TABLE application_states (id INTEGER PRIMARY KEY, status TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT NOT NULL, posted_date TEXT, status TEXT, posting_url TEXT,
                       created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE applicants (id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
                             source TEXT, phone_number TEXT, address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT,
                             zipcode TEXT, country TEXT, linkedin_url TEXT, available_start_date TEXT, education TEXT,
                             created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE applications (id INTEGER PRIMARY KEY, applied_date TEXT NOT NULL, status_id INTEGER, rating INTEGER,
                               applicant_id INTEGER NOT NULL, job_id INTEGER NOT NULL, resume_file_id INTEGER,
                               cover_letter_file_id INTEGER, referred_by TEXT, active INTEGER NOT NULL DEFAULT 1,
                               created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
                               FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE,
                               FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
                               FOREIGN KEY (status_id) REFERENCES application_states(id) ON DELETE SET NULL);
    CREATE TABLE application_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL UNIQUE,
                                     score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
                                     created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
                                     FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE);
  `);
  db.exec('ALTER TABLE jobs ADD COLUMN system_prompt TEXT');
  db.prepare('INSERT INTO jobs (id, title, system_prompt) VALUES (1, ?, ?)').run('Converted job', LEGACY_RUBRIC);
  db.prepare('INSERT INTO jobs (id, title, system_prompt) VALUES (2, ?, ?)').run('Unconvertible job', 'free text only');
  db.exec(`
    INSERT INTO jobs (id, title) VALUES (3, 'Scored job'), (4, 'Brand new job');
    INSERT INTO application_states (id, status) VALUES (1, 'New');
    INSERT INTO applicants (id, first_name, last_name, email) VALUES (1, 'Alex', 'Rivera', 'alex@example.com');
    INSERT INTO applications (id, applied_date, status_id, applicant_id, job_id) VALUES (100, '2026-01-01', 1, 1, 3);
    INSERT INTO application_scores (application_id, score) VALUES (100, 70);`);

  await quiet(() => migrateDatabase(db, MIGRATIONS));

  const columns = (table: string): string[] =>
    db.prepare<[], { name: string }>(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  for (const column of ['description', 'scoring_config', 'criteria_confirmed_at']) assert.ok(columns('jobs').includes(column), column);
  for (const column of ['desired_salary', 'commuting_answer', 'bamboo_status_id']) assert.ok(columns('applications').includes(column), column);

  const job = (id: number) =>
    db.prepare('SELECT scoring_config, criteria_confirmed_at, system_prompt FROM jobs WHERE id = ?').get(id) as {
      scoring_config: string | null;
      criteria_confirmed_at: string | null;
      system_prompt: string | null;
    };

  assert.ok(job(1).scoring_config, 'a convertible hand-written rubric becomes structured criteria');
  assert.equal(job(1).system_prompt, LEGACY_RUBRIC, 'the original text is kept as a backup');
  assert.ok(job(1).criteria_confirmed_at, 'a job with customized criteria counts as confirmed');
  assert.equal(job(2).scoring_config, null, 'an unconvertible rubric is left as written');
  assert.ok(job(3).criteria_confirmed_at, 'a job with scored applicants counts as confirmed');
  assert.equal(job(4).criteria_confirmed_at, null, 'a brand new job still needs confirming');

  assert.equal((db.prepare('SELECT COUNT(*) AS c FROM applications').get() as { c: number }).c, 1);
  assert.equal((db.prepare('SELECT score FROM application_scores').get() as { score: number }).score, 70);
});
