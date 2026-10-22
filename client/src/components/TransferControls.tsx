/**
 * TransferControls
 *
 * Export and Import buttons for sharing job settings and applicant scores with a
 * colleague on the same BambooHR account (so scoring is not paid for twice). Export
 * downloads a JSON file. Import reads one, shows what it would change, and only then
 * writes.
 */

import { useRef, useState, type ChangeEvent } from 'react';
import { apiService } from '../services/api.service';
import type { ImportDecisions, ImportPlan } from '../types/transfer.types';
import { describeImportResult } from '../utils/importPlanSummary';
import { exportFilename, readJsonFile, saveJsonFile } from '../utils/jsonFile';
import type { Notice } from './icons/StatusIcon';
import { Icon } from './icons/Icon';
import { ImportPreviewModal } from './ImportPreviewModal';
import './TransferControls.css';

interface TransferControlsProps {
  /** Called after an import wrote something, so counts on the page refresh. */
  onImported: () => void | Promise<void>;
  onNotice: (notice: Notice) => void;
}

interface PendingImport {
  bundle: unknown;
  plan: ImportPlan;
}

export function TransferControls({ onImported, onNotice }: TransferControlsProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isReading, setIsReading] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const handleExport = async (): Promise<void> => {
    try {
      setIsExporting(true);
      saveJsonFile(exportFilename(), await apiService.exportJobSettingsAndScores());
      onNotice({ tone: 'success', text: 'Exported job settings and scores.' });
    } catch (error) {
      onNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Export failed.' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileChosen = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change.
    event.target.value = '';
    if (!file) return;
    try {
      setIsReading(true);
      const bundle = await readJsonFile(file);
      const plan = await apiService.previewImport(bundle);
      setApplyError(null);
      setPendingImport({ bundle, plan });
    } catch (error) {
      onNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not read that file.' });
    } finally {
      setIsReading(false);
    }
  };

  const handleApply = async (decisions: ImportDecisions): Promise<void> => {
    if (!pendingImport) return;
    try {
      setIsApplying(true);
      setApplyError(null);
      const result = await apiService.applyImport(pendingImport.bundle, decisions);
      setPendingImport(null);
      onNotice({
        tone: result.scoresFailed > 0 ? 'warning' : 'success',
        text: describeImportResult(result),
      });
      await onImported();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : 'Import failed.');
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <>
      <div className="transfer-controls">
        <button
          type="button"
          className="transfer-button"
          onClick={() => void handleExport()}
          disabled={isExporting}
          title="Download every job's settings and every scored applicant's score and report as a JSON file"
        >
          <Icon name="download" /> {isExporting ? 'Exporting…' : 'Export settings & scores'}
        </button>
        <button
          type="button"
          className="transfer-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isReading}
          title="Load job settings and scores exported by someone else, so you do not have to score them again"
        >
          <Icon name="upload" /> {isReading ? 'Reading…' : 'Import settings & scores'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="transfer-file-input"
          onChange={(event) => void handleFileChosen(event)}
          aria-label="Choose an export file to import"
        />
      </div>

      {pendingImport && (
        <ImportPreviewModal
          plan={pendingImport.plan}
          isApplying={isApplying}
          errorMessage={applyError}
          onApply={(decisions) => void handleApply(decisions)}
          onCancel={() => setPendingImport(null)}
        />
      )}
    </>
  );
}
