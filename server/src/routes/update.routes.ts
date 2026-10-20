/**
 * Update API Routes
 */

import { Router } from 'express';
import { UpdateController } from '../controllers/update.controller.js';

const router = Router();
const controller = new UpdateController();

router.get('/status', (req, res) => controller.getStatus(req, res));
router.post('/apply', (req, res) => controller.apply(req, res));

export default router;
