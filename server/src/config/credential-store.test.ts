import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountFor,
  forgetApiKey,
  resolveApiKey,
  storeApiKey,
  type CredentialStore,
} from './credential-store.js';

function memoryStore(initial: Record<string, string> = {}): CredentialStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    read: (account) => items.get(account) ?? null,
    write: (account, secret) => void items.set(account, secret),
    remove: (account) => void items.delete(account),
  };
}

const brokenStore: CredentialStore = {
  read: () => {
    throw new Error('no secret service');
  },
  write: () => {
    throw new Error('no secret service');
  },
  remove: () => {
    throw new Error('no secret service');
  },
};

test('an older install with the key in .env moves it into the store and flags the file for cleaning', () => {
  const store = memoryStore();
  const result = resolveApiKey(store, 'acme', 'old-plaintext-key');
  assert.deepEqual(result, { apiKey: 'old-plaintext-key', location: 'keychain', shouldScrubEnvFile: true });
  assert.equal(store.items.get(accountFor('acme')), 'old-plaintext-key');
});

test('a key already in the store is used, and .env needs no cleaning', () => {
  const store = memoryStore({ [accountFor('acme')]: 'stored-key' });
  assert.deepEqual(resolveApiKey(store, 'acme', ''), {
    apiKey: 'stored-key',
    location: 'keychain',
    shouldScrubEnvFile: false,
  });
});

test('a key someone typed into .env replaces the stored one', () => {
  const store = memoryStore({ [accountFor('acme')]: 'stored-key' });
  const result = resolveApiKey(store, 'acme', 'hand-edited-key');
  assert.equal(result.apiKey, 'hand-edited-key');
  assert.equal(store.items.get(accountFor('acme')), 'hand-edited-key');
  assert.equal(result.shouldScrubEnvFile, true);
});

test('no key anywhere reads as not configured', () => {
  assert.equal(resolveApiKey(memoryStore(), 'acme', '').apiKey, '');
});

test('when the store is unavailable the .env key keeps working and is left in place', () => {
  assert.deepEqual(resolveApiKey(brokenStore, 'acme', 'plain'), {
    apiKey: 'plain',
    location: 'env-file',
    shouldScrubEnvFile: false,
  });
});

test('without a company address there is nothing to file the key under, so the store is not touched', () => {
  const store = memoryStore();
  resolveApiKey(store, '', 'plain');
  assert.equal(store.items.size, 0);
});

test('company names are matched without regard to case', () => {
  assert.equal(accountFor(' Acme '), accountFor('acme'));
});

test('saving reports the store, or tells the caller to fall back to .env', () => {
  const store = memoryStore();
  assert.equal(storeApiKey(store, 'acme', 'k'), 'keychain');
  assert.equal(store.items.get(accountFor('acme')), 'k');
  assert.equal(storeApiKey(brokenStore, 'acme', 'k'), 'env-file');
});

test('forgetting a company removes its key and never throws', () => {
  const store = memoryStore({ [accountFor('acme')]: 'k' });
  forgetApiKey(store, 'acme');
  assert.equal(store.items.size, 0);
  assert.doesNotThrow(() => forgetApiKey(brokenStore, 'acme'));
  assert.doesNotThrow(() => forgetApiKey(store, ''));
});
