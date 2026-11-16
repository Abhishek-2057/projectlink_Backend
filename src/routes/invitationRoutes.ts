import { Router } from 'express';
import {
  sendCompanyInvitation,
  getMyInvitations,
} from '../controllers/invitationController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/company', requireAuth, sendCompanyInvitation);
router.get('/me', requireAuth, getMyInvitations);

export default router;
