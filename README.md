# Hiring Helper

A modern web application for managing BambooHR hiring activity with AI-powered candidate assessment and local database persistence.

**Version 2.0** - Now with SQLite database for faster queries and offline capability!

## Architecture

- **Frontend**: React + Vite + TypeScript
- **Backend**: Node.js + Express + TypeScript
- **External API**: BambooHR Applicant Tracking API

## Getting Started

### Quick install (macOS, Linux and Windows)

One command installs everything: it adds git if it is missing, downloads Hiring Helper, installs what the app needs (Node.js and the Claude Code command-line tool), adds a `hiring-helper` command, starts the app and opens it in your browser.

**macOS or Linux** (Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/WayneJetski/hiring-helper/main/install.sh | bash
```

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/WayneJetski/hiring-helper/main/install.ps1 | iex
```

It asks a few questions, each with a default you accept by pressing Enter:

| Question | Default |
|---|---|
| Install folder | macOS: `~/Library/Application Support/hiring-helper`<br>Linux: `~/.local/share/hiring-helper`<br>Windows: `%LOCALAPPDATA%\HiringHelper` |
| Port | `28417` (uncommon on purpose, so it does not clash with other tools; it only ever listens on your own computer) |
| Add the `hiring-helper` command to your PATH? | Yes |
| Start it when the install finishes? | Yes |

To skip the questions or change a default, pass options (macOS and Linux) or set variables first (Windows):

```bash
curl -fsSL https://raw.githubusercontent.com/WayneJetski/hiring-helper/main/install.sh | bash -s -- --yes --port 28500 --dir ~/hiring-helper
```

```powershell
$env:HH_YES = '1'; $env:HH_PORT = '28500'; irm https://raw.githubusercontent.com/WayneJetski/hiring-helper/main/install.ps1 | iex
```

| Option | Variable | Meaning |
|---|---|---|
| `--yes` | `HH_YES=1` | Accept every default, ask nothing |
| `--dir <folder>` | `HH_DIR` | Install folder |
| `--port <number>` | `HH_PORT` | Port (1024 to 65535) |
| `--branch <name>` | `HH_BRANCH` | Branch to install (default `main`) |
| `--no-path` | `HH_NO_PATH=1` | Do not add the command to PATH |
| `--no-start` | `HH_NO_START=1` | Install, but do not start it |
| `--no-open` | `HH_NO_BROWSER=1` | Start it, but do not open the browser |
| (none) | `HH_SKIP_CLAUDE=1` | Do not install Claude Code (the app works, but cannot score) |

Running the installer again on the same folder updates that install instead of making a second one.

**Requirements:** an internet connection; macOS or Linux with `curl` (installing git on Linux needs `sudo`; on a Mac it uses Homebrew if you have it, otherwise Apple's command line tools), or Windows 10/11 with `winget` (included with current Windows). Node.js is downloaded into the install folder, so nothing is installed system-wide except git. The first start takes a few minutes while packages install and the app builds.

> **A note on `curl | bash`:** it runs a script straight from the internet, so read it first if you like: [install.sh](./install.sh), [install.ps1](./install.ps1). They only contact github.com (to download this project), nodejs.org (Node.js) and claude.ai (the Claude Code installer).

#### Everyday commands

| Command | What it does |
|---|---|
| `hiring-helper start` | Start it in the background and open the browser (`--foreground` keeps it in the terminal, `--no-open` skips the browser) |
| `hiring-helper stop` | Stop it |
| `hiring-helper restart` | Stop, then start |
| `hiring-helper status` | Say whether it is running, where, and which folder it is installed in |
| `hiring-helper open` | Open it in the browser |
| `hiring-helper logs` | Show the end of the log (`-f` keeps following it) |
| `hiring-helper update` | Download the latest version, and restart if it was running (`--check` only says whether one exists) |
| `hiring-helper doctor` | Check that Claude can start the scoring server (`start` runs this too and warns if it fails) |

Open a new terminal after installing so the command is on your PATH. On the first start, sign in to Claude from the app's setup page (the badge at the top right) so scoring works.

#### Updating

When the app opens it checks whether a newer version exists on the branch it follows (a `git ls-remote`, which downloads nothing). If one does, a banner says **A new version of Hiring Helper is available**, with a link to what changed and an **Update now** button. Nothing ever updates on its own.

Clicking it downloads the update, installs packages if they changed, builds, and restarts the app; the page reloads by itself when it is done (about a minute). Your applicants, scores and settings are not touched, and a database change is applied with a backup first. It will not start while scoring is running. If the new version fails to build, the previous version is restored and keeps running, and the banner says why. You can also update from a terminal with `hiring-helper update`.

#### Uninstalling

1. `hiring-helper stop`
2. Delete the install folder. Your applicant data is inside it (`server/data`), so back that up first if you want to keep it. The BambooHR key is not in the folder: it is in your computer's credential store (Keychain on macOS, Credential Manager on Windows), and you can remove it there once you no longer need it.
3. Remove the `# >>> hiring-helper >>>` block from your shell profile (macOS and Linux), or the install folder's `bin` entry from your user PATH (Windows: System Properties, Environment Variables).

### Developer setup

#### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- BambooHR API key

> **Not a developer?** On Windows, double-click `start.bat`: it installs what is missing (Node.js, Git, Claude Code), builds the app and opens it. See [SETUP.md](./SETUP.md).

> **Setting up for the first time, or something is missing?** See [SETUP.md](./SETUP.md) for credentials, Claude Code login, and a troubleshooting table.

#### Installation

1. Clone the repository and install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

Edit `.env` and add your BambooHR credentials:
- `BAMBOOHR_API_KEY`: Your BambooHR API key
- `BAMBOOHR_SUBDOMAIN`: Your company's BambooHR subdomain

No LLM provider API key is required. Candidate scoring is done by **Claude through the MCP server** (see below), which reads candidate data and writes scores/summaries back to the local store.

### AI scoring via MCP

The server ships an MCP (Model Context Protocol) server that exposes the local candidate store to Claude over stdio. Instead of the app calling out to an LLM, you use Claude (Claude Code / Claude Desktop) to read resumes and job descriptions and write back a confidence score + summary.

- A project `.mcp.json` is included; Claude Code auto-detects it in this repo.
- **Skill:** run `/score-candidates` in Claude Code to score a job's unscored applicants end to end.
- **From the web UI:** the **Score new applicants** button spawns headless Claude Code (`claude -p`) to run that same skill for the selected job, sandboxed to the Skill + hiring-helper MCP tools. Requires the Claude Code CLI installed and authenticated on the host running the server; scoring spends tokens on that account.
- **Re-score:** the **Re-score these applicants** button re-runs scoring over every candidate matching your current filter (overwriting their scores) using the job's current rubric — after you tweak a job's rubric, narrow the filter and re-score just that set. It previews the count and asks you to confirm first.
- **Job-scoped:** candidates belong to a job; lists default to the current posting so you don't mix roles (`list_jobs` to see them).
- **Per-job scoring config:** the **Job settings** button (next to the job selector) edits a job's posting text and its scoring system prompt (rubric). A per-job prompt overrides the global default (`server/prompts/ai-evaluation-system.txt`) for that job only.
- Tools also include `list_unscored_applicants`, `get_applicant`, `get_resume_text`, `save_evaluation`, `sync_from_bamboohr`, and more.

See [MCP.md](./MCP.md) for the full tool list and the scoring workflow.

### Development

Run both frontend and backend in development mode:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:server  # Backend on http://localhost:3000
npm run dev:client  # Frontend on http://localhost:5173
```

### Production Build

```bash
npm run build
npm start
```

## Project Structure

```
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── hooks/         # Custom hooks
│   │   ├── services/      # API client services
│   │   ├── types/         # TypeScript type definitions
│   │   └── utils/         # Utility functions
│   └── package.json
├── server/                # Node.js backend
│   ├── src/
│   │   ├── controllers/  # Request handlers
│   │   ├── services/     # Business logic
│   │   ├── routes/       # API routes
│   │   ├── middleware/   # Express middleware
│   │   ├── types/        # TypeScript type definitions
│   │   └── utils/        # Utility functions
│   └── package.json
└── package.json           # Root workspace configuration
```

## API Endpoints

### GET /api/applicants
Get list of all applicants with optional filtering.

**Query Parameters:**
- `status` - Filter by application status
- `jobId` - Filter by job posting ID
- `search` - Search by name or email

### GET /api/applicants/:id
Get detailed information for a specific applicant.

### GET /api/applicants/:id/resume
Get the applicant's resume parsed as JSON.

### GET /api/applicants/push/preview
Preview the local status changes waiting to be pushed to BambooHR (read-only).

Query parameters:
- `jobId` - Scope to a job (omit for all jobs)

### POST /api/applicants/push
Push local status changes (stage moves and rejections) back to BambooHR.

Body: `{ jobId?, changes: [{ id, toStatusId }] }` — required, and must be exactly the changes you reviewed in the preview; a row edited since is skipped (`changedSinceReview`) and anything else pending is left alone. The request must come from the web page (the browser's `Origin`), so it is refused from `curl`.

Only the status is written to BambooHR; **candidates are never emailed**. Changes made locally are held until you push them, and a sync will not overwrite an un-pushed local change.

### POST /api/sync
Manually trigger data synchronization from BambooHR.

Query parameters:
- `force` - Set to `true` for full sync (default: incremental)

### GET /api/sync/status
Get the status of the last synchronization.

### GET /api/sync/history
Get synchronization history.

Query parameters:
- `limit` - Number of history records to return (default: 50)

## Database

The application uses SQLite for local data storage. See [DATABASE.md](./DATABASE.md) for full documentation.

**Key Benefits:**
- Fast queries without hitting BambooHR API
- Offline capability
- Efficient search and filtering
- Incremental updates (only sync new data)

## Security

- The BambooHR API key is stored in your operating system's credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service), not in a file. An older key found in `.env` is moved there on the next start and blanked in the file. Only where no credential store exists (for example a headless Linux server) does the key stay in the owner-only `.env`
- Backend acts as a proxy to the BambooHR API. The AI that reads résumés has no way to change anything in BambooHR; see [SECURITY.md](./SECURITY.md) for how that is enforced and what to do on your side (start with a least-privilege API key)
- There is no login: the app listens only on `127.0.0.1` (your own computer), refuses requests addressed to any other host name, and refuses changes sent from other websites. Do not expose it to a network without adding authentication first.

## License

[MIT](./LICENSE)
