# MCP Server

Hiring Helper ships an **MCP (Model Context Protocol) server** that exposes the local candidate store to Claude over stdio. Scoring is not done by an external LLM call from the app; instead you use Claude (Claude Code or Claude Desktop) to read candidate data and write a confidence score + written summary back to the same SQLite database and summary cache the web app reads from.

```
BambooHR ──sync──▶ SQLite + file cache ──▶ MCP server (stdio) ──▶ Claude
                        ▲                                              │
                        └───────────── save_evaluation ◀──────────────┘
```

## Prerequisites

1. `npm install` (installs `@modelcontextprotocol/sdk` and `zod` in the server workspace).
2. A `.env` with `BAMBOOHR_API_KEY` and `BAMBOOHR_SUBDOMAIN` (see [SETUP.md](./SETUP.md)). No LLM provider key is needed.
3. Data in the local DB. Either start the web server once (`npm run dev:server`) to trigger the initial sync, or call the `sync_from_bamboohr` MCP tool.

## Registering the server

### Claude Code
A project `.mcp.json` is included at the repo root and is auto-detected when you run Claude Code in this directory. It launches:

```
node --import tsx server/src/mcp/index.ts
```

(no build step needed). It calls `node` directly rather than `npm` because `npm` is `npm.cmd` on Windows, which Claude Code cannot spawn without a `cmd /c` wrapper. The project `.claude/settings.json` lists `hiring-helper` under `enabledMcpjsonServers` so headless scoring runs on a fresh machine do not wait for an interactive approval.

### Checking the wiring
`hiring-helper doctor` (or `npm run mcp:check --workspace=server` in a checkout) starts the server the way Claude Code does, using the command in `.mcp.json`, and confirms the tools scoring needs are there (`server/src/mcp/mcp-check.ts`). It also warns if `.claude/settings.json` does not pre-approve the server. `hiring-helper start` runs it after the app is up and prints a warning if it fails; CI runs it against a real install on macOS/Linux and Windows. The app itself works without the MCP server; only scoring needs it.

The usual failure is `Connection closed` with a message about `NODE_MODULE_VERSION`: the app's packages were installed under one Node.js and Claude Code finds another first on `PATH` (common with nvm plus Homebrew). Run `npm rebuild better-sqlite3` with the Node.js you want, or keep a single Node.js first on `PATH`.

### Claude Desktop
Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hiring-helper": {
      "command": "npm",
      "args": ["--silent", "run", "mcp", "--workspace=server"],
      "cwd": "/absolute/path/to/hiring-helper"
    }
  }
}
```

### Standalone smoke test
```bash
# List tools/prompts and exercise them interactively:
npx @modelcontextprotocol/inspector npm --silent run mcp --workspace=server
```

## Tools

| Tool | Purpose |
|------|---------|
| `list_jobs` | List job postings (id, title, counts, latest activity, whether a posting is stored) most-recent first, plus `currentJobId`. Use to discover job ids. |
| `list_applicants` | List candidates with filtering/sorting/pagination (active-only by default), including any existing score. **Scoped to the current job when `jobId` is omitted** (the resolved `jobId` is returned). |
| `get_applicant` | Full detail for one application, including cached summary + score. |
| `get_resume_text` | Fetch + parse a candidate's resume to plain text (the main scoring input). |
| `get_job_description` | The stored job posting text for a job (DB-first; falls back to `server/data/job-descriptions/*.txt`). |
| `list_statuses` | The hiring pipeline statuses (id + label). |
| `list_unscored_applicants` | Active applications with no score yet — the scoring work queue. **Scoped to the current job when `jobId` is omitted.** |
| `get_sync_status` | The most recent BambooHR sync (timestamp, type, count). |
| `save_evaluation` | **Write:** persist a 0-100 fit score (`confidence`) + per-area `areaScores` (must cover every evaluation area and add up to the score; a mismatch is rejected) + written summary for an application. |
| `save_job_posting` | **Write:** store the posting text (+ optional URL) for a job. Read back by `get_job_description` / `evaluate_candidate`; survives BambooHR syncs. |
| `sync_from_bamboohr` | **Ingest:** pull applications from BambooHR (incremental; `force=true` for a full sync). |

### Job scoping

Candidates belong to a job (`job_id`). `list_applicants` and `list_unscored_applicants` default to the **current job** (most recent application activity) when no `jobId` is given, so you don't mix roles. Pass an explicit `jobId` (from `list_jobs`) to target a different posting.

### Job posting store

BambooHR's API exposes a job's metadata and its public **posting URL** (`/applicant_tracking/jobs`), but **not** the posting body text. So:

- The sync auto-captures each job's `posting_url` (plus posted date, status, title) into the `jobs` table; `list_jobs` / `GET /api/jobs` return `postingUrl`.
- The posting **text** is **Claude-writable**: `save_job_posting` writes it to `jobs.description`, and `get_job_description` / the `evaluate_candidate` prompt read it. A full sync will not overwrite it (`COALESCE`). Legacy `server/data/job-descriptions/job-<id>.txt` files are still read as a fallback when no posting is stored.

## Prompt

`evaluate_candidate({ applicationId })` bundles the scoring rubric (`server/prompts/ai-evaluation-system.txt`), the job description, and the candidate's resume into a single prompt, and instructs Claude to finish by calling `save_evaluation`. Candidate-supplied text is fenced and marked as data, preserving the rubric/untrusted-data separation.

## Scoring workflow

The `/score-candidates` Claude Code skill runs this end to end. Manually, the flow is:

1. (Optional) `sync_from_bamboohr` to pull the latest candidates.
2. `list_jobs` and pick the target job (default `currentJobId`).
3. `get_job_description` for that job; if empty, `save_job_posting` with the posting text.
4. `list_unscored_applicants` (scoped to the job) to see who needs scoring.
5. For each candidate, run the `evaluate_candidate` prompt (or manually call `get_resume_text` + `get_job_description`), assess fit, then call `save_evaluation` with `applicationId`, `confidence` (0-100), `areaScores`, `brief`, `full`, optional `risks`, and `suggestedScreeningQuestions`.
6. The score appears in the web app's applicant list (confidence column, scoped to the job) and the summary on the detail page — no regeneration button; the UI is read-only for assessments.

## Notes

- **stdout is the protocol channel.** The entry point (`server/src/mcp/stdio-logging.ts`) reroutes `console.log`/`info`/`debug` to stderr so the chatty ingest/repository code can't corrupt JSON-RPC.
- **Concurrency.** The DB runs in WAL mode, so the Express server and the MCP server can access `server/data/hiring-helper.db` at the same time.
- **Status is read-only** through MCP: BambooHR remains the source of truth for hiring stage (a local change would be overwritten on the next sync).
