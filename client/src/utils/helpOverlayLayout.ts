/**
 * Size and position of the help overlay's legend card. Two layouts:
 *  - 'bottom': a wide card in columns, centered at the bottom of the screen (or
 *    at the top when that would hide more of the highlighted elements);
 *  - 'side': a single narrow column down the right edge, or the left edge when
 *    that hides less of the highlighted elements.
 * Pure geometry, so it is testable without a browser.
 */

export type LegendLayout = 'bottom' | 'side';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export const MAX_LEGEND_WIDTH = 1040;
export const SIDE_LEGEND_WIDTH = 340;
const EDGE_MARGIN = 16;
/** Keeps the legend clear of the app's top bar. */
const TOP_BAR_CLEARANCE = 72;
const LINE_HEIGHT = 18;
const ROW_GAP = 12;
const LEGEND_CHROME_HEIGHT = 76;
const WIDE_COLUMNS_MIN_WIDTH = 900;
const TWO_COLUMNS_MIN_WIDTH = 600;

/** Three columns on a normal screen, fewer when it is narrow. */
export function legendColumnCount(viewportWidth: number, layout: LegendLayout = 'bottom'): number {
  if (layout === 'side') return 1;
  if (viewportWidth >= WIDE_COLUMNS_MIN_WIDTH) return 3;
  if (viewportWidth >= TWO_COLUMNS_MIN_WIDTH) return 2;
  return 1;
}

export function legendWidth(viewportWidth: number, layout: LegendLayout = 'bottom'): number {
  const preferred = layout === 'side' ? SIDE_LEGEND_WIDTH : MAX_LEGEND_WIDTH;
  return Math.min(preferred, viewportWidth - EDGE_MARGIN * 2);
}

/**
 * Items are short, so a line-count estimate is enough: each is a bold title line
 * plus wrapped text, and a row of the grid is as tall as its tallest item.
 */
export function estimateLegendHeight(
  itemTexts: string[],
  columns: number,
  cardWidth: number
): number {
  const columnWidth = (cardWidth - 32) / columns;
  const charactersPerLine = Math.max(12, Math.floor((columnWidth - 40) / 7));

  let height = 0;
  for (let start = 0; start < itemTexts.length; start += columns) {
    const tallestLines = Math.max(
      ...itemTexts
        .slice(start, start + columns)
        .map((text) => 1 + Math.max(1, Math.ceil(text.length / charactersPerLine)))
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
 * Side layout: down the right edge. Bottom layout: bottom center unless the top
 * center would hide less of the highlighted elements. The card never leaves the screen: when it is taller than the
 * space it is capped and scrolls.
 */
export function placeLegend(
  targetRects: Box[],
  viewport: { width: number; height: number },
  contentHeight: number,
  layout: LegendLayout = 'bottom'
): Box {
  const width = legendWidth(viewport.width, layout);
  const maxHeight = viewport.height - TOP_BAR_CLEARANCE - EDGE_MARGIN;
  const height = Math.min(contentHeight, Math.max(maxHeight, 0));

  const coveredBy = (card: Box): number =>
    targetRects.reduce((sum, rect) => sum + overlapArea(card, rect), 0);

  if (layout === 'side') {
    const right: Box = { top: TOP_BAR_CLEARANCE, left: viewport.width - width - EDGE_MARGIN, width, height };
    const leftSide: Box = { top: TOP_BAR_CLEARANCE, left: EDGE_MARGIN, width, height };
    return coveredBy(leftSide) < coveredBy(right) ? leftSide : right;
  }

  const left = (viewport.width - width) / 2;

  const bottomCenter: Box = { top: viewport.height - height - EDGE_MARGIN, left, width, height };
  const topCenter: Box = { top: TOP_BAR_CLEARANCE, left, width, height };

  return coveredBy(topCenter) < coveredBy(bottomCenter) ? topCenter : bottomCenter;
}
