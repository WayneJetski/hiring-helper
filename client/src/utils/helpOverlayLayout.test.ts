import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateLegendHeight,
  legendColumnCount,
  legendWidth,
  placeLegend,
  type Box,
} from './helpOverlayLayout.js';

const viewport = { width: 1400, height: 880 };

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

test('is three columns on a normal screen and fewer on a narrow one', () => {
  assert.equal(legendColumnCount(1400), 3);
  assert.equal(legendColumnCount(700), 2);
  assert.equal(legendColumnCount(400), 1);
});

test('sits centered at the bottom when nothing is highlighted there', () => {
  const legend = placeLegend([{ top: 100, left: 100, width: 200, height: 40 }], viewport, 240);
  assert.equal(legend.left, (viewport.width - legend.width) / 2);
  assert.equal(legend.top + legend.height, viewport.height - 16);
});

test('moves to the top when the bottom would cover a highlighted element', () => {
  const nearBottomCenter: Box = { top: 700, left: 500, width: 400, height: 120 };
  const legend = placeLegend([nearBottomCenter], viewport, 240);
  assert.equal(overlaps(legend, nearBottomCenter), false);
  assert.equal(legend.top, 72);
});

test('never covers the far-right row menu that the old corner placement hid', () => {
  const rowMenu: Box = { top: 380, left: 1340, width: 40, height: 40 };
  const legend = placeLegend([rowMenu], viewport, 240);
  assert.equal(overlaps(legend, rowMenu), false);
});

test('stays on screen and below the top bar even when very tall', () => {
  const legend = placeLegend([], viewport, 5000);
  assert.ok(legend.top >= 72);
  assert.ok(legend.top + legend.height <= viewport.height);
  assert.ok(legend.left >= 0 && legend.left + legend.width <= viewport.width);
});

test('is no wider than the screen on a small viewport', () => {
  assert.ok(legendWidth(500) <= 500 - 32);
});

test('more rows need a taller card, and more columns need fewer rows', () => {
  const texts = Array.from({ length: 12 }, () => 'A short note about this control.');
  const width = legendWidth(viewport.width);
  assert.ok(estimateLegendHeight(texts, 3, width) < estimateLegendHeight(texts, 1, width));
  assert.ok(estimateLegendHeight(texts, 3, width) > estimateLegendHeight(texts.slice(0, 3), 3, width));
});

test('the side layout is one narrow column down the right edge, below the top bar', () => {
  assert.equal(legendColumnCount(1400, 'side'), 1);
  const legend = placeLegend([{ top: 100, left: 100, width: 200, height: 40 }], viewport, 300, 'side');
  assert.equal(legend.width, 340);
  assert.equal(legend.left + legend.width, viewport.width - 16);
  assert.equal(legend.top, 72);
});

test('the side layout is capped to the screen height when the list is tall', () => {
  const legend = placeLegend([], viewport, 5000, 'side');
  assert.ok(legend.top + legend.height <= viewport.height);
});

test('the side layout moves to the left edge when the right edge would cover a highlight', () => {
  const rightColumnCard: Box = { top: 300, left: 700, width: 640, height: 400 };
  const legend = placeLegend([rightColumnCard], viewport, 300, 'side');
  assert.equal(overlaps(legend, rightColumnCard), false);
  assert.equal(legend.left, 16);
});
