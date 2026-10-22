/**
 * ScoringControls
 *
 * The scoring buttons for the selected job ("Score new applicants" and
 * "Re-score these applicants") with everything that goes with a run: the
 * re-score confirmation, live progress with Cancel, and the finished message.
 * Scoring is done by headless Claude Code on the server; this polls its status.
 *
 * Renders into the page's action bar: buttons inline, panels full width.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '../services/api.service';
import type { ScoringStatus } from '../types/applicant.types';
import { ScoringProgress } from './ScoringProgress';
import { CLOSED_JOB_SCORING_REASON, describeBatchOutcome } from '../utils/scoreApplicantOutcome';
import { Icon } from './icons/Icon';
import { StatusIcon } from './icons/StatusIcon';
import type { FlagFilter, ScoreFilter } from '../utils/savedViews';
import './ScoringControls.css';

const POLL_INTERVAL_MS = 3000;
/** How long a success message stays before it clears itself. */
const SUCCESS_NOTICE_MS = 8000;

interface ScoringControlsProps {
  /** Null when "All jobs" is selected; scoring is job-scoped. */
  jobId: number | null;
  /** The list's current status filter and search, used to scope a re-score. */
  statusIds: number[];
  searchTerm: string;
  scoreFilter: ScoreFilter;
  flagFilter: FlagFilter;
  /** Applicants in this view with no score yet, shown on the button. */
  unscoredCount: number;
  /** Called when a run finishes so the list can refresh. */
  onScoringComplete: () => void | Promise<void>;
  /** Setup state of the selected job; scoring is blocked until it is ready. */
  readiness: { hasPosting: boolean; isCriteriaConfirmed: boolean; isReadyToScore: boolean } | null;
  onOpenJobSettings: () => void;
  /** A closed job cannot be scored; both buttons are disabled and say why. */
  isJobClosed: boolean;
}

