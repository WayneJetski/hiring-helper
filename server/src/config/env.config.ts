/**
 * Environment configuration module
 *
 * BambooHR credentials are optional at startup: without them the server still
 * runs and the web app shows a setup screen that saves them (see
 * SetupService). They are held in mutable state so saving takes effect without
 * a restart.
 */

import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { KeychainCredentialStore, resolveApiKey } from './credential-store.js';
import { upsertEnvLines } from '../utils/env-file.js';
import { writePrivateFileSync } from '../utils/private-file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** The single root .env file (shared by the REST server, MCP server and scripts). */
export const ENV_FILE_PATH = resolve(__dirname, '../../../.env');

dotenv.config({ path: ENV_FILE_PATH });

/**
 * Values shipped in .env.example. Installers copy that file to .env, so these must read as
 * "not configured" or the setup screen is skipped on a fresh install.
 */
const PLACEHOLDER_CREDENTIALS = new Set(['your_api_key_here', 'your_company_subdomain']);

export function readCredential(rawValue: string | undefined): string {
  const value = (rawValue ?? '').trim();
  return PLACEHOLDER_CREDENTIALS.has(value) ? '' : value;
}

/** Blank the plaintext key in .env once it lives in the OS credential store. */
function scrubApiKeyFromEnvFile(): void {
  try {
    const existing = readFileSync(ENV_FILE_PATH, 'utf-8');
    writePrivateFileSync(ENV_FILE_PATH, upsertEnvLines(existing, { BAMBOOHR_API_KEY: '' }));
  } catch (error) {
    console.warn(`Could not remove the API key from .env: ${(error as Error).message}`);
  }
}

const keyFromEnvFile = readCredential(process.env.BAMBOOHR_API_KEY);
// The key is held in memory only: child processes (git, npm, Claude Code) must not inherit it.
delete process.env.BAMBOOHR_API_KEY;

/**
 * The key is looked up on first use, not at import: the scoring-only MCP process never needs
 * it, and asking the OS credential store can raise an access prompt that no one is there to answer.
 */
const credentials: { apiKey: string | null; subdomain: string } = {
  apiKey: null,
  subdomain: readCredential(process.env.BAMBOOHR_SUBDOMAIN),
};

function loadApiKey(): string {
  if (credentials.apiKey === null) {
    const resolved = resolveApiKey(new KeychainCredentialStore(), credentials.subdomain, keyFromEnvFile);
    if (resolved.shouldScrubEnvFile) scrubApiKeyFromEnvFile();
    credentials.apiKey = resolved.apiKey;
  }
  return credentials.apiKey;
}

export const config = {
  bambooHR: {
    get apiKey(): string {
      return loadApiKey();
    },
    get subdomain(): string {
      return credentials.subdomain;
    },
    get baseUrl(): string {
      return `https://${credentials.subdomain}.bamboohr.com/api/v1`;
    },
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  client: {
    url: process.env.CLIENT_URL || 'http://localhost:5173',
  },
};

export function isBambooHRConfigured(): boolean {
  return loadApiKey() !== '' && credentials.subdomain !== '';
}

/** Replace the in-memory BambooHR credentials (after the setup screen saves them). The key is never put in process.env. */
export function setBambooHRCredentials(apiKey: string, subdomain: string): void {
  credentials.apiKey = apiKey;
  credentials.subdomain = subdomain;
  process.env.BAMBOOHR_SUBDOMAIN = subdomain;
}
