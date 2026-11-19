import { Response } from 'express';
import { Conversation, Message, User, Team, TeamMembership } from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { emitToConversation, emitToUser } from '../services/socket.js';

export async function getConversations(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // 1. Auto-sync team conversations for active teams of this user
    try {
      const myMemberships = await TeamMembership.find({ userId: req.user._id, status: 'active' });
      for (const m of myMemberships) {
        const team = await Team.findById(m.teamId);
        if (team) {
          const allMems = await TeamMembership.find({ teamId: team._id, status: 'active' });
          const allMemberUserIds = allMems.map((x: any) => x.userId);

          let teamConv = await Conversation.findOne({ teamId: team._id, type: 'team' });
          if (!teamConv) {
            await Conversation.create({
              type: 'team',
              teamId: team._id,
              title: team.name,
              avatar: team.avatar || '',
              participants: allMemberUserIds,
              unreadCount: 0,
            });
          } else {
            const curParts = teamConv.participants || [];
            const hasChanged =
              curParts.length !== allMemberUserIds.length ||
              !allMemberUserIds.every((id: string) => curParts.includes(id));
            if (hasChanged || teamConv.title !== team.name) {
              await Conversation.findByIdAndUpdate(teamConv._id, {
                participants: allMemberUserIds,
                title: team.name,
                avatar: team.avatar || '',
              });
            }
          }
        }
      }
    } catch (teamSyncErr) {
      console.error('Error syncing team conversations:', teamSyncErr);
    }

    const convs = await Conversation.find({ participants: req.user._id }).sort({ updatedAt: -1 });

    const populated = await Promise.all(
      convs.map(async (c: any) => {
        const participantUsers = await Promise.all(
          c.participants.map(async (pId: string) => {
            const u = await User.findById(pId);
            return u ? { _id: u._id, name: u.name, role: u.role, avatar: u.avatar } : null;
          })
        );
        return {
          ...c,
          participantUsers: participantUsers.filter(Boolean),
        };
      })
    );

    return res.json({ success: true, data: populated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error fetching conversations', error: err.message });
  }
}

export async function getOrCreateConversation(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { targetUserId, projectId, teamId, title } = req.body;

    if (teamId) {
      let conv = await Conversation.findOne({ teamId, type: 'team' });
      if (!conv) {
        const team = await Team.findById(teamId);
        const allMems = await TeamMembership.find({ teamId, status: 'active' });
        const memberIds = allMems.map((x: any) => x.userId);
        conv = await Conversation.create({
          type: 'team',
          teamId,
          title: title || team?.name || 'Team Chat',
          avatar: team?.avatar || '',
          participants: memberIds.length > 0 ? memberIds : [req.user._id],
          unreadCount: 0,
        });
      }
      return res.json({ success: true, data: conv });
    }

    if (projectId) {
      let conv = await Conversation.findOne({ projectId, type: 'project' });
      if (!conv) {
        conv = await Conversation.create({
          type: 'project',
          projectId,
          title: title || 'Project Collaboration Channel',
          participants: [req.user._id, targetUserId].filter(Boolean),
          unreadCount: 0,
        });
      }
      return res.json({ success: true, data: conv });
    }

    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Target user ID is required' });
    }

    // Direct 1-to-1 conversation
    const existing = await Conversation.findOne({
      type: 'direct',
      participants: { $in: [req.user._id] },
    });

    // Check if target is in participants
    const directConvs = await Conversation.find({ type: 'direct' });
    let match = directConvs.find(
      (c) => c.participants.includes(req.user!._id) && c.participants.includes(targetUserId)
    );

    if (!match) {
      match = await Conversation.create({
        type: 'direct',
        participants: [req.user._id, targetUserId],
        unreadCount: 0,
      });
    }

    return res.json({ success: true, data: match });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving conversation', error: err.message });
  }
}

export async function getMessages(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params; // conversationId

    const conv = await Conversation.findById(id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });

    if (!conv.participants.includes(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized for this conversation' });
    }

    const messages = await Message.find({ conversationId: id }).sort({ createdAt: 1 });

    return res.json({ success: true, data: messages });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving messages', error: err.message });
  }
}

export async function sendMessage(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params; // conversationId
    const { text, attachments } = req.body;

    if (!text && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ success: false, message: 'Message content or attachment required' });
    }

    const conv = await Conversation.findById(id);
    if (!conv) return res.status(404).json({ success: false, message: 'Conversation not found' });

    const userDoc = await User.findById(req.user._id);
    const senderAvatar = userDoc?.avatar || '';

    const message = await Message.create({
      conversationId: id,
      senderId: req.user._id,
      senderName: req.user.name,
      senderAvatar,
      text: text || '',
      attachments: attachments || (req.file ? [`/uploads/${req.file.filename}`] : []),
      readBy: [req.user._id],
    });

    await Conversation.findByIdAndUpdate(id, {
      lastMessage: {
        text: text || 'Attachment',
        senderId: req.user._id,
        senderName: req.user.name,
        createdAt: new Date().toISOString(),
      },
    });

    emitToConversation(id, 'new_message', message);

    return res.status(201).json({ success: true, data: message });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error sending message', error: err.message });
  }
}
