import { Router } from 'express';
import {
  getTeams,
  getTeamById,
  getMyTeams,
  createTeam,
  updateTeam,
  inviteMember,
  respondInvitation,
  removeMember,
  leaveTeam,
  transferLeadership,
} from '../controllers/teamController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', optionalAuth, getTeams);
router.get('/me', requireAuth, getMyTeams);
router.post('/', requireAuth, createTeam);
router.get('/:id', optionalAuth, getTeamById);
router.put('/:id', requireAuth, updateTeam);
router.post('/:id/invitations', requireAuth, inviteMember);
router.post('/invitations/:id/respond', requireAuth, respondInvitation);
router.delete('/:id/members/:userId', requireAuth, removeMember);
router.post('/:id/leave', requireAuth, leaveTeam);
router.post('/:id/transfer-leadership', requireAuth, transferLeadership);

export default router;
