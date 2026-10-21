import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toSafeWebUrl } from './safeUrl.js';

test('keeps ordinary web addresses', () => {
  assert.equal(toSafeWebUrl('https://www.linkedin.com/in/jane'), 'https://www.linkedin.com/in/jane');
  assert.equal(toSafeWebUrl('http://example.com'), 'http://example.com/');
});

test('adds https to an address typed without a scheme', () => {
  assert.equal(toSafeWebUrl('linkedin.com/in/jane'), 'https://linkedin.com/in/jane');
  assert.equal(toSafeWebUrl('  www.example.com  '), 'https://www.example.com/');
});

test('refuses script, data, file and other schemes in any casing', () => {
  for (const value of [
    'javascript:alert(1)',
    'JaVaScRiPt:fetch("/api/applicants/push")',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'blob:https://example.com/x',
  ]) {
    assert.equal(toSafeWebUrl(value), null, value);
  }
});

test('refuses empty values and addresses with an embedded login', () => {
  assert.equal(toSafeWebUrl(''), null);
  assert.equal(toSafeWebUrl(undefined), null);
  assert.equal(toSafeWebUrl(null), null);
  assert.equal(toSafeWebUrl('https://user:pass@example.com'), null);
});
