import { Router } from 'express';
import {
  applyToProject,
  getProjectApplications,
  getMyApplications,
  getApplicationById,
  updateApplicationStatus,
  withdrawApplication,
} from '../controllers/applicationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/project/:id', requireAuth, applyToProject);
router.get('/project/:id', requireAuth, getProjectApplications);
router.get('/me', requireAuth, getMyApplications);
router.get('/:id', requireAuth, getApplicationById);
router.patch('/:id/status', requireAuth, updateApplicationStatus);
router.post('/:id/withdraw', requireAuth, withdrawApplication);

export default router;
