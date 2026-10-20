/**
 * Setup Service
 *
 * Backs the first-run setup screen: reports whether BambooHR is connected and
 * Claude Code is installed, tests BambooHR credentials without saving them, and
 * saves them to the root .env (and in memory, so no restart is needed).
 *
 * The API key is never returned or logged.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import axios from 'axios';
import {
  ENV_FILE_PATH,
  config,
  isBambooHRConfigured,
  setBambooHRCredentials,
} from '../config/env.config.js';
import { upsertEnvLines } from '../utils/env-file.js';
import { ClaudeAuthService } from './claude-auth.service.js';

const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;
const CONNECTION_TIMEOUT_MS = 15000;

export interface SetupStatus {
  bambooHR: { configured: boolean; subdomain: string | null };
  claude: {
    installed: boolean;
    version: string | null;
    /** Null when unknown (not installed, or the status could not be read). */
    signedIn: boolean | null;
    account: string | null;
    isSigningIn: boolean;
  };
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/** Result of testing the credentials that are already saved. */
export interface SavedConnectionStatus {
  configured: boolean;
  subdomain: string | null;
  /** Null when not configured (nothing to test). */
  ok: boolean | null;
  message: string;
  /** When BambooHR was actually asked (ISO), so the UI can say "checked 5 min ago". */
  checkedAt: string | null;
}

/** Tests a key + subdomain against BambooHR. Injectable so tests need no network. */
export type ConnectionTester = (apiKey: string, subdomain: string) => Promise<ConnectionTestResult>;

/** The saved connection is re-tested at most this often, however often it is asked for. */
export const SAVED_CONNECTION_CACHE_MS = 60_000;

/** Injectable `claude --version` runner (so tests need no CLI). */
export type VersionRunner = () => Promise<string | null>;

/**
 * `claude --version` prints something like "2.1.304 (Claude Code)". Keep just the
 * version number so the UI can word the sentence itself; fall back to the raw
 * text if no number is found.
 */
export function parseClaudeVersion(output: string): string | null {
  const trimmed = output.trim();
  if (trimmed === '') return null;
  return /\d+(?:\.\d+)+/.exec(trimmed)?.[0] ?? trimmed;
}

const runClaudeVersion: VersionRunner = () =>
  new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : parseClaudeVersion(stdout));
    });
  });

export class SetupService {
  private cachedConnection: { signature: string; checkedAtMs: number; result: ConnectionTestResult } | null =
    null;
  private readonly versionRunner: VersionRunner;
  private readonly connectionTester: ConnectionTester | null;
  private readonly now: () => number;
  private readonly claudeAuth: ClaudeAuthService;

  constructor(
    versionRunner: VersionRunner = runClaudeVersion,
    connectionTester: ConnectionTester | null = null,
    now: () => number = Date.now,
    claudeAuth: ClaudeAuthService = new ClaudeAuthService()
  ) {
    this.versionRunner = versionRunner;
    this.connectionTester = connectionTester;
    this.now = now;
    this.claudeAuth = claudeAuth;
  }

  /** Start Claude Code's browser sign-in (see ClaudeAuthService). */
  startClaudeSignIn(useSso: boolean): void {
    this.claudeAuth.startSignIn(useSso);
  }

  cancelClaudeSignIn(): void {
    this.claudeAuth.cancelSignIn();
  }

  async getStatus(): Promise<SetupStatus> {
    const version = await this.versionRunner();
    const auth =
      version === null
        ? { signedIn: null, account: null, isSigningIn: false }
        : await this.claudeAuth.getStatus();
    return {
      bambooHR: {
        configured: isBambooHRConfigured(),
        subdomain: isBambooHRConfigured() ? config.bambooHR.subdomain : null,
      },
      claude: { installed: version !== null, version, ...auth },
    };
  }

