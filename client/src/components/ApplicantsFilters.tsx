/**
 * ApplicantsFilters Component
 * Separated from ApplicantsList to prevent unnecessary re-renders
 */

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import type { JobSummary } from '../types/applicant.types';
import { apiService } from '../services/api.service';
import { groupStatuses } from '../utils/statusGroups';
import { JobConfig } from './JobConfig';
import { Modal } from './Modal';
import { ViewsMenu } from './ViewsMenu';
import type { ListView, ViewSortColumn } from '../utils/savedViews';
import { Icon } from './icons/Icon';
import './ApplicantsFilters.css';

interface Status {
  id: number;
  label: string;
}

interface ApplicantsFiltersProps {
  jobs: JobSummary[];
  selectedJobId: number | null; // null = all jobs
  onJobChange: (jobId: number | null) => void;
  selectedStatuses: number[];
  onSearchChange: (value: string) => void;
  onStatusesChange: (statusIds: number[]) => void;
  /** Replaces the text in the search box when `token` changes (clear filters, apply a view). */
  searchOverride: { value: string; token: number };
  /** Current list sort and search, so a view can capture them. */
  sortColumn: ViewSortColumn;
  sortDirection: 'asc' | 'desc';
  searchTerm: string;
  onApplyView: (view: ListView) => void;
  /** Increment to open the selected job's settings (used by the "set up this job" prompt). */
  openSettingsRequest: number;
  /** Called after Job settings saves or confirms something, so setup state can refresh. */
  onJobSettingsSaved: () => void;
}

