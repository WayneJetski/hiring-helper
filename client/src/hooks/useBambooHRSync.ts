/**
 * "Sync with BambooHR" for any page: runs an incremental sync, reports the outcome
 * (including jobs seen for the first time), and clears the message after a while.
 *
 * A sync started elsewhere (the automatic first sync, another tab) also counts as
 * syncing, so the button stays disabled until it ends and the page then refreshes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api.service';
import type { Notice } from '../components/icons/StatusIcon';
import type { JobSummary } from '../types/applicant.types';

const NOTICE_DURATION_MS = 8000;
const RUNNING_POLL_INTERVAL_MS = 3000;

interface UseBambooHRSyncOptions {
  /** Jobs known before the sync, so jobs that appear afterwards can be announced. */
  jobs: JobSummary[];
  reloadJobs: () => Promise<JobSummary[]>;
  /** Called after a sync that ended normally (also when rate limited), to refresh the page. */
  onSynced?: () => Promise<void> | void;
}

interface UseBambooHRSyncResult {
  isSyncing: boolean;
  notice: Notice | null;
  sync: () => Promise<void>;
}

export function useBambooHRSync({
  jobs,
  reloadJobs,
  onSynced,
}: UseBambooHRSyncOptions): UseBambooHRSyncResult {
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSyncingElsewhere, setIsSyncingElsewhere] = useState<boolean>(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The latest callbacks, so the polling below does not restart when they change.
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  refreshRef.current = async (): Promise<void> => {
    await Promise.all([reloadJobs(), onSynced?.()]);
  };

  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    []
  );

  // Ask whether a sync is already running on load and when the window regains focus, then
  // poll while one is. Skipped while our own request is in flight, since that covers it.
  useEffect(() => {
    if (isSyncing) return;
    let isCancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let wasRunning = false;

    const check = async (): Promise<void> => {
      let isRunning = false;
      try {
        isRunning = await apiService.isSyncRunning();
      } catch {
        // A failed check leaves the button as it was; the next check tries again.
        return;
      }
      if (isCancelled) return;
      setIsSyncingElsewhere(isRunning);
      if (wasRunning && !isRunning) void refreshRef.current();
      wasRunning = isRunning;
      if (isRunning) {
        pollTimer = setTimeout(() => {
          pollTimer = null;
          void check();
        }, RUNNING_POLL_INTERVAL_MS);
      }
    };
    const handleFocus = (): void => {
      if (pollTimer === null) void check();
    };

    void check();
    window.addEventListener('focus', handleFocus);
    return () => {
      isCancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isSyncing]);

  const sync = useCallback(async (): Promise<void> => {
    try {
      setIsSyncing(true);
      setNotice(null);
      // Incremental: pulls new and changed applications. Only a full sync marks
      // anything inactive, so this cannot empty the list.
      const result = await apiService.triggerSync(false);
      setNotice({ tone: result.rateLimited ? 'warning' : 'success', text: result.message });

      // Refresh even when rate limited: the local data is still good.
      const knownJobIds = new Set(jobs.map((job) => job.id));
      const [refreshedJobs] = await Promise.all([reloadJobs(), onSynced?.()]);
      const newJobs = refreshedJobs.filter((job) => !knownJobIds.has(job.id));
      if (newJobs.length > 0) {
        const names = newJobs.map((job) => job.title).join(', ');
        setNotice({
          tone: 'success',
          text: `${result.message}. New job${newJobs.length !== 1 ? 's' : ''} found: ${names}.`,
        });
      }
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      setIsSyncing(false);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    }
  }, [jobs, reloadJobs, onSynced]);

  return { isSyncing: isSyncing || isSyncingElsewhere, notice, sync };
}
