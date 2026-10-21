/**
 * Size and position of the help overlay's legend card: a wide card in columns, centered
 * at the bottom of the screen (or at the top when that would hide more of the
 * highlighted elements). Pure geometry, so it is testable without a browser.
 */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const MAX_LEGEND_WIDTH = 1040;
const EDGE_MARGIN = 16;
/** Keeps the legend clear of the app's top bar. */
const TOP_BAR_CLEARANCE = 72;
const LINE_HEIGHT = 18;
const ROW_GAP = 12;
/** Card padding and border; the Close button floats over the top edge and takes no height. */
const LEGEND_CHROME_HEIGHT = 34;
const WIDE_COLUMNS_MIN_WIDTH = 900;
const TWO_COLUMNS_MIN_WIDTH = 600;

/** Three columns on a normal screen, fewer when it is narrow. */
export function legendColumnCount(viewportWidth: number): number {
  if (viewportWidth >= WIDE_COLUMNS_MIN_WIDTH) return 3;
  if (viewportWidth >= TWO_COLUMNS_MIN_WIDTH) return 2;
  return 1;
}

export function legendWidth(viewportWidth: number): number {
  return Math.min(MAX_LEGEND_WIDTH, viewportWidth - EDGE_MARGIN * 2);
}

/** Rows needed when items fill each column top to bottom before starting the next. */
export function legendRowCount(itemCount: number, columns: number): number {
  return Math.max(1, Math.ceil(itemCount / columns));
}

/**
 * Items are short, so a line-count estimate is enough: each is a bold title line
 * plus wrapped text, and a row of the grid is as tall as its tallest item. Items
 * flow down the columns (11 items in 3 columns: 1-4, 5-8, 9-11), so row r holds
 * items r, r + rows, r + 2 * rows, ...
 */
export function estimateLegendHeight(
  itemTexts: string[],
  columns: number,
  cardWidth: number
): number {
  const columnWidth = (cardWidth - 32) / columns;
  const charactersPerLine = Math.max(12, Math.floor((columnWidth - 40) / 7));
  const rows = legendRowCount(itemTexts.length, columns);

  let height = 0;
  for (let row = 0; row < rows; row += 1) {
    const rowTexts = Array.from({ length: columns }, (_, column) => itemTexts[row + column * rows])
      .filter((text): text is string => text !== undefined);
    const tallestLines = Math.max(
      ...rowTexts.map((text) => 1 + Math.max(1, Math.ceil(text.length / charactersPerLine)))
    );
    height += tallestLines * LINE_HEIGHT + ROW_GAP;
  }
  return height + LEGEND_CHROME_HEIGHT;
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Bottom center, unless the top center would hide less of the highlighted elements. The
 * card never leaves the screen: when it is taller than the space it is capped and scrolls.
 */
export function placeLegend(
  targetRects: Box[],
  viewport: { width: number; height: number },
  contentHeight: number
): Box {
  const width = legendWidth(viewport.width);
  const maxHeight = viewport.height - TOP_BAR_CLEARANCE - EDGE_MARGIN;
  const height = Math.min(contentHeight, Math.max(maxHeight, 0));

  const coveredBy = (card: Box): number =>
    targetRects.reduce((sum, rect) => sum + overlapArea(card, rect), 0);

  const left = (viewport.width - width) / 2;
  const bottomCenter: Box = { top: viewport.height - height - EDGE_MARGIN, left, width, height };
  const topCenter: Box = { top: TOP_BAR_CLEARANCE, left, width, height };

  return coveredBy(topCenter) < coveredBy(bottomCenter) ? topCenter : bottomCenter;
}

/**
 * How far to scroll the page (positive = down) so an element is fully inside the part
 * of the screen the legend does not cover: 0 when it already is, otherwise it ends up
 * centred there (or top-aligned when it is taller than the free area).
 */
export function scrollDeltaToReveal(
  rect: { top: number; height: number },
  freeArea: { top: number; bottom: number }
): number {
  const rectBottom = rect.top + rect.height;
  if (rect.top >= freeArea.top && rectBottom <= freeArea.bottom) return 0;
  const freeHeight = freeArea.bottom - freeArea.top;
  if (rect.height >= freeHeight) return rect.top - freeArea.top;
  return rect.top - (freeArea.top + (freeHeight - rect.height) / 2);
}

/** The top of the screen the app's top bar occupies; nothing is revealed beneath it. */
export const REVEAL_TOP = TOP_BAR_CLEARANCE;
export const REVEAL_EDGE_MARGIN = EDGE_MARGIN;
