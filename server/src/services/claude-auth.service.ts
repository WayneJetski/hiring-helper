/**
 * Claude Code sign-in: whether the Claude Code CLI on this computer is signed in,
 * and starting its browser sign-in (`claude auth login`) from the setup screen.
 *
 * Scoring and criteria suggestions use whichever account Claude Code is signed
 * in to; the app never sees or stores any credential. The sign-in itself runs
 * in the user's browser, which works because this server runs on the same
 * computer (it only listens on 127.0.0.1).
 */

import { execFile, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';

export interface ClaudeAuthStatus {
  /** Null when it could not be determined (CLI missing, or output not understood). */
  signedIn: boolean | null;
  /** The signed-in account's email, when Claude Code reports one. */
  account: string | null;
  isSigningIn: boolean;
}

/** What the user sees when a Claude call fails because nobody is signed in. */
export const NOT_SIGNED_IN_MESSAGE =
  'Claude Code is not signed in. Open Setup (the badge at the top right) and choose Sign in to Claude.';

const NOT_SIGNED_IN_PATTERN = /not (?:logged|signed) in|please run \/login|\/login\b/i;

/** Claude Code's own wording when no account is signed in. */
export function isNotSignedInText(text: string): boolean {
  return NOT_SIGNED_IN_PATTERN.test(text);
}

/**
 * Read the JSON that `claude auth status` prints. Anything else (empty, a
 * crash message, a future format) is "unknown" rather than a guess.
 */
export function parseAuthStatus(output: string): { signedIn: boolean | null; account: string | null } {
  try {
    const parsed = JSON.parse(output) as { loggedIn?: unknown; email?: unknown };
    if (typeof parsed.loggedIn !== 'boolean') return { signedIn: null, account: null };
    const account = typeof parsed.email === 'string' && parsed.email !== '' ? parsed.email : null;
    return { signedIn: parsed.loggedIn, account: parsed.loggedIn ? account : null };
  } catch {
    return { signedIn: null, account: null };
  }
}

/** Injectable `claude auth status` runner (stdout, whatever the exit code). */
export type AuthStatusRunner = () => Promise<string>;
/** Injectable spawn for `claude auth login` (so tests start no browser). */
export type LoginSpawner = (args: string[]) => ChildProcess;

const runAuthStatus: AuthStatusRunner = () =>
  new Promise((resolve) => {
    // A signed-out CLI may exit non-zero but still print its status; use stdout either way.
    execFile('claude', ['auth', 'status'], { timeout: 8000 }, (_error, stdout) => resolve(stdout ?? ''));
  });

const spawnLogin: LoginSpawner = (args) =>
  nodeSpawn('claude', args, { stdio: 'ignore', windowsHide: true });

/** The status is re-read at most this often, except right after a sign-in finishes. */
export const AUTH_STATUS_CACHE_MS = 15_000;
/** A sign-in nobody finishes is stopped after this long. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export class ClaudeAuthService {
  private cached: { checkedAtMs: number; signedIn: boolean | null; account: string | null } | null = null;
  private loginProcess: ChildProcess | null = null;
  private loginTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly statusRunner: AuthStatusRunner = runAuthStatus,
    private readonly loginSpawner: LoginSpawner = spawnLogin,
    private readonly now: () => number = Date.now
  ) {}

  async getStatus(): Promise<ClaudeAuthStatus> {
    const isFresh = this.cached !== null && this.now() - this.cached.checkedAtMs < AUTH_STATUS_CACHE_MS;
    if (!isFresh) {
      const { signedIn, account } = parseAuthStatus(await this.statusRunner());
      this.cached = { checkedAtMs: this.now(), signedIn, account };
    }
    const { signedIn, account } = this.cached as NonNullable<typeof this.cached>;
    return { signedIn, account, isSigningIn: this.loginProcess !== null };
  }

  /**
   * Start Claude Code's browser sign-in. One at a time; asking again while one is
   * open just reports it. `useSso` forces the company single-sign-on flow.
   */
  startSignIn(useSso: boolean): void {
    if (this.loginProcess !== null) return;

    const child = this.loginSpawner(useSso ? ['auth', 'login', '--sso'] : ['auth', 'login']);
    this.loginProcess = child;
    this.loginTimer = setTimeout(() => this.cancelSignIn(), SIGN_IN_TIMEOUT_MS);
    this.loginTimer.unref(); // never keeps the server (or a test run) alive on its own

    const finish = (): void => {
      if (this.loginProcess !== child) return;
      this.loginProcess = null;
      if (this.loginTimer) clearTimeout(this.loginTimer);
      this.loginTimer = null;
      this.cached = null; // re-read the real state straight away
    };
    child.on('error', finish);
    child.on('close', finish);
  }

  cancelSignIn(): void {
    this.loginProcess?.kill();
  }
}
