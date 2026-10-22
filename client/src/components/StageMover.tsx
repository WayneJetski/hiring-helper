/**
 * StageMover
 *
 * Moves one applicant to another hiring stage (a local change; it reaches
 * BambooHR only when sent via "Send to BambooHR"). Used on the detail page and
 * inside the résumé viewer. Optionally offers a one-click "Not a Fit" shortcut
 * so a pile of résumés can be screened quickly.
 */

import { useState } from 'react';
import { apiService } from '../services/api.service';
import type { Status } from '../types/applicant.types';
import { groupStatuses } from '../utils/statusGroups';
import { StatusIcon, type Notice } from './icons/StatusIcon';

const NOT_A_FIT_LABEL = 'Not a Fit';

interface StageMoverProps {
  applicantId: number;
  statuses: Status[];
  /** Called after a successful move with the new stage label. */
  onMoved: (stageLabel: string) => void | Promise<void>;
  /** Show the one-click "Not a Fit" button next to the dropdown. */
  hasRejectShortcut?: boolean;
  /** `onDark` restyles it for the applicant page's dark header band. */
  variant?: 'default' | 'onDark';
  /** When set, moving is not allowed (a closed job); shown as the reason on hover. */
  disabledReason?: string;
}

export function StageMover({
  applicantId,
  statuses,
  onMoved,
  hasRejectShortcut = false,
  variant = 'default',
  disabledReason,
}: StageMoverProps): JSX.Element {
  const [selectedStatusId, setSelectedStatusId] = useState<number | ''>('');
  const [isMoving, setIsMoving] = useState<boolean>(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const isLocked = disabledReason !== undefined;
  const notAFitStatus = statuses.find((status) => status.label === NOT_A_FIT_LABEL);

  const move = async (statusId: number): Promise<void> => {
    try {
      setIsMoving(true);
      setNotice(null);
      const result = await apiService.moveApplicantStage(applicantId, statusId);
      setNotice({ tone: 'success', text: `Moved to "${result.statusLabel}"` });
      setSelectedStatusId('');
      await onMoved(result.statusLabel);
    } catch (err) {
      setNotice({ tone: 'error', text: err instanceof Error ? err.message : 'Move failed' });
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div
      className={`stage-move${variant === 'onDark' ? ' stage-move--on-dark' : ''}`}
      data-help="stage"
      title={disabledReason}
    >
      <label className="stage-move-label" htmlFor={`stage-move-${applicantId}`}>
        Move to stage:
      </label>
      <select
        id={`stage-move-${applicantId}`}
        className="stage-move-select"
        disabled={isLocked}
        value={selectedStatusId}
        onChange={(e) => setSelectedStatusId(e.target.value === '' ? '' : Number(e.target.value))}
      >
        <option value="">Select a stage…</option>
        {groupStatuses(statuses).map((group) => (
          <optgroup key={group.name} label={group.name}>
            {group.statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        className="stage-move-button"
        onClick={() => selectedStatusId !== '' && void move(selectedStatusId)}
        disabled={isLocked || isMoving || selectedStatusId === ''}
      >
        {isMoving ? 'Moving…' : 'Move'}
      </button>
      {hasRejectShortcut && notAFitStatus && (
        <button
          className="stage-move-reject"
          onClick={() => void move(notAFitStatus.id)}
          disabled={isLocked || isMoving}
          title={`Move straight to "${NOT_A_FIT_LABEL}"`}
        >
          {NOT_A_FIT_LABEL}
        </button>
      )}
      {notice && (
        <span className={`stage-move-message ${notice.tone}`} role="status">
          <StatusIcon tone={notice.tone} />
          {notice.text}
        </span>
      )}
    </div>
  );
}
