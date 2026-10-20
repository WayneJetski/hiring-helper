# Database Architecture

## Overview

The hiring helper uses a **SQLite database** to store applicant, job, and application data locally. Data is synced from BambooHR API automatically on server startup and can be manually refreshed.

AI-generated summaries and parsed resumes are **not** stored in SQLite; they are cached as JSON files on disk (see [File Locations](#file-locations)). Only the numeric confidence score is persisted to the database (`application_scores`).

## Architecture

```
┌─────────────┐
│  BambooHR   │
│     API     │
└──────┬──────┘
       │
       │ Sync (on startup / manual)
       ▼
┌──────────────┐
│   SQLite DB  │
│  Local Copy  │
└──────┬───────┘
       │
       │ Queries
       ▼
┌──────────────┐
│    Server    │
│     API      │
└──────┬───────┘
       │
       │ HTTP
       ▼
┌──────────────┐
│   Frontend   │
└──────────────┘
```

## Migrations

The database records its schema version in SQLite's `PRAGMA user_version`. On every start (the web server and the MCP server both do this), each migration newer than that version runs once, in order. A new database simply runs them all from version 0.

- **Where:** `server/src/db/migrations/` (one numbered file per change, listed in `index.ts`) and the runner in `server/src/db/migrator.ts`.
- **Safe by construction:** each migration runs in one transaction together with the version bump, so a failure changes nothing. The error says which migration failed and where the backup is.
- **Backed up first:** before applying anything to a database that already has data, a copy is written to `server/data/backups/` (the newest 3 are kept; the folder is gitignored because it holds applicant data). To undo an update, stop the app and copy a backup over `hiring-helper.db`.
- **Downgrades are refused:** a database from a newer version of the app will not be opened by an older one.
- **Also at startup:** `repairData` in `database.ts` runs every time and heals rows that need no schema change (for example a NULL `bamboo_status_id`). It is not a migration.

### Adding a migration

1. Create `server/src/db/migrations/00N-short-name.ts` exporting a `Migration` (`version: N`, a `name`, and `up(db)`).
2. Append it to `MIGRATIONS` in `migrations/index.ts`. Never edit or reorder one that has shipped.
3. Update `schema.sql` to match the new shape.
4. Add a test (see `migrations/migrations.test.ts` for how to build an older database and upgrade it).

SQLite can add columns and indexes directly. To rename or drop a column or change a constraint, rebuild the table (create the new one, copy the rows, drop the old, rename) and set `disableForeignKeys: true` on the migration. The runner then switches foreign keys off around it and refuses to commit if the rebuild left any row pointing at a missing record.

## Database Schema

`server/src/db/schema.sql` is the readable reference for the current schema. It is **not run at startup**: the database is built and upgraded by versioned migrations (see [Migrations](#migrations)), and a test fails if the migrations and `schema.sql` ever disagree, so keep both in step.

### `application_states`
Stores the possible application statuses (hiring stages) synced from BambooHR.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Status ID from BambooHR |
| status | TEXT UNIQUE | Status label (e.g. "New", "Interview") |
| active | INTEGER | `1` if the status is enabled/selectable, `0` otherwise |

### `jobs`
Stores job postings.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Job ID from BambooHR |
| title | TEXT | Job title |
| posted_date | TEXT | Date job was posted |
| status | TEXT | Job status |
| posting_url | TEXT | URL to job posting |
| description | TEXT | Full job posting text, written via the MCP `save_job_posting` tool and used for scoring |
| scoring_config | TEXT | Structured per-job scoring criteria (JSON `ScoringConfig`: weighted evaluation areas + red-flag toggles). NULL means the defaults |
| system_prompt | TEXT | Legacy hand-written rubric, kept as a backup after conversion to `scoring_config`; used only if it could not be converted |
| created_at | TEXT | Record creation timestamp |
| updated_at | TEXT | Record update timestamp |

> BambooHR's API returns only the job title, so `description`/`posting_url` are populated by Claude via MCP. `JobsRepository.upsert` uses `COALESCE`, so a BambooHR sync never overwrites them. On existing databases the `description` column is added by an automatic migration in `initializeDatabase`.

### `applicants`
Stores candidate information.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Applicant ID from BambooHR |
| first_name | TEXT | First name |
| last_name | TEXT | Last name |
| email | TEXT | Email address |
| source | TEXT | Application source |
| phone_number | TEXT | Phone number |
| address_line1 | TEXT | Address line 1 |
| address_line2 | TEXT | Address line 2 |
| city | TEXT | City |
| state | TEXT | State/Province |
| zipcode | TEXT | ZIP/Postal code |
| country | TEXT | Country |
| linkedin_url | TEXT | LinkedIn profile URL |
| available_start_date | TEXT | Available start date |
| education | TEXT | Education details |
| created_at | TEXT | Record creation timestamp |
| updated_at | TEXT | Record update timestamp |

### `applications`
Links applicants to jobs (applications).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Application ID from BambooHR |
| applied_date | TEXT | Date application was submitted |
| status_id | INTEGER FK | Foreign key to `application_states.id` (the hiring stage) |
| rating | INTEGER | Application rating (1-5) |
| applicant_id | INTEGER FK | Foreign key to `applicants.id` (ON DELETE CASCADE) |
| job_id | INTEGER FK | Foreign key to `jobs.id` (ON DELETE CASCADE) |
| resume_file_id | INTEGER | Resume file ID (for BambooHR API lookup) |
| cover_letter_file_id | INTEGER | Cover letter file ID |
| referred_by | TEXT | Referral source |
| active | INTEGER | `1` if still present in BambooHR, `0` if marked inactive by a full sync |
| created_at | TEXT | Record creation timestamp |
| updated_at | TEXT | Record update timestamp |

> Status is normalized. `status_id` references `application_states`; there is no `status TEXT` column. Resolve labels through `ApplicationStatesRepository`.

### `application_scores`
Stores AI-generated confidence scores.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTOINCREMENT | Score record ID |
| application_id | INTEGER UNIQUE FK | Foreign key to `applications.id` |
| score | INTEGER | Confidence score (0-100) |
| created_at | TEXT | Record creation timestamp |
| updated_at | TEXT | Record update timestamp |

### `content_updates`
Tracks sync history from BambooHR.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK AUTOINCREMENT | Update record ID |
| timestamp | TEXT | Sync timestamp |
| sync_type | TEXT | Type of sync (full/incremental/failed) |
| applications_synced | INTEGER | Number of applications synced |
| notes | TEXT | Additional notes |

## Data Sync

### Automatic Sync on Startup
When the server starts, it automatically syncs data from BambooHR:

1. Syncs application statuses into `application_states`
2. Checks `content_updates` table for last sync timestamp
3. Uses the `newSince` parameter to fetch only updated applications (incremental)
4. Upserts jobs, applicants, and applications into the database
5. On a **full** sync (`force=true`), marks applications no longer returned by BambooHR as `active = 0` (per job)
6. Records the sync in `content_updates` (a BambooHR rate limit is recorded as a `rate_limited` entry and does not fail the sync)

Scoring is **not** automatic. New candidates are scored by Claude through the MCP server (see [MCP.md](./MCP.md)); the score lands in `application_scores` and the written summary in the on-disk cache.

### Manual Sync
You can manually trigger a sync using the API:

```bash
# Incremental sync (only new/updated since last sync)
curl -X POST http://localhost:3000/api/sync

# Full sync (refresh all data)
curl -X POST http://localhost:3000/api/sync?force=true
```

### Sync Status
Check the last sync status:

```bash
curl http://localhost:3000/api/sync/status
```

Response:
```json
{
  "lastSync": {
    "timestamp": "2025-11-11 13:00:00",
    "syncType": "incremental",
    "applicationsSynced": 5,
    "notes": "Successfully synced 5 of 5 applications"
  }
}
```

### Sync History
View sync history:

```bash
curl http://localhost:3000/api/sync/history?limit=10
```

## File Locations

- **Database**: `server/data/hiring-helper.db`
- **Schema**: `server/src/db/schema.sql`
- **Database Module**: `server/src/db/database.ts`
- **Cached AI summaries**: `server/data/cache/application/summary/<applicationId>.json`
- **Cached parsed resumes**: `server/data/cache/application/resume/<resumeFileId>.json`
- **Legacy scores file**: `server/data/scores.json` (superseded by the `application_scores` table; no longer read by the app)

The database file and disk caches are created automatically on first run and are excluded from version control (`.gitignore`).

## Repositories

Each table has a corresponding repository class for data access:

- `JobsRepository` - Manages job records
- `ApplicantsRepository` - Manages applicant records
- `ApplicationsRepository` - Manages application records
- `ApplicationStatesRepository` - Manages the `application_states` lookup table
- `ScoresRepository` - Manages confidence scores in `application_scores` (migrated from `data/scores.json`)
- `ContentUpdatesRepository` - Manages sync history

These use the singleton database connection from `getDatabase()`.

Two other classes share the "repository" name but are **file-backed, not database-backed**:

- `ApplicationSummaryRepository` - Reads/writes full AI summaries as JSON files
- `ResumeRepository` - Reads/writes parsed resumes as JSON files

## Benefits of Local Database

1. **Performance**: Fast queries without hitting BambooHR API
2. **Offline capability**: View data when API is unavailable
3. **Search & Filter**: Efficient searching and filtering
4. **Data consistency**: Snapshot of hiring data at sync time
5. **Reduced API calls**: Only sync when needed (incremental updates)

## Migration from Direct API Calls

Previously, the app queried BambooHR API directly for every request. Now:

- **Before**: `GET /api/applicants` → BambooHR API → Response
- **After**: `GET /api/applicants` → SQLite DB → Response

Resume files are still fetched from BambooHR API as they are binary data.

## Future Enhancements

- Scheduled automatic syncs (e.g., every hour)
- Webhook integration for real-time updates
- Data export functionality
- Analytics and reporting queries