function ApplicantsFiltersComponent({
  jobs,
  selectedJobId,
  onJobChange,
  selectedStatuses,
  onSearchChange,
  onStatusesChange,
  searchOverride,
  sortColumn,
  sortDirection,
  searchTerm,
  onApplyView,
  openSettingsRequest,
  onJobSettingsSaved,
}: ApplicantsFiltersProps): JSX.Element {
  const [searchInput, setSearchInput] = useState<string>('');
  const [availableStatuses, setAvailableStatuses] = useState<Status[]>([]);
  const [statusesLoading, setStatusesLoading] = useState(true);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Open the settings window when asked (by the "set up this job" prompt).
  const lastSettingsRequestRef = useRef(openSettingsRequest);
  useEffect(() => {
    if (openSettingsRequest !== lastSettingsRequestRef.current) {
      lastSettingsRequestRef.current = openSettingsRequest;
      setShowConfig(true);
    }
  }, [openSettingsRequest]);

  // Let the list replace the search text (Clear filters, applying a view).
  useEffect(() => {
    if (searchOverride.token > 0) setSearchInput(searchOverride.value);
  }, [searchOverride]);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Store the callback in a ref so it doesn't cause effect re-runs
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  // Keep the latest selection + change handler in refs so the reconcile effect
  // below can run once (on status load) without re-firing on every selection.
  const selectedStatusesRef = useRef(selectedStatuses);
  const onStatusesChangeRef = useRef(onStatusesChange);
  useEffect(() => {
    selectedStatusesRef.current = selectedStatuses;
    onStatusesChangeRef.current = onStatusesChange;
  }, [selectedStatuses, onStatusesChange]);

  // Fetch available statuses on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchStatuses() {
      try {
        const data = await apiService.getStatuses();
        if (cancelled) return;
        // Only surface active statuses in the filter; inactive ones are legacy.
        setAvailableStatuses(data.filter((status) => status.active));
      } catch (error) {
        console.error('Failed to load statuses:', error);
      } finally {
        if (!cancelled) setStatusesLoading(false);
      }
    }

    fetchStatuses();
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop any persisted/selected status IDs that are no longer valid once the
  // real status list is known, so a stale selection can't silently filter the
  // list to nothing. Runs only when the fetched status set changes.
  useEffect(() => {
    if (availableStatuses.length === 0) return;
    const validIds = new Set(availableStatuses.map((status) => status.id));
    const current = selectedStatusesRef.current;
    const reconciled = current.filter((id) => validIds.has(id));
    if (reconciled.length !== current.length) {
      onStatusesChangeRef.current(reconciled);
    }
  }, [availableStatuses]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showStatusDropdown) return;

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowStatusDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showStatusDropdown]);

  // Debounce search input - only depends on searchInput to avoid re-triggering
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchChangeRef.current(searchInput);
    }, 500); // Wait 500ms after user stops typing

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Partition the flat status list into labeled groups for display.
  const statusGroups = useMemo(
    () => groupStatuses(availableStatuses),
    [availableStatuses]
  );

  const selectedStatusSet = useMemo(
    () => new Set(selectedStatuses),
    [selectedStatuses]
  );

  const handleSearchInputChange = (value: string): void => {
    setSearchInput(value);
  };

  const handleStatusToggle = useCallback((statusId: number): void => {
    if (selectedStatuses.includes(statusId)) {
      onStatusesChange(selectedStatuses.filter(id => id !== statusId));
    } else {
      onStatusesChange([...selectedStatuses, statusId]);
    }
  }, [selectedStatuses, onStatusesChange]);

  const handleClearStatuses = useCallback((): void => {
    onStatusesChange([]);
  }, [onStatusesChange]);

  // Toggle every status in a group: if all are already selected, clear them;
  // otherwise select the group's remaining statuses.
  const handleGroupToggle = useCallback(
    (groupStatusIds: number[], allSelected: boolean): void => {
      if (allSelected) {
        const groupIdSet = new Set(groupStatusIds);
        onStatusesChange(selectedStatuses.filter((id) => !groupIdSet.has(id)));
      } else {
        const merged = new Set(selectedStatuses);
        groupStatusIds.forEach((id) => merged.add(id));
        onStatusesChange([...merged]);
      }
    },
    [selectedStatuses, onStatusesChange]
  );

  const selectedJob = jobs.find((job) => job.id === selectedJobId);

  const getSelectedStatusLabels = (): string => {
    if (selectedStatuses.length === 0) return 'All Statuses';
    if (selectedStatuses.length === 1) {
      const status = availableStatuses.find(s => s.id === selectedStatuses[0]);
      return status?.label || 'Unknown';
    }
    return `${selectedStatuses.length} selected`;
  };

  return (
    <div className="applicants-filters">
      <div className="filters-row">
        <select
          className="job-filter"
          data-help="job"
          value={selectedJobId === null ? 'all' : String(selectedJobId)}
          onChange={(e) => onJobChange(e.target.value === 'all' ? null : Number(e.target.value))}
          title="Scope the list to a job posting"
        >
          <option value="all">All jobs</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title} ({job.activeCount})
            </option>
          ))}
        </select>

        <button
          className="configure-job-button"
          data-help="job-settings"
          onClick={() => setShowConfig((open) => !open)}
          disabled={selectedJobId === null}
          title={
            selectedJobId === null
              ? 'Select a single job to edit its settings'
              : 'Edit this job’s posting text and the criteria used to score its applicants'
          }
        >
          <Icon name="settings" /> Job settings
          {selectedJob && !selectedJob.isReadyToScore && (
            <span className="setup-needed-pill">Setup needed</span>
          )}
        </button>

        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchInput}
          onChange={(e) => handleSearchInputChange(e.target.value)}
          className="search-input"
          data-help="search"
        />

        <div className="status-filter-container" ref={dropdownRef}>
          <button
            className="status-filter-button"
            onClick={() => setShowStatusDropdown(!showStatusDropdown)}
            disabled={statusesLoading}
          >
            {statusesLoading ? 'Loading...' : getSelectedStatusLabels()}
            <Icon name="chevronDown" className="dropdown-arrow" />
          </button>

          {showStatusDropdown && !statusesLoading && (
            <div className="status-dropdown">
              <div className="status-dropdown-header">
                <span>Filter by Status</span>
                {selectedStatuses.length > 0 && (
                  <button className="clear-button" onClick={handleClearStatuses}>
                    Clear
                  </button>
                )}
              </div>
              <div className="status-options">
                {statusGroups.map((group) => {
                  const groupStatusIds = group.statuses.map((status) => status.id);
                  const selectedCount = groupStatusIds.filter((id) =>
                    selectedStatusSet.has(id)
                  ).length;
                  const allSelected =
                    selectedCount === groupStatusIds.length && groupStatusIds.length > 0;

                  return (
                    <div key={group.name} className="status-group">
                      <div className="status-group-header">
                        <span className="status-group-title">
                          {group.name}
                          <span className="status-group-count">
                            {selectedCount}/{groupStatusIds.length}
                          </span>
                        </span>
                        <button
                          className="status-group-toggle"
                          onClick={() => handleGroupToggle(groupStatusIds, allSelected)}
                        >
                          {allSelected ? 'Clear' : 'Select all'}
                        </button>
                      </div>
                      {group.statuses.map((status) => (
                        <label key={status.id} className="status-option">
                          <input
                            type="checkbox"
                            checked={selectedStatusSet.has(status.id)}
                            onChange={() => handleStatusToggle(status.id)}
                          />
                          <span>{status.label}</span>
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <ViewsMenu
          statuses={availableStatuses}
          current={{ statusIds: selectedStatuses, search: searchTerm, sortColumn, sortDirection }}
          onApply={onApplyView}
        />
      </div>

      {showConfig && selectedJobId !== null && (
        <Modal
          title={`Job settings: ${jobs.find((job) => job.id === selectedJobId)?.title ?? ''}`}
          size="wide"
          onClose={() => setShowConfig(false)}
        >
          <JobConfig key={selectedJobId} jobId={selectedJobId} onSaved={onJobSettingsSaved} />
        </Modal>
      )}
    </div>
  );
}

// Custom comparison function for memo - only re-render if these specific props change
function arePropsEqual(
  prevProps: ApplicantsFiltersProps,
  nextProps: ApplicantsFiltersProps
): boolean {
  // Only re-render if selected statuses array actually changed (not just reference)
  const statusesEqual =
    prevProps.selectedStatuses.length === nextProps.selectedStatuses.length &&
    prevProps.selectedStatuses.every((id, index) => id === nextProps.selectedStatuses[index]);

  // Job selection or job list changes (titles feed the settings modal)
  const jobEqual =
    prevProps.selectedJobId === nextProps.selectedJobId && prevProps.jobs === nextProps.jobs;

  // Sort/search feed the "save view" action; the override token drives the search box
  const viewStateEqual =
    prevProps.sortColumn === nextProps.sortColumn &&
    prevProps.sortDirection === nextProps.sortDirection &&
    prevProps.searchTerm === nextProps.searchTerm &&
    prevProps.searchOverride.token === nextProps.searchOverride.token &&
    prevProps.openSettingsRequest === nextProps.openSettingsRequest;

  // Callbacks should be stable, so we don't need to compare them
  return statusesEqual && jobEqual && viewStateEqual;
}

export const ApplicantsFilters = memo(ApplicantsFiltersComponent, arePropsEqual);
