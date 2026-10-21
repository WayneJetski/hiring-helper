import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBambooHRFailure, buildBambooHRError } from './bamboohr-failure.js';
import { classifyClaudeFailureText, buildClaudeError } from './claude-failure.js';
import { UpstreamServiceError, isRateLimitedUpstreamError } from './upstream-error.js';

test('BambooHR HTTP statuses map to the kind a person can act on', () => {
  assert.equal(classifyBambooHRFailure(503, undefined), 'unavailable');
  assert.equal(classifyBambooHRFailure(500, undefined), 'unavailable');
  assert.equal(classifyBambooHRFailure(429, undefined), 'rate_limited');
  assert.equal(classifyBambooHRFailure(401, undefined), 'unauthorized');
  assert.equal(classifyBambooHRFailure(403, undefined), 'forbidden');
  assert.equal(classifyBambooHRFailure(404, undefined), 'not_found');
  assert.equal(classifyBambooHRFailure(504, undefined), 'timeout');
  assert.equal(classifyBambooHRFailure(422, undefined), 'rejected');
});

test('BambooHR failures without a response are told apart by network code', () => {
  assert.equal(classifyBambooHRFailure(undefined, 'ECONNABORTED'), 'timeout');
  assert.equal(classifyBambooHRFailure(undefined, 'ENOTFOUND'), 'network');
  assert.equal(classifyBambooHRFailure(undefined, undefined), 'unknown');
});

test('a BambooHR outage message carries no response body and is retryable', () => {
  const rawGatewayPage = '<html><head><title>503 Service Temporarily Unavailable</title></head></html>';
  const error = buildBambooHRError('unavailable', 503, new Error(rawGatewayPage));
  assert.ok(error instanceof UpstreamServiceError);
  assert.doesNotMatch(error.message, /<|html|APISIX|openresty/i);
  assert.equal(error.responseStatus, 503);
  assert.equal(error.isRetryable, true);
});

test('only a rate-limited upstream error counts as a rate limit', () => {
  assert.equal(isRateLimitedUpstreamError(buildBambooHRError('rate_limited', 429, undefined)), true);
  assert.equal(isRateLimitedUpstreamError(buildBambooHRError('unavailable', 503, undefined)), false);
  assert.equal(isRateLimitedUpstreamError(new Error('429 too many requests')), false);
});

test('a refused key is not retryable', () => {
  assert.equal(buildBambooHRError('unauthorized', 401, undefined).isRetryable, false);
});

test('Claude overload, usage limit and sign-in text map to friendly kinds', () => {
  assert.equal(classifyClaudeFailureText('API Error: 529 {"type":"overloaded_error"}'), 'unavailable');
  assert.equal(classifyClaudeFailureText('Claude usage limit reached'), 'rate_limited');
  assert.equal(classifyClaudeFailureText('Not logged in · Please run /login'), 'unauthorized');
  assert.equal(classifyClaudeFailureText('Credit balance is too low'), 'forbidden');
  assert.equal(classifyClaudeFailureText('something odd'), 'unknown');
});

test('unrecognised Claude text is never shown as written, but is kept as the cause', () => {
  const error = buildClaudeError('Traceback: secret internal detail');
  assert.doesNotMatch(error.message, /Traceback|secret/);
  assert.match(String((error.cause as Error).message), /secret internal detail/);
});
