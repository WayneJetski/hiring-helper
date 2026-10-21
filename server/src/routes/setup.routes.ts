/**
 * Setup API Routes (first-run connection screen)
 */

import { Router } from 'express';
import { SetupController } from '../controllers/setup.controller.js';
import { requireBrowserOrigin } from '../middleware/local-only.middleware.js';

const router = Router();
const controller = new SetupController();

router.get('/status', (req, res) => controller.getStatus(req, res));
router.post('/claude/signin', requireBrowserOrigin, (req, res) => controller.startClaudeSignIn(req, res));
router.post('/claude/signin/cancel', (req, res) => controller.cancelClaudeSignIn(req, res));
router.get('/bamboohr/connection', (req, res) => controller.getSavedConnection(req, res));
router.post('/bamboohr/test', (req, res) => controller.testBambooHR(req, res));
// Saving the API key: from the page only.
router.post('/bamboohr', requireBrowserOrigin, (req, res) => controller.saveBambooHR(req, res));

export default router;
