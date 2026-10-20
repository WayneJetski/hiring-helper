/**
 * HelpOverlay
 *
 * Dims the page, rings the main buttons and columns with numbered badges, and
 * explains each number in one legend card (so nothing covers the controls it
 * describes). Elements opt in with a `data-help="<id>"` attribute; ids that are
 * not on screen right now (for example "Send to BambooHR" when nothing is
 * waiting) are left out of both the page and the legend.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import {
  estimateLegendHeight,
  legendColumnCount,
  legendWidth,
  placeLegend,
  type Box,
  type LegendLayout,
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
    { id: 'row-menu', title: 'Row menu', text: 'Move, reject, read the résumé, or copy a link.' },
  ],
  candidate: [
    { id: 'back', title: 'Breadcrumb', text: 'Back to the list, or to this job\'s applicants.' },
    { id: 'stepper', title: 'Previous / next', text: 'Step through the applicants in your list.' },
    { id: 'match', title: 'Match score', text: 'AI fit for this job. The assessment below says why.' },
    { id: 'stage', title: 'Move stage', text: 'Move this applicant to another stage.' },
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

interface Highlight extends HelpStep {
  number: number;
  rect: Box;
}

interface Measurement {
  viewport: { width: number; height: number };
  highlights: Highlight[];
  legend: Box;
  legendColumns: number;
}

/** The applicant page has few items, so they read best as one column down the right side. */
const LEGEND_LAYOUT: Record<HelpPageKey, LegendLayout> = { list: 'bottom', candidate: 'side' };

function measure(pageKey: HelpPageKey): Measurement {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const highlights: Highlight[] = [];

  for (const step of HELP_STEPS[pageKey]) {
    const element = document.querySelector<HTMLElement>(`[data-help="${step.id}"]`);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    const isVisible =
      rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewport.height;
    if (!isVisible) continue;
    highlights.push({
      ...step,
      number: highlights.length + 1,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    });
  }

  const layout = LEGEND_LAYOUT[pageKey];
  const legendColumns = legendColumnCount(viewport.width, layout);
  const legendContentHeight = estimateLegendHeight(
    highlights.map((highlight) => highlight.text),
    legendColumns,
    legendWidth(viewport.width, layout)
  );
  const legend = placeLegend(
    highlights.map((highlight) => highlight.rect),
    viewport,
    legendContentHeight,
    layout
  );
  return { viewport, highlights, legend, legendColumns };
}

export function HelpOverlay({ pageKey, onClose }: HelpOverlayProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(dialogRef, onClose);

  const [measurement, setMeasurement] = useState<Measurement>(() => measure(pageKey));
  const remeasure = useCallback(() => setMeasurement(measure(pageKey)), [pageKey]);

  // Page scroll is locked while open (see useDialogBehavior); only a resize moves things.
  useLayoutEffect(remeasure, [remeasure]);
  useEffect(() => {
    window.addEventListener('resize', remeasure);
    return () => window.removeEventListener('resize', remeasure);
  }, [remeasure]);

  const { viewport, highlights, legend, legendColumns } = measurement;

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
            {highlights.map((highlight) => (
              <rect
                key={highlight.id}
                x={highlight.rect.left - SPOTLIGHT_PADDING}
                y={highlight.rect.top - SPOTLIGHT_PADDING}
                width={highlight.rect.width + SPOTLIGHT_PADDING * 2}
                height={highlight.rect.height + SPOTLIGHT_PADDING * 2}
                rx={8}
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect
          width={viewport.width}
          height={viewport.height}
          fill="rgba(20, 50, 38, 0.68)"
          mask="url(#help-overlay-mask)"
        />
      </svg>

      {highlights.map((highlight) => (
        <span
          key={highlight.id}
          className="help-overlay-ring"
          style={{
            top: highlight.rect.top - SPOTLIGHT_PADDING,
            left: highlight.rect.left - SPOTLIGHT_PADDING,
            width: highlight.rect.width + SPOTLIGHT_PADDING * 2,
            height: highlight.rect.height + SPOTLIGHT_PADDING * 2,
          }}
        >
          <span className="help-overlay-number">{highlight.number}</span>
        </span>
      ))}

      <div
        className="help-overlay-legend"
        style={{ top: legend.top, left: legend.left, width: legend.width, maxHeight: legend.height }}
        onClick={(event) => event.stopPropagation()}
      >
        <ol
          className="help-overlay-legend-list"
          style={{ gridTemplateColumns: `repeat(${legendColumns}, minmax(0, 1fr))` }}
        >
          {highlights.map((highlight) => (
            <li key={highlight.id}>
              <span className="help-overlay-number inline">{highlight.number}</span>
              <span>
                <strong>{highlight.title}</strong>
                <span className="help-overlay-legend-text">{highlight.text}</span>
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
