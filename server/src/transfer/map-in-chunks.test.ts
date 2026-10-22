import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapInChunks } from './map-in-chunks.js';

test('results keep the input order', async () => {
  const results = await mapInChunks([3, 1, 2], 2, async (n) => {
    await new Promise((resolve) => setTimeout(resolve, n));
    return n * 10;
  });
  assert.deepEqual(results, [30, 10, 20]);
});

test('no more than the chunk size runs at once', async () => {
  let running = 0;
  let peak = 0;
  await mapInChunks([1, 2, 3, 4, 5], 2, async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 2));
    running--;
  });
  assert.equal(peak, 2);
});

test('an empty list gives an empty result', async () => {
  assert.deepEqual(await mapInChunks([], 5, async () => 1), []);
});
