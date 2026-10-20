/**
 * Sync Routes
 * Endpoints for syncing data from BambooHR
 */

import { Router } from 'express';
import { SyncController } from '../controllers/sync.controller.js';

const router = Router();
const controller = new SyncController();

/**
 * POST /api/sync
 * Manually trigger a sync from BambooHR
 */
router.post('/', (req, res) => controller.syncApplications(req, res));

/**
 * GET /api/sync/history
 * Get sync history
 */
router.get('/history', (req, res) => controller.getSyncHistory(req, res));

/**
 * GET /api/sync/status
 * Get last sync status
 */
router.get('/status', (req, res) => controller.getSyncStatus(req, res));

export default router;

