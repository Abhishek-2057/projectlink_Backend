import { Router } from 'express';
import {
  getCompanies,
  getCompanyById,
  getMeProfile,
  updateMeProfile,
  submitVerification,
} from '../controllers/companyController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.get('/', optionalAuth, getCompanies);
router.get('/me', requireAuth, getMeProfile);
router.put('/me', requireAuth, updateMeProfile);
router.post('/me/verification', requireAuth, upload.single('document'), submitVerification);
router.get('/:id', optionalAuth, getCompanyById);

export default router;
