/**
 * UpdateBanner
 *
 * Under the top bar: says when a newer version of Hiring Helper exists and lets the
 * person update with one click (after a confirmation). Nothing updates on its own.
 * Shown only for an install made by the installer, which can update itself.
 */

import { useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api.service';
import type { UpdateStatus } from '../types/applicant.types';
import { interpretUpdatePoll } from '../utils/updateProgress';
import { Icon } from './icons/Icon';
import './UpdateBanner.css';

type Phase = 'idle' | 'confirming' | 'applying' | 'failed';

const RECHECK_INTERVAL_MS = 60 * 60_000;
const POLL_INTERVAL_MS = 2000;

interface FlowMemory {
  startCommit: string | null;
  sawServerDown: boolean;
  restartingSince: number | null;
}

export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progressText, setProgressText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isStuck, setIsStuck] = useState<boolean>(false);
  const flow = useRef<FlowMemory>({ startCommit: null, sawServerDown: false, restartingSince: null });

  // Look for an update when the page opens, then hourly. A failed check just shows nothing.
  useEffect(() => {
    let isCancelled = false;
    const load = (): void => {
      apiService
        .getUpdateStatus()
        .then((next) => {
          if (!isCancelled) setStatus(next);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, RECHECK_INTERVAL_MS);
    return () => {
      isCancelled = true;
      clearInterval(timer);
    };
  }, []);

  // While updating, watch progress. The server goes away and comes back; that is expected.
  useEffect(() => {
    if (phase !== 'applying') return undefined;
    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async (): Promise<void> => {
      let next: UpdateStatus | null = null;
      try {
        next = await apiService.getUpdateStatus();
      } catch {
        flow.current.sawServerDown = true;
      }
      if (isCancelled) return;

      if ((next === null || next.apply.state === 'restarting') && flow.current.restartingSince === null) {
        flow.current.restartingSince = Date.now();
      }
      const waitingForRestartMs =
        flow.current.restartingSince === null ? 0 : Date.now() - flow.current.restartingSince;

      const outcome = interpretUpdatePoll({
        status: next,
        startCommit: flow.current.startCommit,
        sawServerDown: flow.current.sawServerDown,
        waitingForRestartMs,
      });

      if (outcome.kind === 'reload') {
        window.location.reload();
        return;
      }
      if (outcome.kind === 'failed') {
        setErrorMessage(outcome.message);
        setPhase('failed');
        return;
      }
      if (outcome.kind === 'stuck') {
        setIsStuck(true);
        return;
      }
      setProgressText(outcome.text);
      timer = setTimeout(() => void check(), POLL_INTERVAL_MS);
    };

    void check();
    return () => {
      isCancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase]);

  const startUpdate = async (): Promise<void> => {
    flow.current = { startCommit: status?.currentCommit ?? null, sawServerDown: false, restartingSince: null };
    setIsStuck(false);
    setProgressText('Starting the update…');
    setPhase('applying');
    try {
      await apiService.applyUpdate();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The update could not be started.');
      setPhase('failed');
    }
  };

  const hasUpdate = status?.isManagedInstall === true && status.update.available;
  if (!hasUpdate && phase === 'idle') return null;

  return (
    <div className={`update-banner${phase === 'failed' || isStuck ? ' is-problem' : ''}`} role="status">
      <div className="update-banner-inner">
        {phase === 'idle' && (
          <>
            <span className="update-banner-text">
              <Icon name="upload" /> A new version of Hiring Helper is available.
            </span>
            {status?.update.compareUrl && (
              <a href={status.update.compareUrl} target="_blank" rel="noopener noreferrer" className="update-banner-link">
                See what&apos;s new
              </a>
            )}
            <button type="button" className="update-banner-button" onClick={() => setPhase('confirming')}>
              Update now
            </button>
          </>
        )}

        {phase === 'confirming' && (
          <>
            <span className="update-banner-text">
              Update now? Hiring Helper will download the new version and restart, which takes about a minute. Your
              applicants and scores are not affected.
            </span>
            <button type="button" className="update-banner-button" onClick={() => void startUpdate()}>
              Update and restart
            </button>
            <button type="button" className="update-banner-secondary" onClick={() => setPhase('idle')}>
              Cancel
            </button>
          </>
        )}

        {phase === 'applying' && !isStuck && (
          <span className="update-banner-text">
            <Icon name="loader" isSpinning /> {progressText} This page reloads by itself when it is done.
          </span>
        )}

        {phase === 'applying' && isStuck && (
          <>
            <span className="update-banner-text">
              <Icon name="alertTriangle" /> Restarting is taking longer than expected. Reload the page; if it does not
              come back, run <code>hiring-helper restart</code> in a terminal.
            </span>
            <button type="button" className="update-banner-button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </>
        )}

        {phase === 'failed' && (
          <>
            <span className="update-banner-text">
              <Icon name="alertTriangle" /> {errorMessage}
            </span>
            <button type="button" className="update-banner-button" onClick={() => setPhase('confirming')}>
              Try again
            </button>
            <button type="button" className="update-banner-secondary" onClick={() => setPhase('idle')}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
