/**
 * BulkActions Component
 *
 * Two job-scoped bulk operations on the applicants list:
 *   - Bulk Reject: set matching candidates to a rejection status
 *   - Bulk Move:   set matching candidates to any target stage
 *
 * Each action builds a single condition (Match or Applied Date), previews how
 * many candidates match, and requires an explicit confirm before applying.
 * Scoped to the currently selected job; disabled when "All jobs" is selected.
 * Changes are applied to the local store only (no BambooHR writes, no emails).
 */

import { CLOSED_JOB_CHANGES_REASON } from '../utils/closedJob';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { apiService } from '../services/api.service';
import type {
  Status,
  BulkCondition,
  BulkPreviewResult,
  DuplicatePreviewResult,
  PushPreviewResult,
  PushResult,
  PreviousStatus,
} from '../types/applicant.types';
import { getGroupForLabel } from '../utils/statusGroups';
import { Icon } from './icons/Icon';
import { Modal } from './Modal';
import './BulkActions.css';

/** Selectable triage flags for a Flag condition. */
const FLAG_OPTIONS: { value: string; label: string }[] = [
  { value: 'location', label: 'Location' },
  { value: 'name', label: 'Name' },
  { value: 'studying', label: 'Studying' },
  { value: 'no_exp', label: 'No Exp' },
  { value: 'tenure', label: 'Tenure / Gaps' },
  { value: 'salary-low', label: 'Salary Low' },
  { value: 'salary-high', label: 'Salary High' },
];

type BulkMode = 'reject' | 'move' | 'duplicates' | 'push' | null;
type ConditionField = 'match' | 'appliedDate' | 'flag';
type ConditionOperator = 'greaterThan' | 'lessThan' | 'is';

/**
 * Starting operator for a condition. Bulk reject defaults to "is less than" so
 * the first thing a user sees targets the weakest candidates (for example Match
 * below 50) rather than the strongest, which would be a costly mistake to
 * confirm without reading.
 */
function defaultOperator(mode: BulkMode, field: ConditionField): ConditionOperator {
  if (field === 'flag') return 'is';
  return mode === 'reject' ? 'lessThan' : 'greaterThan';
}

interface BulkActionsProps {
  selectedJobId?: number;
  /** A closed job is read-only: bulk reject, move and clean-up are disabled. */
  isJobClosed?: boolean;
  /** Called after a successful reject/move so the list can refresh. */
  onActionComplete: () => void | Promise<void>;
  /** Bumped whenever data may have changed elsewhere (row actions, sync, scoring). */
  dataVersion?: number;
}

/** The most recent bulk change, kept so it can be undone. */
interface UndoableAction {
  text: string;
  previousStatuses: PreviousStatus[];
}

/**
 * An affected candidate's name, linking to their applicant page. Opens in a new
 * tab so the reviewer doesn't lose an in-progress bulk preview.
 */
