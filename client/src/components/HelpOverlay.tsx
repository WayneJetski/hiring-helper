/**
 * HelpOverlay
 *
 * Dims the page and lists what each control does in one legend card. Hovering (or
 * focusing) a legend item scrolls its element into view and spotlights it with a ring;
 * with nothing hovered the page is just dimmed, so the overlay is not overwhelming.
 * Elements opt in with a `data-help="<id>"` attribute; ids that are not on the page
 * right now (for example "Send to BambooHR" when nothing is waiting) are left out.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import {
  estimateLegendHeight,
  legendColumnCount,
  legendRowCount,
  legendWidth,
  placeLegend,
  REVEAL_EDGE_MARGIN,
  REVEAL_TOP,
  scrollDeltaToReveal,
  type Box,
} from '../utils/helpOverlayLayout';
import { Icon } from './icons/Icon';
import './HelpOverlay.css';

export type HelpPageKey = 'list' | 'candidate';

interface HelpStep {
  id: string;
  title: string;
  text: string;
}

const HELP_STEPS: Record<HelpPageKey, HelpStep[]> = {
  list: [
    { id: 'sync', title: 'Sync with BambooHR', text: 'Bring in new applicants and changes.' },
    { id: 'job', title: 'Job picker', text: 'Choose the job to look at.' },
    { id: 'job-settings', title: 'Job settings', text: 'Edit the job posting and how applicants are scored.' },
    { id: 'search', title: 'Search', text: 'Find someone by name or email.' },
    { id: 'score', title: 'Score new applicants', text: 'Score everyone who has no score yet.' },
    { id: 'rescore', title: 'Re-score', text: 'Score again after changing the criteria.' },
    { id: 'bulk', title: 'Bulk actions', text: 'Move or reject many applicants at once.' },
    { id: 'push', title: 'Send to BambooHR', text: 'Send your stage changes to BambooHR.' },
    { id: 'match', title: 'Match', text: 'How well the résumé fits, 0 to 100. 75+ strong, 60 to 74 maybe.' },
    { id: 'flags', title: 'Flags', text: 'Worth a second look. Some jobs lower the score for them.' },
    { id: 'row', title: 'Applicant row', text: 'Click a row to open the applicant.' },
    { id: 'row-menu', title: 'Row menu', text: 'Score or rescore, move, reject, read the résumé, or copy a link.' },
  ],
  candidate: [
    { id: 'back', title: 'Breadcrumb', text: 'Back to the list, or to this job\'s applicants.' },
    { id: 'stepper', title: 'Previous / next', text: 'Step through the applicants in your list.' },
    { id: 'match', title: 'Match score', text: 'AI fit for this job. The assessment below says why.' },
    { id: 'stage', title: 'Move stage', text: 'Move this applicant to another stage.' },
    { id: 'score-applicant', title: 'Score applicant', text: 'Score this one applicant, or score them again.' },
    { id: 'resume', title: 'Résumé', text: 'Read the résumé.' },
    { id: 'bamboohr', title: 'Open in BambooHR', text: 'Open this person in BambooHR, in a new tab.' },
    { id: 'assessment', title: 'AI assessment', text: 'Score, summary, and what to check.' },
  ],
};

const SPOTLIGHT_PADDING = 4;

interface HelpOverlayProps {
  pageKey: HelpPageKey;
  onClose: () => void;
}

interface LegendItem extends HelpStep {
  number: number;
}

interface Measurement {
  viewport: { width: number; height: number };
  items: LegendItem[];
  legend: Box;
  legendColumns: number;
}

function findHelpElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-help="${id}"]`);
}

function toBox(rect: DOMRect): Box {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * Lists the steps whose element is on the page (even below the fold: hovering scrolls to
 * it) and places the legend where it hides the least of what is on screen right now. The
 * legend then stays put, so the item under the mouse never moves while the page scrolls.
 */
function measure(pageKey: HelpPageKey): Measurement {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const items: LegendItem[] = [];
  const visibleRects: Box[] = [];

  for (const step of HELP_STEPS[pageKey]) {
    const element = findHelpElement(step.id);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    items.push({ ...step, number: items.length + 1 });
    if (rect.bottom > 0 && rect.top < viewport.height) visibleRects.push(toBox(rect));
  }

  const legendColumns = legendColumnCount(viewport.width);
  const legendContentHeight = estimateLegendHeight(
    items.map((item) => item.text),
    legendColumns,
    legendWidth(viewport.width)
  );
  const legend = placeLegend(visibleRects, viewport, legendContentHeight);
  return { viewport, items, legend, legendColumns };
}