  /** Validate the shape of the credentials; returns an error message or null. */
  validateCredentials(apiKey: unknown, subdomain: unknown): string | null {
    if (typeof apiKey !== 'string' || apiKey.trim() === '') return 'Enter your BambooHR API key.';
    if (/\s/.test(apiKey.trim())) return 'The API key should not contain spaces.';
    if (typeof subdomain !== 'string' || subdomain.trim() === '') {
      return 'Enter your BambooHR subdomain (the part before .bamboohr.com).';
    }
    if (!SUBDOMAIN_PATTERN.test(subdomain.trim())) {
      return 'The subdomain should be just the part before .bamboohr.com (letters, numbers, hyphens), without https://.';
    }
    return null;
  }

  /**
   * Test the credentials that are already saved, without ever returning the key.
   * The answer is cached for a minute (and dropped when new credentials are
   * saved), so reopening the setup screen cannot hammer BambooHR.
   */
  async checkSavedConnection(): Promise<SavedConnectionStatus> {
    if (!isBambooHRConfigured()) {
      return {
        configured: false,
        subdomain: null,
        ok: null,
        message: 'BambooHR is not connected yet.',
        checkedAt: null,
      };
    }

    const subdomain = config.bambooHR.subdomain;
    const signature = `${subdomain}:${config.bambooHR.apiKey}`;
    const nowMs = this.now();
    const cached = this.cachedConnection;
    const isFresh =
      cached !== null &&
      cached.signature === signature &&
      nowMs - cached.checkedAtMs < SAVED_CONNECTION_CACHE_MS;

    if (!isFresh) {
      const result = await this.testConnection(config.bambooHR.apiKey, subdomain);
      this.cachedConnection = { signature, checkedAtMs: nowMs, result };
    }

    const { checkedAtMs, result } = this.cachedConnection as NonNullable<typeof this.cachedConnection>;
    return {
      configured: true,
      subdomain,
      ok: result.ok,
      message: result.message,
      checkedAt: new Date(checkedAtMs).toISOString(),
    };
  }

  /** Forget the cached saved-connection result (call when credentials change). */
  invalidateConnectionCache(): void {
    this.cachedConnection = null;
  }

  /** Try the credentials against BambooHR's applicant tracking API. Never saves. */
  async testConnection(apiKey: string, subdomain: string): Promise<ConnectionTestResult> {
    if (this.connectionTester) return this.connectionTester(apiKey, subdomain);
    const authToken = Buffer.from(`${apiKey}:`).toString('base64');
    try {
      await axios.get(`https://${subdomain}.bamboohr.com/api/v1/applicant_tracking/statuses`, {
        headers: { Authorization: `Basic ${authToken}`, Accept: 'application/json' },
        timeout: CONNECTION_TIMEOUT_MS,
        maxRedirects: 0,
      });
      return { ok: true, message: 'Connected to BambooHR.' };
    } catch (error) {
      return { ok: false, message: this.describeConnectionError(error) };
    }
  }

  private describeConnectionError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401) return 'BambooHR rejected the API key. Check it was copied in full.';
      if (status === 403) {
        return 'This API key does not have access to Hiring (applicant tracking). Ask a BambooHR admin to give its user that permission.';
      }
      if (status === 404 || (status !== undefined && status >= 300 && status < 400)) {
        return 'BambooHR did not recognise that subdomain. Use just the part before .bamboohr.com.';
      }
      if (status === 429) return 'BambooHR is rate limiting requests. Wait a minute and try again.';
      if (status !== undefined) return `BambooHR returned an unexpected response (HTTP ${status}).`;
      if (error.code === 'ENOTFOUND') {
        return 'Could not find that BambooHR address. Check the subdomain, and that this computer is online.';
      }
      return 'Could not reach BambooHR. Check this computer is online and try again.';
    }
    return 'Could not test the connection.';
  }

  /** Persist credentials to the root .env and apply them immediately. */
  async saveCredentials(apiKey: string, subdomain: string): Promise<void> {
    let existing = '';
    try {
      existing = await fs.readFile(ENV_FILE_PATH, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const updated = upsertEnvLines(existing, {
      BAMBOOHR_API_KEY: apiKey,
      BAMBOOHR_SUBDOMAIN: subdomain,
    });
    await fs.writeFile(ENV_FILE_PATH, updated, { encoding: 'utf-8', mode: 0o600 });
    setBambooHRCredentials(apiKey, subdomain);
    this.invalidateConnectionCache();
  }
}