function ApplicantLink({ id, name }: { id: number; name: string }): JSX.Element {
  return (
    <Link
      to={`/applicants/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="bulk-applicant-link"
    >
      {name}
    </Link>
  );
}

export function BulkActions({
  selectedJobId,
  isJobClosed = false,
  onActionComplete,
  dataVersion = 0,
}: BulkActionsProps): JSX.Element {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [mode, setMode] = useState<BulkMode>(null);

  // Condition state
  const [field, setField] = useState<ConditionField>('match');
  const [operator, setOperator] = useState<ConditionOperator>('greaterThan');
  const [matchValue, setMatchValue] = useState<string>('50');
  const [dateValue, setDateValue] = useState<string>('');
  const [flagValue, setFlagValue] = useState<string>('location');

  // Target status for the action
  const [statusId, setStatusId] = useState<number | undefined>(undefined);

  // Preview + submission state
  const [preview, setPreview] = useState<BulkPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Duplicate-cleanup state
  const [dupPreview, setDupPreview] = useState<DuplicatePreviewResult | null>(null);
  const [dupPreviewing, setDupPreviewing] = useState<boolean>(false);
  const [dupSubmitting, setDupSubmitting] = useState<boolean>(false);

  // Push-to-BambooHR state
  const [pushCount, setPushCount] = useState<number>(0);
  const [pushPreview, setPushPreview] = useState<PushPreviewResult | null>(null);
  const [pushPreviewing, setPushPreviewing] = useState<boolean>(false);
  const [pushSubmitting, setPushSubmitting] = useState<boolean>(false);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [hasConfirmedPush, setHasConfirmedPush] = useState<boolean>(false);
  const [isDiscarding, setIsDiscarding] = useState<boolean>(false);
  const [isConfirmingDiscardAll, setIsConfirmingDiscardAll] = useState<boolean>(false);

  // "Bulk actions" dropdown
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Undo of the last reject/move/duplicate cleanup
  const [undoable, setUndoable] = useState<UndoableAction | null>(null);
  const [isUndoing, setIsUndoing] = useState<boolean>(false);
  const [undoNotice, setUndoNotice] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    apiService
      .getStatuses()
      .then((fetched) => {
        if (!cancelled) setStatuses(fetched);
      })
      .catch((err) => console.error('Failed to load statuses:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handlePointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const jobSelected = selectedJobId !== undefined;

  // Rejection reasons come from the shared status grouping (single source of
  // truth), so the reject dropdown lists every reject reason — including
  // "Lacking Skill(s)/Qualification(s)" — not a hardcoded subset.
  const rejectionStatuses = statuses.filter((s) => getGroupForLabel(s.label) === 'Rejected');
  const otherStatuses = statuses.filter((s) => getGroupForLabel(s.label) !== 'Rejected');

  const resetTransientState = useCallback((): void => {
    setPreview(null);
    setDupPreview(null);
    setPushPreview(null);
    setPushResult(null);
    setMessage('');
    setErrorMessage('');
  }, []);

  // Badge count of local status changes pending a push to BambooHR, scoped to
  // the selected job (or all jobs when none is selected). Refreshed whenever the
  // job changes or a local action may have created/cleared pending changes.
  const loadPushCount = useCallback((): void => {
    apiService
      .getPendingPush(selectedJobId)
      .then((result) => setPushCount(result.count))
      .catch((err) => console.error('Failed to load pending push count:', err));
  }, [selectedJobId]);

  // Also refresh when the page reports data changed elsewhere (a move or reject
  // from a row's menu, a sync), so the Send button appears without a reload.
  useEffect(() => {
    loadPushCount();
  }, [loadPushCount, dataVersion]);

  const openForm = useCallback(
    (nextMode: Exclude<BulkMode, null>): void => {
      resetTransientState();
      if (nextMode === 'reject') {
        setStatusId(rejectionStatuses[0]?.id);
      } else {
        setStatusId(otherStatuses[0]?.id ?? statuses[0]?.id);
      }
      if (nextMode === 'reject' || nextMode === 'move') {
        setField('match');
        setOperator(defaultOperator(nextMode, 'match'));
      }
      setMode(nextMode);
    },
    [resetTransientState, rejectionStatuses, otherStatuses, statuses]
  );

  const closeForm = useCallback((): void => {
    setMode(null);
    resetTransientState();
  }, [resetTransientState]);

  const buildCondition = useCallback((): BulkCondition | null => {
    if (field === 'flag') {
      return { field, operator: 'is', value: flagValue };
    }
    if (field === 'match') {
      const numeric = parseInt(matchValue, 10);
      if (Number.isNaN(numeric) || numeric < 1 || numeric > 100) {
        setErrorMessage('Match value must be a number between 1 and 100.');
        return null;
      }
      return { field, operator, value: numeric };
    }
    if (!dateValue) {
      setErrorMessage('Please choose an applied date.');
      return null;
    }
    return { field, operator, value: dateValue };
  }, [field, operator, matchValue, dateValue, flagValue]);

  // When switching to/from the Flag field, keep the operator valid and clear any stale preview.
  const handleFieldChange = useCallback(
    (nextField: ConditionField): void => {
      setField(nextField);
      setOperator(defaultOperator(mode, nextField));
      setPreview(null);
      setMessage('');
    },
    [mode]
  );

  const handlePreview = useCallback(async (): Promise<void> => {
    if (selectedJobId === undefined) return;
    setErrorMessage('');
    setMessage('');
    const condition = buildCondition();
    if (!condition) return;
    try {
      setPreviewing(true);
      const result = await apiService.bulkPreview(selectedJobId, condition);
      setPreview(result);
    } catch (err) {
      setPreview(null);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to preview.');
    } finally {
      setPreviewing(false);
    }
  }, [selectedJobId, buildCondition]);

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (selectedJobId === undefined || mode === null) return;
    if (statusId === undefined) {
      setErrorMessage(mode === 'reject' ? 'Please choose a rejection reason.' : 'Please choose a target stage.');
      return;
    }
    const condition = buildCondition();
    if (!condition) return;
    try {
      setSubmitting(true);
      setErrorMessage('');
      const result =
        mode === 'reject'
          ? await apiService.bulkReject(selectedJobId, condition, statusId)
          : await apiService.bulkMove(selectedJobId, condition, statusId);
      const verb = mode === 'reject' ? 'rejected' : 'moved';
      const summary = `${result.updated} candidate${result.updated !== 1 ? 's' : ''} ${verb}.`;
      setMessage(summary);
      setUndoNotice('');
      setUndoable(result.updated > 0 ? { text: summary, previousStatuses: result.previousStatuses } : null);
      setPreview(null);
      setMode(null); // the page's undo banner reports the result
      loadPushCount();
      onActionComplete();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Bulk action failed.');
    } finally {
      setSubmitting(false);
    }
  }, [selectedJobId, mode, statusId, buildCondition, onActionComplete, loadPushCount]);

  // Any change to the condition invalidates a stale preview.
  const handleConditionChange = useCallback((): void => {
    setPreview(null);
    setMessage('');
  }, []);

  const openDuplicates = useCallback(async (): Promise<void> => {
    if (selectedJobId === undefined) return;
    resetTransientState();
    setMode('duplicates');
    try {
      setDupPreviewing(true);
      const result = await apiService.previewDuplicates(selectedJobId);
      setDupPreview(result);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to preview duplicates.');
    } finally {
      setDupPreviewing(false);
    }
  }, [selectedJobId, resetTransientState]);

  const handleConfirmDuplicates = useCallback(async (): Promise<void> => {
    if (selectedJobId === undefined) return;
    try {
      setDupSubmitting(true);
      setErrorMessage('');
      const result = await apiService.cleanupDuplicates(selectedJobId);
      const summary = `${result.updated} duplicate${result.updated !== 1 ? 's' : ''} rejected as "${result.statusLabel}".`;
      setMessage(summary);
      setUndoNotice('');
      setUndoable(result.updated > 0 ? { text: summary, previousStatuses: result.previousStatuses } : null);
      setDupPreview(null);
      setMode(null); // the page's undo banner reports the result
      loadPushCount();
      onActionComplete();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Cleanup failed.');
    } finally {
      setDupSubmitting(false);
    }
  }, [selectedJobId, onActionComplete, loadPushCount]);

  const handleUndo = useCallback(async (): Promise<void> => {
    if (!undoable) return;
    try {
      setIsUndoing(true);
      const { restored } = await apiService.restoreStatuses(undoable.previousStatuses);
      setUndoable(null);
      setUndoNotice(`Undone: ${restored} candidate${restored !== 1 ? 's' : ''} put back as they were.`);
      loadPushCount();
      await onActionComplete();
    } catch (err) {
      setUndoNotice(err instanceof Error ? err.message : 'Could not undo.');
    } finally {
      setIsUndoing(false);
    }
  }, [undoable, loadPushCount, onActionComplete]);

  const openPush = useCallback(async (): Promise<void> => {
    resetTransientState();
    setHasConfirmedPush(false);
    setIsConfirmingDiscardAll(false);
    setMode('push');
    try {
      setPushPreviewing(true);
      const result = await apiService.getPendingPush(selectedJobId);
      setPushPreview(result);
      setPushCount(result.count);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load pending changes.');
    } finally {
      setPushPreviewing(false);
    }
  }, [selectedJobId, resetTransientState]);

  // Roll back pending changes locally instead of sending them. With `ids`, just
  // those applicants; otherwise everything pending in scope.
  const handleDiscard = useCallback(
    async (ids?: number[]): Promise<void> => {
      try {
        setIsDiscarding(true);
        setErrorMessage('');
        setMessage('');
        setIsConfirmingDiscardAll(false);
        const { discarded, skipped } = await apiService.discardPendingPush(selectedJobId, ids);
        const parts = [
          `${discarded} change${discarded !== 1 ? 's' : ''} rolled back. Applicants are back to the stage BambooHR has.`,
        ];
        if (skipped > 0) {
          parts.push(`${skipped} could not be rolled back because BambooHR's stage for them is unknown.`);
        }
        setMessage(parts.join(' '));
        const refreshed = await apiService.getPendingPush(selectedJobId);
        setPushPreview(refreshed);
        setPushCount(refreshed.count);
        setHasConfirmedPush(false);
        await onActionComplete();
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Could not roll back the changes.');
      } finally {
        setIsDiscarding(false);
      }
    },
    [selectedJobId, onActionComplete]
  );

  const handleConfirmPush = useCallback(async (): Promise<void> => {
    try {
      setPushSubmitting(true);
      setErrorMessage('');
      setMessage('');
      // Send exactly the changes listed in the preview the person just confirmed;
      // the server refuses a push that does not name them.
      const reviewedChanges =
        pushPreview?.pending.map((item) => ({ id: item.id, toStatusId: item.toStatusId })) ?? [];
      const result = await apiService.pushToBambooHR(selectedJobId, reviewedChanges);
      setPushResult(result);
      setHasConfirmedPush(false);
      const parts = [`${result.pushed} change${result.pushed !== 1 ? 's' : ''} sent to BambooHR`];
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (result.changedSinceReview > 0) {
        parts.push(`${result.changedSinceReview} skipped because they changed after you reviewed them`);
      }
      if (result.rateLimited) parts.push('halted early (rate limited, retry to finish)');
      setMessage(`${parts.join('; ')}.`);
      // Refresh the remaining pending set and the surrounding list.
      const refreshed = await apiService.getPendingPush(selectedJobId);
      setPushPreview(refreshed);
      setPushCount(refreshed.count);
      onActionComplete();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Push failed.');
    } finally {
      setPushSubmitting(false);
    }
  }, [selectedJobId, pushPreview, onActionComplete]);

  const confirmLabel = mode === 'reject' ? 'Confirm Reject' : 'Confirm Move';
  const formTitle =
    mode === 'reject'
      ? 'Bulk Reject'
      : mode === 'move'
        ? 'Bulk Move'
        : mode === 'push'
          ? 'Send changes to BambooHR'
          : 'Clean up duplicates';

  return (
    <>
      <div className="bulk-menu" ref={menuRef}>
        <button
          className="bulk-action-button bulk-menu-button"
          data-help="bulk"
          onClick={() => setIsMenuOpen((open) => !open)}
          disabled={!jobSelected || isJobClosed}
          aria-expanded={isMenuOpen}
          aria-haspopup="true"
          title={
            isJobClosed
              ? CLOSED_JOB_CHANGES_REASON
              : jobSelected
                ? 'Reject or move many applicants at once, or clean up duplicates'
                : 'Select a single job to use bulk actions'
          }
        >
          Bulk actions <Icon name="chevronDown" />
        </button>
        {isMenuOpen && (
          <div className="bulk-menu-panel" role="menu">
            <button
              role="menuitem"
              className="bulk-menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                openForm('reject');
              }}
            >
              Bulk reject
              <span>Reject everyone matching a rule, for example a low Match score</span>
            </button>
            <button
              role="menuitem"
              className="bulk-menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                openForm('move');
              }}
            >
              Bulk move
              <span>Move everyone matching a rule to another stage</span>
            </button>
            <button
              role="menuitem"
              className="bulk-menu-item"
              onClick={() => {
                setIsMenuOpen(false);
                void openDuplicates();
              }}
            >
              Clean up duplicates
              <span>Reject older copies of the same person&apos;s application</span>
            </button>
          </div>
        )}
      </div>

      {pushCount > 0 && (
        <button
          className="bulk-action-button push"
          data-help="push"
          onClick={openPush}
          title="Send your stage moves and rejections to BambooHR. Only the stage is updated; candidates are never emailed by Hiring Helper."
        >
          <Icon name="upload" /> Send to BambooHR
          <span className="action-count">{pushCount}</span>
        </button>
      )}

      {mode !== null && (jobSelected || mode === 'push') && (
        <Modal title={formTitle} onClose={closeForm}>
        <div className="bulk-actions-form">

          {(mode === 'reject' || mode === 'move') && (
          <>
          <div className="bulk-condition-row">
            <span className="bulk-condition-prefix">Where</span>

            <select
              className="bulk-select"
              value={field}
              onChange={(e) => handleFieldChange(e.target.value as ConditionField)}
              aria-label="Condition field"
            >
              <option value="match">Match</option>
              <option value="appliedDate">Applied Date</option>
              <option value="flag">Flag</option>
            </select>

            {field === 'flag' ? (
              <span className="bulk-condition-prefix">is</span>
            ) : (
              <select
                className="bulk-select"
                value={operator}
                onChange={(e) => {
                  setOperator(e.target.value as ConditionOperator);
                  handleConditionChange();
                }}
                aria-label="Condition operator"
              >
                <option value="greaterThan">is greater than</option>
                <option value="lessThan">is less than</option>
              </select>
            )}

            {field === 'match' && (
              <input
                className="bulk-input"
                type="number"
                min={1}
                max={100}
                value={matchValue}
                onChange={(e) => {
                  setMatchValue(e.target.value);
                  handleConditionChange();
                }}
                aria-label="Match value"
              />
            )}
            {field === 'appliedDate' && (
              <input
                className="bulk-input"
                type="date"
                value={dateValue}
                onChange={(e) => {
                  setDateValue(e.target.value);
                  handleConditionChange();
                }}
                aria-label="Applied date value"
              />
            )}
            {field === 'flag' && (
              <select
                className="bulk-select"
                value={flagValue}
                onChange={(e) => {
                  setFlagValue(e.target.value);
                  handleConditionChange();
                }}
                aria-label="Flag value"
              >
                {FLAG_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {field === 'match' && (
            <p className="bulk-note">
              Note: candidates without a match score are never affected by a Match condition.
            </p>
          )}

          <div className="bulk-status-row">
            <label className="bulk-status-label">
              {mode === 'reject' ? 'Rejection reason' : 'Target stage'}
            </label>
            <select
              className="bulk-select bulk-status-select"
              value={statusId ?? ''}
              onChange={(e) => setStatusId(e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
              aria-label={mode === 'reject' ? 'Rejection reason' : 'Target stage'}
            >
              {mode === 'reject' ? (
                <>
                  {rejectionStatuses.length > 0 && (
                    <optgroup label="Rejection reasons">
                      {rejectionStatuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherStatuses.length > 0 && (
                    <optgroup label="Other statuses">
                      {otherStatuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              ) : (
                statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="bulk-actions-controls">
            <button
              className="bulk-preview-button"
              onClick={handlePreview}
              disabled={previewing || submitting}
            >
              {previewing ? 'Previewing…' : 'Preview'}
            </button>

            {preview && (
              <button
                className="bulk-confirm-button"
                onClick={handleConfirm}
                disabled={submitting || preview.count === 0}
              >
                {submitting ? 'Applying…' : confirmLabel}
              </button>
            )}
          </div>

          {preview && (
            <div className="bulk-preview">
              <p className="bulk-preview-count">
                <strong>{preview.count}</strong> candidate{preview.count !== 1 ? 's' : ''} match
                {preview.count === 1 ? 'es' : ''} and will be {mode === 'reject' ? 'rejected' : 'moved'}.
              </p>
              {preview.sample.length > 0 && (
                <ul className="bulk-preview-sample">
                  {preview.sample.map((candidate) => (
                    <li key={candidate.id}>
                      <ApplicantLink id={candidate.id} name={candidate.name} />
                      <span className="bulk-preview-meta">
                        {candidate.score !== null ? ` — ${candidate.score}% match` : ' — no score'}
                      </span>
                    </li>
                  ))}
                  {preview.count > preview.sample.length && (
                    <li className="bulk-preview-more">
                      …and {preview.count - preview.sample.length} more
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
          </>
          )}

          {mode === 'duplicates' && (
            <div className="bulk-duplicates">
              {dupPreviewing ? (
                <p className="bulk-note">Scanning for duplicates…</p>
              ) : dupPreview ? (
                dupPreview.rejectCount === 0 ? (
                  <p className="bulk-preview-count">No duplicate applications to reject in this job.</p>
                ) : (
                  <>
                    <p className="bulk-preview-count">
                      <strong>{dupPreview.rejectCount}</strong> application
                      {dupPreview.rejectCount !== 1 ? 's' : ''} across{' '}
                      <strong>{dupPreview.groupCount}</strong> candidate
                      {dupPreview.groupCount !== 1 ? 's' : ''} will be rejected as Duplicate.
                    </p>
                    <ul className="bulk-dup-groups">
                      {dupPreview.groups.map((g) => (
                        <li key={g.email} className="bulk-dup-group">
                          <div className="bulk-dup-head">
                            <span className="bulk-dup-name">{g.name}</span>{' '}
                            <span className="bulk-preview-meta">({g.email})</span>
                            <span className="bulk-dup-reason"> — {g.reason}</span>
                          </div>
                          <div className="bulk-dup-detail">
                            {g.keep && (
                              <span className="bulk-dup-keep">
                                keep #{g.keep.id} ({g.keep.appliedDate.slice(0, 10)})
                              </span>
                            )}
                            {g.reject.map((r) => (
                              <span key={r.id} className="bulk-dup-reject">
                                reject #{r.id} ({r.appliedDate.slice(0, 10)})
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="bulk-actions-controls">
                      <button
                        className="bulk-confirm-button"
                        onClick={handleConfirmDuplicates}
                        disabled={dupSubmitting}
                      >
                        {dupSubmitting
                          ? 'Rejecting…'
                          : `Reject ${dupPreview.rejectCount} as Duplicate`}
                      </button>
                    </div>
                  </>
                )
              ) : null}
            </div>
          )}

          {mode === 'push' && (
            <div className="bulk-push">
              <p className="bulk-note">
                Review the changes below
                {selectedJobId !== undefined ? ' for this job' : ' across all jobs'}. Nothing is sent
                until you tick the box and press Send. You can also roll changes back here, which puts
                applicants back to the stage BambooHR has, or close this window to leave them
                waiting. Hiring Helper never emails candidates.
              </p>
              {pushPreviewing ? (
                <p className="bulk-note">Loading pending changes…</p>
              ) : pushPreview ? (
                pushPreview.count === 0 ? (
                  <p className="bulk-preview-count">
                    No changes are waiting to be sent to BambooHR
                    {selectedJobId !== undefined ? ' for this job' : ''}.
                  </p>
                ) : (
                  <>
                    <p className="bulk-preview-count">
                      <strong>{pushPreview.count}</strong> status change
                      {pushPreview.count !== 1 ? 's' : ''} will be sent to BambooHR.
                    </p>
                    <ul className="bulk-dup-groups">
                      {pushPreview.pending.map((item) => (
                        <li key={item.id} className="bulk-dup-group">
                          <span className="bulk-dup-name">
                            <ApplicantLink id={item.id} name={item.name} />
                          </span>{' '}
                          <span className="bulk-push-transition">
                            {item.fromLabel} <Icon name="arrowRight" /> {item.toLabel}
                          </span>
                          <button
                            type="button"
                            className="bulk-rollback-button"
                            onClick={() => void handleDiscard([item.id])}
                            disabled={isDiscarding || pushSubmitting}
                            title={`Put ${item.name} back to "${item.fromLabel}" instead of sending this change`}
                          >
                            <Icon name="undo" /> Roll back
                          </button>
                        </li>
                      ))}
                    </ul>
                    <label className="bulk-confirm-check">
                      <input
                        type="checkbox"
                        checked={hasConfirmedPush}
                        onChange={(event) => setHasConfirmedPush(event.target.checked)}
                      />
                      <span>
                        I understand this changes the live applicants in my BambooHR account.
                      </span>
                    </label>
                    <div className="bulk-actions-controls">
                      <button
                        className="bulk-confirm-button"
                        onClick={handleConfirmPush}
                        disabled={pushSubmitting || isDiscarding || !hasConfirmedPush}
                      >
                        {pushSubmitting
                          ? 'Sending…'
                          : `Send ${pushPreview.count} change${pushPreview.count !== 1 ? 's' : ''} to BambooHR`}
                      </button>
                      {isConfirmingDiscardAll ? (
                        <span className="bulk-discard-confirm">
                          Put all {pushPreview.count} back as BambooHR has them?
                          <button
                            type="button"
                            className="bulk-rollback-confirm"
                            onClick={() => void handleDiscard()}
                            disabled={isDiscarding}
                          >
                            {isDiscarding ? 'Rolling back…' : 'Yes, roll back all'}
                          </button>
                          <button
                            type="button"
                            className="bulk-rollback-cancel"
                            onClick={() => setIsConfirmingDiscardAll(false)}
                            disabled={isDiscarding}
                          >
                            Keep them
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="bulk-rollback-all"
                          onClick={() => setIsConfirmingDiscardAll(true)}
                          disabled={pushSubmitting || isDiscarding}
                          title="Throw away these local changes instead of sending them"
                        >
                          <Icon name="undo" /> Roll back all
                        </button>
                      )}
                    </div>
                  </>
                )
              ) : null}

              {pushResult && pushResult.failed > 0 && (
                <ul className="bulk-preview-sample">
                  {pushResult.results
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <li key={r.id}>
                        #{r.id} <Icon name="arrowRight" /> {r.toLabel}
                        <span className="bulk-preview-meta"> — failed: {r.error}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}

          {errorMessage && (
            <div className="bulk-message error">
              <Icon name="xCircle" />
              <span>{errorMessage}</span>
            </div>
          )}
          {message && (
            <div className="bulk-message success">
              <Icon name="checkCircle" />
              <span>{message}</span>
            </div>
          )}
        </div>
        </Modal>
      )}

      {(undoable || undoNotice) && (
        <div className="action-panel bulk-undo-banner" role="status">
          <Icon name={undoable ? 'checkCircle' : 'info'} />
          <span>{undoable ? undoable.text : undoNotice}</span>
          {undoable && (
            <>
              <button
                type="button"
                className="bulk-undo-button"
                onClick={() => void handleUndo()}
                disabled={isUndoing}
              >
                <Icon name="undo" /> {isUndoing ? 'Undoing…' : 'Undo'}
              </button>
              <button
                type="button"
                className="bulk-undo-dismiss"
                onClick={() => setUndoable(null)}
                aria-label="Dismiss"
              >
                <Icon name="close" />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
