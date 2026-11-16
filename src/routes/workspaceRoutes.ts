import { Router } from 'express';
import {
  getWorkspace,
  updateWorkspaceLinks,
  createTask,
  updateTask,
  addTaskComment,
  submitDeliverable,
  reviewDeliverable,
  completeProject,
} from '../controllers/workspaceController.js';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.get('/project/:projectId', requireAuth, getWorkspace);
router.patch('/:id/links', requireAuth, updateWorkspaceLinks);
router.post('/tasks', requireAuth, createTask);
router.patch('/tasks/:id', requireAuth, updateTask);
router.post('/tasks/:id/comments', requireAuth, addTaskComment);
router.post('/deliverables', requireAuth, upload.single('file'), submitDeliverable);
router.patch('/deliverables/:id/review', requireAuth, reviewDeliverable);
router.post('/:id/complete', requireAuth, completeProject);

export default router;
