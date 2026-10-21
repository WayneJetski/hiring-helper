import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateLegendHeight,
  legendColumnCount,
  legendRowCount,
  legendWidth,
  placeLegend,
  scrollDeltaToReveal,
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

test('items fill each column before the next: 11 items in 3 columns is 4, 4, 3 rows deep', () => {
  assert.equal(legendRowCount(11, 3), 4);
  assert.equal(legendRowCount(12, 3), 4);
  assert.equal(legendRowCount(2, 3), 1);
  assert.equal(legendRowCount(0, 3), 1);
});

test('the height estimate follows column order, so one long note only counts in its own row', () => {
  const short = 'Short note.';
  const long = 'A much longer note that wraps onto several lines in a narrow column. '.repeat(3);
  const width = legendWidth(viewport.width);
  // 6 items, 3 columns: rows are (0,2,4) and (1,3,5). The long note is item 1, in row 2 only.
  const texts = [short, long, short, short, short, short];
  const withLongInSecondRow = estimateLegendHeight(texts, 3, width);
  const allShort = estimateLegendHeight(Array(6).fill(short), 3, width);
  assert.ok(withLongInSecondRow > allShort);
});

test('an element already inside the free area needs no scroll', () => {
  assert.equal(scrollDeltaToReveal({ top: 200, height: 100 }, { top: 72, bottom: 600 }), 0);
});

test('an element below the free area is scrolled up to its middle', () => {
  // Free area 72..600 (height 528); a 100px element is centred at top = 72 + 214 = 286.
  assert.equal(scrollDeltaToReveal({ top: 900, height: 100 }, { top: 72, bottom: 600 }), 614);
});

test('an element above the free area is scrolled down (negative delta)', () => {
  assert.equal(scrollDeltaToReveal({ top: -300, height: 100 }, { top: 72, bottom: 600 }), -586);
});

test('an element partly under the legend counts as not revealed', () => {
  assert.notEqual(scrollDeltaToReveal({ top: 550, height: 100 }, { top: 72, bottom: 600 }), 0);
});

test('an element taller than the free area is aligned to its top', () => {
  assert.equal(scrollDeltaToReveal({ top: 800, height: 900 }, { top: 72, bottom: 600 }), 728);
});
