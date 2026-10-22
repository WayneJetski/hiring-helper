/**
 * The list of jobs (with applicant counts and setup state), loaded once and
 * reloadable after anything that can change the counts: sync, scoring, bulk actions.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/api.service';
import type { JobSummary } from '../types/applicant.types';

interface UseJobsResult {
  jobs: JobSummary[];
  isLoading: boolean;
  /** Set when the first load failed; null otherwise. */
  loadError: string | null;
  /** Fetches the jobs again and returns them (the previous list on failure). */
  reloadJobs: () => Promise<JobSummary[]>;
}

export function useJobs(): UseJobsResult {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reloadJobs = useCallback(async (): Promise<JobSummary[]> => {
    try {
      const fetchedJobs = await apiService.getJobs();
      setJobs(fetchedJobs);
      setLoadError(null);
      return fetchedJobs;
    } catch (err) {
      console.error('Failed to load jobs:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load jobs');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadJobs();
  }, [reloadJobs]);

  return { jobs, isLoading, loadError, reloadJobs };
}
