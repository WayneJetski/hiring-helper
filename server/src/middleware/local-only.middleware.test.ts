/**
 * Tests for the local-only guard. Run with: npm run test --workspace=server
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { hostnameOf, isLocalHostHeader, isLocalOrigin, localOnlyGuard } from './local-only.middleware.js';

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

test('local origins are accepted on any port; look-alikes are not', () => {
  assert.equal(isLocalOrigin('http://localhost:5173'), true);
  assert.equal(isLocalOrigin('http://127.0.0.1:28417'), true);
  assert.equal(isLocalOrigin('https://evil.example.com'), false);
  assert.equal(isLocalOrigin('http://localhost.evil.com'), false);
  assert.equal(isLocalOrigin('null'), false);
});

let server: http.Server;
let port: number;

before(async () => {
  const app = express();
  app.use(localOnlyGuard);
  app.all('/thing', (_req, res) => res.json({ ok: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

after(() => {
  server.close();
});

function request(method: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/thing', method, headers }, (res) => {
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
  assert.equal(await request('GET', { Host: local, Origin: 'https://evil.example.com' }), 200);
});
