import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountFor,
  forgetApiKey,
  KeychainCredentialStore,
  type KeychainEntryFactory,
  resolveApiKey,
  storeApiKey,
  type CredentialStore,
} from './credential-store.js';

function memoryStore(
  initial: Record<string, string> = {}
): CredentialStore & { items: Map<string, string> } {
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
  assert.deepEqual(result, {
    apiKey: 'old-plaintext-key',
    location: 'keychain',
    shouldScrubEnvFile: true,
  });
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

/** An in-memory stand-in for the OS keychain, keyed by "service/account". */
function fakeKeychain(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const createEntry: KeychainEntryFactory = (service, account) => {
    const itemName = `${service}/${account}`;
    return {
      getPassword: () => items.get(itemName) ?? null,
      setPassword: (secret) => void items.set(itemName, secret),
      deletePassword: () => items.delete(itemName),
    };
  };
  return { items, store: new KeychainCredentialStore(createEntry) };
}

const NEW_ITEM = 'Hiring Helper BambooHR API key/bamboohr-api-key:acme';
const OLD_ITEM = 'hiring-helper/bamboohr-api-key:acme';

test('the keychain item is named for what it holds, so the macOS prompt is self-explanatory', () => {
  const { items, store } = fakeKeychain();
  store.write(accountFor('acme'), 'k');
  assert.deepEqual([...items.keys()], [NEW_ITEM]);
});

test('a key filed under the old service name is found and moved to the new name', () => {
  const { items, store } = fakeKeychain({ [OLD_ITEM]: 'old-key' });
  assert.equal(store.read(accountFor('acme')), 'old-key');
  assert.equal(items.get(NEW_ITEM), 'old-key');
  assert.equal(items.has(OLD_ITEM), false);
});

test('the old entry is not touched once the new one exists', () => {
  const { items, store } = fakeKeychain({ [NEW_ITEM]: 'new-key', [OLD_ITEM]: 'stale' });
  assert.equal(store.read(accountFor('acme')), 'new-key');
  assert.equal(items.get(OLD_ITEM), 'stale');
});

test('removing a company clears both the new and the old entry', () => {
  const { items, store } = fakeKeychain({ [NEW_ITEM]: 'k', [OLD_ITEM]: 'k' });
  store.remove(accountFor('acme'));
  assert.equal(items.size, 0);
});
