import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRestartCommand } from './restart-command.js';

test('on Windows an install path with a space stays in one quoted piece', () => {
  const command = buildRestartCommand('C:\\Users\\Jane Doe\\hiring-helper', true, { stopFirst: false });
  assert.equal(command.file, 'cmd.exe');
  assert.equal(command.windowsVerbatimArguments, true);
  assert.deepEqual(command.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(command.args[3], /^""[^"]*Jane Doe[^"]*hiring-helper\.cmd" restart --no-open"$/);
});

test('elsewhere the script is run directly with plain arguments', () => {
  const command = buildRestartCommand('/home/jane/hiring-helper', false, { stopFirst: false });
  assert.equal(command.file, '/home/jane/hiring-helper/bin/hiring-helper');
  assert.deepEqual(command.args, ['restart', '--no-open']);
});

test('stop-first is passed on only when asked for', () => {
  assert.deepEqual(buildRestartCommand('/x', false, { stopFirst: true }).args, ['restart', '--no-open', '--stop-first']);
  assert.match(buildRestartCommand('C:\\x', true, { stopFirst: true }).args[3], /restart --no-open --stop-first"$/);
});
