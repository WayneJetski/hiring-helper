import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKING_STATUS,
  describeConnection,
  statusFromConnection,
  statusFromError,
} from './connectionStatus.js';

const connection = (ok: boolean | null, message: string) => ({
  configured: true,
  subdomain: 'acme',
  ok,
  message,
  checkedAt: null,
});

test('a working connection is online', () => {
  assert.deepEqual(statusFromConnection(connection(true, 'Connected to BambooHR.')), {
    state: 'online',
    message: 'Connected to BambooHR.',
  });
});

test('a failing connection is offline and keeps the reason for the tooltip', () => {
  const status = statusFromConnection(connection(false, 'BambooHR rejected the API key.'));
  assert.equal(status.state, 'offline');
  assert.equal(status.message, 'BambooHR rejected the API key.');
});

test('nothing saved to test counts as not connected, never as online', () => {
  assert.equal(statusFromConnection(connection(null, '')).state, 'offline');
});

test('a failed check is offline and says what went wrong', () => {
  const status = statusFromError(new Error('Network Error'));
  assert.equal(status.state, 'offline');
  assert.match(status.message, /Network Error/);
  assert.equal(statusFromError('weird').state, 'offline');
});

test('the badge wording changes with the state, not just the color', () => {
  assert.equal(describeConnection({ state: 'online', message: '' }, 'acme'), 'Connected to acme.bamboohr.com');
  assert.equal(describeConnection({ state: 'offline', message: '' }, 'acme'), 'Not connected to acme.bamboohr.com');
  assert.equal(describeConnection(CHECKING_STATUS, 'acme'), 'Checking acme.bamboohr.com…');
});
