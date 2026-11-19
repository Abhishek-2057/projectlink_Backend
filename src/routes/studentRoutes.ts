import { Router } from 'express';
import {
  getStudents,
  getStudentById,
  lookupStudentById,
  getMeProfile,
  updateMeProfile,
  uploadResume,
  uploadAvatar,
  parseResumeAI,
  applyParsedResume,
} from '../controllers/studentController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.get('/', optionalAuth, getStudents);
router.get('/lookup/:identifier', requireAuth, lookupStudentById);
router.get('/me', requireAuth, getMeProfile);
router.put('/me', requireAuth, updateMeProfile);
router.post('/me/resume', requireAuth, upload.single('resume'), uploadResume);
router.post('/me/avatar', requireAuth, upload.single('avatar'), uploadAvatar);
router.post('/resume/parse-ai', requireAuth, upload.single('resume'), parseResumeAI);
router.post('/resume/apply-parsed', requireAuth, applyParsedResume);
router.get('/:id', optionalAuth, getStudentById);

export default router;
