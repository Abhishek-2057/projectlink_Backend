import { Router } from 'express';
import authRoutes from './authRoutes.js';
import studentRoutes from './studentRoutes.js';
import companyRoutes from './companyRoutes.js';
import teamRoutes from './teamRoutes.js';
import projectRoutes from './projectRoutes.js';
import applicationRoutes from './applicationRoutes.js';
import invitationRoutes from './invitationRoutes.js';
import assessmentRoutes from './assessmentRoutes.js';
import workspaceRoutes from './workspaceRoutes.js';
import chatRoutes from './chatRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import adminRoutes from './adminRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/students', studentRoutes);
router.use('/companies', companyRoutes);
router.use('/teams', teamRoutes);
router.use('/projects', projectRoutes);
router.use('/applications', applicationRoutes);
router.use('/invitations', invitationRoutes);
router.use('/assessments', assessmentRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/chat', chatRoutes);
router.use('/notifications', notificationRoutes);
router.use('/admin', adminRoutes);

// Health check endpoint
router.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'ProjectLink API',
    version: '1.0.0',
  });
});

export default router;
