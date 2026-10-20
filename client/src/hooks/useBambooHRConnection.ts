/**
 * Whether the saved BambooHR credentials currently work, kept fresh for the top
 * bar. The server caches its answer for a minute, so checking this often is safe.
 */

import { useEffect, useState } from 'react';
import { apiService } from '../services/api.service';
import {
  CHECKING_STATUS,
  NO_INTERNET_STATUS,
  statusFromConnection,
  statusFromError,
  type ConnectionStatus,
} from '../utils/connectionStatus';

const RECHECK_INTERVAL_MS = 60_000;

export function useBambooHRConnection(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(CHECKING_STATUS);

  useEffect(() => {
    let isCancelled = false;

    // The previous answer stays on screen while a re-check runs, so the badge never flickers.
    const check = async (): Promise<void> => {
      try {
        const connection = await apiService.getBambooHRConnection();
        if (!isCancelled) setStatus(statusFromConnection(connection));
      } catch (error) {
        if (!isCancelled) setStatus(statusFromError(error));
      }
    };
    const handleOffline = (): void => setStatus(NO_INTERNET_STATUS);
    const handleRecheck = (): void => void check();

    void check();
    const timer = setInterval(handleRecheck, RECHECK_INTERVAL_MS);
    window.addEventListener('focus', handleRecheck);
    window.addEventListener('online', handleRecheck);
    window.addEventListener('offline', handleOffline);

    return () => {
      isCancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', handleRecheck);
      window.removeEventListener('online', handleRecheck);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return status;
}
