import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncCoordinator } from './sync-coordinator.js';

function gate(): { open: () => void; wait: Promise<void> } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, wait };
}

test('overlapping requests share one run', async () => {
  const coordinator = new SyncCoordinator<string>();
  const door = gate();
  let runs = 0;
  const run = async (): Promise<string> => {
    runs++;
    await door.wait;
    return 'done';
  };

  const first = coordinator.request(false, run);
  const second = coordinator.request(false, run);
  assert.equal(coordinator.isRunning, true);
  door.open();

  assert.deepEqual(await Promise.all([first, second]), ['done', 'done']);
  assert.equal(runs, 1);
  assert.equal(coordinator.isRunning, false);
});

test('a forced sync during an incremental one runs after it instead of being dropped', async () => {
  const coordinator = new SyncCoordinator<string>();
  const door = gate();
  const order: string[] = [];

  const incremental = coordinator.request(false, async () => {
    order.push('incremental start');
    await door.wait;
    order.push('incremental end');
    return 'incremental';
  });
  const forced = coordinator.request(true, async () => {
    order.push('full');
    return 'full';
  });
  door.open();

  assert.deepEqual(await Promise.all([incremental, forced]), ['incremental', 'full']);
  assert.deepEqual(order, ['incremental start', 'incremental end', 'full']);
});

test('two forced requests during an incremental sync share one full run', async () => {
  const coordinator = new SyncCoordinator<string>();
  const door = gate();
  let fullRuns = 0;
  const full = async (): Promise<string> => {
    fullRuns++;
    return 'full';
  };

  const incremental = coordinator.request(false, async () => {
    await door.wait;
    return 'incremental';
  });
  const forcedA = coordinator.request(true, full);
  const forcedB = coordinator.request(true, full);
  door.open();

  await Promise.all([incremental, forcedA, forcedB]);
  assert.equal(fullRuns, 1);
});

test('a forced request while a forced sync runs joins it', async () => {
  const coordinator = new SyncCoordinator<string>();
  const door = gate();
  let runs = 0;
  const run = async (): Promise<string> => {
    runs++;
    await door.wait;
    return 'full';
  };

  const first = coordinator.request(true, run);
  const second = coordinator.request(true, run);
  door.open();
  await Promise.all([first, second]);
  assert.equal(runs, 1);
});

test('a forced sync still runs when the incremental one before it failed', async () => {
  const coordinator = new SyncCoordinator<string>();
  const door = gate();
  const incremental = coordinator.request(false, async () => {
    await door.wait;
    throw new Error('boom');
  });
  const forced = coordinator.request(true, async () => 'full');
  door.open();

  await assert.rejects(incremental, /boom/);
  assert.equal(await forced, 'full');
});
