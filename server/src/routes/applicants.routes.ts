/**
 * Applicants API Routes
 */

import { Router } from 'express';
import { ApplicantsController } from '../controllers/applicants.controller.js';

const router = Router();
const controller = new ApplicantsController();

// GET /api/applicants - List all applicants with optional filters
router.get('/', (req, res) => controller.getApplicants(req, res));

// GET /api/applicants/statuses - Get all available statuses (must be before /:id route)
router.get('/statuses', (req, res) => controller.getStatuses(req, res));

// Bulk actions (job-scoped). Registered before /:id so they aren't captured by
// the parameterized route. bulk-preview is read-only; reject/move mutate.
router.post('/bulk-preview', (req, res) => controller.bulkPreview(req, res));
router.post('/bulk-reject', (req, res) => controller.bulkReject(req, res));
router.post('/bulk-move', (req, res) => controller.bulkMove(req, res));
router.post('/bulk-restore', (req, res) => controller.bulkRestore(req, res));

// Duplicate cleanup (job-scoped): preview then reject older copies as "Duplicate"
router.post('/duplicates/preview', (req, res) => controller.duplicatesPreview(req, res));
router.post('/duplicates/cleanup', (req, res) => controller.duplicatesCleanup(req, res));

// Push local status changes back to BambooHR (status only — never emails).
// preview is GET (read-only, skips the rate limiter); push is the mutating POST.
// Registered before /:id so they aren't captured by the parameterized route.
router.get('/push/preview', (req, res) => controller.pushPreview(req, res));
router.post('/push/discard', (req, res) => controller.discardPendingPush(req, res));
router.post('/push', (req, res) => controller.pushToBambooHR(req, res));

// GET /api/applicants/:id - Get single applicant details
router.get('/:id', (req, res) => controller.getApplicant(req, res));

// GET /api/applicants/:id/resume - Get applicant resume as JSON
router.get('/:id/resume', (req, res) => controller.getApplicantResume(req, res));

// GET /api/applicants/:id/resume/file - Stream the raw résumé PDF
router.get('/:id/resume/file', (req, res) => controller.getApplicantResumeFile(req, res));

// PATCH /api/applicants/:id/status - Move a single applicant to a hiring stage (local)
router.patch('/:id/status', (req, res) => controller.moveApplicantStage(req, res));

export default router;

