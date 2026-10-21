/**
 * Tests for first-run setup validation and status. No network or CLI is used.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountFor, type CredentialStore } from '../config/credential-store.js';
import { config } from '../config/env.config.js';

import { SetupService, parseClaudeVersion } from './setup.service.js';

import { ClaudeAuthService } from './claude-auth.service.js';

const signedOutAuth = new ClaudeAuthService(async () => '{"loggedIn": false}');
const service = new SetupService(async () => '2.1.0', null, Date.now, signedOutAuth);

test('accepts a plausible key and subdomain', () => {
  assert.equal(service.validateCredentials('abc123', 'acme'), null);
});

test('asks for a missing key or subdomain in plain language', () => {
  assert.match(service.validateCredentials('', 'acme') ?? '', /API key/);
  assert.match(service.validateCredentials('abc', '  ') ?? '', /subdomain/);
});

test('rejects a pasted URL or host as the subdomain', () => {
  assert.match(service.validateCredentials('abc', 'https://acme.bamboohr.com') ?? '', /before \.bamboohr\.com/);
  assert.match(service.validateCredentials('abc', 'acme.bamboohr.com') ?? '', /before \.bamboohr\.com/);
});

test('rejects an API key containing whitespace', () => {
  assert.match(service.validateCredentials('abc def', 'acme') ?? '', /spaces/);
});

test('status reports the installed Claude Code version', async () => {
  const status = await service.getStatus();
  assert.equal(status.claude.installed, true);
  assert.equal(status.claude.version, '2.1.0');
});

test('status reports Claude Code missing when the version check fails', async () => {
  const missing = new SetupService(async () => null);
  assert.deepEqual((await missing.getStatus()).claude, {
    installed: false,
    version: null,
    signedIn: null,
    account: null,
    isSigningIn: false,
  });
});

test('keeps just the version number from `claude --version` output', () => {
  assert.equal(parseClaudeVersion('2.1.304 (Claude Code)\n'), '2.1.304');
  assert.equal(parseClaudeVersion('claude 1.0.9'), '1.0.9');
});

test('falls back to the raw text when no version number is present, and null when empty', () => {
  assert.equal(parseClaudeVersion('unknown build'), 'unknown build');
  assert.equal(parseClaudeVersion('  \n'), null);
});

// ---- Saved-connection check (cached) ----
// These use the process's real BambooHR config; set it for the duration of each test.
import { setBambooHRCredentials, config } from '../config/env.config.js';
import { SAVED_CONNECTION_CACHE_MS, type ConnectionTester } from './setup.service.js';

function withSavedCredentials(
  apiKey: string,
  subdomain: string,
  run: () => Promise<void>
): () => Promise<void> {
  return async (): Promise<void> => {
    const previous = { apiKey: config.bambooHR.apiKey, subdomain: config.bambooHR.subdomain };
    setBambooHRCredentials(apiKey, subdomain);
    try {
      await run();
    } finally {
      setBambooHRCredentials(previous.apiKey, previous.subdomain);
    }
  };
}

function countingTester(result = { ok: true, message: 'Connected to BambooHR.' }): {
  tester: ConnectionTester;
  calls: Array<{ apiKey: string; subdomain: string }>;
} {
  const calls: Array<{ apiKey: string; subdomain: string }> = [];
  return {
    calls,
    tester: async (apiKey, subdomain): Promise<{ ok: boolean; message: string }> => {
      calls.push({ apiKey, subdomain });
      return result;
    },
  };
}

test(
  'tests the saved connection and reports it without exposing the key',
  withSavedCredentials('secret-key', 'acme', async () => {
    const { tester, calls } = countingTester();
    const status = await new SetupService(async () => null, tester, () => 1_000).checkSavedConnection();

    assert.equal(status.configured, true);
    assert.equal(status.subdomain, 'acme');
    assert.equal(status.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(status).includes('secret-key'), false);
  })
);

test(
  'asks BambooHR at most once a minute however often it is called',
  withSavedCredentials('k', 'acme', async () => {
    const { tester, calls } = countingTester();
    let nowMs = 1_000;
    const service = new SetupService(async () => null, tester, () => nowMs);

    await service.checkSavedConnection();
    nowMs += SAVED_CONNECTION_CACHE_MS - 1;
    await service.checkSavedConnection();
    assert.equal(calls.length, 1, 'served from the cache inside the window');

    nowMs += 2;
    await service.checkSavedConnection();
    assert.equal(calls.length, 2, 'asked again once the minute has passed');
  })
);

test(
  'caches a failed check too, so a bad key is not retried in a loop',
  withSavedCredentials('bad', 'acme', async () => {
    const { tester, calls } = countingTester({ ok: false, message: 'BambooHR rejected the API key.' });
    const service = new SetupService(async () => null, tester, () => 5_000);

    const first = await service.checkSavedConnection();
    await service.checkSavedConnection();

    assert.equal(first.ok, false);
    assert.equal(calls.length, 1);
  })
);

test(
  'changing the saved credentials or invalidating the cache forces a fresh test',
  withSavedCredentials('k1', 'acme', async () => {
    const { tester, calls } = countingTester();
    const service = new SetupService(async () => null, tester, () => 1_000);

    await service.checkSavedConnection();
    setBambooHRCredentials('k2', 'acme');
    await service.checkSavedConnection();
    assert.equal(calls.length, 2, 'a different key is never served from the old cache');

    service.invalidateConnectionCache();
    await service.checkSavedConnection();
    assert.equal(calls.length, 3);
  })
);

test(
  'reports not configured without contacting BambooHR',
  withSavedCredentials('', '', async () => {
    const { tester, calls } = countingTester();
    const status = await new SetupService(async () => null, tester).checkSavedConnection();

    assert.deepEqual(
      { configured: status.configured, ok: status.ok, subdomain: status.subdomain },
      { configured: false, ok: null, subdomain: null }
    );
    assert.equal(calls.length, 0);
  })
);

test(
  'an outage is flagged as temporary, not as a bad key, and is not cached',
  withSavedCredentials('good-key', 'acme', async () => {
    let calls = 0;
    const tester: ConnectionTester = async () => {
      calls += 1;
      return { ok: false, message: 'BambooHR is having trouble right now.', isTemporaryFailure: true };
    };
    const service = new SetupService(async () => null, tester, () => 1_000);

    const first = await service.checkSavedConnection();
    await service.checkSavedConnection();

    assert.equal(first.ok, false);
    assert.equal(first.isTemporaryFailure, true);
    assert.equal(calls, 2, 'asked again straight away, so "Check again" can recover');
    assert.equal(config.bambooHR.apiKey, 'good-key', 'the saved key is untouched');
  })
);

// ---- where the saved key goes ----


function savingFixture(store: CredentialStore): { saving: SetupService; readEnvFile: () => string } {
  const envFile = join(mkdtempSync(join(tmpdir(), 'hh-setup-')), '.env');
  writeFileSync(envFile, 'BAMBOOHR_API_KEY=\nPORT=3000\n');
  const saving = new SetupService(async () => null, null, Date.now, signedOutAuth, store, envFile);
  return { saving, readEnvFile: (): string => readFileSync(envFile, 'utf-8') };
}

test('a saved API key goes to the credential store and never into the .env file', async () => {
  const items = new Map<string, string>();
  const store: CredentialStore = {
    read: (account) => items.get(account) ?? null,
    write: (account, secret) => void items.set(account, secret),
    remove: (account) => void items.delete(account),
  };
  const { saving, readEnvFile } = savingFixture(store);

  await saving.saveCredentials('super-secret-key', 'acme');

  assert.equal(items.get(accountFor('acme')), 'super-secret-key');
  assert.doesNotMatch(readEnvFile(), /super-secret-key/);
  assert.match(readEnvFile(), /BAMBOOHR_SUBDOMAIN=acme/);
  assert.match(readEnvFile(), /PORT=3000/, 'unrelated settings are kept');
  assert.equal(config.bambooHR.apiKey, 'super-secret-key', 'applied in memory without a restart');
  assert.equal(process.env.BAMBOOHR_API_KEY, undefined, 'child processes must not inherit the key');
});

test('switching to another company forgets the first company\'s stored key', async () => {
  const items = new Map<string, string>([[accountFor('acme'), 'old-key']]);
  const store: CredentialStore = {
    read: (account) => items.get(account) ?? null,
    write: (account, secret) => void items.set(account, secret),
    remove: (account) => void items.delete(account),
  };
  const { saving } = savingFixture(store);
  await saving.saveCredentials('k1', 'acme');
  await saving.saveCredentials('k2', 'globex');
  assert.equal(items.has(accountFor('acme')), false);
  assert.equal(items.get(accountFor('globex')), 'k2');
});

test('where no credential store exists the key falls back to the owner-only .env file', async () => {
  const unavailable: CredentialStore = {
    read: () => {
      throw new Error('none');
    },
    write: () => {
      throw new Error('none');
    },
    remove: () => {
      throw new Error('none');
    },
  };
  const { saving, readEnvFile } = savingFixture(unavailable);
  await saving.saveCredentials('fallback-key', 'acme');
  assert.match(readEnvFile(), /BAMBOOHR_API_KEY=fallback-key/);
});
