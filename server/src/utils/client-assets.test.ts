/**
 * Tests for serving the built client. Run with: npm run test --workspace=server
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { registerClientAssets } from './client-assets.js';

let distDir: string;
let server: Server;
let baseUrl: string;

before(async () => {
  distDir = mkdtempSync(join(tmpdir(), 'client-dist-'));
  mkdirSync(join(distDir, 'assets'));
  writeFileSync(join(distDir, 'index.html'), '<html><body>client shell</body></html>');
  writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log("app");');

  const app = express();
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  assert.equal(registerClientAssets(app, distDir), true);
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  rmSync(distDir, { recursive: true, force: true });
});

test('serves the client shell at the root', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /client shell/);
});

test('serves built assets as files', async () => {
  const response = await fetch(`${baseUrl}/assets/app.js`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /console\.log/);
});

test('falls back to the client shell for deep links like /setup', async () => {
  for (const path of ['/setup', '/applicants/42']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /client shell/, path);
  }
});

test('leaves API routes alone, including unknown ones', async () => {
  const known = await fetch(`${baseUrl}/api/ping`);
  assert.deepEqual(await known.json(), { ok: true });

  const unknown = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(unknown.status, 404);
});

test('registers nothing when the client has not been built', () => {
  const app = express();
  assert.equal(registerClientAssets(app, join(tmpdir(), 'no-such-client-dist')), false);
});
