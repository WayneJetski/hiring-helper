import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SingleFlight } from './single-flight.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

test('callers that arrive while a run is in progress share its result', async () => {
  const flight = new SingleFlight<number>();
  const gate = deferred<number>();
  let starts = 0;
  const task = (): Promise<number> => {
    starts++;
    return gate.promise;
  };

  const first = flight.run(task);
  const second = flight.run(task);
  assert.equal(flight.isRunning, true);
  gate.resolve(7);

  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  assert.equal(starts, 1);
  assert.equal(flight.isRunning, false);
});

test('a new run can start once the previous one has finished', async () => {
  const flight = new SingleFlight<string>();
  assert.equal(await flight.run(async () => 'a'), 'a');
  assert.equal(await flight.run(async () => 'b'), 'b');
});

test('a failed run clears the guard so the next attempt can run', async () => {
  const flight = new SingleFlight<string>();
  await assert.rejects(flight.run(async () => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(flight.isRunning, false);
  assert.equal(await flight.run(async () => 'ok'), 'ok');
});

test('whenIdle resolves once the run ends, even when it failed', async () => {
  const flight = new SingleFlight<string>();
  assert.equal(await flight.whenIdle(), undefined);

  const gate = deferred<string>();
  const failing = flight.run(() => gate.promise);
  const idle = flight.whenIdle();
  gate.resolve('x');
  await failing;
  assert.equal(await idle, undefined);
  assert.equal(flight.isRunning, false);
});
