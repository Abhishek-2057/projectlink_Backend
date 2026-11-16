import { Router } from 'express';
import {
  getProjects,
  getProjectById,
  getCompanyProjects,
  getRecommendedProjects,
  createProject,
  updateProject,
  updateProjectStatus,
  toggleBookmark,
} from '../controllers/projectController.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', optionalAuth, getProjects);
router.get('/recommended', requireAuth, getRecommendedProjects);
router.get('/company/my', requireAuth, getCompanyProjects);
router.post('/', requireAuth, createProject);
router.get('/:id', optionalAuth, getProjectById);
router.put('/:id', requireAuth, updateProject);
router.patch('/:id/status', requireAuth, updateProjectStatus);
router.post('/:id/bookmark', requireAuth, toggleBookmark);

export default router;
