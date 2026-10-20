# Hiring Helper: Setup and Help

Two things must be in place before the app works: **BambooHR credentials** (to load applicants) and **Claude Code** (to score them). There is no separate Anthropic API key in `.env`; scoring uses the Claude account that Claude Code is logged into on this computer.

> **Prefer a one-line install?** The README has a [Quick install](./README.md#quick-install-macos-linux-and-windows) for macOS, Linux and Windows that also adds a `hiring-helper` command and checks for updates. The steps below are for a copy that arrived as a zip file.

## Quick start (Windows, no technical setup)

1. Put the Hiring Helper folder somewhere simple, such as `C:\Users\<you>\HiringHelper` (not Program Files). If it came as a zip file, right-click the zip, choose **Properties**, tick **Unblock**, then **OK**, and only then extract it.
2. Double-click **`start.bat`**. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.
3. The first run sets everything up by itself and takes several minutes. It checks for each of these and installs what is missing:
   - **Node.js**: downloaded into the app folder (`.runtime`), nothing system-wide, no admin rights.
   - **Git for Windows**: needed by Claude Code. Installed with `winget`; Windows may ask permission.
   - **Claude Code**: installed with Anthropic's official installer.
   - **Claude sign-in**: a Claude Code window opens once. Sign in with your Claude account, then type `/exit`.
4. Your browser opens the app. The first screen asks for your BambooHR company address and API key (step 2 below). Every address in the app leads to this screen until BambooHR is connected.
5. Next time, double-click `start.bat` again. It starts in seconds. **Keep the black window open while you use the app**; closing it stops the app.

Only the first run needs an internet connection and these installs. If anything fails, the window stays open with a message; the table at the bottom of this page covers the common ones. The manual steps below are for developers or if you prefer to set things up yourself.

---

## 1. Install (manual)

You need Node.js 18+ ([nodejs.org](https://nodejs.org)). Then, in the project folder:

```bash
npm install
cp .env.example .env
```

## 2. BambooHR credentials

**Easiest:** start the app (step 4) and open it. If BambooHR is not connected, a setup screen asks for your company address and API key, tests them, and saves them for you. You can reopen it any time from the **Connected to ... .bamboohr.com** badge in the top bar. The rest of this section is the manual way, by editing `.env`.

Open `.env` and fill in two lines:

```env
BAMBOOHR_API_KEY=your_api_key_here
BAMBOOHR_SUBDOMAIN=yourcompany
```

- **API key:** in BambooHR, click your name (top right), then **API Keys**, then **Add New Key**. The key needs access to Hiring/Applicant Tracking, including permission to change application statuses if you plan to push statuses back.
- **Subdomain:** the first part of your BambooHR address. For `https://yourcompany.bamboohr.com`, enter `yourcompany`.

## 3. Claude Code (for scoring)

1. Install it: see [docs.claude.com/claude-code](https://docs.claude.com/en/docs/claude-code/overview).
2. Sign in once: on the app's setup page (the badge at the top right), choose **Sign in to Claude**. It opens your browser; tick **My company uses single sign-on (SSO)** first if that is how you sign in. (Or run `claude` in a terminal and follow the prompts.) The app shows who is signed in, and a banner above the scoring buttons while nobody is.
3. Check it works: `claude --version` should print a version number.

Scoring uses `claude-sonnet-5-5` by default. To change it, set `SCORING_MODEL` in `.env`. Scoring spends tokens on the logged-in Claude account.

## 4. Run

```bash
npm run dev
```

Open http://localhost:5173. The first start syncs applicants from BambooHR, which can take a minute.

To run the built app the way `start.bat` does (one process, one port): `npm run build`, then `npm start`, and open http://localhost:3000.

## If something is missing

| What you see | Cause | Fix |
|---|---|---|
| The app shows the **Connect to BambooHR** screen | No BambooHR credentials are saved yet | Fill it in (step 2). The test button tells you if the key or company address is wrong. |
| Applicant list is empty; log shows `Initial sync failed` with 401 or 403 | Wrong API key, or the key lacks Hiring access | Create a new key (step 2), update `.env`, restart. |
| Sync fails with 404 or a connection error | Wrong subdomain | Use only the part before `.bamboohr.com`, with no `https://`. |
| Sync log says `rate limit reached` | BambooHR is throttling requests | Wait a few minutes. The app keeps showing cached data, and the next sync retries. |
| `start.bat` says Git for Windows did not install | `winget` is missing or was declined | Install Git from https://git-scm.com/download/win, then double-click `start.bat` again. |
| `start.bat` says Port is in use or the app "stopped unexpectedly" | Another program uses port 3000 | Close it, or set `PORT=3001` in `.env`. |
| **Score unscored** fails with `Claude Code CLI (claude) not found` | Claude Code is not installed, or not on the PATH of the process running the server | Do step 3, then restart the server from a terminal where `claude --version` works. |
| **Score unscored** says Claude Code is not signed in | Not signed in, or the login expired | Open the setup page and choose **Sign in to Claude**, then try again. |
| Scoring runs but some candidates are skipped | The job has no posting text | Click **Configure** next to the job selector and paste the posting text. |

## Good to know

- **No login on this app, so it only listens on this computer.** Both the API (port 3000) and the web page (port 5173) are bound to `127.0.0.1`, so other machines on your network cannot reach them. Open it at http://localhost:5173. Do not change this unless you add authentication first.
- **Status changes are local** until you use the push action, which updates BambooHR after showing a from-to preview. The app never emails candidates.
- **Data** lives in `server/data/`. Back up that folder if you care about local scores and edits.
- **Help is built in.** The **Help** button in the top bar dims the page and labels the main buttons and columns. Click anywhere or press Esc to close it.
- More detail: [README.md](./README.md), [MCP.md](./MCP.md) (scoring tools), [DATABASE.md](./DATABASE.md).
