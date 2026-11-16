import { Router } from 'express';
import {
  getConversations,
  getOrCreateConversation,
  getMessages,
  sendMessage,
} from '../controllers/chatController.js';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.get('/conversations', requireAuth, getConversations);
router.post('/conversations', requireAuth, getOrCreateConversation);
router.get('/conversations/:id/messages', requireAuth, getMessages);
router.post('/conversations/:id/messages', requireAuth, upload.single('attachment'), sendMessage);

export default router;
