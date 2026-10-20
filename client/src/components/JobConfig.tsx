/**
 * JobConfig
 *
 * Per-job scoring configuration editor (shown inside a modal): the job posting
 * and the scoring criteria (system prompt), each on its own tab to avoid long
 * scrolling; one Save covers both. The system prompt is pre-filled with the effective
 * value — the per-job override if set, otherwise the global default — so it can
 * be tailored per role. Saving a blank system prompt reverts to the global
 * rubric. All changes are local (no BambooHR writes).
 */

import { useState, useEffect, useCallback } from 'react';
import { apiService } from '../services/api.service';
import { Icon } from './icons/Icon';
import { Skeleton } from './Skeleton';
import { ScoringCriteriaEditor } from './ScoringCriteriaEditor';
import { CriteriaGenerator } from './CriteriaGenerator';
import { areConfigsEqual, findScoringConfigProblems } from '../utils/scoringConfig';
import type { JobDetail, ScoringConfig, ScoringDimension } from '../types/applicant.types';
import './JobConfig.css';

type JobConfigTab = 'posting' | 'criteria';

interface JobConfigProps {
  jobId: number;
  /** Called after anything is saved or confirmed, so the list can refresh its setup state. */
  onSaved?: () => void;
}

export function JobConfig({ jobId, onSaved }: JobConfigProps): JSX.Element {
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [description, setDescription] = useState<string>('');
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isConfirmingReplace, setIsConfirmingReplace] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<JobConfigTab>('posting');
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  // The areas that were in the editor before a suggestion was applied, so it can be undone.
  const [dimensionsBeforeSuggestion, setDimensionsBeforeSuggestion] = useState<ScoringDimension[] | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      const data = await apiService.getJobDetail(jobId);
      setDetail(data);
      setDescription(data.description);
      setScoringConfig(data.scoringConfig);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to load job config.');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  // Criteria are only sent when they were changed, so editing just the posting
  // never turns a job's default criteria into a saved copy.
  const isCriteriaEdited =
    detail !== null && scoringConfig !== null && !areConfigsEqual(scoringConfig, detail.scoringConfig);

  const handleSave = useCallback(async (): Promise<void> => {
    setErrorMessage('');
    setMessage('');
    if (isCriteriaEdited && scoringConfig) {
      const problems = findScoringConfigProblems(scoringConfig);
      if (problems.length > 0) {
        setActiveTab('criteria');
        setErrorMessage(problems[0]);
        return;
      }
    }
    try {
      setSaving(true);
      const updated = await apiService.updateJob(jobId, {
        description,
        ...(isCriteriaEdited && scoringConfig ? { scoringConfig } : {}),
      });
      setDetail(updated);
      setScoringConfig(updated.scoringConfig);
      setDimensionsBeforeSuggestion(null);
      setMessage('Saved.');
      onSaved?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [jobId, description, scoringConfig, isCriteriaEdited, onSaved]);

  // Fetch the public posting text from BambooHR into the editor. Nothing is
  // saved until the user presses Save, so they can review it first.
  const handleImport = useCallback(async (): Promise<void> => {
    if (description.trim() !== '' && !isConfirmingReplace) {
      setIsConfirmingReplace(true);
      return;
    }
    try {
      setIsImporting(true);
      setIsConfirmingReplace(false);
      setErrorMessage('');
      setMessage('');
      setDescription(await apiService.importJobPosting(jobId));
      setMessage('Loaded the posting from BambooHR. Review it, then press Save to keep it.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not load the posting.');
    } finally {
      setIsImporting(false);
    }
  }, [jobId, description, isConfirmingReplace]);

  // Accept the criteria as they are (saving any edits too), which is what allows
  // scoring for a new job.
  const handleConfirmCriteria = useCallback(async (): Promise<void> => {
    setErrorMessage('');
    setMessage('');
    if (isCriteriaEdited && scoringConfig) {
      const problems = findScoringConfigProblems(scoringConfig);
      if (problems.length > 0) {
        setErrorMessage(problems[0]);
        return;
      }
    }
    try {
      setIsConfirming(true);
      const updated = await apiService.updateJob(jobId, {
        criteriaConfirmed: true,
        ...(isCriteriaEdited && scoringConfig ? { scoringConfig } : {}),
      });
      setDetail(updated);
      setScoringConfig(updated.scoringConfig);
      setDimensionsBeforeSuggestion(null);
      setMessage('Criteria confirmed.');
      onSaved?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not confirm the criteria.');
    } finally {
      setIsConfirming(false);
    }
  }, [jobId, scoringConfig, isCriteriaEdited, onSaved]);

  // A generated suggestion fills the editor but is not saved; keep what was there
  // so "Undo" can bring it back.
  const handleApplySuggestion = useCallback(
    (dimensions: ScoringDimension[]): void => {
      setScoringConfig((current) => {
        if (current) setDimensionsBeforeSuggestion(current.dimensions);
        return current ? { ...current, dimensions } : current;
      });
      setMessage('Suggestion applied below. Review it, then press Save to keep it.');
      setErrorMessage('');
    },
    []
  );

  const handleUndoSuggestion = useCallback((): void => {
    setScoringConfig((current) =>
      current && dimensionsBeforeSuggestion ? { ...current, dimensions: dimensionsBeforeSuggestion } : current
    );
    setDimensionsBeforeSuggestion(null);
    setMessage('Suggestion undone.');
  }, [dimensionsBeforeSuggestion]);

  // Put the job back on the default scoring criteria (also replaces a hand-written
  // legacy prompt), then reload to show what is now in effect.
  const handleResetCriteria = useCallback(async (): Promise<void> => {
    try {
      setSaving(true);
      setErrorMessage('');
      setMessage('');
      await apiService.updateJob(jobId, { resetScoringConfig: true });
      const data = await apiService.getJobDetail(jobId);
      setDetail(data);
      setScoringConfig(data.scoringConfig);
      setDimensionsBeforeSuggestion(null);
      setMessage('Reverted to the default scoring criteria.');
      onSaved?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Reset failed.');
    } finally {
      setSaving(false);
    }
  }, [jobId, onSaved]);

  // Unsaved-edit markers on the tabs, so a change on the other tab is not forgotten.
  const isPostingEdited = detail !== null && description !== detail.description;

  // The criteria are written against the job posting (and AI suggestions read it),
  // so they open only once a posting has been saved.
  const isCriteriaLocked = detail !== null && !detail.hasPosting;

  const tabs: Array<{ id: JobConfigTab; label: string; isEdited: boolean; isLocked: boolean }> = [
    { id: 'posting', label: 'Job posting', isEdited: isPostingEdited, isLocked: false },
    { id: 'criteria', label: 'Scoring criteria', isEdited: isCriteriaEdited, isLocked: isCriteriaLocked },
  ];

  const selectTab = (tab: JobConfigTab): void => {
    if (tab === 'criteria' && isCriteriaLocked) return;
    setActiveTab(tab);
  };

  // A posting that gets removed and saved locks the criteria again.
  useEffect(() => {
    if (isCriteriaLocked && activeTab === 'criteria') setActiveTab('posting');
  }, [isCriteriaLocked, activeTab]);

  const handleTabKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    selectTab(activeTab === 'posting' ? 'criteria' : 'posting');
  };

  // The guided criteria editor is on screen (not the hand-written-prompt notice).
  const isCriteriaEditorShown =
    activeTab === 'criteria' && !detail?.isLegacyPromptActive && scoringConfig !== null;

  return (
    <div className="job-config">
      {loading ? (
        <div role="status" aria-busy="true" aria-label="Loading job settings">
          <div className="job-config-tabs">
            <Skeleton width={120} height="2.4rem" />
            <Skeleton width={150} height="2.4rem" />
          </div>
          <div className="job-config-skeleton-body">
            <Skeleton width={150} height="1rem" />
            <Skeleton width="70%" height="0.9rem" />
            <Skeleton height="16rem" />
          </div>
        </div>
      ) : (
        <>
          {detail && !detail.isReadyToScore && (
            <div className="job-config-setup" role="status">
              <strong>Finish setting up this job to turn on scoring.</strong>
              <ul>
                <li className={detail.hasPosting ? 'is-done' : 'is-todo'}>
                  <Icon name={detail.hasPosting ? 'checkCircle' : 'alertTriangle'} />
                  {detail.hasPosting ? (
                    'Job posting is loaded'
                  ) : (
                    <>
                      Job posting is missing.{' '}
                      <button type="button" className="job-config-setup-link" onClick={() => setActiveTab('posting')}>
                        Load or paste it
                      </button>
                    </>
                  )}
                </li>
                <li className={detail.isCriteriaConfirmed ? 'is-done' : 'is-todo'}>
                  <Icon name={detail.isCriteriaConfirmed ? 'checkCircle' : 'alertTriangle'} />
                  {detail.isCriteriaConfirmed ? (
                    'Scoring criteria are confirmed'
                  ) : (
                    <>
                      Scoring criteria are not confirmed yet.{' '}
                      {isCriteriaLocked ? (
                        'Add the job posting first.'
                      ) : (
                        <button type="button" className="job-config-setup-link" onClick={() => setActiveTab('criteria')}>
                          Review them
                        </button>
                      )}
                    </>
                  )}
                </li>
              </ul>
            </div>
          )}

          <div className="job-config-tabs" role="tablist" aria-label="Job settings" onKeyDown={handleTabKeyDown}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`job-config-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`job-config-panel-${tab.id}`}
                aria-disabled={tab.isLocked || undefined}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={`job-config-tab${activeTab === tab.id ? ' is-active' : ''}${tab.isLocked ? ' is-locked' : ''}`}
                title={tab.isLocked ? 'Add and save the job posting first. The criteria are based on it.' : undefined}
                onClick={() => selectTab(tab.id)}
              >
                {tab.isLocked && <Icon name="lock" size={14} />}
                {tab.label}
                {tab.isLocked && <span className="job-config-tab-lock-note">Add the job posting first</span>}
                {tab.isEdited && <span className="job-config-tab-edited">Unsaved</span>}
              </button>
            ))}
          </div>

          {activeTab === 'posting' && (
            <div
              role="tabpanel"
              id="job-config-panel-posting"
              aria-labelledby="job-config-tab-posting"
              className="job-config-panel"
            >
              <label className="job-config-label" htmlFor="job-description">
                Job posting text
              </label>
              <p className="job-config-hint">
                Hiring Helper compares each résumé against this. New jobs get it filled in from BambooHR
                automatically; you can edit it freely.
              </p>
              <div className="job-config-import">
                <button
                  type="button"
                  className="job-config-import-button"
                  onClick={() => void handleImport()}
                  disabled={isImporting || saving}
                >
                  {isImporting
                    ? 'Loading…'
                    : isConfirmingReplace
                      ? 'Replace the text below with the BambooHR posting?'
                      : 'Load posting from BambooHR'}
                </button>
                {isConfirmingReplace && (
                  <button
                    type="button"
                    className="job-config-import-cancel"
                    onClick={() => setIsConfirmingReplace(false)}
                  >
                    Keep my text
                  </button>
                )}
              </div>
              <textarea
                id="job-description"
                className="job-config-textarea"
                rows={16}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Paste the job posting text…"
              />
            </div>
          )}

          {activeTab === 'criteria' && (
            <div
              role="tabpanel"
              id="job-config-panel-criteria"
              aria-labelledby="job-config-tab-criteria"
              className="job-config-panel"
            >
              {detail?.isLegacyPromptActive ? (
                <div className="job-config-legacy">
                  <p>
                    <strong>This job still uses a scoring prompt that was written by hand.</strong>{' '}
                    The guided editor cannot show it. Switching replaces it with the default
                    criteria, which you can then adjust.
                  </p>
                  <button
                    type="button"
                    className="job-config-import-button"
                    onClick={() => void handleResetCriteria()}
                    disabled={saving}
                  >
                    Switch to guided criteria
                  </button>
                </div>
              ) : (
                scoringConfig && (
                  <>
                    <div className="job-config-prompt-header">
                      <span className="job-config-label">How applicants are scored</span>
                      <span
                        className={`job-config-badge ${detail?.scoringConfigIsCustom ? 'custom' : 'default'}`}
                      >
                        {detail?.scoringConfigIsCustom ? 'Customized for this job' : 'Using the defaults'}
                      </span>
                    </div>
                    {detail && !detail.isCriteriaConfirmed && (
                      <div className="job-config-confirm">
                        <p>
                          <strong>These criteria are not confirmed yet.</strong> Check them (or get a
                          suggestion below), then press <strong>Confirm criteria</strong> at the bottom
                          to allow scoring.
                        </p>
                      </div>
                    )}
                    <ScoringCriteriaEditor
                      value={scoringConfig}
                      onChange={setScoringConfig}
                      isDisabled={saving}
                      frameworkTopContent={
                        <>
                          <CriteriaGenerator
                            jobId={jobId}
                            hasPosting={detail?.hasPosting ?? false}
                            onApply={handleApplySuggestion}
                          />
                          {dimensionsBeforeSuggestion && (
                            <p className="job-config-undo">
                              A suggestion is filled in below and not saved yet.{' '}
                              <button
                                type="button"
                                className="job-config-setup-link"
                                onClick={handleUndoSuggestion}
                              >
                                Undo
                              </button>
                            </p>
                          )}
                        </>
                      }
                    />
                  </>
                )
              )}
            </div>
          )}

          {/* Stays visible at the bottom of the scrolling modal. */}
          <div className="job-config-footer">
            {errorMessage && (
              <div className="job-config-message error">
                <Icon name="xCircle" />
                <span>{errorMessage}</span>
              </div>
            )}
            {message && (
              <div className="job-config-message success">
                <Icon name="checkCircle" />
                <span>{message}</span>
              </div>
            )}
            <div className="job-config-controls">
              <button className="job-config-save" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <span className="job-config-save-hint">Saves both tabs.</span>
              <span className="job-config-footer-spacer" />
              {isCriteriaEditorShown && detail?.scoringConfigIsCustom && (
                <button
                  type="button"
                  className="job-config-reset"
                  onClick={() => void handleResetCriteria()}
                  disabled={saving}
                >
                  Reset criteria to the defaults
                </button>
              )}
              {isCriteriaEditorShown && detail && !detail.isCriteriaConfirmed && (
                <button
                  type="button"
                  className="job-config-confirm-button"
                  onClick={() => void handleConfirmCriteria()}
                  disabled={isConfirming || saving}
                >
                  {isConfirming ? 'Confirming…' : 'Confirm criteria'}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
