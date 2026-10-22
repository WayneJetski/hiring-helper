/**
 * ImportPreviewModal
 *
 * Shows what importing a file would do before anything is written. Whatever is empty
 * here is filled without asking; only what already exists and differs is a choice, and
 * replacing it is the recommended default (the file is usually the more complete copy).
 */

import { useMemo, useState } from 'react';
import type { ImportDecisions, ImportPlan } from '../types/transfer.types';
import { buildDecisions, summarizeImportPlan } from '../utils/importPlanSummary';
import { Modal } from './Modal';
import './ImportPreviewModal.css';

const MAX_CONFLICTS_SHOWN = 50;

interface ImportPreviewModalProps {
  plan: ImportPlan;
  isApplying: boolean;
  errorMessage: string | null;
  onApply: (decisions: ImportDecisions) => void;
  onCancel: () => void;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

interface ChoiceProps {
  name: string;
  isReplacing: boolean;
  onChange: (isReplacing: boolean) => void;
  disabled: boolean;
}

function ReplaceChoice({ name, isReplacing, onChange, disabled }: ChoiceProps): JSX.Element {
  return (
    <div className="import-choice" role="radiogroup">
      <label>
        <input
          type="radio"
          name={name}
          checked={isReplacing}
          onChange={() => onChange(true)}
          disabled={disabled}
        />
        Replace mine with the file <span className="import-recommended">(Recommended)</span>
      </label>
      <label>
        <input
          type="radio"
          name={name}
          checked={!isReplacing}
          onChange={() => onChange(false)}
          disabled={disabled}
        />
        Keep mine
      </label>
    </div>
  );
}

export function ImportPreviewModal({
  plan,
  isApplying,
  errorMessage,
  onApply,
  onCancel,
}: ImportPreviewModalProps): JSX.Element {
  const summary = useMemo(() => summarizeImportPlan(plan), [plan]);
  const [replaceSettings, setReplaceSettings] = useState<boolean>(true);
  const [replaceScores, setReplaceScores] = useState<boolean>(true);

  const hasSettingsConflicts = summary.settingsConflicts.length > 0;
  const hasScoreConflicts = summary.scoreConflicts.length > 0;

  return (
    <Modal title="Import job settings and scores" onClose={isApplying ? () => undefined : onCancel}>
      <div className="import-preview">
        {summary.notSyncedJobTitles.length > 0 && (
          <p className="import-note">
            {plural(summary.notSyncedJobTitles.length, 'job')} in this file{' '}
            {summary.notSyncedJobTitles.length === 1 ? 'is' : 'are'} not in your app yet and will be
            skipped ({summary.notSyncedJobTitles.join(', ')}). Sync with BambooHR first to bring{' '}
            {summary.notSyncedJobTitles.length === 1 ? 'it' : 'them'} in.
          </p>
        )}

        {!summary.hasWork && (
          <p className="import-empty">
            There is nothing to import: everything in this file is already in your app
            {summary.scoresSameCount > 0 && ` (${plural(summary.scoresSameCount, 'score')} identical)`}.
          </p>
        )}

        {(summary.settingsToFillCount > 0 || summary.scoresToFillCount > 0) && (
          <section>
            <h3>Added automatically</h3>
            <ul>
              {summary.settingsToFillCount > 0 && (
                <li>Posting and criteria for {plural(summary.settingsToFillCount, 'job')} that have none yet</li>
              )}
              {summary.scoresToFillCount > 0 && (
                <li>{plural(summary.scoresToFillCount, 'applicant')} with no score yet</li>
              )}
            </ul>
          </section>
        )}

        {hasSettingsConflicts && (
          <section>
            <h3>
              Already set up here: {plural(summary.settingsConflicts.length, 'job')} with a different
              posting or criteria
            </h3>
            <p className="import-list">{summary.settingsConflicts.map((job) => job.title).join(', ')}</p>
            <ReplaceChoice
              name="replace-settings"
              isReplacing={replaceSettings}
              onChange={setReplaceSettings}
              disabled={isApplying}
            />
          </section>
        )}

        {hasScoreConflicts && (
          <section>
            <h3>
              Already scored here: {plural(summary.scoreConflicts.length, 'applicant')} with a different
              score or report
            </h3>
            <ul className="import-conflicts">
              {summary.scoreConflicts.slice(0, MAX_CONFLICTS_SHOWN).map((conflict) => (
                <li key={conflict.applicationId}>
                  <span>
                    {conflict.name || `Applicant ${conflict.applicationId}`}
                    <span className="import-conflict-job"> · {conflict.jobTitle}</span>
                  </span>
                  <span className="import-conflict-scores">
                    {conflict.currentScore}% here, {conflict.importedScore}% in file
                  </span>
                </li>
              ))}
              {summary.scoreConflicts.length > MAX_CONFLICTS_SHOWN && (
                <li className="import-more">
                  and {summary.scoreConflicts.length - MAX_CONFLICTS_SHOWN} more
                </li>
              )}
            </ul>
            <ReplaceChoice
              name="replace-scores"
              isReplacing={replaceScores}
              onChange={setReplaceScores}
              disabled={isApplying}
            />
          </section>
        )}

        {(summary.scoresSameCount > 0 || summary.applicantsNotFoundCount > 0) && summary.hasWork && (
          <p className="import-note">
            {summary.scoresSameCount > 0 && `${plural(summary.scoresSameCount, 'applicant')} already match and stay as they are. `}
            {summary.applicantsNotFoundCount > 0 &&
              `${plural(summary.applicantsNotFoundCount, 'applicant')} in the file ${summary.applicantsNotFoundCount === 1 ? 'is' : 'are'} not in your app and will be skipped.`}
          </p>
        )}

        {errorMessage && (
          <p className="import-error" role="alert">
            {errorMessage}
          </p>
        )}

        <div className="import-actions">
          <button type="button" className="import-cancel" onClick={onCancel} disabled={isApplying}>
            Cancel
          </button>
          <button
            type="button"
            className="import-confirm"
            onClick={() => onApply(buildDecisions(summary, { replaceSettings, replaceScores }))}
            disabled={isApplying || !summary.hasWork}
          >
            {isApplying ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
