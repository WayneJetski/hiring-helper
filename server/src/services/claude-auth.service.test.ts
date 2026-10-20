/**
 * Tests for Claude Code sign-in status and starting a sign-in. No CLI, browser
 * or network is used. Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import {
  AUTH_STATUS_CACHE_MS,
  ClaudeAuthService,
  NOT_SIGNED_IN_MESSAGE,
  isNotSignedInText,
  parseAuthStatus,
} from './claude-auth.service.js';

class FakeLogin extends EventEmitter {
  killed = false;
  kill(): boolean {
    this.killed = true;
    this.emit('close', null);
    return true;
  }
}

test('reads a signed-in account from `claude auth status` output', () => {
  assert.deepEqual(parseAuthStatus('{"loggedIn": true, "email": "hr@example.com"}'), {
    signedIn: true,
    account: 'hr@example.com',
  });
});

test('reads a signed-out status', () => {
  assert.deepEqual(parseAuthStatus('{"loggedIn": false}'), { signedIn: false, account: null });
});

test('treats unreadable output as unknown, never as signed out', () => {
  for (const output of ['', 'Segmentation fault', '{"something":"else"}', '[]']) {
    assert.deepEqual(parseAuthStatus(output), { signedIn: null, account: null }, output);
  }
});

test('recognizes Claude Code\'s not-signed-in wording', () => {
  assert.equal(isNotSignedInText('Not logged in · Please run /login'), true);
  assert.equal(isNotSignedInText('You are not signed in'), true);
  assert.equal(isNotSignedInText('Rate limit reached'), false);
  assert.match(NOT_SIGNED_IN_MESSAGE, /Sign in to Claude/);
});

test('status is cached briefly so polling does not run the CLI every time', async () => {
  let runs = 0;
  let nowMs = 0;
  const service = new ClaudeAuthService(
    async () => {
      runs += 1;
      return '{"loggedIn": true}';
    },
    () => new FakeLogin() as unknown as ChildProcess,
    () => nowMs
  );
  await service.getStatus();
  await service.getStatus();
  assert.equal(runs, 1);
  nowMs = AUTH_STATUS_CACHE_MS + 1;
  await service.getStatus();
  assert.equal(runs, 2);
});

test('starting a sign-in passes --sso only when asked, and only one runs at a time', async () => {
  const started: string[][] = [];
  const service = new ClaudeAuthService(
    async () => '{"loggedIn": false}',
    (args) => {
      started.push(args);
      return new FakeLogin() as unknown as ChildProcess;
    }
  );

  service.startSignIn(true);
  service.startSignIn(false); // ignored: one is already open
  assert.deepEqual(started, [['auth', 'login', '--sso']]);
  assert.equal((await service.getStatus()).isSigningIn, true);
});

test('when the sign-in ends the status is re-read straight away', async () => {
  let loggedIn = false;
  const login = new FakeLogin();
  const service = new ClaudeAuthService(
    async () => JSON.stringify({ loggedIn, email: loggedIn ? 'hr@example.com' : undefined }),
    () => login as unknown as ChildProcess
  );

  assert.equal((await service.getStatus()).signedIn, false);
  service.startSignIn(false);
  loggedIn = true;
  login.emit('close', 0);

  const status = await service.getStatus();
  assert.equal(status.signedIn, true);
  assert.equal(status.account, 'hr@example.com');
  assert.equal(status.isSigningIn, false);
});

test('cancelling stops the sign-in', async () => {
  const login = new FakeLogin();
  const service = new ClaudeAuthService(async () => '{"loggedIn": false}', () => login as unknown as ChildProcess);
  service.startSignIn(false);
  service.cancelSignIn();
  assert.equal(login.killed, true);
  assert.equal((await service.getStatus()).isSigningIn, false);
});
