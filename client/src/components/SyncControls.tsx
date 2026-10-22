/**
 * The "Sync with BambooHR" button with its last-synced status, shared by the jobs
 * page and a job's applicant list.
 */

import { Icon } from './icons/Icon';
import { SyncStatus } from './SyncStatus';

interface SyncControlsProps {
  isSyncing: boolean;
  onSync: () => void;
  /** Bumped whenever data may have changed, so the status re-checks. */
  dataVersion: number;
}

export function SyncControls({ isSyncing, onSync, dataVersion }: SyncControlsProps): JSX.Element {
  return (
    <div className="header-sync">
      <button
        onClick={onSync}
        disabled={isSyncing}
        className="sync-button"
        data-help="sync"
        title="Bring in new applicants, new jobs and status changes from BambooHR"
      >
        <Icon name="refresh" isSpinning={isSyncing} /> {isSyncing ? 'Syncing…' : 'Sync with BambooHR'}
      </button>
      <SyncStatus dataVersion={dataVersion} />
    </div>
  );
}
