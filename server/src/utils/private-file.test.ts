import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writePrivateFile } from './private-file.js';

const isWindows = process.platform === 'win32';

test('an existing world-readable file becomes owner-only when rewritten', { skip: isWindows }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-file-'));
  try {
    const filePath = join(directory, '.env');
    writeFileSync(filePath, 'BAMBOOHR_API_KEY=old\n', { mode: 0o644 });
    assert.equal(statSync(filePath).mode & 0o777, 0o644);

    await writePrivateFile(filePath, 'BAMBOOHR_API_KEY=new\n');

    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.equal(readFileSync(filePath, 'utf-8'), 'BAMBOOHR_API_KEY=new\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a new file is created owner-only', { skip: isWindows }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'private-file-'));
  try {
    const filePath = join(directory, '.env');
    await writePrivateFile(filePath, 'x=1\n');
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
