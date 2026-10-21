# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Hiring Helper is a BambooHR applicant-tracking interface. It mirrors BambooHR hiring data into local SQLite. Candidate scoring is done by Claude through an **MCP server** that reads that data and writes scores and summaries back; the app makes no outbound LLM call and holds no LLM key.

npm workspaces monorepo: `client` (React + Vite + TypeScript) and `server` (Express + TypeScript, ESM). The server has two entry points: the REST API (`src/index.ts`) and the MCP stdio server (`src/mcp/index.ts`).

## Commands

Run from the repo root unless noted.

```bash
npm install                  # root + both workspaces
npm run dev                  # server (:3000) and client (:5173); Vite proxies /api to the server
npm run dev:server           # server only (tsx watch)
npm run dev:client           # client only
npm run build                # client, then server
npm start                    # built REST server (server/dist/index.js)

npm run mcp --workspace=server         # MCP stdio server
npm run mcp:check --workspace=server   # starts the server from .mcp.json and lists its tools (needs a build)

npm run lint --workspace=server        # eslint
npm run lint --workspace=client        # eslint, max-warnings 0
npm run test --workspace=server        # node --import tsx --test "src/**/*.test.ts"
npm run test --workspace=client        # pure helpers only, same runner
```

- Tests use Node's built-in runner and live next to the code as `*.test.ts` (excluded from builds). There are no component or DOM tests. `.cursorrules` mentions Jest and React Testing Library; that is aspirational.
- The MCP server is registered via the project `.mcp.json` (`node --import tsx server/src/mcp/index.ts`, not `npm`, so it spawns on Windows). `.claude/settings.json` pre-approves it for headless runs. See `MCP.md` for tools and workflow.

## Running, installing and updating

Besides `npm run dev` there are two ways to run the app:

- **Zip + `start.bat`** (Windows, non-developers): `scripts/launcher/start.ps1` checks or installs Node (downloaded to `.runtime/node` if there is no even-numbered LTS >= 20, so better-sqlite3 prebuilds apply), Git for Windows (Claude Code needs Git Bash), Claude Code (plus a one-time sign-in check), runs `npm install` and `npm run build` when stale, then starts `node server/dist/index.js` on `PORT` (default 3000) and opens the browser. Foreground, no git; updates are a new zip.
- **Installer** (`install.sh` macOS/Linux, `install.ps1` Windows; one-liners in the README): prompts for folder and port (default port **28417**), installs git if missing, clones `WayneJetski/hiring-helper` (`HH_REPO_URL`/`HH_BRANCH` override, used by CI), writes `PORT` to `.env`, adds `<install>/bin` to PATH, then runs `hiring-helper start`. Prompts read `/dev/tty` or `Read-Host` and fall back to defaults with no keyboard or `HH_YES=1`. PowerShell takes `HH_*` variables because `irm | iex` cannot take parameters. Scripts are wrapped in `main`/`Install-HiringHelper` so a truncated download runs nothing.

The REST server serves `client/dist` with an SPA fallback (`utils/client-assets.ts`). The web app redirects every route to `/setup` until BambooHR is connected.

### The `hiring-helper` command

`bin/hiring-helper` (bash) and `bin/hiring-helper.cmd` -> `scripts/launcher/hiring-helper.ps1` (Windows): `start [--foreground] [--no-open]`, `stop`, `restart`, `status`, `open`, `logs [-f]`, `update [--check]`, `doctor`.

- `start` runs prerequisites (`scripts/launcher/setup.sh`, or the `Initialize-*` functions from `start.ps1`, which `hiring-helper.ps1` dot-sources; `start.ps1` runs its launcher only when not dot-sourced), then launches `node server/dist/index.js` in the background with `NODE_ENV=production` and `HIRING_HELPER_MANAGED=1`. It records `.runtime/server.pid` and logs to `.runtime/server.log` (Windows also `server.err.log`). A pid is trusted only if its command line is `server/dist/index.js`.
- `restart` runs setup first, so a failed setup leaves the running copy alone.
- Setup works from any directory: `Initialize-AppFiles` does `Push-Location $RepoRoot` before `npm ci`/`npm run build` (npm reads `package-lock.json` from the current directory, and people run `hiring-helper update` from their home folder).
- Setup uses `npm ci --include=dev` with `NODE_ENV` unset: production mode makes `npm ci` drop TypeScript and Vite, and `npm install` would rewrite `package-lock.json` and dirty the clone.
- `HH_SKIP_CLAUDE=1` skips Claude Code (CI, headless).

