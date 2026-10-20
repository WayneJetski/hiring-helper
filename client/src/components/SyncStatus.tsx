/**
 * SyncStatus
 *
 * "Synced 19 min ago" for the page header, turning into a warning when the last
 * sync attempt failed or was rate limited by BambooHR. Re-checks whenever data
 * may have changed and keeps the relative time current.
 */

import { useEffect, useState } from 'react';
import { apiService } from '../services/api.service';
import type { LastSync } from '../types/applicant.types';
import { formatTimeAgo, parseServerTimestamp } from '../utils/relativeTime';
import { Icon } from './icons/Icon';
import './SyncStatus.css';

interface SyncStatusProps {
  /** Bumped whenever data may have changed (sync, scoring, bulk actions). */
  dataVersion: number;
}

const CLOCK_TICK_MS = 60_000;

function describe(lastSync: LastSync | null, now: Date): { text: string; isProblem: boolean } {
  if (!lastSync) return { text: 'Not synced yet', isProblem: true };
  const when = formatTimeAgo(parseServerTimestamp(lastSync.timestamp), now);
  if (lastSync.syncType === 'failed') return { text: `Last sync attempt failed (${when})`, isProblem: true };
  if (lastSync.syncType === 'rate_limited') {
    return { text: `BambooHR asked us to slow down (${when}); try again soon`, isProblem: true };
  }
  return { text: `Synced ${when}`, isProblem: false };
}

export function SyncStatus({ dataVersion }: SyncStatusProps): JSX.Element | null {
  const [lastSync, setLastSync] = useState<LastSync | null>(null);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isStale = false;
    apiService
      .getLastSync()
      .then((result) => {
        if (isStale) return;
        setLastSync(result);
        setHasLoaded(true);
        setNow(new Date());
      })
      .catch(() => {});
    return () => {
      isStale = true;
    };
  }, [dataVersion]);

  if (!hasLoaded) return null;
  const { text, isProblem } = describe(lastSync, now);

  return (
    <span className={`sync-status${isProblem ? ' is-problem' : ''}`}>
      <Icon name={isProblem ? 'alertTriangle' : 'checkCircle'} size={14} /> {text}
    </span>
  );
}
