/**
 * Transfer Controller
 * Export and import of job settings and applicant scores (see transfer/).
 */

import type { Request, Response } from 'express';
import { respondWithError } from '../errors/respond-with-error.js';
import { parseTransferBundle, type TransferBundle } from '../transfer/transfer-format.js';
import { TransferExportService } from '../transfer/transfer-export.service.js';
import { TransferImportService } from '../transfer/transfer-import.service.js';
import type { ImportDecisions } from '../transfer/transfer-plan.js';

const exportService = new TransferExportService();
const importService = new TransferImportService();

function isIntegerList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => Number.isInteger(entry));
}

/** Read the decisions from an untrusted body; missing lists mean "keep everything I have". */
function parseDecisions(value: unknown): ImportDecisions | null {
  const { replaceSettingsJobIds = [], replaceScoreApplicationIds = [] } =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  if (!isIntegerList(replaceSettingsJobIds) || !isIntegerList(replaceScoreApplicationIds)) {
    return null;
  }
  return { replaceSettingsJobIds, replaceScoreApplicationIds };
}

function sendInvalidFile(res: Response, message: string): void {
  res.status(400).json({ error: 'Invalid file', message });
}

export class TransferController {
  /**
   * GET /api/transfer/export
   * Every job's settings and every scored applicant's score, report and flags, as a download.
   */
  async exportBundle(_req: Request, res: Response): Promise<void> {
    try {
      const bundle = await exportService.buildBundle();
      const day = bundle.exportedAt.slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="hiring-helper-export-${day}.json"`);
      res.json(bundle);
    } catch (error) {
      console.error('Failed to export:', error);
      respondWithError(res, error, 'Failed to export job settings and scores');
    }
  }

  /**
   * POST /api/transfer/import/preview  <the export file>
   * What importing would fill and what would conflict. Changes nothing.
   */
  async previewImport(req: Request, res: Response): Promise<void> {
    try {
      const parsed = parseTransferBundle(req.body);
      if (!parsed.ok) {
        sendInvalidFile(res, parsed.error);
        return;
      }
      res.json({ data: await importService.preview(parsed.bundle) });
    } catch (error) {
      console.error('Failed to preview import:', error);
      respondWithError(res, error, 'Failed to read the export file');
    }
  }

  /**
   * POST /api/transfer/import/apply  { bundle, decisions }
   * Fill what is missing, and replace the conflicts the person chose to replace.
   */
  async applyImport(
    req: Request<unknown, unknown, { bundle?: unknown; decisions?: unknown }>,
    res: Response
  ): Promise<void> {
    try {
      const parsed = parseTransferBundle(req.body?.bundle);
      if (!parsed.ok) {
        sendInvalidFile(res, parsed.error);
        return;
      }
      const decisions = parseDecisions(req.body?.decisions);
      if (!decisions) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'decisions must list job ids and application ids as whole numbers',
        });
        return;
      }
      const bundle: TransferBundle = parsed.bundle;
      res.json({ data: await importService.apply(bundle, decisions) });
    } catch (error) {
      console.error('Failed to import:', error);
      respondWithError(res, error, 'Failed to import job settings and scores');
    }
  }
}
