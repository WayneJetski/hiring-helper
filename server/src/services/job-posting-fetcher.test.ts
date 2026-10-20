/**
 * Tests for converting and fetching public BambooHR job postings.
 * Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { htmlToPlainText, fetchPostingText, type FetchFn } from './job-posting-fetcher.js';

test('converts paragraphs, bullets and entities to readable text', () => {
  const html =
    '<p><span style="font-weight: bold">About the role</span></p>' +
    '<p>You&#39;ll own data &amp; tools.<br>Second line.</p>' +
    '<ul><li>Build dashboards</li><li>Answer questions</li></ul>';
  assert.equal(
    htmlToPlainText(html),
    "About the role\n\nYou'll own data & tools.\nSecond line.\n\n- Build dashboards\n- Answer questions"
  );
});

test('returns the description text from the careers detail JSON', async () => {
  let requestedUrl = '';
  const fakeFetch: FetchFn = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: { jobOpening: { description: '<p>Hello</p>' } } }),
    };
  };
  assert.equal(await fetchPostingText('acme', 48, fakeFetch), 'Hello');
  assert.equal(requestedUrl, 'https://acme.bamboohr.com/careers/48/detail');
});

test('a closed or unpublished posting (404) yields null, not an error', async () => {
  const fakeFetch: FetchFn = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.equal(await fetchPostingText('acme', 36, fakeFetch), null);
});

test('a posting without a description yields null', async () => {
  const fakeFetch: FetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ result: { jobOpening: {} } }),
  });
  assert.equal(await fetchPostingText('acme', 1, fakeFetch), null);
});

test('other HTTP failures surface as errors', async () => {
  const fakeFetch: FetchFn = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(fetchPostingText('acme', 1, fakeFetch), /HTTP 500/);
});

test('rejects a subdomain that is not a plain hostname label', async () => {
  const fakeFetch: FetchFn = async () => {
    throw new Error('should not be called');
  };
  await assert.rejects(fetchPostingText('evil.com/x', 1, fakeFetch), /Invalid BambooHR subdomain/);
});
