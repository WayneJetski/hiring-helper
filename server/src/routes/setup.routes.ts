/**
 * Setup API Routes (first-run connection screen)
 */

import { Router } from 'express';
import { SetupController } from '../controllers/setup.controller.js';

const router = Router();
const controller = new SetupController();

router.get('/status', (req, res) => controller.getStatus(req, res));
router.post('/claude/signin', (req, res) => controller.startClaudeSignIn(req, res));
router.post('/claude/signin/cancel', (req, res) => controller.cancelClaudeSignIn(req, res));
router.get('/bamboohr/connection', (req, res) => controller.getSavedConnection(req, res));
router.post('/bamboohr/test', (req, res) => controller.testBambooHR(req, res));
router.post('/bamboohr', (req, res) => controller.saveBambooHR(req, res));

export default router;
