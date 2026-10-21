/**
 * Update API Routes
 */

import { Router } from 'express';
import { UpdateController } from '../controllers/update.controller.js';
import { requireBrowserOrigin } from '../middleware/local-only.middleware.js';

const router = Router();
const controller = new UpdateController();

router.get('/status', (req, res) => controller.getStatus(req, res));
// Runs git, npm and a restart: only ever as the result of a person's click on the page.
router.post('/apply', requireBrowserOrigin, (req, res) => controller.apply(req, res));

export default router;
