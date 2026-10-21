/**
 * Where the BambooHR API key rests. Preferred: the operating system's credential store
 * (macOS Keychain, Windows Credential Manager, Linux Secret Service), so the plaintext key
 * is never in a file that backups, zips, cloud-synced folders or a stray `git add` can copy.
 *
 * If the store is unavailable (a headless Linux box with no Secret Service), the key stays
 * in the owner-only `.env`, as before. Nothing here logs or returns the key.
 *
 * The key is held per company, so two copies of the app for different companies do not
 * overwrite each other and moving the install folder does not lose it.
 */

import { createRequire } from 'node:module';

/**
 * The service name is what the macOS prompt shows ("... stored in '<name>' in your keychain"),
 * so it says what the item is for. The process asking is always shown as "node"; that is the
 * executable macOS sees, and we cannot rename it.
 */
const SERVICE_NAME = 'Hiring Helper BambooHR API key';
/** Earlier releases filed the key under this name; it is read once and moved to SERVICE_NAME. */
const LEGACY_SERVICE_NAME = 'hiring-helper';

/** Narrow on purpose: tests and callers need only these three operations. */
export interface CredentialStore {
  read(account: string): string | null;
  write(account: string, secret: string): void;
  remove(account: string): void;
}

export type StorageLocation = 'keychain' | 'env-file';

export const accountFor = (subdomain: string): string =>
  `bamboohr-api-key:${subdomain.trim().toLowerCase()}`;

/** The slice of @napi-rs/keyring's Entry used here, so tests can stand in for the OS store. */
export interface KeychainEntry {
  getPassword(): string | null;
  setPassword(secret: string): void;
  deletePassword(): boolean;
}
export type KeychainEntryFactory = (service: string, account: string) => KeychainEntry;

const createOsEntry: KeychainEntryFactory = (service, account) => {
  // Loaded on first use so a platform without a binary fails here (and falls back), not at startup.
  const { Entry } = createRequire(import.meta.url)(
    '@napi-rs/keyring'
  ) as typeof import('@napi-rs/keyring');
  return new Entry(service, account);
};

/** The OS credential store, through @napi-rs/keyring (prebuilt binaries, no compiler needed). */
export class KeychainCredentialStore implements CredentialStore {
  constructor(private readonly createEntry: KeychainEntryFactory = createOsEntry) {}

  read(account: string): string | null {
    const current = this.createEntry(SERVICE_NAME, account).getPassword() ?? null;
    if (current !== null) return current;
    return this.migrateLegacyEntry(account);
  }

  write(account: string, secret: string): void {
    this.createEntry(SERVICE_NAME, account).setPassword(secret);
  }

  remove(account: string): void {
    this.createEntry(SERVICE_NAME, account).deletePassword();
    this.removeLegacyEntry(account);
  }

  /** Move a key filed under the old service name to the new one. Best effort: the old key still works. */
  private migrateLegacyEntry(account: string): string | null {
    let legacySecret: string | null;
    try {
      legacySecret = this.createEntry(LEGACY_SERVICE_NAME, account).getPassword() ?? null;
    } catch {
      return null;
    }
    if (legacySecret === null) return null;
    try {
      this.createEntry(SERVICE_NAME, account).setPassword(legacySecret);
      this.removeLegacyEntry(account);
    } catch {
      // Could not move it; keep using the old entry rather than lose the key.
    }
    return legacySecret;
  }

  private removeLegacyEntry(account: string): void {
    try {
      this.createEntry(LEGACY_SERVICE_NAME, account).deletePassword();
    } catch {
      // No old entry, or no permission to remove it; nothing depends on it.
    }
  }
}

export interface ResolvedApiKey {
  apiKey: string;
  location: StorageLocation;
  /** A plaintext copy in `.env` is now redundant and should be blanked. */
  shouldScrubEnvFile: boolean;
}

/**
 * Find the key at startup. A key found in `.env` (an older install, or someone editing the
 * file by hand) wins over the stored one, is moved into the store, and the plaintext copy is
 * flagged for removal. If the store cannot be used, the `.env` copy keeps working.
 */
export function resolveApiKey(
  store: CredentialStore,
  subdomain: string,
  keyFromEnvFile: string
): ResolvedApiKey {
  const stayInEnvFile: ResolvedApiKey = {
    apiKey: keyFromEnvFile,
    location: 'env-file',
    shouldScrubEnvFile: false,
  };
  if (subdomain === '') return stayInEnvFile;

  const account = accountFor(subdomain);
  let stored: string | null;
  try {
    stored = store.read(account);
  } catch {
    return stayInEnvFile;
  }

  if (keyFromEnvFile === '')
    return { apiKey: stored ?? '', location: 'keychain', shouldScrubEnvFile: false };
  if (stored === keyFromEnvFile)
    return { apiKey: stored, location: 'keychain', shouldScrubEnvFile: true };

  try {
    store.write(account, keyFromEnvFile);
  } catch {
    return stayInEnvFile;
  }
  return { apiKey: keyFromEnvFile, location: 'keychain', shouldScrubEnvFile: true };
}

/**
 * Save a key the person just entered. Returns where it went; `env-file` means the store was
 * unavailable and the caller must write it to `.env` instead.
 */
export function storeApiKey(
  store: CredentialStore,
  subdomain: string,
  apiKey: string
): StorageLocation {
  try {
    store.write(accountFor(subdomain), apiKey);
    return 'keychain';
  } catch {
    return 'env-file';
  }
}

/** Forget the key kept for a company the app no longer points at. Best effort. */
export function forgetApiKey(store: CredentialStore, subdomain: string): void {
  if (subdomain === '') return;
  try {
    store.remove(accountFor(subdomain));
  } catch {
    // Nothing stored, or the store is unavailable; either way there is nothing to clean up.
  }
}
