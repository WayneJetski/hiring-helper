/**
 * Scoring Service
 *
 * Runs candidate scoring from the web app by spawning **headless Claude Code**
 * (`claude -p`) in the repo root. That reuses the exact `/score-candidates`
 * skill, the `hiring-helper` MCP server, and the (now per-job) rubric — the app
 * itself makes no LLM call and holds no API key.
 *
 * Safety: the run is sandboxed to the Skill tool + the hiring-helper scoring tools
 * only (see claude-sandbox.ts); no Bash/Write/Edit, no other MCP servers. One run at a time (single-flight).
 * It never writes to BambooHR. Requires the Claude Code CLI installed and
 * authenticated on the host running this server.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { claudeChildEnvironment, scoringSandboxArguments } from './claude-sandbox.js';
import { JobsRepository } from '../repositories/jobs.repository.js';
import { NOT_SIGNED_IN_MESSAGE, isNotSignedInText } from './claude-auth.service.js';
import { SCORING_MODEL } from '../scoring/claude-model.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Candidates scored per headless run. A long session keeps every résumé it has
 * read in context, so later candidates are scored against earlier ones and quality
 * drifts; a fresh run per batch keeps each score independent.
 */
export const SCORING_BATCH_SIZE = 12;

/** Split ids into consecutive batches of at most `size`. */
export function chunkIds(ids: number[], size: number = SCORING_BATCH_SIZE): number[][] {
  const batches: number[][] = [];
  for (let start = 0; start < ids.length; start += size) {
    batches.push(ids.slice(start, start + size));
  }
  return batches;
}

/** CLI stderr that suggests the host's Claude Code login is missing or expired. */
const LOGIN_PROBLEM_PATTERN = /log ?in|authenticat|unauthorized|api key|credential/i;

/** Injectable spawn signature (so tests can supply a fake child process). */
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export interface ScoringStatus {
  running: boolean;
  jobId: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  scored: number;
  /** How many candidates this run set out to score (null when unknown). */
  total: number | null;
  /** True when the run was stopped by the user rather than finishing or failing. */
  cancelled: boolean;
  ok: boolean | null;
  error: string | null;
  message: string | null;
}

export interface StartResult {
  started: boolean;
  alreadyRunning?: boolean;
  status: ScoringStatus;
}

export class ScoringService {
  private spawnFn: SpawnFn;
  private activeChild: ChildProcess | null = null;
  /** Batches still to run after the current one, in order. */
  private pendingBatches: number[][] = [];
  private batchCount = 1;
  private runContext: { jobId?: number; title?: string; isRescore: boolean } = { isRescore: false };
  private jobsRepo: JobsRepository;
  private status: ScoringStatus = {
    running: false,
    jobId: null,
    startedAt: null,
    finishedAt: null,
    scored: 0,
    total: null,
    cancelled: false,
    ok: null,
    error: null,
    message: null,
  };

  constructor(spawnFn: SpawnFn = nodeSpawn, jobsRepo: JobsRepository = new JobsRepository()) {
    this.spawnFn = spawnFn;
    this.jobsRepo = jobsRepo;
  }

  getStatus(): ScoringStatus {
    return { ...this.status };
  }

  /**
   * Start a scoring run. With no `applicationIds`, scores a job's unscored
   * candidates (or the current job when jobId is omitted) in a single run. With
   * `applicationIds`, scores exactly those, in batches of SCORING_BATCH_SIZE run
   * one after another, each in a fresh Claude session; `isRescore` (default true)
   * says they may already have a score, which is then overwritten with the job's
   * current rubric.
   * Returns immediately; progress is tracked on `status` and polled via
   * getStatus(). Single-flight: a second call while running is a no-op.
   */
  start(
    opts: { jobId?: number; applicationIds?: number[]; total?: number; isRescore?: boolean } = {}
  ): StartResult {
    if (this.status.running) {
      return { started: false, alreadyRunning: true, status: this.getStatus() };
    }

    const { jobId, applicationIds } = opts;
    const title = jobId ? this.jobsRepo.getById(jobId)?.title : undefined;
    const batches = applicationIds && applicationIds.length > 0 ? chunkIds(applicationIds) : [];
    this.runContext = { jobId, title, isRescore: opts.isRescore ?? true };
    this.batchCount = Math.max(batches.length, 1);
    this.pendingBatches = batches.slice(1);

    this.status = {
      running: true,
      jobId: jobId ?? null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      scored: 0,
      total: opts.total ?? null,
      cancelled: false,
      ok: null,
      error: null,
      message: null,
    };

    if (!this.launchRun(batches[0])) return { started: false, status: this.getStatus() };
    return { started: true, status: this.getStatus() };
  }

  /** Spawn one headless run for a batch of ids (or the unscored queue when none). */
  private launchRun(batch?: number[]): boolean {
    const { jobId, title, isRescore } = this.runContext;
    const args = [
      '-p',
      this.buildPrompt(jobId, title, batch, isRescore),
      '--model',
      SCORING_MODEL,
      '--output-format',
      'stream-json',
      '--verbose',
      ...scoringSandboxArguments(REPO_ROOT),
    ];

    let child: ChildProcess;
    try {
      child = this.spawnFn('claude', args, { cwd: REPO_ROOT, env: claudeChildEnvironment() });
    } catch (error) {
      this.fail(this.spawnErrorMessage(error));
      return false;
    }

    this.activeChild = child;
    this.attachHandlers(child);
    return true;
  }

