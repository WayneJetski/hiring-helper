-- SQLite Database Schema for Hiring Helper

-- Application states table: Stores possible application statuses from BambooHR
CREATE TABLE IF NOT EXISTS application_states (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

-- Jobs table: Stores job postings
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  posted_date TEXT,
  status TEXT,
  posting_url TEXT,
  description TEXT,
  -- Legacy hand-written per-job rubric. Superseded by scoring_config; kept as a
  -- backup, and still used only when it could not be converted (see
  -- parseLegacyRubric). NULL means no hand-written rubric.
  system_prompt TEXT,
  -- Structured per-job scoring criteria (JSON ScoringConfig: weighted evaluation
  -- areas + which red flags are on). NULL means use the default criteria.
  scoring_config TEXT,
  -- When a person confirmed this job's scoring criteria (NULL = not yet). Scoring is
  -- blocked until it is set and the posting text exists. See scoring/job-readiness.ts.
  criteria_confirmed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Applicants table: Stores candidate information
CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  source TEXT,
  phone_number TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zipcode TEXT,
  country TEXT,
  linkedin_url TEXT,
  available_start_date TEXT,
  education TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Applications table: Links applicants to jobs
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
  applied_date TEXT NOT NULL,
  status_id INTEGER,
  -- The status BambooHR last reported for this application (set by sync). The
  -- working status_id can diverge from this via local triage; a row where
  -- status_id <> bamboo_status_id is a change pending push back to BambooHR.
  bamboo_status_id INTEGER,
  rating INTEGER,
  applicant_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  resume_file_id INTEGER,
  cover_letter_file_id INTEGER,
  referred_by TEXT,
  -- Selected BambooHR application answers, captured on sync for display/triage:
  -- the candidate's desired pay and their answer to the commuting-distance question.
  desired_salary TEXT,
  commuting_answer TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (applicant_id) REFERENCES applicants(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (status_id) REFERENCES application_states(id) ON DELETE SET NULL
);

-- Application scores table: Stores AI-generated confidence scores
CREATE TABLE IF NOT EXISTS application_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL UNIQUE,
  score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

-- Application flags table: structured reasons attached to an application
-- (e.g. location / name skips, or studying / no_exp content flags).
CREATE TABLE IF NOT EXISTS application_flags (
  application_id INTEGER NOT NULL,
  flag TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (application_id, flag),
  FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
);

-- Content updates table: Tracks when data was last synced from BambooHR
CREATE TABLE IF NOT EXISTS content_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT (datetime('now')),
  sync_type TEXT DEFAULT 'full',
  applications_synced INTEGER DEFAULT 0,
  notes TEXT
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_applications_applicant_id ON applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_status_id ON applications(status_id);
CREATE INDEX IF NOT EXISTS idx_applications_applied_date ON applications(applied_date);
CREATE INDEX IF NOT EXISTS idx_applicants_email ON applicants(email);
CREATE INDEX IF NOT EXISTS idx_application_scores_application_id ON application_scores(application_id);
CREATE INDEX IF NOT EXISTS idx_content_updates_timestamp ON content_updates(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_application_states_status ON application_states(status);
CREATE INDEX IF NOT EXISTS idx_application_flags_application_id ON application_flags(application_id);
CREATE INDEX IF NOT EXISTS idx_application_flags_flag ON application_flags(flag);