/**
 * The part of the screen the legend leaves free, in which a hovered element is revealed:
 * the card takes a band at the bottom (or the top), and the free area is the rest.
 */
function freeAreaAround(legend: Box, viewportHeight: number): { top: number; bottom: number } {
  const free = { top: REVEAL_TOP, bottom: viewportHeight - REVEAL_EDGE_MARGIN };
  if (legend.top > viewportHeight / 2) return { ...free, bottom: legend.top - REVEAL_EDGE_MARGIN };
  return { ...free, top: legend.top + legend.height + REVEAL_EDGE_MARGIN };
}

export function HelpOverlay({ pageKey, onClose }: HelpOverlayProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(dialogRef, onClose);

  const [measurement, setMeasurement] = useState<Measurement>(() => measure(pageKey));
  const remeasure = useCallback(() => setMeasurement(measure(pageKey)), [pageKey]);

  // Page scroll is locked for the user while open (see useDialogBehavior); only a resize
  // re-measures, and hovering scrolls the page itself.
  useLayoutEffect(remeasure, [remeasure]);
  useEffect(() => {
    window.addEventListener('resize', remeasure);
    return () => window.removeEventListener('resize', remeasure);
  }, [remeasure]);

  const { viewport, items, legend, legendColumns } = measurement;

  // The legend item under the mouse (or focused), and where its element is on screen.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeRect, setActiveRect] = useState<Box | null>(null);

  // Scroll the active element into view, then follow it while the smooth scroll runs.
  useEffect(() => {
    if (activeId === null) {
      setActiveRect(null);
      return;
    }
    const element = findHelpElement(activeId);
    if (!element) {
      setActiveRect(null);
      return;
    }

    const delta = scrollDeltaToReveal(
      element.getBoundingClientRect(),
      freeAreaAround(legend, viewport.height)
    );
    if (delta !== 0) window.scrollBy({ top: delta, behavior: 'smooth' });

    let frame = 0;
    const follow = (): void => {
      const next = toBox(element.getBoundingClientRect());
      setActiveRect((previous) => (sameBox(previous, next) ? previous : next));
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [activeId, legend, viewport.height]);

  return (
    <div
      ref={dialogRef}
      className="help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="What everything on this page does"
      onClick={onClose}
    >
      <svg className="help-overlay-dim" width={viewport.width} height={viewport.height} aria-hidden="true">
        <defs>
          <mask id="help-overlay-mask">
            <rect width={viewport.width} height={viewport.height} fill="white" />
            {activeRect && (
              <rect
                x={activeRect.left - SPOTLIGHT_PADDING}
                y={activeRect.top - SPOTLIGHT_PADDING}
                width={activeRect.width + SPOTLIGHT_PADDING * 2}
                height={activeRect.height + SPOTLIGHT_PADDING * 2}
                rx={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width={viewport.width}
          height={viewport.height}
          fill="rgba(20, 50, 38, 0.68)"
          mask="url(#help-overlay-mask)"
        />
      </svg>

      {activeRect && (
        <span
          className="help-overlay-ring"
          style={{
            top: activeRect.top - SPOTLIGHT_PADDING,
            left: activeRect.left - SPOTLIGHT_PADDING,
            width: activeRect.width + SPOTLIGHT_PADDING * 2,
            height: activeRect.height + SPOTLIGHT_PADDING * 2,
          }}
        />
      )}

      <div
        className="help-overlay-legend"
        style={{ top: legend.top, left: legend.left, width: legend.width, maxHeight: legend.height }}
        onClick={(event) => event.stopPropagation()}
      >
        <ol
          className="help-overlay-legend-list"
          style={{
            gridTemplateColumns: `repeat(${legendColumns}, minmax(0, 1fr))`,
            // Fill down each column before starting the next (1-4, 5-8, 9-11).
            gridTemplateRows: `repeat(${legendRowCount(items.length, legendColumns)}, auto)`,
          }}
          onMouseLeave={() => setActiveId(null)}
        >
          {items.map((item) => (
            <li
              key={item.id}
              className={item.id === activeId ? 'is-active' : undefined}
              tabIndex={0}
              onMouseEnter={() => setActiveId(item.id)}
              onFocus={() => setActiveId(item.id)}
              onBlur={() => setActiveId(null)}
            >
              <span className="help-overlay-number inline">{item.number}</span>
              <span>
                <strong>{item.title}</strong>
                <span className="help-overlay-legend-text">{item.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <button type="button" className="help-overlay-close" onClick={onClose} autoFocus>
          <Icon name="close" /> Close help
        </button>
      </div>
    </div>
  );
}
