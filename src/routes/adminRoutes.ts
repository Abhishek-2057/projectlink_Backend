import { Router } from 'express';
import {
  getAnalytics,
  getUsers,
  updateUserStatus,
  getVerificationRequests,
  reviewVerification,
  getActivityLogs,
} from '../controllers/adminController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/analytics', getAnalytics);
router.get('/users', getUsers);
router.patch('/users/:id/status', updateUserStatus);
router.get('/verifications', getVerificationRequests);
router.patch('/verifications/:id', reviewVerification);
router.get('/logs', getActivityLogs);

export default router;
