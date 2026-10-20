/**
 * Jobs API Routes
 */

import { Router } from 'express';
import { JobsController } from '../controllers/jobs.controller.js';

const router = Router();
const controller = new JobsController();

// GET /api/jobs - List jobs with counts, most recent first
router.get('/', (req, res) => controller.getJobs(req, res));

// GET /api/jobs/:id - A job's editable scoring config (description + system prompt)
router.get('/:id', (req, res) => controller.getJobDetail(req, res));

// PATCH /api/jobs/:id - Update a job's description / posting URL / system prompt (local)
router.patch('/:id', (req, res) => controller.updateJob(req, res));

// POST /api/jobs/:id/import-posting - fetch the public posting text for review (not saved)
router.post('/:id/import-posting', (req, res) => controller.importPosting(req, res));

// POST /api/jobs/:id/criteria/questions - tailored survey for generating criteria (Claude)
router.post('/:id/criteria/questions', (req, res) => controller.suggestCriteriaQuestions(req, res));

// POST /api/jobs/:id/criteria/suggest - draft criteria, from the posting alone or with survey answers (Claude)
router.post('/:id/criteria/suggest', (req, res) => controller.suggestCriteria(req, res));

export default router;
