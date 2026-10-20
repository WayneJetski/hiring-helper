/**
 * Scoring API Routes
 */

import { Router } from 'express';
import { ScoringController } from '../controllers/scoring.controller.js';

const router = Router();
const controller = new ScoringController();

// POST /api/score - start scoring a job's unscored candidates (headless Claude Code)
router.post('/', (req, res) => controller.startScoring(req, res));

// Re-score every candidate matching the active filter (preview count, then run)
router.post('/rescore/preview', (req, res) => controller.rescorePreview(req, res));
router.post('/rescore', (req, res) => controller.rescore(req, res));

// POST /api/score/cancel - stop the running scoring run
router.post('/cancel', (req, res) => controller.cancelScoring(req, res));

// GET /api/score/status - current/last scoring-run status
router.get('/status', (req, res) => controller.getScoringStatus(req, res));

export default router;
