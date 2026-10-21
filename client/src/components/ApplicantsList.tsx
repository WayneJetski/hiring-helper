/**
 * ApplicantsList Component
 * Displays a table of all applicants with filtering capabilities
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApplicants } from '../hooks/useApplicants';
import { useScoreApplicant } from '../hooks/useScoreApplicant';
import { apiService } from '../services/api.service';
import { ApplicantsFilters } from './ApplicantsFilters';
import { Icon } from './icons/Icon';
import { type Notice } from './icons/StatusIcon';
import { BulkActions } from './BulkActions';
import { SyncStatus } from './SyncStatus';
import { ScoringControls } from './ScoringControls';
import { StatusIcon } from './icons/StatusIcon';
import { HelpTip } from './HelpTip';
import { RowActionsMenu, type RowAction } from './RowActionsMenu';
import { RowActionModal } from './RowActionModal';
import { ResumeModal } from './ResumeModal';
import { StageMover } from './StageMover';
import { ApplicantsListSkeleton } from './PageSkeletons';
import {
  loadSelectedStatusIds,
  saveSelectedStatusIds,
  loadSelectedJobId,
  saveSelectedJobId,
  hasPersistedJobSelection,
} from '../utils/filterStorage';
import { saveNavigationIds } from '../utils/applicantNavigation';
import {
  FLAG_DISPLAY,
  getConfidenceBadge,
  getConfidenceClass,
  getConfidenceLevel,
} from '../utils/matchDisplay';
import { buildCandidateLink } from '../utils/bamboohrLinks';
import type { ListView } from '../utils/savedViews';
import type { ApplicantListItem, JobSummary, SetupStatus, Status } from '../types/applicant.types';
import './ApplicantsList.css';

type SortColumn = 'name' | 'email' | 'stage' | 'confidence' | 'appliedDate';
type SortDirection = 'asc' | 'desc';

/**
 * Decide which job to scope to on first load.
 *
 * A persisted job selection wins as long as it still refers to a job that
 * exists (guarding against a posting that was removed since it was saved),
 * including the explicit "all jobs" (null) choice. Otherwise fall back to the
 * default behavior: the current (most-recent) job, so old postings' applicants
 * stay hidden.
 */
function resolveInitialJobId(fetchedJobs: JobSummary[]): number | null {
  if (hasPersistedJobSelection()) {
    const persistedJobId = loadSelectedJobId();
    if (persistedJobId === null) return null; // explicit "all jobs"
    if (fetchedJobs.some((job) => job.id === persistedJobId)) {
      return persistedJobId;
    }
    // Persisted job no longer exists; fall through to the default.
  }
  return fetchedJobs.length > 0 ? fetchedJobs[0].id : null;
}

interface ApplicantsListProps {
  /** The connected BambooHR company address, used to build shareable candidate links. */
  bambooHRSubdomain: string | null;
  /** Whether Claude Code is installed and signed in, since scoring depends on it. */
  claude: SetupStatus['claude'];
}