### MCP self-check (`server/src/mcp/mcp-check.ts`, `mcp-check.cli.ts`, `hiring-helper doctor`)

Scoring is the only feature that needs the MCP server, so a broken one used to surface only at the first scoring click. The check spawns the exact command in `.mcp.json` from the repo root, lists tools, requires `REQUIRED_TOOL_NAMES`, and warns if `.claude/settings.json` does not pre-approve the server.

- `hiring-helper start` runs it **after** the server is healthy (the MCP server opens the DB, so app start-up must migrate first) and only warns. `setup.sh`/`start.ps1` and the zip path do not run it (use `npm run mcp:check`).
- `diagnoseServerLog` turns a `NODE_MODULE_VERSION` crash (two Node installs, e.g. nvm plus Homebrew) into advice.
- Tests use `server/src/mcp/test-fixtures/fake-mcp-server.mjs`.

### Updates (`UpdateService`)

- **Check:** `GET /api/update/status[?refresh=1]`, cached 5 minutes, managed installs only (`HIRING_HELPER_MANAGED=1`; a developer checkout never reaches out). It runs `git ls-remote origin refs/heads/<branch>` and reports an update when that commit is not an ancestor of `HEAD` (`git merge-base --is-ancestor`). "Present on disk" is not enough, because a rolled-back update leaves the commit downloaded. `UpdateBanner` checks on load and hourly.
- **Apply:** `POST /api/update/apply`, then poll status; the user always clicks. Refused if not managed, already updating, scoring is running (`scoring-runtime.ts`), or tracked files other than `package-lock.json` are modified (lockfile churn is restored with `git checkout`). Steps: `git pull --ff-only`, `npm ci --include=dev` only if a `package*.json` changed, `npm run build`, write `.runtime/build.stamp` (so the restart skips a rebuild), then spawn `bin/hiring-helper restart --no-open` detached. The page reloads when the new commit answers (`utils/updateProgress.ts`).
- **Failure:** `git reset --hard <previous>`, reinstall, rebuild, and report the compiler error (`summarizeFailure` drops npm boilerplate). The old server keeps running throughout. Child commands get `commandEnvironment` (no `NODE_ENV`, no password prompts). DB migrations run on the next start, with a backup.
- **Manual end-to-end test** (needs real installs; do it after changing any launcher, installer or updater code): clone the working tree into a scratch git repo as "origin", run `install.sh` against it with a fake `HOME`, a minimal `PATH` (no Node, so it downloads one) and `HH_SKIP_CLAUDE=1`, commit a release to the scratch origin, then drive `/api/update/*` with curl. `POST /api/update/apply` is browser-only, so send `-H "Origin: http://localhost:<port>"` (and `.claude/settings.json` denies Claude running that curl; run it yourself in a terminal).

### Launcher file rules

Keep `start.ps1` ASCII-only and the `.bat`/`.ps1` files CRLF (`.gitattributes`). Build scripts must stay cross-platform (no `cp`/`rm`; the server build uses a Node one-liner).

### Continuous integration (`.github/workflows/ci.yml`, pull requests into `main` only)

- **test**: build, lint and tests on macOS (Node 22, 24) and Windows (Node 22). The server test glob needs Node 21+.
- **launcher**: parses `start.ps1`, `hiring-helper.ps1`, `install.ps1` with Windows PowerShell 5.1.
- **installer-macos / installer-windows**: run the real installer against the commit under test (`HH_REPO_URL=file://...`, branch `ci-install`), start the app, hit `/health` and `/api/update/status`, run `update --check` and `doctor`, stop it.
- **hygiene** (macOS, so portable tools only, no `grep -P`): fails on a `package-lock.json` pointing at a non-public registry, tracked local data or `.env` files, non-ASCII in Windows scripts, a shell script that fails `bash -n`, or one that lost its executable bit.

Reproduce the test job locally: `npm ci && npm run build && npm run lint --workspace=server && npm run lint --workspace=client && npm run test --workspace=server && npm run test --workspace=client`.

### Maintenance scripts (`scripts/`)

One-off, not part of the build.

- `*.sh` (e.g. `regenerate-all-summaries.sh`, `backfill-scores.sh`) call the **running** dev server's HTTP API, so start `npm run dev` first.
- `*.ts` import server modules directly and run via `npx tsx scripts/<name>.ts`. They import from `../server/src/...js` with `.js` extensions (ESM rule below).

## Architecture

### Data flow

```
BambooHR API -> BambooHRSyncService -> SQLite -+- ApplicantsController -> REST -> React client
                                               +- MCP server (stdio) -> Claude -> save_evaluation
```

