import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatTimeAgo, parseServerTimestamp } from './relativeTime.js';

test('reads a SQLite UTC timestamp as UTC, not local time', () => {
  assert.equal(parseServerTimestamp('2026-10-20 14:31:59').toISOString(), '2026-10-20T14:31:59.000Z');
});

test('leaves ISO timestamps with a zone untouched', () => {
  assert.equal(parseServerTimestamp('2026-10-20T11:58:40+00:00').toISOString(), '2026-10-20T11:58:40.000Z');
});

test('formats time ago in plain language', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  assert.equal(formatTimeAgo(new Date('2026-10-20T11:59:40Z'), now), 'just now');
  assert.equal(formatTimeAgo(new Date('2026-10-20T11:55:00Z'), now), '5 min ago');
  assert.equal(formatTimeAgo(new Date('2026-10-20T11:00:00Z'), now), '1 hour ago');
  assert.equal(formatTimeAgo(new Date('2026-10-18T12:00:00Z'), now), '2 days ago');
});

test('formats durations', () => {
  assert.equal(formatDuration(20), 'under a minute');
  assert.equal(formatDuration(180), 'about 3 min');
  assert.equal(formatDuration(7200), 'about 2 hours');
});
