/**
 * "Sync with BambooHR" for any page: runs an incremental sync, reports the outcome
 * (including jobs seen for the first time), and clears the message after a while.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api.service';
import type { Notice } from '../components/icons/StatusIcon';
import type { JobSummary } from '../types/applicant.types';

const NOTICE_DURATION_MS = 8000;

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
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    []
  );

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

  return { isSyncing, notice, sync };
}
