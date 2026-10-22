/**
 * ApplicantsFilters Component
 * Separated from ApplicantsList to prevent unnecessary re-renders
 */

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { apiService } from '../services/api.service';
import { groupStatuses } from '../utils/statusGroups';
import { ViewsMenu } from './ViewsMenu';
import type { FlagFilter, ListView, ScoreFilter, ViewSortColumn } from '../utils/savedViews';
import { Icon } from './icons/Icon';
import './ApplicantsFilters.css';

interface Status {
  id: number;
  label: string;
}

interface ApplicantsFiltersProps {
  selectedStatuses: number[];
  scoreFilter: ScoreFilter;
  flagFilter: FlagFilter;
  onScoreFilterChange: (value: ScoreFilter) => void;
  onFlagFilterChange: (value: FlagFilter) => void;
  /** Resets status, scored and flag filters and the search text. */
  onClearFilters: () => void;
  onSearchChange: (value: string) => void;
  onStatusesChange: (statusIds: number[]) => void;
  /** Replaces the text in the search box when `token` changes (clear filters, apply a view). */
  searchOverride: { value: string; token: number };
  /** Current list sort and search, so a view can capture them. */
  sortColumn: ViewSortColumn;
  sortDirection: 'asc' | 'desc';
  searchTerm: string;
  onApplyView: (view: ListView) => void;
}

function ApplicantsFiltersComponent({
  selectedStatuses,
  scoreFilter,
  flagFilter,
  onScoreFilterChange,
  onFlagFilterChange,
  onClearFilters,
  onSearchChange,
  onStatusesChange,
  searchOverride,
  sortColumn,
  sortDirection,
  searchTerm,
  onApplyView,
}: ApplicantsFiltersProps): JSX.Element {
  const [searchInput, setSearchInput] = useState<string>('');
  const [availableStatuses, setAvailableStatuses] = useState<Status[]>([]);
  const [statusesLoading, setStatusesLoading] = useState(true);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

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

  const activeFilterCount =
    (selectedStatuses.length > 0 ? 1 : 0) + (scoreFilter !== 'all' ? 1 : 0) + (flagFilter !== 'all' ? 1 : 0);

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
        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchInput}
          onChange={(e) => handleSearchInputChange(e.target.value)}
          className="search-input"
          data-help="search"
        />

        <button
          type="button"
          className={`filters-toggle-button${activeFilterCount > 0 ? ' has-active' : ''}`}
          data-help="filters"
          onClick={() => setIsFilterPanelOpen((open) => !open)}
          aria-expanded={isFilterPanelOpen}
          aria-controls="filters-panel"
          title={isFilterPanelOpen ? 'Hide filters' : 'Show filters for stage, scored and flags'}
        >
          <Icon name="filter" /> Filters
          {activeFilterCount > 0 && <span className="filters-toggle-count">{activeFilterCount}</span>}
        </button>

        <ViewsMenu
          statuses={availableStatuses}
          current={{
            statusIds: selectedStatuses,
            search: searchTerm,
            scoreFilter,
            flagFilter,
            sortColumn,
            sortDirection,
          }}
          onApply={onApplyView}
        />
      </div>

      {isFilterPanelOpen && (
        <div className="filters-panel" id="filters-panel">
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

        <select
          className="job-filter"
          data-help="score-filter"
          value={scoreFilter}
          onChange={(e) => onScoreFilterChange(e.target.value as ScoreFilter)}
          aria-label="Filter by scored or unscored"
          title="Show scored applicants, unscored applicants, or both"
        >
          <option value="all">Scored and unscored</option>
          <option value="scored">Scored only</option>
          <option value="unscored">Unscored only</option>
        </select>

        <select
          className="job-filter"
          data-help="flag-filter"
          value={flagFilter}
          onChange={(e) => onFlagFilterChange(e.target.value as FlagFilter)}
          aria-label="Filter by red flags"
          title="Show or hide applicants the AI flagged"
        >
          <option value="all">Flagged and unflagged</option>
          <option value="unflagged">Hide flagged</option>
          <option value="flagged">Flagged only</option>
        </select>

          {(activeFilterCount > 0 || searchTerm.trim() !== '') && (
            <button type="button" className="filters-clear-all" onClick={onClearFilters}>
              Clear filters
            </button>
          )}
        </div>
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

  const aiFiltersEqual =
    prevProps.scoreFilter === nextProps.scoreFilter &&
    prevProps.flagFilter === nextProps.flagFilter;

  // Sort/search feed the "save view" action; the override token drives the search box
  const viewStateEqual =
    prevProps.sortColumn === nextProps.sortColumn &&
    prevProps.sortDirection === nextProps.sortDirection &&
    prevProps.searchTerm === nextProps.searchTerm &&
    prevProps.searchOverride.token === nextProps.searchOverride.token;

  // Callbacks should be stable, so we don't need to compare them
  return statusesEqual && viewStateEqual && aiFiltersEqual;
}

export const ApplicantsFilters = memo(ApplicantsFiltersComponent, arePropsEqual);
