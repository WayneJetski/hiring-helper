/**
 * Tests for editing .env text. Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { upsertEnvLines } from './env-file.js';

test('replaces existing keys in place and keeps other lines', () => {
  const before = '# BambooHR\nBAMBOOHR_API_KEY=old\nPORT=3000\nBAMBOOHR_SUBDOMAIN=\n';
  const after = upsertEnvLines(before, { BAMBOOHR_API_KEY: 'new', BAMBOOHR_SUBDOMAIN: 'acme' });
  assert.equal(after, '# BambooHR\nBAMBOOHR_API_KEY=new\nPORT=3000\nBAMBOOHR_SUBDOMAIN=acme\n');
});

test('appends keys that are missing and works on an empty file', () => {
  assert.equal(upsertEnvLines('', { A: '1', B: '2' }), 'A=1\nB=2\n');
  assert.equal(upsertEnvLines('PORT=3000\n', { A: '1' }), 'PORT=3000\nA=1\n');
});

test('leaves commented-out keys alone', () => {
  assert.equal(upsertEnvLines('# SCORING_MODEL=x\n', { SCORING_MODEL: 'y' }), '# SCORING_MODEL=x\nSCORING_MODEL=y\n');
});

test('quotes values that contain spaces or special characters', () => {
  assert.equal(upsertEnvLines('', { A: 'has space' }), 'A="has space"\n');
});

test('rejects multi-line values so a value cannot inject another variable', () => {
  assert.throws(() => upsertEnvLines('', { A: 'x\nEVIL=1' }), /single line/);
});