`ApplicantQueryService` holds the read/assembly logic (list, detail, resume text, unscored queue, scoring context) so the REST controller and MCP tools share one implementation. The controller is thin (HTTP parsing and status codes). The client never talks to BambooHR. The one live fetch is resume PDFs (binary): fetched from BambooHR, parsed with `unpdf`, cached to disk.

### Sync (`bamboohr-sync.service.ts`)

- Runs automatically on REST-server startup (`startServer`), and on demand via `POST /api/sync` or the `sync_from_bamboohr` MCP tool. It only ingests; nothing scores in the background.
- Incremental by default: the last **successful** (`full`/`incremental`) `content_updates` timestamp is BambooHR's `newSince`. Failed and rate-limited attempts are logged there but never advance the watermark. A full sync (`force=true`) also marks applications `inactive` when they vanish from BambooHR (`markInactiveExcept`, per job).
- A BambooHR 429 records a `rate_limited` entry, returns 0, and keeps serving cached data.
- **New-job discovery** (incremental, `sync-discovery.ts`): snapshots the stored job ids, then backfills every not-yet-stored application of any job id never seen before. This catches applicants who predate our access to a job, which `newSince` would skip. It reuses the applications list already fetched for status pulls (extra cost: detail fetches only). A job with zero applicants is still not created.

### AI scoring (MCP-driven)

Claude reads a candidate (`get_resume_text`, `get_job_description`), assesses fit, and calls `save_evaluation`, the only write path. `EvaluationService.saveEvaluation` validates confidence 0-100, stores the score in `application_scores` (SQLite) and the summary in the disk cache. The `evaluate_candidate` MCP prompt bundles rubric and resume, fencing candidate text and marking it as data (trusted rubric vs untrusted candidate). The `/score-candidates` skill (`.claude/skills/`) drives the flow.

**Per-job criteria (structured, not a raw prompt).** The rubric is a fixed template, `server/prompts/ai-evaluation-system.txt` (safety rules, scoring rules, `save_evaluation` instructions, `{{JOB_TITLE}}`/`{{JOB_DESCRIPTION}}`), plus generated `{{EVALUATION_FRAMEWORK}}`, `{{RED_FLAGS}}`, `{{FLAGS_TO_PASS}}`. Users edit only a `ScoringConfig` (`server/src/scoring/scoring-config.ts`, pure, tested):

- Weighted evaluation areas (name, points, guidance); points must total exactly 100.
- Five red-flag toggles, keys `name`, `location` (free-text `locale`), `studying`, `no_exp`, `tenure` ("Tenure / Gaps": a pattern of short roles or unexplained gaps of about six months or more, excluding internships, co-ops, placements, contract/freelance/temporary work, and gaps the résumé explains). All default on except `location`, which stays off until a job names where it is based. Salary flags are separate (below).
- **The model never adjusts its score for a flag**; a flag lowers the score only through its penalty, applied by the app.
- `jobs.scoring_config` holds the JSON (NULL = `DEFAULT_SCORING_CONFIG`). `composeRubric` fills the template and strips `{{`/`}}` from user text so it cannot inject placeholders. The generated "Flags to pass to save_evaluation" list is what the skill follows, so a disabled flag is never set.
- `JobDescriptionService.getSystemPrompt(jobId)` returns the composed rubric. It reaches scoring through the `evaluate_candidate` prompt (`fillRubric`, interactive) and the model-callable **`get_system_prompt` tool**, which `/score-candidates` treats as authoritative (MCP prompts are not model-invocable in a headless `claude -p` run).
- **Legacy:** `jobs.system_prompt` (old free-text override) is kept as a backup. On startup `convertLegacyRubrics` converts parseable ones into `scoring_config` (`parseLegacyRubric` reads the place from the old "based in X" sentence). One it cannot convert keeps being used as written until the user clicks "Switch to guided criteria" (resets to defaults, clears it).

**Calibration and per-area scores.** The template teaches evidence-first scoring: find evidence per area, then assign points as a share of the maximum. Required items outweigh preferred ones, adjacent experience earns partial credit, missing evidence for a soft area is neutral, and a candidate meeting every requirement should land about 75-85 (typical qualified: 60-70).