export function ScoringControls({
  jobId,
  statusIds,
  searchTerm,
  scoreFilter,
  flagFilter,
  unscoredCount,
  onScoringComplete,
  readiness,
  onOpenJobSettings,
  isJobClosed,
}: ScoringControlsProps): JSX.Element {
  const [isScoring, setIsScoring] = useState<boolean>(false);
  const [scoreStatus, setScoreStatus] = useState<ScoringStatus | null>(null);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [rescorePreviewCount, setRescorePreviewCount] = useState<number | null>(null);
  const [isRescoreBusy, setIsRescoreBusy] = useState<boolean>(false);
  // The finishedAt of the run whose message the person closed (or that timed out).
  const [dismissedFinishedAt, setDismissedFinishedAt] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onScoringCompleteRef = useRef(onScoringComplete);
  useEffect(() => {
    onScoringCompleteRef.current = onScoringComplete;
  }, [onScoringComplete]);

  const stopPolling = useCallback((): void => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await apiService.getScoringStatus();
      setScoreStatus(status);
      if (!status.running) {
        stopPolling();
        setIsScoring(false);
        void onScoringCompleteRef.current();
      }
    } catch {
      // Transient poll error: keep polling.
    }
  }, [stopPolling]);

  const startPolling = useCallback((): void => {
    stopPolling();
    pollTimerRef.current = setInterval(() => void pollStatus(), POLL_INTERVAL_MS);
  }, [pollStatus, stopPolling]);

  // Reflect a run already in progress (for example after a page reload) and
  // clean up the timer on unmount.
  useEffect(() => {
    let isCancelled = false;
    apiService
      .getScoringStatus()
      .then((status) => {
        if (isCancelled) return;
        setScoreStatus(status);
        if (status.running) {
          setIsScoring(true);
          startPolling();
        }
      })
      .catch(() => {});
    return () => {
      isCancelled = true;
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const failedStatus = (message: string): ScoringStatus => ({
    running: false,
    jobId,
    startedAt: null,
    finishedAt: new Date().toISOString(),
    scored: 0,
    total: null,
    cancelled: false,
    ok: false,
    error: message,
    message: null,
  });

  const handleScore = useCallback(async (): Promise<void> => {
    if (jobId === null) return;
    try {
      setIsScoring(true);
      const result = await apiService.startScoring(jobId);
      setScoreStatus(result.status);
      startPolling();
    } catch (err) {
      setIsScoring(false);
      setScoreStatus(failedStatus(err instanceof Error ? err.message : 'Failed to start scoring'));
    }
    // failedStatus only reads jobId, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, startPolling]);

  const handleCancel = useCallback(async (): Promise<void> => {
    try {
      setIsCancelling(true);
      await apiService.cancelScoring();
      await pollStatus();
    } catch {
      // The next poll will show the real state.
    } finally {
      setIsCancelling(false);
    }
  }, [pollStatus]);

  const rescoreFilter = useCallback(() => {
    if (jobId === null) return null;
    const search = searchTerm.trim();
    return {
      jobId,
      statusIds: statusIds.length > 0 ? statusIds : undefined,
      search: search !== '' ? search : undefined,
      active: true,
      scored: scoreFilter === 'all' ? undefined : scoreFilter,
      flagged: flagFilter === 'all' ? undefined : flagFilter,
    };
  }, [jobId, statusIds, searchTerm, scoreFilter, flagFilter]);

  const handleRescorePreview = useCallback(async (): Promise<void> => {
    const filter = rescoreFilter();
    if (!filter) return;
    try {
      setIsRescoreBusy(true);
      const { count } = await apiService.rescorePreview(filter);
      setRescorePreviewCount(count);
    } catch {
      setRescorePreviewCount(null);
    } finally {
      setIsRescoreBusy(false);
    }
  }, [rescoreFilter]);

  const handleRescoreConfirm = useCallback(async (): Promise<void> => {
    const filter = rescoreFilter();
    if (!filter) return;
    try {
      setIsRescoreBusy(true);
      const result = await apiService.rescore(filter);
      setRescorePreviewCount(null);
      setScoreStatus(result.status);
      setIsScoring(true);
      startPolling();
    } catch {
      // Leave the confirmation open on failure.
    } finally {
      setIsRescoreBusy(false);
    }
  }, [rescoreFilter, startPolling]);

  // A job that has not been set up cannot be scored (the server enforces this too).
  const isSetupIncomplete = jobId !== null && readiness !== null && !readiness.isReadyToScore;
  const isBlocked = isJobClosed || isSetupIncomplete;

  const finishedNotice = scoreStatus ? describeBatchOutcome(scoreStatus) : null;
  const finishedAt = scoreStatus?.finishedAt ?? null;
  const isFinishedNoticeVisible =
    !isScoring && finishedAt !== null && finishedNotice !== null && finishedAt !== dismissedFinishedAt;
  const shouldAutoDismiss = isFinishedNoticeVisible && finishedNotice?.tone === 'success';

  // Warnings and errors stay until closed, since they ask the person to act.
  useEffect(() => {
    if (!shouldAutoDismiss || finishedAt === null) return;
    const timer = setTimeout(() => setDismissedFinishedAt(finishedAt), SUCCESS_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shouldAutoDismiss, finishedAt]);

  return (
    <>
      <button
        className="score-button"
        data-help="score"
        onClick={() => void handleScore()}
        disabled={isScoring || jobId === null || isBlocked}
        title={
          jobId === null
            ? 'Select a job to score its new applicants'
            : isJobClosed
              ? CLOSED_JOB_SCORING_REASON
              : isBlocked
              ? 'Set up this job in Job settings before scoring'
              : 'Score every applicant in this job who has no score yet'
        }
      >
        {isScoring ? (
          <>
            <Icon name="loader" isSpinning /> Scoring…
          </>
        ) : (
          <>
            <Icon name="target" /> Score new applicants
            {jobId !== null && unscoredCount > 0 && (
              <span className="action-count">{unscoredCount}</span>
            )}
          </>
        )}
      </button>

      <button
        className="rescore-button"
        data-help="rescore"
        onClick={() => void handleRescorePreview()}
        disabled={isScoring || isRescoreBusy || jobId === null || isBlocked || rescorePreviewCount !== null}
        title={
          jobId === null
            ? 'Select a job to re-score applicants'
            : isJobClosed
              ? CLOSED_JOB_SCORING_REASON
              : isBlocked
              ? 'Set up this job in Job settings before scoring'
              : 'Score again everyone currently shown by your filters, replacing their old scores'
        }
      >
        <Icon name="repeat" /> Re-score these applicants
      </button>

      {isJobClosed && (
        <div className="action-panel scoring-setup-needed" role="status">
          <div>
            <strong>{CLOSED_JOB_SCORING_REASON}</strong> Existing scores and summaries stay as they are.
          </div>
        </div>
      )}

      {isSetupIncomplete && !isJobClosed && readiness && (
        <div className="action-panel scoring-setup-needed" role="status">
          <div>
            <strong>Set up this job before scoring.</strong>
            <ul>
              <li className={readiness.hasPosting ? 'is-done' : 'is-todo'}>
                <Icon name={readiness.hasPosting ? 'checkCircle' : 'alertTriangle'} />
                {readiness.hasPosting ? 'Job posting is loaded' : 'Job posting is missing'}
              </li>
              <li className={readiness.isCriteriaConfirmed ? 'is-done' : 'is-todo'}>
                <Icon name={readiness.isCriteriaConfirmed ? 'checkCircle' : 'alertTriangle'} />
                {readiness.isCriteriaConfirmed ? 'Scoring criteria are confirmed' : 'Scoring criteria are not confirmed yet'}
              </li>
            </ul>
          </div>
          <button type="button" className="scoring-setup-button" onClick={onOpenJobSettings}>
            Open Job settings
          </button>
        </div>
      )}

      {rescorePreviewCount !== null && (
        <div className="action-panel rescore-confirm">
          {rescorePreviewCount === 0 ? (
            <>
              <span>No applicants match the current filters.</span>
              <button className="rescore-cancel" onClick={() => setRescorePreviewCount(null)}>
                Close
              </button>
            </>
          ) : (
            <>
              <span>
                Re-score <strong>{rescorePreviewCount}</strong> applicant
                {rescorePreviewCount !== 1 ? 's' : ''} currently shown? This replaces their
                existing scores using the job’s current scoring criteria, and uses your scoring
                allowance.
              </span>
              <div className="rescore-confirm-controls">
                <button
                  className="rescore-confirm-button"
                  onClick={() => void handleRescoreConfirm()}
                  disabled={isRescoreBusy}
                >
                  {isRescoreBusy ? 'Starting…' : `Re-score ${rescorePreviewCount}`}
                </button>
                <button
                  className="rescore-cancel"
                  onClick={() => setRescorePreviewCount(null)}
                  disabled={isRescoreBusy}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {isScoring && (
        <div className="action-panel">
          <ScoringProgress
            status={scoreStatus}
            isCancelling={isCancelling}
            onCancel={() => void handleCancel()}
          />
        </div>
      )}

      {isFinishedNoticeVisible && finishedNotice && (
        <div className={`action-panel sync-message ${finishedNotice.tone}`}>
          <StatusIcon tone={finishedNotice.tone} />
          <span>{finishedNotice.text}</span>
          <button
            type="button"
            className="scoring-notice-dismiss"
            onClick={() => setDismissedFinishedAt(finishedAt)}
            aria-label="Dismiss"
          >
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}
