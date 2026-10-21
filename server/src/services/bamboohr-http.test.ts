/**
 * The BambooHR access policy: which requests each kind of client may send.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRedirectAllowed,
  assertRequestAllowed,
  BambooHRAccessDeniedError,
} from './bamboohr-http.js';

const STATUS_PATH = '/applicant_tracking/applications/123/status';

test('a read-only client may GET, with or without a query string', () => {
  assert.doesNotThrow(() => assertRequestAllowed('read-only', 'get', '/applicant_tracking/jobs'));
  assert.doesNotThrow(() =>
    assertRequestAllowed('read-only', 'GET', '/applicant_tracking/applications?page=2')
  );
});

test('a read-only client refuses every write verb, including the status endpoint', () => {
  for (const verb of ['post', 'put', 'patch', 'delete']) {
    assert.throws(
      () => assertRequestAllowed('read-only', verb, STATUS_PATH),
      BambooHRAccessDeniedError,
      verb
    );
  }
});

test('the status writer may POST an application status and nothing else', () => {
  assert.doesNotThrow(() => assertRequestAllowed('status-write', 'post', STATUS_PATH));

  const refused: Array<[string, string]> = [
    ['get', STATUS_PATH],
    ['put', STATUS_PATH],
    ['delete', STATUS_PATH],
    ['post', '/applicant_tracking/applications/123/comments'],
    ['post', '/applicant_tracking/applications/abc/status'],
    ['post', '/applicant_tracking/applications/123/status/extra'],
    ['post', '/applicant_tracking/applications/123/../jobs'],
    ['post', '/employees/1'],
  ];
  for (const [verb, url] of refused) {
    assert.throws(
      () => assertRequestAllowed('status-write', verb, url),
      BambooHRAccessDeniedError,
      `${verb} ${url}`
    );
  }
});

test('an absolute or protocol-relative URL is refused, so the key cannot be sent to another host', () => {
  for (const access of ['read-only', 'status-write'] as const) {
    assert.throws(
      () => assertRequestAllowed(access, access === 'read-only' ? 'get' : 'post', 'https://evil.example/x'),
      BambooHRAccessDeniedError
    );
    assert.throws(
      () => assertRequestAllowed(access, access === 'read-only' ? 'get' : 'post', '//evil.example/x'),
      BambooHRAccessDeniedError
    );
  }
});

test('a redirect is followed only within https://*.bamboohr.com', () => {
  assert.doesNotThrow(() => assertRedirectAllowed('https:', 'acme.bamboohr.com'));
  assert.throws(() => assertRedirectAllowed('http:', 'acme.bamboohr.com'), BambooHRAccessDeniedError);
  assert.throws(() => assertRedirectAllowed('https:', 'evil.example'), BambooHRAccessDeniedError);
  assert.throws(
    () => assertRedirectAllowed('https:', 'acme.bamboohr.com.evil.example'),
    BambooHRAccessDeniedError
  );
});