- It deliberately has no "be strict" wording: that, plus a harsh skill and generated "discount" guidance, once pushed averages to about 50.
- Soft areas stay small (default culture 5, presentation 10); `EXAMPLE_CRITERIA` and the generator prompt match. The generator asks for 4 to 6 areas, guidance lines as alternatives (not a checklist), tools named as examples only, and independent areas (a generated job once scored 46%/40%/41% of max on three overlapping areas).
- Name capitalization is judged only by its flag, not also in Presentation.
- `save_evaluation` takes `areaScores` (`name` + `points` per area). `validateAreaScores` (`scoring/area-scores.ts`) rejects an unknown, repeated, missing or out-of-range area, or a sum that is not `confidence`, with a message the model can act on. The breakdown is stored in the summary (`areaScores` with each maximum) and shown as "Score Breakdown". Skipped for jobs on a legacy rubric; older summaries have none.
- Jobs with saved custom criteria keep them; only jobs on defaults pick up new weights.

**Red-flag penalties.** Each flag has a `penalty` set by slider: `none` (default), `bit` = -5, `lot` = -15, `dealbreaker` = cap at 20. The model scores on merit and only reports flags; `saveEvaluation` applies them with the pure `applyFlagPenalties` (`scoring/flag-penalties.ts`) and stores the final score. When a penalty applied, the summary carries `scoreAdjustment` (merit score and penalties) and the AI card explains it. Older configs load as `none`. A changed penalty affects only later scoring; use Re-score for existing applicants. Keep the client's `FLAG_PENALTY_LEVELS` (`utils/scoringConfig.ts`) in step with the server numbers.

**Desired-pay flags are app-owned.** `redFlags.salaryLow`/`salaryHigh` (`SalaryFlagSetting`: `enabled`, `penalty`, yearly `threshold`) are off until a threshold is entered and are not in the rubric. `saveEvaluation` derives `salary-low`/`salary-high` from `applications.desired_salary` with `deriveSalaryFlags` (`scoring/salary.ts`, which also owns `parseSalary`) and rewrites stored salary flags via `reconcileSalaryFlags` (a check that is off leaves existing flags alone). The same penalty slider applies.

**Batched runs (`ScoringService`).** Ids are scored in batches of `SCORING_BATCH_SIZE` (12), one headless `claude -p` run after another, so each batch starts fresh and earlier résumés cannot anchor later scores. `POST /api/score` passes the unscored ids (`isRescore: false`); re-score passes its filtered ids. Progress, cancel and errors span the whole run (an error or cancel stops remaining batches). A start with no ids runs one session over the unscored queue.

**Triggering scoring from the web.** "Score new applicants" (`POST /api/score`) spawns headless Claude Code (`claude -p`) in the repo root to run `/score-candidates` against the `hiring-helper` MCP.

