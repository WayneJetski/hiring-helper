/**
 * Score or re-score one applicant, and follow the run until it ends.
 *
 * Scoring runs on the server (headless Claude Code), one run at a time, so this
 * starts the run and polls its status. It is shared by the list's row menu and
 * the applicant page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api.service';
import type { Notice } from '../components/icons/StatusIcon';
import { describeSingleScoreOutcome } from '../utils/scoreApplicantOutcome';

const POLL_INTERVAL_MS = 3000;

interface UseScoreApplicantResult {
  /** The application being scored right now, or null. */
  scoringApplicationId: number | null;
  notice: Notice | null;
  dismissNotice: () => void;
  scoreApplicant: (applicationId: number, applicantName: string) => Promise<void>;
}

export function useScoreApplicant(
  onFinished: () => void | Promise<void>
): UseScoreApplicantResult {
  const [scoringApplicationId, setScoringApplicationId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  const stopPolling = useCallback((): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const scoreApplicant = useCallback(
    async (applicationId: number, applicantName: string): Promise<void> => {
      setNotice(null);
      try {
        const result = await apiService.scoreApplicant(applicationId);
        if (!result.started) {
          setNotice({
            tone: 'warning',
            text: result.alreadyRunning
              ? 'A scoring run is already in progress. Try again when it finishes.'
              : (result.status.error ?? `Could not start scoring ${applicantName}.`),
          });
          return;
        }
        setScoringApplicationId(applicationId);
        setNotice({ tone: 'info', text: `Scoring ${applicantName}. This can take a minute.` });

        stopPolling();
        timerRef.current = setInterval(() => {
          void (async () => {
            try {
              const status = await apiService.getScoringStatus();
              if (status.running) return;
              stopPolling();
              setScoringApplicationId(null);
              setNotice(describeSingleScoreOutcome(status, applicantName));
              await onFinishedRef.current();
            } catch {
              // Transient poll error: keep polling.
            }
          })();
        }, POLL_INTERVAL_MS);
      } catch (error) {
        setNotice({
          tone: 'error',
          text: error instanceof Error ? error.message : `Could not start scoring ${applicantName}.`,
        });
      }
    },
    [stopPolling]
  );

  return {
    scoringApplicationId,
    notice,
    dismissNotice: () => setNotice(null),
    scoreApplicant,
  };
}
