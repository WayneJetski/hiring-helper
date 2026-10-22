/**
 * Transfer API Routes: share job settings and applicant scores between people.
 */

import { Router } from 'express';
import { TransferController } from '../controllers/transfer.controller.js';
import { requireBrowserOrigin } from '../middleware/local-only.middleware.js';

const router = Router();
const controller = new TransferController();

// GET /api/transfer/export - download every job's settings and scores as JSON
router.get('/export', (req, res) => controller.exportBundle(req, res));

// POST /api/transfer/import/preview - what an export file would fill or conflict with (changes nothing)
router.post('/import/preview', requireBrowserOrigin, (req, res) => controller.previewImport(req, res));

// POST /api/transfer/import/apply - write the file's data, replacing conflicts only as chosen
router.post('/import/apply', requireBrowserOrigin, (req, res) => controller.applyImport(req, res));

export default router;
