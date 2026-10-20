/**
 * Custom hook for fetching single applicant details
 */

import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api.service';
import type { ApplicantDetail } from '../types/applicant.types';

interface UseApplicantResult {
  applicant: ApplicantDetail | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useApplicant(id: number | null): UseApplicantResult {
  const [applicant, setApplicant] = useState<ApplicantDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApplicant = useCallback(async (): Promise<void> => {
    if (!id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await apiService.getApplicant(id);
      setApplicant(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch applicant';
      setError(errorMessage);
      console.error('Error fetching applicant:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchApplicant();
  }, [fetchApplicant]);

  return {
    applicant,
    loading,
    error,
    refetch: fetchApplicant,
  };
}

