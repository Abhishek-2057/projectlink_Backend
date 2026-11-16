import { Response } from 'express';
import {
  TeamInvitation,
  Project,
  CompanyProfile,
  User,
  Team,
  Application,
  StudentProfile,
} from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity, createNotification } from '../utils/helpers.js';

export async function sendCompanyInvitation(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'company') {
      return res.status(403).json({ success: false, message: 'Only companies can send project invitations' });
    }

    const { projectId, targetType, targetId, message } = req.body;
    // targetType: 'student' or 'team'
    // targetId: userId or teamId

    if (!projectId || !targetType || !targetId) {
      return res.status(400).json({ success: false, message: 'Project ID, target type, and target ID required' });
    }

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    let receiverUserId: string | null = null;
    let title = '';

    if (targetType === 'student') {
      const student = await User.findById(targetId);
      if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
      receiverUserId = student._id;
      title = `Project Invitation from ${req.user.name}`;
    } else {
      const team = await Team.findById(targetId);
      if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
      receiverUserId = team.leaderId;
      title = `Project Invitation for Team "${team.name}"`;
    }

    await createNotification({
      userId: receiverUserId,
      type: 'company_invite',
      title,
      message: `${req.user.name} invited you to collaborate on "${project.title}". ${message || ''}`,
      link: `/projects/${projectId}`,
    });

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'INVITE_TO_PROJECT',
      targetType: targetType === 'student' ? 'Student' : 'Team',
      targetId,
      details: `Invited to project ${project.title}`,
    });

    return res.json({
      success: true,
      message: 'Invitation successfully dispatched to candidate!',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error sending invitation', error: err.message });
  }
}

export async function getMyInvitations(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Team invitations sent to current user
    const teamInvites = await TeamInvitation.find({ receiverId: req.user._id, status: 'pending' })
      .populate('team')
      .populate('sender');

    return res.json({
      success: true,
      data: {
        teamInvitations: teamInvites,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving invitations', error: err.message });
  }
}
