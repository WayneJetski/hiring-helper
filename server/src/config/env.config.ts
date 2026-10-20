/**
 * Environment configuration module
 *
 * BambooHR credentials are optional at startup: without them the server still
 * runs and the web app shows a setup screen that saves them (see
 * SetupService). They are held in mutable state so saving takes effect without
 * a restart.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** The single root .env file (shared by the REST server, MCP server and scripts). */
export const ENV_FILE_PATH = resolve(__dirname, '../../../.env');

dotenv.config({ path: ENV_FILE_PATH });

const credentials = {
  apiKey: process.env.BAMBOOHR_API_KEY ?? '',
  subdomain: process.env.BAMBOOHR_SUBDOMAIN ?? '',
};

export const config = {
  bambooHR: {
    get apiKey(): string {
      return credentials.apiKey;
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
  return credentials.apiKey !== '' && credentials.subdomain !== '';
}

/** Replace the in-memory BambooHR credentials (after the setup screen saves them). */
export function setBambooHRCredentials(apiKey: string, subdomain: string): void {
  credentials.apiKey = apiKey;
  credentials.subdomain = subdomain;
  process.env.BAMBOOHR_API_KEY = apiKey;
  process.env.BAMBOOHR_SUBDOMAIN = subdomain;
}
