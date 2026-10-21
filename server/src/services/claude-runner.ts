/**
 * Claude Runner
 *
 * Runs a single prompt through the host's Claude Code CLI (`claude -p`) and
 * returns the reply text. Like scoring, this means the app makes no LLM call of
 * its own and holds no key: it uses whichever account Claude Code is signed in
 * to on this computer.
 *
 * The run happens in an empty temporary folder with every tool and MCP server
 * switched off (see claude-sandbox.ts): it is only asked for text, and the prompt
 * can contain a posting or answers that someone else wrote.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { NOT_SIGNED_IN_MESSAGE, isNotSignedInText } from './claude-auth.service.js';
import { tmpdir } from 'node:os';
import { TEXT_ONLY_SANDBOX_ARGUMENTS, claudeChildEnvironment } from './claude-sandbox.js';
import { SCORING_MODEL } from '../scoring/claude-model.js';

/** Injectable spawn signature (so tests can supply a fake child process). */
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

export const DEFAULT_RUN_TIMEOUT_MS = 180_000;

/** CLI output that suggests Claude Code is not signed in. */
const LOGIN_PROBLEM_PATTERN = /log ?in|authenticat|unauthorized|api key|credential/i;

/** The run failed for a reason that is worth showing the user as written. */
export class ClaudeRunError extends Error {}

/** The caller cancelled the run (for example the browser disconnected). */
export class ClaudeRunCancelledError extends Error {
  constructor() {
    super('The request was cancelled.');
  }
}

export class ClaudeRunner {
  private readonly spawnFn: SpawnFn;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(
    spawnFn: SpawnFn = nodeSpawn,
    options: { model?: string; timeoutMs?: number } = {}
  ) {
    this.spawnFn = spawnFn;
    this.model = options.model ?? SCORING_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
  }

  /** Send one prompt and resolve with the model's reply text. */
  run(prompt: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ClaudeRunCancelledError());
        return;
      }

      let child: ChildProcess;
      try {
        child = this.spawnFn(
          'claude',
          ['-p', prompt, '--model', this.model, '--output-format', 'json', ...TEXT_ONLY_SANDBOX_ARGUMENTS],
          { cwd: tmpdir(), env: claudeChildEnvironment() }
        );
      } catch (error) {
        reject(new ClaudeRunError(this.describeSpawnError(error)));
        return;
      }

      let stdout = '';
      let stderrTail = '';
      let isSettled = false;

      const settle = (finish: () => void): void => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', handleAbort);
        finish();
      };

      const handleAbort = (): void => {
        child.kill('SIGTERM');
        settle(() => reject(new ClaudeRunCancelledError()));
      };
      signal?.addEventListener('abort', handleAbort);

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        settle(() =>
          reject(new ClaudeRunError('This is taking too long. Please try again in a moment.'))
        );
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });

      child.on('error', (error) => settle(() => reject(new ClaudeRunError(this.describeSpawnError(error)))));

      child.on('close', (code) => {
        settle(() => {
          if (code !== 0) {
            // A signed-out CLI exits 1 but explains itself in its JSON output.
            if (isNotSignedInText(stdout)) {
              reject(new ClaudeRunError(NOT_SIGNED_IN_MESSAGE));
              return;
            }
            const hint = LOGIN_PROBLEM_PATTERN.test(stderrTail)
              ? ' Claude Code may not be signed in: open Setup and choose Sign in to Claude.'
              : '';
            reject(new ClaudeRunError(`Claude Code stopped unexpectedly (code ${code ?? 'null'}).${hint}`));
            return;
          }
          try {
            const reply = JSON.parse(stdout) as { is_error?: boolean; result?: unknown };
            if (reply.is_error === true || typeof reply.result !== 'string') {
              const reason =
                typeof reply.result === 'string' && reply.result !== ''
                  ? reply.result
                  : 'Claude Code reported an error.';
              reject(new ClaudeRunError(isNotSignedInText(reason) ? NOT_SIGNED_IN_MESSAGE : reason));
              return;
            }
            resolve(reply.result);
          } catch {
            reject(new ClaudeRunError('Claude Code returned a reply that could not be read.'));
          }
        });
      });
    });
  }

  private describeSpawnError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('ENOENT')
      ? 'Claude Code was not found on this computer. Install it and sign in (see the Setup page).'
      : `Could not start Claude Code: ${message}`;
  }
}