- Sandboxed by `services/claude-sandbox.ts`: `--tools Skill` (no built-in Bash/file/web tools), `--strict-mcp-config` (only this project's server), the seven scoring tools allowed and the rest (`save_job_posting`, `sync_from_bamboohr`, ...) removed with `--disallowedTools`, no `BAMBOOHR_API_KEY` in the child's environment, and the batch's ids passed to the MCP server as `HIRING_HELPER_SCORING_SCOPE` (inline `--mcp-config`), which `mcp/application-scope.ts` enforces in `get_applicant`, `get_resume_text`, `save_evaluation` and the prompt (unset = a person driving Claude Code, unrestricted; set but malformed = nothing allowed). A test requires every registered MCP tool to be classified as allowed or withheld, so a new tool must be placed on purpose. Single-flight.
- Pins `--model` (default `claude-sonnet-5-5`, override with `SCORING_MODEL`): capable enough for rubric scoring and much cheaper and faster than inheriting Opus.
- Progress comes from `--output-format stream-json` (counts `save_evaluation` calls); the UI polls `GET /api/score/status`.
- **Prerequisite:** the Claude Code CLI must be installed and signed in on the host. Scoring spends tokens on that account.

**Claude sign-in from the app (`ClaudeAuthService`).** `GET /api/setup/status` reports `claude.signedIn`/`account`/`isSigningIn` from `claude auth status` (JSON, cached 15 s; unreadable output is `null`/unknown, never "signed out"). `POST /api/setup/claude/signin { sso? }` runs `claude auth login [--sso]` (stdio ignored, one at a time, killed after 5 min; `.../signin/cancel` stops it). It opens the browser on this machine, so it relies on the loopback-only server running locally. The setup screen polls while a sign-in is open, and the applicant list shows a banner when Claude is missing or signed out. A "not logged in" result maps to `NOT_SIGNED_IN_MESSAGE` in both `ScoringService` and `ClaudeRunner`.

**Job scoping.** Candidates belong to a job (`applications.job_id`). `list_applicants`/`list_unscored_applicants` and the web list default to the **current job** (`ApplicantQueryService.resolveCurrentJobId()`, the most recent application activity) so postings are not mixed. `listJobs()`, `GET /api/jobs` and `list_jobs` enumerate jobs.

**Job setup gate.** A job can be scored only when *ready*: posting text (`jobs.description`) and person-confirmed criteria (`jobs.criteria_confirmed_at`), per the pure `scoring/job-readiness.ts`.

- Saving criteria confirms them, as does "Confirm criteria" (`PATCH /api/jobs/:id { criteriaConfirmed: true }`); resetting to defaults does not undo it.
- A one-time startup migration (`confirmCriteriaOfJobsInUse`) confirms jobs already in use (custom criteria or scored applicants). A brand-new job from sync stays unconfirmed.
- `POST /api/score` and `/api/score/rescore` return **409** with a plain-language message for a job that is not ready; the UI disables the buttons and shows a checklist banner that opens Job settings. `JobSummary`/`JobDetail` carry `hasPosting`, `isCriteriaConfirmed`, `isReadyToScore`.
- The MCP/skill path is not gated (a person driving Claude Code directly).

**AI criteria suggestions.** Job settings can draft criteria through `RubricGeneratorService` and `ClaudeRunner` (one `claude -p --output-format json` call in an empty temp folder with `--tools "" --strict-mcp-config`, same sign-in, `SCORING_MODEL` applies):

- *Generate from job description*: `POST /api/jobs/:id/criteria/suggest`, no body.
- *Help me generate criteria*: `POST /api/jobs/:id/criteria/questions` returns 3 to 5 role-specific multiple-choice questions (a general set if the reply is unusable); the browser then sends `{ answers }` to `/criteria/suggest`. The UI offers an "Other" free-text answer for each.
- Suggestions are **drafts only**: `parseCriteriaResponse` validates them (weights close to 100 are rescaled to exactly 100), the editor applies them unsaved, Undo restores the previous areas. Red flags are never generated.
- One generation at a time (409 otherwise); one retry if a reply cannot be read; closing the browser aborts the run. `EXAMPLE_CRITERIA` in `scoring/rubric-generation.ts` is the example shown to the model.

**Job posting store.** BambooHR's authenticated `/applicant_tracking/jobs` gives metadata and a public `posting_url` but no posting body. The public careers site serves it as JSON (`https://<subdomain>.bamboohr.com/careers/<jobId>/detail`, HTML description), which `job-posting-fetcher.ts` converts to plain text.

- Sync auto-fills `jobs.description` only for jobs first seen in that sync and only if empty, so edits are never overwritten; closed jobs 404 and are skipped. `POST /api/jobs/:id/import-posting` returns the text unsaved for review.
- `syncJobs()` captures `posting_url`/`posted_date`/`status`/`title` into existing rows (`JobsRepository.updateMetadata`, update-only). `upsert` and `updateMetadata` touch only metadata columns (with `COALESCE`), so a sync never wipes `description` or `system_prompt`.
- Posting text and rubric are writable from the web UI (`PATCH /api/jobs/:id` -> `saveJobPosting`/`saveSystemPrompt`), and the posting via the `save_job_posting` MCP tool. `getJobDescription` is DB-first, falling back to legacy `server/data/job-descriptions/*.txt`.

### Upstream errors (`server/src/errors/`)

BambooHR and Claude Code failures are wrapped before they can reach a screen. `UpstreamServiceError` carries a `kind` (`unavailable`, `rate_limited`, `unauthorized`, `forbidden`, `not_found`, `timeout`, `network`, `rejected`, `unknown`), a user-facing `message`, and the raw failure only as `cause` (logged where caught, never returned).

- `raiseBambooHRError` (`bamboohr-http.ts`) maps HTTP status and network code through `classifyBambooHRFailure`. A gateway 503 HTML page used to be shown to the user verbatim. `isBambooRateLimitError` now reads `kind`, not message text.
- Claude Code text (`claude-runner.ts`, `scoring.service.ts`) goes through `describeClaudeFailure`: overload, usage limit, billing, offline and signed-out are recognised; anything else becomes a generic message with the raw text in the log.
- Controllers answer with `respondWithError`: upstream failures get their mapped status (503 unavailable, 429, 504, 502) plus `kind` and `isRetryable`; other errors keep the old 500 shape. Add new BambooHR/Claude call sites to this path rather than interpolating `error.message`.
- **A temporary failure never says the key is bad.** `ConnectionTestResult.isTemporaryFailure` is set for outages, rate limits, timeouts and offline; the setup screen then shows "Check again" and keeps the saved key, and the saved-connection cache skips these results. Only 401, 403 and a wrong subdomain ask for a new key.

### MCP server (`server/src/mcp/`)

- `index.ts` (stdio entry) imports `stdio-logging.ts` **first** to reroute `console.log`/`info`/`debug` to stderr: stdout is the JSON-RPC channel and the ingest/repository code is chatty. Then it inits the DB and connects `StdioServerTransport`.
- `server.ts` builds the `McpServer` and registers tools and the prompt with injected services (`deps.ts` holds `McpDeps`). Tools: `tools/read.tools.ts`, `write.tools.ts`, `ingest.tools.ts`; prompt in `prompts/`.
- Tool schemas use `zod`. Results go through `result.ts` (`jsonResult`/`textResult`/`errorResult`).

### Storage is split between SQLite and disk

Not everything called a "repository" is database-backed.

- **SQLite** (`server/data/hiring-helper.db`): `jobs`, `applicants`, `applications`, `application_states`, `application_scores` (the confidence **integer only**), `content_updates`.
- **Disk JSON caches** (`server/data/cache/application/`): `summary/<applicationId>.json` (full AI summary) and `resume/<resumeFileId>.json` (parsed résumé). `ApplicationSummaryRepository` and `ResumeRepository` are file-backed.
- So the confidence number lives in SQLite and the summary prose on disk. `server/data/scores.json` is a legacy pre-2.0 artifact the app ignores.

### Status model

`applications.status_id` is a FK into `application_states`, resolved via `ApplicationStatesRepository`; both tables carry an `active` flag. The local `application_states.id` **is** BambooHR's status id (`getOrCreateByStatus` stores `status.id` as the PK), so statuses need no mapping table.

### Status write-back to BambooHR (`bamboo-push.service.ts`)

Triage is local by default; local status changes can be pushed on demand. `applications.bamboo_status_id` is the status BambooHR last reported; `status_id` is the working value local triage edits. A row with `status_id <> bamboo_status_id` is **pending a push** (`findPendingStatusPushes`).

- **Sync protection:** the sync `upsert` always sets `bamboo_status_id = excluded.status_id` but advances `status_id` only when not locally diverged (`CASE WHEN status_id IS bamboo_status_id THEN excluded.status_id ELSE status_id END`). An un-pushed local edit survives a sync while BambooHR's truth is still tracked.
- **Push:** `pushStatuses` calls `BambooHRStatusWriter.updateApplicationStatus` (the ONLY BambooHR write; see Security boundaries) per pending row, then `markStatusPushed(id, pushedStatus)`. Sequential and 429-aware (halts with partial progress, logs `rate_limited`). A rejection "reason" is just the rejection status.
- **Never emails candidates:** `updateApplicationStatus` sends `{ status }` only, and no email/disposition endpoint is called anywhere. Do not add one.
- Local wins a two-sided conflict; the from->to preview surfaces it. Web UI and REST only, no MCP tool.

### API surface

Static routes are registered before `/:id` (see gotchas).

- `GET /api/applicants`: `statusIds` (comma-separated), `jobId`, `search`, `page`, `limit` (max 50), `sortBy`, `sortDirection`, `active`. Also `GET /statuses`, `/:id`, `/:id/resume`; `PATCH /:id/status` (single local move).
- `POST /api/applicants/bulk-preview | bulk-reject | bulk-move`: job-scoped, by a Match/Applied-Date condition; update the **local** `status_id` only.
- `POST /api/applicants/bulk-restore` (`{ entries: [{ id, statusId }] }`): undo a bulk reject/move/duplicate cleanup using the returned `previousStatuses` (local only).
- `GET /api/applicants/push/preview?jobId=`, `POST /api/applicants/push` (`{ jobId?, changes: [{ id, toStatusId }] }`, required: exactly what the person reviewed, parsed by `validation/reviewed-changes.ts`; a row edited since is skipped and counted in `changedSinceReview`): push to BambooHR (status only, never emails). Browser-only (`requireBrowserOrigin`), as are the routes that change an applicant's stage.
- `POST /api/applicants/push/discard` (`{ jobId?, ids? }`): return each applicant to `bamboo_status_id` (local only; changes whose BambooHR stage is unknown are skipped). The Send modal offers Roll back per change and Roll back all.
- `GET /api/jobs` (counts and latest activity; drives the job selector). `GET /api/jobs/:id` (description, effective `scoringConfig`, `scoringConfigIsCustom`, `isLegacyPromptActive`). `PATCH /api/jobs/:id` (`{ description?, postingUrl?, scoringConfig?, resetScoringConfig?, criteriaConfirmed? }`): an invalid `scoringConfig` (e.g. points not totalling 100) gets a 400 before anything is saved. Local only.
- `POST /api/jobs/:id/criteria/questions`, `/criteria/suggest` (`{ answers? }`), `/import-posting`: draft or fetch only, nothing saved.
- `POST /api/score` (`{ jobId? }`), `GET /api/score/status`, `POST /api/score/cancel` (saved scores are kept), `POST /api/score/rescore/preview` and `/rescore` (`{ jobId, statusIds?, search?, active? }`, overwrites scores for every candidate matching the list filter using the current rubric; preview returns a count). `ScoringStatus` carries `total` and `cancelled`, which drive the progress bar.
- `GET /api/setup/status`, `POST /api/setup/bamboohr/test`, `POST /api/setup/bamboohr`, `POST /api/setup/claude/signin` (see Config and sign-in).
- `POST /api/sync`, `GET /api/sync/status`, `GET /api/sync/history`.
- `GET /api/update/status[?refresh=1]`, `POST /api/update/apply`.

## Client UX conventions

- **Setup gate.** Until BambooHR is connected, `App.tsx` redirects every route to `/setup` (`SetupScreen`); afterwards `/setup` reopens it to change credentials.
- **Help overlay.** The top-bar **Help** button opens `HelpOverlay`: a dimmed spotlight over the current page with numbered badges explained in one legend card. Elements opt in with `data-help="<id>"`; the id-to-text list is in `HelpOverlay.tsx`; legend position (bottom center, or top center if that hides fewer highlights) and column count come from the pure `utils/helpOverlayLayout.ts`. To document a control, add the attribute and a step.
- **Layout.** The page header holds **Sync with BambooHR** and `SyncStatus` (warns on failed/rate-limited). One action bar under the filters holds `ScoringControls` (Score new applicants with unscored count, Re-score, progress/cancel), the `BulkActions` dropdown, and **Send to BambooHR** (only while changes wait; filled amber with a count; needs an explicit checkbox confirmation). Scoring confirmations and progress span the full row (`.action-panel`).
- **Modals.** Bulk reject/move/duplicate/send forms and Job settings open in `Modal` (shared `useDialogBehavior`: Escape, focus trap, focus restore; `size="wide"` option). A bulk reject/move/cleanup closes on success and leaves an Undo banner. Job settings' criteria editor has a left menu (Evaluation framework, Red flags) showing one section at a time and flagging an invalid points total.
- **Undo is client-held only** (`BulkActions` keeps the last `previousStatuses`); it is lost on reload.
- **Bulk defaults.** Reject defaults to "Match is less than 50" and move to "greater than", so the first view targets the weakest candidates (`defaultOperator` in `BulkActions.tsx`).
- **Row menu** (`RowActionsMenu`, rendered in a portal because the table clips overflow), three groups: **Move to stage, Reject** (`RowActionModal`, a single local change with Undo via `bulk-restore`); **View résumé** (`ResumeModal`) and **View profile**; **Copy applicant link**. There is no Notes action: a notes link redirected to BambooHR's /jobs page, and notes live in BambooHR. Menu clicks must stop propagation, because React events bubble through portals and would also open the row.
- **BambooHR links** (`utils/bamboohrLinks.ts`, used by Copy link and the applicant page's **Open in BambooHR** button, hidden until the company address is known): `https://<subdomain>.bamboohr.com/hiring/candidates/<id>`, where `<id>` is the **application id** (`applications.id`, the id in our own `/applicants/:id` URL), NOT the person's `applicants.id` (exposed as `applicantId`). Despite the "candidates" path, the person id opened a different applicant (consistently off by the gap between the two id sequences). If a link opens the wrong person, revisit the id choice; **Copy email** is the fallback.
- **Résumé viewer.** `ResumeModal` steps through the applicants last shown in the list (`applicantNavigation.ts`, sessionStorage) and hosts a `StageMover` footer with a one-click "Not a Fit".
- **Filters.** Status filters are remembered per job (`filterStorage.ts`). `ViewsMenu` offers built-in views from the status groups plus user-saved views (`savedViews.ts`, localStorage).

## Security boundaries

The full model is in `SECURITY.md`; the rules that code changes must keep:

- **Reading applicants never writes to BambooHR.** `BambooHRService` is read-only; the one write (`BambooHRStatusWriter.updateApplicationStatus`, status field only) is imported only by `bamboo-push.service.ts`. `bamboohr-http.ts` enforces it at the network layer (read-only client: GET only; writer: POST to `/applicant_tracking/applications/<n>/status` only; no absolute URLs, no redirects off bamboohr.com). `architecture/bamboohr-write-isolation.test.ts` fails if the MCP server can reach the writer, push service or a controller. Never add an MCP tool or prompt that changes BambooHR, and never give the MCP deps the writer.
- **Applicant-supplied text is hostile.** Never render it as a link without `utils/safeUrl.ts` (`javascript:` hrefs would run in the app's origin and can call its API), never interpolate it into a prompt outside the fenced candidate-data block, and never give a run that reads it a shell, file or web tool.
- **Headless Claude runs use `claude-sandbox.ts`** (see Triggering scoring). New MCP tools must be added to its allowed or withheld list (a test enforces this).
- **`.env` and `server/data/` stay owner-only** (`utils/private-file.ts`, `initializeDatabase`).
- Production dependencies must stay clean under `npm audit --omit=dev`.

## Conventions and gotchas

- **ESM `.js` import extensions.** The server is ESM (`"type": "module"`, `moduleResolution: node`). Relative imports must end in `.js` even though the source is `.ts` (`import { getDatabase } from '../db/database.js'`), or build/runtime breaks.
- **DB singleton and migrations.** `getDatabase()` throws until `initializeDatabase()` has run. That runs the versioned migrations (`server/src/db/migrator.ts`, `migrations/`): version in `PRAGMA user_version`, each pending migration in its own transaction, a backup of an existing DB written first to `server/data/backups/` (gitignored, newest 3 kept), and a DB from a newer app is refused. A new DB replays every migration from 0, so there is no separate fresh path. To change the schema: add a numbered migration (never edit a shipped one), update `server/src/db/schema.sql` (a test fails if it disagrees with the migrations), and add a test. See `DATABASE.md`. Per-boot self-healing not tied to a version goes in `repairData`. The old `scripts/add-*-migration.ts` files are superseded.
- **Repository pattern.** DB columns are `snake_case`, domain objects `camelCase`. Each DB repository has a private `get db()` and a private `rowToX` mapper. `better-sqlite3` is synchronous; some repositories (`ScoresRepository`, the file caches) wrap calls in `async` for a uniform interface.
- **Route ordering.** Register static routes (e.g. `/api/applicants/statuses`) above param routes so `/:id` does not swallow them.
- **Loopback only.** The REST server binds to `127.0.0.1` (`LOOPBACK_HOST` in `server/src/index.ts`) and Vite to `127.0.0.1` (`client/vite.config.ts`), because the API has no auth and serves applicant PII. Do not bind `0.0.0.0` without adding authentication. The guard from `createLocalOnlyGuard` (`middleware/local-only.middleware.ts`) also refuses any request whose `Host` is not `localhost`/`127.0.0.1`/`[::1]` (DNS rebinding) and any POST/PATCH/DELETE whose `Origin` is not this server's own port or the dev client's port (`allowedOriginsFor`; another localhost port is refused, and the dev client's port is trusted only outside production, where CORS is also off). Requests with no `Origin` (curl, scripts) pass the guard, but `requireBrowserOrigin` (Origin present, `Sec-Fetch-Site` same-origin or absent) is added to the routes that push to BambooHR, save the API key, start Claude sign-in or apply an update. The API accepts JSON only (no urlencoded parser).
- **Rate limiting skips GET.** `express-rate-limit` covers `/api/applicants` and `/api/sync` but skips GET, so only mutating or expensive POSTs are limited.
- **Two processes, one DB.** The REST and MCP servers both open `server/data/hiring-helper.db`; `initializeDatabase()` sets `journal_mode = WAL` to avoid `SQLITE_BUSY`.
- **Config.** One root `.env`, loaded by `server/src/config/env.config.ts` via a relative path. Sync needs `BAMBOOHR_API_KEY` and `BAMBOOHR_SUBDOMAIN`, but the server starts without them (skipping the initial sync) and the web app shows first-run setup: `GET /api/setup/bamboohr/connection` tests the SAVED key (cached 60 s server-side, dropped when credentials change, never returns the key), `POST /api/setup/bamboohr/test` tests entered ones, and `POST /api/setup/bamboohr` writes `.env` (`SetupService`, `utils/env-file.ts`), applies it in memory and starts the first sync. `BambooHRService` builds its axios client lazily so new credentials need no restart, and throws `BambooHRNotConfiguredError` until then. No LLM provider keys are used.
- **Formatting.** `.prettierrc.json`: single quotes, semicolons, 100 columns, 2-space indent, trailing commas es5. The server tsconfig is strict with `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`.
