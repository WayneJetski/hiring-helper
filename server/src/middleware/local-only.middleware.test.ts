/**
 * Tests for the local-only guard. Run with: npm run test --workspace=server
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  allowedOriginsFor,
  createLocalOnlyGuard,
  hostnameOf,
  isLocalHostHeader,
  requireBrowserOrigin,
} from './local-only.middleware.js';

test('reads the host name out of Host headers and origins', () => {
  assert.equal(hostnameOf('localhost:3000'), 'localhost');
  assert.equal(hostnameOf('http://localhost:5173'), 'localhost');
  assert.equal(hostnameOf('http://127.0.0.1:28417/path'), '127.0.0.1');
  assert.equal(hostnameOf('[::1]:3000'), '[::1]');
  assert.equal(hostnameOf('Evil.Example.com:80'), 'evil.example.com');
});

test('only local host names are accepted', () => {
  for (const host of ['localhost', 'localhost:3000', '127.0.0.1:28417', '[::1]:3000']) {
    assert.equal(isLocalHostHeader(host), true, host);
  }
  for (const host of ['evil.example.com', 'evil.example.com:3000', 'localhost.evil.com', '192.168.1.5:3000', '']) {
    assert.equal(isLocalHostHeader(host), false, host);
  }
  assert.equal(isLocalHostHeader(undefined), false);
});

test('only this server and the dev client are allowed to make changes', () => {
  const origins = allowedOriginsFor(28417, 'http://localhost:5173');
  for (const origin of [
    'http://localhost:28417',
    'http://127.0.0.1:28417',
    'http://[::1]:28417',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]) {
    assert.equal(origins.has(origin), true, origin);
  }
  for (const origin of [
    'http://localhost:8080', // some other program on this computer
    'http://localhost',
    'https://localhost:28417',
    'https://evil.example.com',
    'http://localhost.evil.com:28417',
    'null',
  ]) {
    assert.equal(origins.has(origin), false, origin);
  }
});

test('in production the dev client port is not trusted', () => {
  const origins = allowedOriginsFor(28417, 'http://localhost:5173', true);
  assert.equal(origins.has('http://localhost:28417'), true);
  assert.equal(origins.has('http://localhost:5173'), false);
});

test('an unusable CLIENT_URL leaves only the server port allowed', () => {
  const origins = allowedOriginsFor(3000, 'not a url');
  assert.equal(origins.has('http://localhost:3000'), true);
  assert.equal(origins.has('http://localhost:5173'), false);
});

let server: http.Server;
let port: number;
/** The port the guard treats as "this server" (the test listens on a random one). */
const SERVER_PORT = 28417;

before(async () => {
  const app = express();
  app.use(createLocalOnlyGuard(allowedOriginsFor(SERVER_PORT, 'http://localhost:5173')));
  app.all('/thing', (_req, res) => res.json({ ok: true }));
  app.post('/sensitive', requireBrowserOrigin, (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.close();
});

function request(
  method: string,
  headers: Record<string, string>,
  path = '/thing'
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

test('a normal local request goes through', async () => {
  assert.equal(await request('GET', { Host: `localhost:${port}` }), 200);
  assert.equal(await request('POST', { Host: `127.0.0.1:${port}` }), 200, 'no Origin: curl or a script');
});

test('a request addressed to a foreign host name (DNS rebinding) is refused', async () => {
  assert.equal(await request('GET', { Host: `evil.example.com:${port}` }), 403);
});

test('a write from another website is refused, but reading is not tied to Origin', async () => {
  const local = `localhost:${port}`;
  assert.equal(await request('POST', { Host: local, Origin: 'https://evil.example.com' }), 403);
  assert.equal(await request('DELETE', { Host: local, Origin: 'null' }), 403);
  assert.equal(await request('POST', { Host: local, Origin: 'http://localhost:5173' }), 200, 'the dev server');
  assert.equal(await request('POST', { Host: local, Origin: `http://localhost:${SERVER_PORT}` }), 200, 'the app itself');
  assert.equal(
    await request('POST', { Host: local, Origin: 'http://localhost:8080' }),
    403,
    'another program on localhost'
  );
  assert.equal(await request('GET', { Host: local, Origin: 'https://evil.example.com' }), 200);
});

test('a sensitive action needs a browser-labelled request from the page', async () => {
  const local = `localhost:${port}`;
  const page = `http://localhost:${SERVER_PORT}`;
  assert.equal(await request('POST', { Host: local }, '/sensitive'), 403, 'curl or a script');
  assert.equal(
    await request('POST', { Host: local, Origin: page, 'Sec-Fetch-Site': 'same-site' }, '/sensitive'),
    403,
    'a different page on this computer'
  );
  assert.equal(
    await request('POST', { Host: local, Origin: page, 'Sec-Fetch-Site': 'cross-site' }, '/sensitive'),
    403
  );
  assert.equal(await request('POST', { Host: local, Origin: page, 'Sec-Fetch-Site': 'same-origin' }, '/sensitive'), 200);
  assert.equal(await request('POST', { Host: local, Origin: page }, '/sensitive'), 200, 'older browsers');
});