  /**
   * Stop a running scoring run. Candidates already scored keep their scores.
   * Returns false when nothing is running.
   */
  cancel(): boolean {
    if (!this.status.running) return false;
    const child = this.activeChild;
    this.pendingBatches = [];
    this.status.running = false;
    this.status.cancelled = true;
    this.status.ok = false;
    this.status.error = 'Scoring was cancelled.';
    this.status.finishedAt = new Date().toISOString();
    child?.kill('SIGTERM');
    return true;
  }

  private buildPrompt(
    jobId: number | undefined,
    title: string | undefined,
    applicationIds: number[] | undefined,
    isRescore: boolean
  ): string {
    const scope = jobId ? `job ${jobId}${title ? ` (${title})` : ''}` : 'the current job';
    if (applicationIds && applicationIds.length > 0) {
      const task = isRescore
        ? `RE-SCORE these ${applicationIds.length} application IDs for ${scope}, overwriting their existing scores and using the job's current rubric`
        : `score these ${applicationIds.length} application IDs for ${scope} (none has a score yet), using the job's current rubric`;
      return (
        `Use the score-candidates skill to ${task} ` +
        `(call get_system_prompt). Score every listed id; skip the unscored-queue step. ` +
        `Work autonomously and do not ask any questions. IDs: ${applicationIds.join(', ')}. ` +
        'When finished, report how many candidates you scored.'
      );
    }
    return (
      `Use the score-candidates skill to score ONLY the unscored candidates for ${scope}. ` +
      'Work autonomously and do not ask any questions. If a job posting is missing, skip ' +
      'candidates you cannot fairly score rather than pausing. When finished, report how ' +
      'many candidates you scored.'
    );
  }

  private attachHandlers(child: ChildProcess): void {
    let stdoutBuffer = '';
    let stderrTail = '';
    let sawResult = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (child !== this.activeChild) return; // a batch that already handed over
      stdoutBuffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) sawResult = this.handleEventLine(line) || sawResult;
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });

    child.on('error', (error) => {
      if (child === this.activeChild && this.status.running) this.fail(this.spawnErrorMessage(error));
    });

    child.on('close', (code) => {
      if (child !== this.activeChild) return; // a batch that already handed over
      if (!this.status.running) return; // already finalized by a result event
      if (sawResult) {
        this.finish();
      } else {
        const loginHint = LOGIN_PROBLEM_PATTERN.test(stderrTail)
          ? ' Claude Code may not be signed in: open Setup and choose Sign in to Claude.'
          : '';
        this.fail(
          `Scoring run exited (code ${code ?? 'null'}) without completing.` +
            (stderrTail ? ` Details: ${stderrTail.trim().slice(-500)}` : '') +
            loginHint
        );
      }
    });
  }

  /**
   * Parse one stream-json event line. Counts save_evaluation tool calls as
   * "scored" progress and captures the terminal result event. Returns true if
   * this line was the terminal result event.
   */
  private handleEventLine(line: string): boolean {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return false; // partial / non-JSON line
    }
    if (!event || typeof event !== 'object') return false;
    const obj = event as Record<string, unknown>;

    if (obj.type === 'assistant') {
      const message = obj.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message?.content : [];
      for (const item of content as Array<Record<string, unknown>>) {
        if (
          item?.type === 'tool_use' &&
          typeof item.name === 'string' &&
          item.name.includes('save_evaluation')
        ) {
          this.status.scored += 1;
        }
      }
      return false;
    }

    if (obj.type === 'result') {
      const isError = obj.is_error === true;
      const resultText = typeof obj.result === 'string' ? obj.result : null;
      if (isError) {
        this.status.error =
          resultText !== null && isNotSignedInText(resultText)
            ? NOT_SIGNED_IN_MESSAGE
            : (resultText ?? 'Scoring run reported an error.');
        this.status.ok = false;
        this.pendingBatches = [];
      } else if (this.pendingBatches.length > 0) {
        // This batch is done; start the next one in a fresh session.
        const next = this.pendingBatches.shift();
        this.launchRun(next);
        return true;
      } else {
        this.status.message = this.batchCount > 1 ? this.batchSummary() : resultText;
        this.status.ok = true;
      }
      this.finish();
      return true;
    }

    return false;
  }

  private batchSummary(): string {
    return `Scored ${this.status.scored} candidates in ${this.batchCount} batches.`;
  }

  private finish(): void {
    this.status.running = false;
    this.status.finishedAt = new Date().toISOString();
    if (this.status.ok === null) this.status.ok = true;
  }

  private fail(error: string): void {
    this.status.running = false;
    this.status.finishedAt = new Date().toISOString();
    this.status.ok = false;
    this.status.error = error;
  }

  private spawnErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ENOENT')) {
      return 'Claude Code CLI (`claude`) not found on PATH. Install it and log in on the server host (see SETUP.md, section 3).';
    }
    return `Failed to start scoring run: ${message}`;
  }
}
