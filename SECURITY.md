# Security

Hiring Helper is a **local tool**. It runs on your own computer, listens only on `127.0.0.1`, and is not meant to be reachable from a network or the internet. This page explains what it protects, how, and what you should do on your side.

## What is at stake

- **Your BambooHR API key.** It can do whatever the BambooHR user who created it can do.
- **Applicant data** (names, contact details, résumés, answers). Stored in `server/data/` on your computer.
- **Applicant-supplied text is hostile by default.** A résumé or an application answer is written by a stranger. It can contain instructions aimed at whatever AI reads it, or a link meant to run script in your browser.

## The main guarantee: reading applicants can never change BambooHR

The AI that reads résumés (Claude, through the MCP server) has no way to write to BambooHR, and this is enforced in code rather than by asking the AI to behave.

| Layer | What it does | Where |
| --- | --- | --- |
| Separate classes | `BambooHRService` (read-only) is what sync, résumé fetching and the MCP server use. The only write, "set an application's status", lives in `BambooHRStatusWriter`, used only by the push service. | `server/src/services/bamboohr-*.ts` |
| Network policy | A read-only client refuses anything but `GET`. The status writer refuses anything but `POST /applicant_tracking/applications/<number>/status`. Both refuse an absolute URL (the key could go to another host) and a redirect off `bamboohr.com`. | `bamboohr-http.ts` |
| Architecture test | Fails the build if the MCP server (transitively) imports the writer, the push service or a controller, if any other file sends a non-GET request to BambooHR, or if the write method exists anywhere else. | `server/src/architecture/` |
| Not an MCP tool | There is no MCP tool, prompt or resource that changes a status. | `server/src/mcp/` |
| A person's click | `POST /api/applicants/push` accepts only a request labelled by a browser as coming from the app's own page, and only for the exact application ids listed in the preview the person reviewed (the page makes them tick a confirmation first). | `requireBrowserOrigin`, `application-id-selection.ts` |

A status change never emails a candidate: the app calls no BambooHR email, disposition or notification endpoint.

## Limiting what the AI can reach while scoring

"Score new applicants" starts Claude Code in the background (`claude -p`). It runs with:

- **No built-in tools except `Skill`**: no shell, file, search or web tools (`--tools`). Allow-lists alone are not enough, because anything not listed would otherwise follow your own Claude Code settings.
- **Only this project's MCP server** (`--strict-mcp-config`), so your Slack, Jira or other servers are not loaded.
- **Only seven hiring-helper tools**: read a job, read a candidate, read the résumé text, save an evaluation. The tools that rewrite the job posting or trigger a sync are removed from that run, so a hostile résumé cannot change the posting that later candidates are judged against.
- **No BambooHR API key in its environment.**

The AI-assisted criteria drafting runs with no tools and no MCP servers at all (`--tools ""`).

Residual risk: a hostile résumé can still try to influence **its own score** or text it writes into the evaluation. That is inherent in having an AI read it. Scores are advice for a person who makes the decision, and nothing is sent to BambooHR without that person's review.

## Only your own browser can use the app

The server has no login, so it refuses anything that does not come from your own page:

- It binds to `127.0.0.1` only.
- A request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]` is refused (DNS rebinding).
- A write whose `Origin` is not the app's own page (this server's port, or the Vite dev server's port) is refused, including pages served from other `localhost` ports.
- Saving the API key, signing in to Claude, applying an update, and pushing to BambooHR additionally require a browser-labelled request (`Origin` present, `Sec-Fetch-Site: same-origin`), so a script or terminal tool cannot trigger them by accident or by prompt injection without deliberately forging headers.
- The API accepts JSON only (no HTML form posts).

Do not bind the server to another address or put it behind a tunnel or reverse proxy without adding authentication first.

## Applicant text in the web page

Applicant-supplied links (LinkedIn, website) are shown only if they are plain `http(s)` addresses (`client/src/utils/safeUrl.ts`); a `javascript:` or `data:` link would run inside the app's page, where it could call the app's own API. React escapes all other text.

## Files and dependencies

- `.env` (the API key) is written owner-only (`0600`), including when an existing file had looser permissions.
- `server/data/` (database, backups, résumé and summary caches) is owner-only (`0700`).
- Résumé downloads from BambooHR are capped at 25 MB.
- The Node.js download in the launcher scripts is verified against the checksum list published with it.
- Production dependencies have no known advisories (`npm audit --omit=dev`). Remaining advisories are in development tools (Vite, esbuild, ESLint) that run only under `npm run dev` on `127.0.0.1` and are not part of an installed copy.

## What you should do

1. **Create a dedicated BambooHR API key** for a BambooHR user whose permissions are as small as possible: Hiring access only, and no employee or payroll data. The key can do whatever that user can do, whatever this app does with it.
2. Run it as a normal user, never as administrator or root, and keep the computer's disk encrypted.
3. Keep Claude Code up to date. Do not run the scoring skill in a session where you have granted Claude broad shell or network permissions if you are about to open résumés you do not trust; the unattended "Score new applicants" button already runs without them.
4. Treat the `.env` file and `server/data/` like passwords and personal data: do not commit, email or sync them.
5. Update when the banner says so; updates are always your click.

## Known limits

- Anything running as you on your computer (a shell, another program) can read `.env` and `server/data/` and can send requests to the app. This tool protects against web pages, hostile applicant content and AI mistakes, not against malware that already runs as you.
- The project's `.claude/settings.json` denies Claude Code reading or editing `.env` and running `curl` against the write endpoints. Those rules are best-effort friction for interactive sessions (shell commands can be written many ways); the guarantees above do not depend on them.

## Reporting a problem

Open a private security advisory on the GitHub repository, or contact the maintainers directly. Please do not post details publicly first.
