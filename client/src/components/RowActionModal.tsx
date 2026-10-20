/**
 * RowActionModal
 *
 * Window for moving one applicant to another stage, or rejecting them with a
 * reason, opened from the row's "⋮" menu. Both are local changes; they reach
 * BambooHR only when sent with "Send to BambooHR".
 */

import { useMemo, useState } from 'react';
import { apiService } from '../services/api.service';
import type { Status } from '../types/applicant.types';
import { getGroupForLabel, groupStatuses } from '../utils/statusGroups';
import { Modal } from './Modal';
import { Icon } from './icons/Icon';
import './RowActionModal.css';

const DEFAULT_REJECTION_LABEL = 'Not a Fit';

interface RowActionModalProps {
  mode: 'move' | 'reject';
  applicantId: number;
  applicantName: string;
  currentStage: string;
  statuses: Status[];
  /** Called after the change is saved, with the new stage's label. */
  onDone: (newStageLabel: string) => void | Promise<void>;
  onClose: () => void;
}

export function RowActionModal({
  mode,
  applicantId,
  applicantName,
  currentStage,
  statuses,
  onDone,
  onClose,
}: RowActionModalProps): JSX.Element {
  const choices = useMemo(() => {
    const active = statuses.filter((status) => status.active && status.label !== currentStage);
    return mode === 'reject'
      ? active.filter((status) => getGroupForLabel(status.label) === 'Rejected')
      : active;
  }, [statuses, currentStage, mode]);

  const initialChoice =
    mode === 'reject'
      ? (choices.find((status) => status.label === DEFAULT_REJECTION_LABEL) ?? choices[0])
      : undefined;

  const [selectedId, setSelectedId] = useState<number | ''>(initialChoice?.id ?? '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const isReject = mode === 'reject';

  const handleConfirm = async (): Promise<void> => {
    if (selectedId === '') return;
    try {
      setIsSaving(true);
      setErrorMessage('');
      const result = await apiService.moveApplicantStage(applicantId, selectedId);
      await onDone(result.statusLabel);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not save the change.');
      setIsSaving(false);
    }
  };

  return (
    <Modal title={isReject ? `Reject ${applicantName}` : `Move ${applicantName}`} onClose={onClose}>
      <div className="row-action-modal">
        <p className="row-action-current">
          Current stage: <strong>{currentStage}</strong>
        </p>

        <label htmlFor="row-action-select" className="row-action-label">
          {isReject ? 'Reason for rejecting' : 'Move to stage'}
        </label>
        <select
          id="row-action-select"
          className="row-action-select"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value === '' ? '' : Number(event.target.value))}
        >
          <option value="">{isReject ? 'Choose a reason…' : 'Choose a stage…'}</option>
          {isReject
            ? choices.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))
            : groupStatuses(choices).map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.statuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </optgroup>
              ))}
        </select>

        <p className="row-action-note">
          This changes the stage here only. Use <strong>Send to BambooHR</strong> when you want
          BambooHR updated. Hiring Helper never emails candidates.
        </p>

        {errorMessage && (
          <div className="row-action-error" role="alert">
            <Icon name="xCircle" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="row-action-buttons">
          <button
            type="button"
            className={`row-action-confirm${isReject ? ' is-danger' : ''}`}
            onClick={() => void handleConfirm()}
            disabled={isSaving || selectedId === ''}
          >
            {isSaving ? 'Saving…' : isReject ? 'Reject applicant' : 'Move applicant'}
          </button>
          <button type="button" className="row-action-cancel" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