export function ApplicantsList({ bambooHRSubdomain, claude }: ApplicantsListProps): JSX.Element {
  const [searchTerm, setSearchTerm] = useState<string>('');
  // Each job remembers its own status selection; it is loaded once the job is
  // resolved. Stale IDs (statuses that no longer exist) are reconciled inside
  // ApplicantsFilters once the current status list is known.
  const [selectedStatusIds, setSelectedStatusIds] = useState<number[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [sortColumn, setSortColumn] = useState<SortColumn>('confidence');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncNotice, setSyncNotice] = useState<Notice | null>(null);

  // Job scoping: default to the current (most-recent) job so old postings' applicants are hidden.
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null); // null = all jobs
  const [jobsReady, setJobsReady] = useState<boolean>(false);

  // Quick actions from each row's "⋮" menu.
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [resumeApplicantId, setResumeApplicantId] = useState<number | null>(null);
  const [rowAction, setRowAction] = useState<{ mode: 'move' | 'reject'; applicantId: number } | null>(
    null
  );
  const [rowNotice, setRowNotice] = useState<{
    text: string;
    undoEntry?: { id: number; statusId: number };
  } | null>(null);
  const [isUndoingRowAction, setIsUndoingRowAction] = useState<boolean>(false);

  // Increment to open the selected job's settings window.
  const [openSettingsRequest, setOpenSettingsRequest] = useState<number>(0);

  // Bumped whenever data may have changed (sync, scoring, bulk actions) so the
  // pending bar and job counts refresh.
  const [dataVersion, setDataVersion] = useState<number>(0);
  // Lets the list reset or replace the text in the filter bar's search box.
  const [searchOverride, setSearchOverride] = useState<{ value: string; token: number }>({
    value: '',
    token: 0,
  });

  useEffect(() => {
    let cancelled = false;
    apiService
      .getJobs()
      .then((fetchedJobs) => {
        if (cancelled) return;
        const initialJobId = resolveInitialJobId(fetchedJobs);
        setJobs(fetchedJobs);
        setSelectedJobId(initialJobId);
        setSelectedStatusIds(loadSelectedStatusIds(initialJobId));
        setJobsReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load jobs:', err);
        setJobsReady(true); // Fall back to all-jobs view rather than blocking forever
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the status selection for the current job (not before the job and its
  // saved selection have been loaded, or the empty default would overwrite it).
  useEffect(() => {
    if (jobsReady) saveSelectedStatusIds(selectedJobId, selectedStatusIds);
  }, [jobsReady, selectedJobId, selectedStatusIds]);

  const navigate = useNavigate();

  useEffect(() => {
    apiService
      .getStatuses()
      .then(setStatuses)
      .catch((err) => console.error('Failed to load statuses:', err));
  }, []);
  const { applicants, loading, isRefreshing, error, pagination, totalCount, refetch } = useApplicants({
    search: searchTerm,
    statusIds: selectedStatusIds.length > 0 ? selectedStatusIds.join(',') : undefined,
    jobId: selectedJobId !== null ? String(selectedJobId) : undefined,
    page: currentPage,
    limit: 50,
    sortBy: sortColumn,
    sortDirection,
    enabled: jobsReady, // Defer fetching until the default job is resolved
  });

  // Remember the order shown so the detail page and résumé viewer can step
  // to the previous/next applicant.
  useEffect(() => {
    saveNavigationIds(applicants.map((applicant) => applicant.id));
  }, [applicants]);

  const reloadJobs = useCallback(async (): Promise<JobSummary[]> => {
    try {
      const fetchedJobs = await apiService.getJobs();
      setJobs(fetchedJobs);
      return fetchedJobs;
    } catch (err) {
      console.error('Failed to reload jobs:', err);
      return [];
    }
  }, []);

  const handleDataChanged = useCallback(async (): Promise<void> => {
    await Promise.all([refetch(), reloadJobs()]);
    setDataVersion((version) => version + 1);
  }, [refetch, reloadJobs]);

  const {
    notice: scoreNotice,
    dismissNotice: dismissScoreNotice,
    scoreApplicant,
  } = useScoreApplicant(handleDataChanged);

  const handleJobChange = useCallback((jobId: number | null): void => {
    setSelectedJobId(jobId);
    setSelectedStatusIds(loadSelectedStatusIds(jobId)); // each job keeps its own filter
    saveSelectedJobId(jobId); // Remember the job scope across reloads
    setCurrentPage(1); // Reset to page 1 when changing job scope
  }, []);

  const handleSearchChange = useCallback((value: string): void => {
    setSearchTerm(value);
    setCurrentPage(1); // Reset to page 1 when searching
  }, []);

  const handleStatusesChange = useCallback((statusIds: number[]): void => {
    setSelectedStatusIds(statusIds);
    setCurrentPage(1); // Reset to page 1 when filtering
  }, []);

  const handleRowClick = (applicant: ApplicantListItem): void => {
    navigate(`/applicants/${applicant.id}`);
  };

  const rowActionApplicant =
    rowAction !== null ? applicants.find((applicant) => applicant.id === rowAction.applicantId) : undefined;

  const resumeIndex =
    resumeApplicantId !== null
      ? applicants.findIndex((applicant) => applicant.id === resumeApplicantId)
      : -1;
  const resumeApplicant = resumeIndex >= 0 ? applicants[resumeIndex] : undefined;
  const previousResumeApplicant = resumeIndex > 0 ? applicants[resumeIndex - 1] : undefined;
  const nextResumeApplicant =
    resumeIndex >= 0 && resumeIndex < applicants.length - 1 ? applicants[resumeIndex + 1] : undefined;

  const handleCopyEmail = async (applicant: ApplicantListItem): Promise<void> => {
    try {
      await navigator.clipboard.writeText(applicant.email);
      setRowNotice({ text: `Copied ${applicant.email}` });
    } catch {
      setRowNotice({ text: `Could not copy automatically. The email is ${applicant.email}` });
    }
  };

  // Grouped by intent: change the applicant, look at them, then share them.
  const handleCopyLink = async (applicant: ApplicantListItem): Promise<void> => {
    const link = buildCandidateLink(bambooHRSubdomain, applicant.id);
    if (!link) {
      setRowNotice({ text: 'Could not build the link. Sync with BambooHR and try again.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setRowNotice({ text: `Link to ${applicant.name} copied. Anyone with BambooHR access can open it.` });
    } catch {
      setRowNotice({ text: `Could not copy automatically. The link is ${link}` });
    }
  };

  const buildRowActionGroups = (applicant: ApplicantListItem): RowAction[][] => [
    [
      {
        label: 'Move to stage',
        icon: 'arrowRight',
        onSelect: () => setRowAction({ mode: 'move', applicantId: applicant.id }),
      },
      {
        label: 'Reject',
        icon: 'xCircle',
        isDanger: true,
        onSelect: () => setRowAction({ mode: 'reject', applicantId: applicant.id }),
      },
    ],
    [
      {
        label: applicant.confidence !== undefined ? 'Rescore Applicant' : 'Score Applicant',
        icon: applicant.confidence !== undefined ? 'repeat' : 'target',
        onSelect: () => void scoreApplicant(applicant.id, applicant.name),
      },
      { label: 'View résumé', icon: 'fileText', onSelect: () => setResumeApplicantId(applicant.id) },
      { label: 'View profile', icon: 'user', onSelect: () => handleRowClick(applicant) },
    ],
    [
      {
        label: 'Copy applicant link',
        icon: 'link',
        onSelect: () => void handleCopyLink(applicant),
      },
      { label: 'Copy email', icon: 'clipboardList', onSelect: () => void handleCopyEmail(applicant) },
    ],
  ];

  const handleRowActionDone = async (
    applicant: ApplicantListItem,
    mode: 'move' | 'reject',
    newStageLabel: string
  ): Promise<void> => {
    const previousStatus = statuses.find((status) => status.label === applicant.stage);
    setRowNotice({
      text: `${applicant.name} ${mode === 'reject' ? 'rejected as' : 'moved to'} "${newStageLabel}".`,
      undoEntry: previousStatus ? { id: applicant.id, statusId: previousStatus.id } : undefined,
    });
    await handleDataChanged();
  };

  const handleUndoRowAction = async (): Promise<void> => {
    if (!rowNotice?.undoEntry) return;
    try {
      setIsUndoingRowAction(true);
      await apiService.restoreStatuses([rowNotice.undoEntry]);
      setRowNotice({ text: 'Undone. The applicant is back in their previous stage.' });
      await handleDataChanged();
    } catch (err) {
      setRowNotice({ text: err instanceof Error ? err.message : 'Could not undo.' });
    } finally {
      setIsUndoingRowAction(false);
    }
  };

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const handlePreviousPage = (): void => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = (): void => {
    if (pagination?.hasMore) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handleSort = (column: SortColumn): void => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to ascending
      setSortColumn(column);
      setSortDirection('asc');
    }
    setCurrentPage(1); // Reset to page 1 when sorting changes
  };

  const handleApplyView = useCallback((view: ListView): void => {
    setSelectedStatusIds(view.statusIds);
    setSearchTerm(view.search);
    setSearchOverride((previous) => ({ value: view.search, token: previous.token + 1 }));
    setSortColumn(view.sortColumn);
    setSortDirection(view.sortDirection);
    setCurrentPage(1);
  }, []);

  const handleClearFilters = useCallback((): void => {
    setSelectedStatusIds([]);
    setSearchTerm('');
    setSearchOverride((previous) => ({ value: '', token: previous.token + 1 }));
    setCurrentPage(1);
  }, []);

  const sortAriaValue = (column: SortColumn): 'ascending' | 'descending' | 'none' => {
    if (sortColumn !== column) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  const handleSortKeyDown = (event: React.KeyboardEvent, column: SortColumn): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSort(column);
    }
  };

  const getSortIcon = (column: SortColumn): JSX.Element => {
    if (sortColumn !== column) return <Icon name="chevronsUpDown" size={14} className="sort-icon" />;
    return (
      <Icon
        name={sortDirection === 'asc' ? 'arrowUp' : 'arrowDown'}
        size={14}
        className="sort-icon sort-icon-active"
      />
    );
  };

  const handleSync = useCallback(async (): Promise<void> => {
    try {
      setSyncing(true);
      setSyncNotice(null);
      // Incremental sync: pull new/changed applications from BambooHR. This does
      // NOT mark anything inactive (only a full sync does), so it can't hide the
      // list. A full reconcile is a deliberate maintenance action, not this button.
      const result = await apiService.triggerSync(false);
      
      // Check if rate limited
      if (result.rateLimited) {
        setSyncNotice({ tone: 'warning', text: result.message });
      } else {
        setSyncNotice({ tone: 'success', text: result.message });
      }
      
      // Refresh the list and job selector after sync (even if rate limited, we
      // have local data). A job we have never seen shows up here, so say so.
      const knownJobIds = new Set(jobs.map((job) => job.id));
      const [, refreshedJobs] = await Promise.all([refetch(), reloadJobs()]);
      setDataVersion((version) => version + 1);
      const newJobs = refreshedJobs.filter((job) => !knownJobIds.has(job.id));
      if (newJobs.length > 0) {
        const names = newJobs.map((job) => job.title).join(', ');
        setSyncNotice({
          tone: 'success',
          text: `${result.message}. New job${newJobs.length !== 1 ? 's' : ''} found: ${names}.`,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sync failed';
      setSyncNotice({ tone: 'error', text: errorMessage });
    } finally {
      setSyncing(false);
      // Clear message after 8 seconds (longer for rate limit warnings)
      setTimeout(() => setSyncNotice(null), 8000);
    }
  }, [refetch, reloadJobs, jobs]);

  if (loading) {
    return <ApplicantsListSkeleton />;
  }

  if (error) {
    return (
      <div className="applicants-list">
        <div className="load-error" role="alert">
          <p>We could not load the applicants.</p>
          <p className="error-detail">{error}</p>
          <button type="button" className="retry-button" onClick={() => void refetch()}>
            <Icon name="refresh" /> Try again
          </button>
        </div>
      </div>
    );
  }

  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const hasActiveFilters = searchTerm.trim() !== '' || selectedStatusIds.length > 0;

  const renderEmptyState = (): JSX.Element => {
    if (hasActiveFilters) {
      return (
        <div className="no-results">
          <p>No applicants match these filters.</p>
          <button type="button" className="clear-filters-button" onClick={handleClearFilters}>
            Clear filters
          </button>
        </div>
      );
    }
    return (
      <div className="no-results">
        <p>
          {selectedJob
            ? `There are no applicants for ${selectedJob.title} yet.`
            : 'There are no applicants to show yet.'}
        </p>
        <p className="no-results-hint">
          Press <strong>Sync with BambooHR</strong> to check for new ones. If you just connected,
          the first sync may still be running.
        </p>
      </div>
    );
  };

  return (
    <div className="applicants-list">
      <div className="header">
        <div className="header-title">
          <h1>Job Applicants</h1>
          {totalCount !== undefined && (
            <p className="total-count">
              Showing {applicants.length} of {totalCount} applicant{totalCount !== 1 ? 's' : ''}
              {isRefreshing && <span className="refreshing-indicator"> (updating...)</span>}
            </p>
          )}
        </div>
        <div className="header-sync">
          <button
            onClick={() => void handleSync()}
            disabled={syncing}
            className="sync-button"
            data-help="sync"
            title="Bring in new applicants, new jobs and status changes from BambooHR"
          >
            <Icon name="refresh" isSpinning={syncing} /> {syncing ? 'Syncing…' : 'Sync with BambooHR'}
          </button>
          <SyncStatus dataVersion={dataVersion} />
        </div>
      </div>

      {syncNotice && (
        <div className={`sync-message ${syncNotice.tone}`} role="status">
          <StatusIcon tone={syncNotice.tone} />
          <span>{syncNotice.text}</span>
        </div>
      )}

      {scoreNotice && (
        <div className={`sync-message ${scoreNotice.tone} row-notice`} role="status">
          <StatusIcon tone={scoreNotice.tone} />
          <span>{scoreNotice.text}</span>
          <button
            type="button"
            className="row-notice-dismiss"
            onClick={dismissScoreNotice}
            aria-label="Dismiss"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {rowNotice && (
        <div className="sync-message success row-notice" role="status">
          <Icon name="checkCircle" />
          <span>{rowNotice.text}</span>
          {rowNotice.undoEntry && (
            <button
              type="button"
              className="row-notice-undo"
              onClick={() => void handleUndoRowAction()}
              disabled={isUndoingRowAction}
            >
              <Icon name="undo" /> {isUndoingRowAction ? 'Undoing…' : 'Undo'}
            </button>
          )}
          <button
            type="button"
            className="row-notice-dismiss"
            onClick={() => setRowNotice(null)}
            aria-label="Dismiss"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      <ApplicantsFilters
        jobs={jobs}
        selectedJobId={selectedJobId}
        onJobChange={handleJobChange}
        selectedStatuses={selectedStatusIds}
        onSearchChange={handleSearchChange}
        onStatusesChange={handleStatusesChange}
        searchOverride={searchOverride}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        searchTerm={searchTerm}
        onApplyView={handleApplyView}
        openSettingsRequest={openSettingsRequest}
        onJobSettingsSaved={() => void handleDataChanged()}
      />

      {(!claude.installed || claude.signedIn === false) && (
        <div className="sync-message warning claude-banner" role="status">
          <StatusIcon tone="warning" />
          <span>
            {claude.installed
              ? 'Scoring is off because Claude is not signed in.'
              : 'Scoring is off because Claude Code is not installed.'}
          </span>
          <Link to="/setup" className="claude-banner-link">
            {claude.installed ? 'Sign in' : 'Open setup'}
          </Link>
        </div>
      )}

      <div className="action-bar">
        <ScoringControls
          jobId={selectedJobId}
          statusIds={selectedStatusIds}
          searchTerm={searchTerm}
          unscoredCount={selectedJob?.unscoredCount ?? 0}
          onScoringComplete={handleDataChanged}
          readiness={selectedJob ?? null}
          onOpenJobSettings={() => setOpenSettingsRequest((request) => request + 1)}
        />
        <BulkActions
          selectedJobId={selectedJobId ?? undefined}
          onActionComplete={handleDataChanged}
          dataVersion={dataVersion}
        />
      </div>

      {applicants.length === 0 ? (
        renderEmptyState()
      ) : (
        <div className="table-container">
          <table className="applicants-table">
            <thead>
              <tr>
                {(
                  [
                    ['name', 'Name'],
                    ['email', 'Email'],
                    ['stage', 'Stage'],
                    ['appliedDate', 'Applied Date'],
                  ] as Array<[SortColumn, string]>
                ).map(([column, label]) => (
                  <th
                    key={column}
                    onClick={() => handleSort(column)}
                    onKeyDown={(event) => handleSortKeyDown(event, column)}
                    className="sortable"
                    tabIndex={0}
                    aria-sort={sortAriaValue(column)}
                  >
                    <span className="sort-label">
                      {label} {getSortIcon(column)}
                    </span>
                  </th>
                ))}
                <th
                  data-help="match"
                  onClick={() => handleSort('confidence')}
                  onKeyDown={(event) => handleSortKeyDown(event, 'confidence')}
                  className="sortable"
                  tabIndex={0}
                  aria-sort={sortAriaValue('confidence')}
                >
                  <span className="sort-label">
                    Match {getSortIcon('confidence')}
                    <HelpTip text="How well the résumé fits this job, from 0 to 100, estimated by AI. Strong is 75 and up, Maybe is 60 to 74, Weak is below 60. It is a first-pass guide, not a decision." />
                  </span>
                </th>
                <th data-help="flags">
                  Flags
                  <HelpTip text="Things worth a second look, such as location, still studying, little experience, short jobs or gaps, or salary expectations. Depending on the job's settings, a flag can also lower the Match score." />
                </th>
                <th className="row-actions-cell">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {applicants.map((applicant, rowIndex) => (
                <tr
                  key={applicant.id}
                  onClick={() => handleRowClick(applicant)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleRowClick(applicant);
                  }}
                  className="applicant-row"
                  tabIndex={0}
                  aria-label={`Open ${applicant.name}`}
                >
                  <td className="name-cell" data-help={rowIndex === 0 ? 'row' : undefined}>
                    <span className="name-text">{applicant.name}</span>
                    {applicant.summaryBrief && (
                      <span className="applicant-summary-line" title={applicant.summaryBrief}>
                        {applicant.summaryBrief}
                      </span>
                    )}
                  </td>
                  <td>{applicant.email}</td>
                  <td>
                    <span className="stage-badge">{applicant.stage}</span>
                  </td>
                  <td>{formatDate(applicant.appliedDate)}</td>
                  <td>
                    <span className={`confidence-badge ${getConfidenceClass(applicant.confidence)}`}>
                      {getConfidenceBadge(applicant.confidence)}
                    </span>
                    {applicant.confidence !== undefined && (
                      <span className="confidence-level">{getConfidenceLevel(applicant.confidence)}</span>
                    )}
                  </td>
                  <td className="flags-cell">
                    {applicant.flags && applicant.flags.length > 0
                      ? applicant.flags.map((flag) => (
                          <span key={flag} className={`flag-badge flag-${flag}`}>
                            {FLAG_DISPLAY[flag] ? (
                              <>
                                <Icon name={FLAG_DISPLAY[flag].icon} size={13} />
                                {FLAG_DISPLAY[flag].label}
                              </>
                            ) : (
                              flag
                            )}
                          </span>
                        ))
                      : <span className="flag-none">—</span>}
                  </td>
                  <td
                    className="row-actions-cell"
                    data-help={rowIndex === 0 ? 'row-menu' : undefined}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <RowActionsMenu
                      applicantName={applicant.name}
                      actionGroups={buildRowActionGroups(applicant)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && (
        <div className="pagination">
          <button
            onClick={handlePreviousPage}
            disabled={currentPage === 1}
            className="pagination-button"
          >
            <Icon name="arrowLeft" /> Previous
          </button>
          <span className="pagination-info">
            Page {currentPage} {pagination.hasMore && '· More available'}
          </span>
          <button
            onClick={handleNextPage}
            disabled={!pagination.hasMore}
            className="pagination-button"
          >
            Next <Icon name="arrowRight" />
          </button>
        </div>
      )}

      {rowAction && rowActionApplicant && (
        <RowActionModal
          mode={rowAction.mode}
          applicantId={rowActionApplicant.id}
          applicantName={rowActionApplicant.name}
          currentStage={rowActionApplicant.stage}
          statuses={statuses}
          onDone={(label) => handleRowActionDone(rowActionApplicant, rowAction.mode, label)}
          onClose={() => setRowAction(null)}
        />
      )}

      {resumeApplicant && (
        <ResumeModal
          applicationId={resumeApplicant.id}
          applicantName={resumeApplicant.name}
          position={{ current: resumeIndex + 1, total: applicants.length }}
          onPrevious={
            previousResumeApplicant ? () => setResumeApplicantId(previousResumeApplicant.id) : undefined
          }
          onNext={nextResumeApplicant ? () => setResumeApplicantId(nextResumeApplicant.id) : undefined}
          onClose={() => setResumeApplicantId(null)}
        >
          <StageMover
            key={resumeApplicant.id}
            applicantId={resumeApplicant.id}
            statuses={statuses}
            hasRejectShortcut
            onMoved={async () => {
              const nextId = nextResumeApplicant?.id ?? null;
              await handleDataChanged();
              if (nextId !== null) setResumeApplicantId(nextId);
            }}
          />
        </ResumeModal>
      )}
    </div>
  );
}
