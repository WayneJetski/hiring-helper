/**
 * ScoringProgress
 *
 * Live progress for a scoring run: "Scoring 7 of 23", a bar, elapsed time, an
 * estimate of time left, and a Cancel button. Re-renders once a second so the
 * estimate stays current between the 3-second status polls.
 */

import { useEffect, useState } from 'react';
import type { ScoringStatus } from '../types/applicant.types';
import { computeScoringProgress } from '../utils/scoringProgress';
import { formatDuration } from '../utils/relativeTime';
import { Icon } from './icons/Icon';
import './ScoringProgress.css';

interface ScoringProgressProps {
  status: ScoringStatus | null;
  isCancelling: boolean;
  onCancel: () => void;
}

export function ScoringProgress({
  status,
  isCancelling,
  onCancel,
}: ScoringProgressProps): JSX.Element {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const scored = status?.scored ?? 0;
  const total = status?.total ?? null;
  const { percent, secondsRemaining } = computeScoringProgress(
    scored,
    total,
    status?.startedAt ?? null,
    now
  );

  const heading =
    total !== null ? `Scoring ${Math.min(scored, total)} of ${total}` : `Scoring… ${scored} done`;

  return (
    <div className="scoring-progress" role="status" aria-live="polite">
      <div className="scoring-progress-top">
        <span className="scoring-progress-heading">
          <Icon name="loader" isSpinning /> {heading}
        </span>
        <span className="scoring-progress-estimate">
          {secondsRemaining !== null
            ? `${formatDuration(secondsRemaining)} left`
            : 'Working out how long this will take…'}
        </span>
        <button
          type="button"
          className="scoring-progress-cancel"
          onClick={onCancel}
          disabled={isCancelling}
        >
          {isCancelling ? 'Stopping…' : 'Cancel'}
        </button>
      </div>
      <div
        className="scoring-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-label="Scoring progress"
      >
        <div
          className={`scoring-progress-fill${percent === null ? ' indeterminate' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="scoring-progress-note">
        You can keep browsing while this runs. Scores already saved are kept if you cancel.
      </p>
    </div>
  );
}
