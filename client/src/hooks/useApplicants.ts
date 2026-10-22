/**
 * Custom hook for fetching applicants list
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiService } from '../services/api.service';
import type { ApplicantListItem, PaginationInfo } from '../types/applicant.types';

interface UseApplicantsResult {
  applicants: ApplicantListItem[];
  loading: boolean;
  isRefreshing: boolean;
  error: string | null;
  pagination?: PaginationInfo;
  totalCount?: number;
  refetch: () => Promise<void>;
}

interface UseApplicantsParams {
  statusIds?: string; // Comma-separated list of status IDs
  jobId?: string;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  scored?: 'scored' | 'unscored';
  flagged?: 'flagged' | 'unflagged';
  enabled?: boolean; // When false, defer fetching (e.g. until the default job is resolved)
}

export function useApplicants(params?: UseApplicantsParams): UseApplicantsResult {
  const [applicants, setApplicants] = useState<ApplicantListItem[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | undefined>();
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
  
  // Store params in a ref so fetchApplicants doesn't need to be recreated
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const fetchApplicants = useCallback(async (): Promise<void> => {
    // Defer until the caller signals it is ready (e.g. the default job resolved)
    if (paramsRef.current?.enabled === false) {
      return;
    }
    try {
      // Use loading for initial load, isRefreshing for subsequent loads
      if (isInitialLoad) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      setError(null);
      // Forward only real API parameters (`enabled` is a local control flag)
      const current = paramsRef.current;
      const apiParams = current && {
        statusIds: current.statusIds,
        jobId: current.jobId,
        search: current.search,
        page: current.page,
        limit: current.limit,
        sortBy: current.sortBy,
        sortDirection: current.sortDirection,
        scored: current.scored,
        flagged: current.flagged,
      };
      const { applicants: data, pagination: paginationData, totalCount: total } = await apiService.getApplicants(apiParams || undefined);
      setApplicants(data);
      setPagination(paginationData);
      setTotalCount(total);
      setIsInitialLoad(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch applicants';
      setError(errorMessage);
      console.error('Error fetching applicants:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [isInitialLoad]); // Include isInitialLoad in deps

  useEffect(() => {
    fetchApplicants();
  }, [params?.statusIds, params?.jobId, params?.search, params?.page, params?.limit, params?.sortBy, params?.sortDirection, params?.scored, params?.flagged, params?.enabled, fetchApplicants]);

  return {
    applicants,
    loading,
    isRefreshing,
    error,
    pagination,
    totalCount,
    refetch: fetchApplicants,
  };
}

