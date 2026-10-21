/**
 * Shared HTTP plumbing for the BambooHR API, with the access policy enforced at
 * the network boundary.
 *
 * The API key can do anything its owner can do in BambooHR, so this app limits what
 * it will ever send with it. Every client is created for exactly one kind of access
 * and refuses any request outside it, even if code elsewhere is changed to try one:
 *
 *  - `read-only`: GET requests only. Used for syncing and fetching résumés, the
 *    paths that handle applicant-supplied content.
 *  - `status-write`: POST to an application's status endpoint only. Used solely by
 *    the push service (see BambooHRStatusWriter) and never reachable from the MCP
 *    server, which is what Claude talks to while reading résumés.
 *
 * Both refuse an absolute or protocol-relative URL (it would send the key to another
 * host) and refuse to follow a redirect off bamboohr.com.
 */

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { config, isBambooHRConfigured } from '../config/env.config.js';
import { buildBambooHRError, classifyBambooHRFailure } from '../errors/bamboohr-failure.js';
import { UpstreamServiceError } from '../errors/upstream-error.js';

export type BambooHRAccess = 'read-only' | 'status-write';

/** Raised when a BambooHR call is attempted before credentials are saved. */
export class BambooHRNotConfiguredError extends Error {
  constructor() {
    super('BambooHR is not connected yet. Open the app and complete the setup screen.');
  }
}

/** Raised when code tries to send a request its client is not allowed to make. */
export class BambooHRAccessDeniedError extends Error {}

const STATUS_WRITE_PATH = /^\/applicant_tracking\/applications\/\d+\/status$/;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const BAMBOOHR_HOST_SUFFIX = '.bamboohr.com';

/** Throws unless `access` permits this request. Pure, so the policy is unit-testable. */
export function assertRequestAllowed(
  access: BambooHRAccess,
  method: string | undefined,
  url: string | undefined
): void {
  const verb = (method ?? 'get').toUpperCase();
  const path = (url ?? '').split('?')[0];

  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new BambooHRAccessDeniedError('BambooHR requests must use a path on the BambooHR host.');
  }

  if (access === 'read-only') {
    if (verb !== 'GET') {
      throw new BambooHRAccessDeniedError(`A read-only BambooHR client cannot send ${verb}.`);
    }
    return;
  }

  if (verb !== 'POST' || !STATUS_WRITE_PATH.test(path)) {
    throw new BambooHRAccessDeniedError(
      `The BambooHR status writer may only POST an application status, not ${verb} ${path}.`
    );
  }
}

/** Throws unless a redirect stays on https://*.bamboohr.com. */
export function assertRedirectAllowed(protocol: string | undefined, hostname: string | undefined): void {
  const isBambooHRHost = (hostname ?? '').toLowerCase().endsWith(BAMBOOHR_HOST_SUFFIX);
  if (protocol !== 'https:' || !isBambooHRHost) {
    throw new BambooHRAccessDeniedError('BambooHR redirected to a host that is not bamboohr.com.');
  }
}

/**
 * Hands out an axios client for the current credentials, rebuilt when they change
 * (so saving them on the setup screen takes effect without a restart).
 */
export class BambooHRClientProvider {
  private cachedClient: { signature: string; client: AxiosInstance } | null = null;

  constructor(private readonly access: BambooHRAccess) {}

  get client(): AxiosInstance {
    if (!isBambooHRConfigured()) throw new BambooHRNotConfiguredError();

    const signature = `${config.bambooHR.subdomain}:${config.bambooHR.apiKey}`;
    if (this.cachedClient?.signature !== signature) {
      this.cachedClient = { signature, client: this.createClient() };
    }
    return this.cachedClient.client;
  }

  private createClient(): AxiosInstance {
    const authToken = Buffer.from(`${config.bambooHR.apiKey}:`).toString('base64');
    const client = axios.create({
      baseURL: config.bambooHR.baseUrl,
      headers: { Authorization: `Basic ${authToken}`, Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxRedirects: 3,
      beforeRedirect: (options) => assertRedirectAllowed(options.protocol, options.hostname),
    });
    client.interceptors.request.use((request) => {
      assertRequestAllowed(this.access, request.method, request.url);
      return request;
    });
    return client;
  }
}

/** Turn a failed BambooHR call into an Error with a readable message. */
export function raiseBambooHRError(error: unknown, message: string): never {
  if (error instanceof BambooHRNotConfiguredError || error instanceof BambooHRAccessDeniedError) {
    throw error;
  }

  if (error instanceof UpstreamServiceError) throw error;

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    const upstreamStatus = axiosError.response?.status;
    const kind = classifyBambooHRFailure(upstreamStatus, axiosError.code);

    // The raw response (often an HTML gateway page) belongs in the log only.
    console.error(`BambooHR API Error: ${message}`, {
      status: upstreamStatus,
      code: axiosError.code,
      details: summarizeResponseBody(axiosError.response?.data) ?? axiosError.message,
    });

    throw buildBambooHRError(kind, upstreamStatus, error);
  }

  console.error(`Unexpected error: ${message}`, error);
  throw buildBambooHRError('unknown', undefined, error);
}

const LOGGED_BODY_LIMIT = 500;

/** A response body as a bounded string for the log (it can be a whole HTML page). */
function summarizeResponseBody(body: unknown): string | undefined {
  if (body === undefined || body === null || body === '') return undefined;
  // Resume downloads use an arraybuffer, so the body may be binary.
  if (typeof body !== 'string' && !isPlainObject(body)) return '[non-text response]';
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > LOGGED_BODY_LIMIT ? `${text.slice(0, LOGGED_BODY_LIMIT)}...` : text;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer);
}
