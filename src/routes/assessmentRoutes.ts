import { Router } from 'express';
import {
  createAssessment,
  getAssessmentByApplication,
  submitAssessment,
  reviewAssessment,
} from '../controllers/assessmentController.js';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.post('/', requireAuth, createAssessment);
router.get('/application/:applicationId', requireAuth, getAssessmentByApplication);
router.post('/:id/submit', requireAuth, upload.single('attachment'), submitAssessment);
router.patch('/:id/review', requireAuth, reviewAssessment);

export default router;
