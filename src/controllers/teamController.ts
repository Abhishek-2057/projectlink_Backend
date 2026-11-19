import { Response } from 'express';
import { Team, TeamMembership, TeamInvitation, User, StudentProfile } from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity, createNotification } from '../utils/helpers.js';

// Helper to compute combined skills of all active team members
async function updateTeamCombinedSkills(teamId: string): Promise<string[]> {
  const memberships = await TeamMembership.find({ teamId, status: 'active' });
  const userIds = memberships.map((m) => m.userId);
  const profiles = await StudentProfile.find({ userId: { $in: userIds } });

  const team = await Team.findById(teamId);
  const explicitSkills = team?.skills || [];

  const memberSkills = profiles.flatMap((p) => p.skills || []);
  const combined = Array.from(new Set([...explicitSkills, ...memberSkills]));

  await Team.findByIdAndUpdate(teamId, {
    skills: combined,
    memberCount: memberships.length,
  });

  return combined;
}

export async function getTeams(req: AuthRequest, res: Response) {
  try {
    const {
      search,
      skill,
      college,
      minMembers,
      maxMembers,
      page = 1,
      limit = 12,
    } = req.query;

    const filter: any = { isPublic: true };
    if (college) {
      filter.college = { $regex: String(college), $options: 'i' };
    }

    let teams = await Team.find(filter).populate('leader');

    // Skill filter
    if (skill) {
      const s = String(skill).toLowerCase();
      teams = teams.filter((t: any) =>
        t.skills?.some((sk: string) => sk.toLowerCase().includes(s))
      );
    }

    if (minMembers) {
      teams = teams.filter((t: any) => t.memberCount >= Number(minMembers));
    }
    if (maxMembers) {
      teams = teams.filter((t: any) => t.memberCount <= Number(maxMembers));
    }

    if (search) {
      const q = String(search).toLowerCase();
      teams = teams.filter(
        (t: any) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.college.toLowerCase().includes(q) ||
          t.skills?.some((sk: string) => sk.toLowerCase().includes(q))
      );
    }

    // Attach member preview avatars for each team
    const teamsWithMembers = await Promise.all(
      teams.map(async (t: any) => {
        const memberships = await TeamMembership.find({ teamId: t._id, status: 'active' }).populate('user');
        return {
          ...t,
          members: memberships.map((m: any) => ({
            _id: m.userId,
            name: m.user?.name,
            avatar: m.user?.avatar,
            role: m.role,
          })),
        };
      })
    );

    const total = teamsWithMembers.length;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const paginated = teamsWithMembers.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    return res.json({
      success: true,
      data: paginated,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving teams', error: err.message });
  }
}

export async function getTeamById(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const team = await Team.findById(id).populate('leader');
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const memberships = await TeamMembership.find({ teamId: team._id, status: 'active' }).populate('user');
    const memberUserIds = memberships.map((m) => m.userId);
    const studentProfiles = await StudentProfile.find({ userId: { $in: memberUserIds } });

    const memberDetails = memberships.map((m: any) => {
      const profile = studentProfiles.find((sp) => sp.userId === m.userId);
      return {
        _id: m._id,
        userId: m.userId,
        name: m.user?.name,
        email: m.user?.email,
        avatar: m.user?.avatar,
        role: m.role,
        joinedAt: m.joinedAt,
        degree: profile?.degree,
        cgpa: profile?.cgpa,
        skills: profile?.skills || [],
        githubUrl: profile?.githubUrl,
        portfolioUrl: profile?.portfolioUrl,
      };
    });

    return res.json({
      success: true,
      data: {
        ...team,
        members: memberDetails,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error fetching team', error: err.message });
  }
}

export async function getMyTeams(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const memberships = await TeamMembership.find({ userId: req.user._id, status: 'active' });
    const teamIds = memberships.map((m) => m.teamId);

    const teams = await Team.find({ _id: { $in: teamIds } }).populate('leader');

    const result = await Promise.all(
      teams.map(async (t: any) => {
        const mems = await TeamMembership.find({ teamId: t._id, status: 'active' }).populate('user');
        const myMembership = mems.find((m: any) => m.userId === req.user?._id);
        return {
          ...t,
          myRole: myMembership?.role || 'member',
          members: mems.map((m: any) => ({
            _id: m.userId,
            name: m.user?.name,
            avatar: m.user?.avatar,
            role: m.role,
            joinedAt: m.joinedAt,
          })),
        };
      })
    );

    return res.json({ success: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving your teams', error: err.message });
  }
}

export async function createTeam(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Only students can form student teams' });
    }

    const { name, description, college, skills, avatar, isPublic } = req.body;
    if (!name || !description) {
      return res.status(400).json({ success: false, message: 'Team name and description are required' });
    }

    const studentProfile = await StudentProfile.findOne({ userId: req.user._id });
    const userCollege = college || studentProfile?.college || 'Engineering Institute';
    const initialSkills = Array.from(new Set([...(skills || []), ...(studentProfile?.skills || [])]));

    const team = await Team.create({
      name,
      description,
      leaderId: req.user._id,
      college: userCollege,
      skills: initialSkills,
      memberCount: 1,
      avatar: avatar || `https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150&auto=format&fit=crop&q=80`,
      completedProjectsCount: 0,
      rating: 5.0,
      isPublic: isPublic !== undefined ? isPublic : true,
    });

    await TeamMembership.create({
      teamId: team._id,
      userId: req.user._id,
      role: 'leader',
      joinedAt: new Date().toISOString(),
      status: 'active',
    });

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'CREATE_TEAM',
      targetType: 'Team',
      targetId: team._id,
    });

    return res.status(201).json({
      success: true,
      message: 'Team created successfully',
      data: team,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error creating team', error: err.message });
  }
}

export async function updateTeam(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params;

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (team.leaderId !== req.user._id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only team leader can update team details' });
    }

    const { name, description, college, skills, avatar, isPublic } = req.body;
    const updated = await Team.findByIdAndUpdate(id, {
      name: name ?? team.name,
      description: description ?? team.description,
      college: college ?? team.college,
      skills: skills ?? team.skills,
      avatar: avatar ?? team.avatar,
      isPublic: isPublic !== undefined ? isPublic : team.isPublic,
    });

    return res.json({ success: true, message: 'Team details updated', data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating team', error: err.message });
  }
}

export async function inviteMember(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params;
    const { receiverId, message } = req.body;

    if (!receiverId) return res.status(400).json({ success: false, message: 'Receiver student ID is required' });

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (team.leaderId !== req.user._id) {
      return res.status(403).json({ success: false, message: 'Only team leader can invite members' });
    }

    let targetUser = await User.findById(receiverId);
    let resolvedReceiverId = receiverId;

    if (!targetUser) {
      const cleanId = String(receiverId).trim().toUpperCase();
      const studentProfile = await StudentProfile.findOne({
        $or: [
          { studentIdNumber: cleanId },
          { studentIdNumber: { $regex: `^${cleanId}$`, $options: 'i' } },
        ],
      });
      if (studentProfile && studentProfile.userId) {
        targetUser = await User.findById(studentProfile.userId);
        resolvedReceiverId = studentProfile.userId;
      }
    }

    if (!targetUser || targetUser.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Target student not found' });
    }

    // Check if already an active member
    const existingMembership = await TeamMembership.findOne({
      teamId: id,
      userId: resolvedReceiverId,
      status: 'active',
    });
    if (existingMembership) {
      return res.status(400).json({ success: false, message: 'Student is already a member of this team' });
    }

    // Check existing pending invitation
    const pendingInv = await TeamInvitation.findOne({
      teamId: id,
      receiverId: resolvedReceiverId,
      status: 'pending',
    });
    if (pendingInv) {
      return res.status(400).json({ success: false, message: 'An invitation is already pending for this student' });
    }

    const invitation = await TeamInvitation.create({
      teamId: id,
      senderId: req.user._id,
      receiverId: resolvedReceiverId,
      message: message || `Join ${team.name} for final-year project collaboration!`,
      status: 'pending',
      sentAt: new Date().toISOString(),
    });

    await createNotification({
      userId: resolvedReceiverId,
      type: 'team_invite',
      title: 'New Team Invitation',
      message: `${req.user.name} invited you to join team "${team.name}"`,
      link: '/student/invitations',
    });

    return res.status(201).json({
      success: true,
      message: 'Invitation sent successfully',
      data: invitation,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error sending invitation', error: err.message });
  }
}

export async function respondInvitation(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params; // invitationId
    const { action } = req.body; // 'accept' or 'reject'

    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be accept or reject' });
    }

    const invitation = await TeamInvitation.findById(id);
    if (!invitation) return res.status(404).json({ success: false, message: 'Invitation not found' });

    if (invitation.receiverId !== req.user._id) {
      return res.status(403).json({ success: false, message: 'You are not the recipient of this invitation' });
    }

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Invitation has already been ${invitation.status}` });
    }

    const team = await Team.findById(invitation.teamId);
    if (!team) return res.status(404).json({ success: false, message: 'Team no longer exists' });

    if (action === 'accept') {
      await TeamInvitation.findByIdAndUpdate(id, {
        status: 'accepted',
        respondedAt: new Date().toISOString(),
      });

      // Add to team membership
      await TeamMembership.create({
        teamId: team._id,
        userId: req.user._id,
        role: 'member',
        joinedAt: new Date().toISOString(),
        status: 'active',
      });

      // Update combined skills & member count
      await updateTeamCombinedSkills(team._id);

      await createNotification({
        userId: team.leaderId,
        type: 'team_invite_accepted',
        title: 'Team Invitation Accepted',
        message: `${req.user.name} accepted your invitation to join ${team.name}!`,
        link: '/student/teams',
      });

      return res.json({ success: true, message: `Joined ${team.name} successfully!` });
    } else {
      await TeamInvitation.findByIdAndUpdate(id, {
        status: 'rejected',
        respondedAt: new Date().toISOString(),
      });

      await createNotification({
        userId: team.leaderId,
        type: 'team_invite_rejected',
        title: 'Team Invitation Declined',
        message: `${req.user.name} declined the invitation to join ${team.name}.`,
        link: '/student/teams',
      });

      return res.json({ success: true, message: 'Invitation declined' });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error responding to invitation', error: err.message });
  }
}

export async function removeMember(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id, userId } = req.params;

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (team.leaderId !== req.user._id) {
      return res.status(403).json({ success: false, message: 'Only team leader can remove members' });
    }

    if (userId === team.leaderId) {
      return res.status(400).json({ success: false, message: 'Team leader cannot be removed. Transfer leadership first.' });
    }

    const membership = await TeamMembership.findOne({ teamId: id, userId, status: 'active' });
    if (!membership) {
      return res.status(404).json({ success: false, message: 'Member not found in team' });
    }

    await TeamMembership.findByIdAndUpdate(membership._id, { status: 'removed' });
    await updateTeamCombinedSkills(team._id);

    return res.json({ success: true, message: 'Member removed from team' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error removing member', error: err.message });
  }
}

export async function leaveTeam(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params;

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (team.leaderId === req.user._id && team.memberCount > 1) {
      return res.status(400).json({
        success: false,
        message: 'As team leader, you must transfer leadership to another member before leaving.',
      });
    }

    const membership = await TeamMembership.findOne({ teamId: id, userId: req.user._id, status: 'active' });
    if (!membership) {
      return res.status(404).json({ success: false, message: 'Active membership not found' });
    }

    await TeamMembership.findByIdAndUpdate(membership._id, { status: 'left' });
    await updateTeamCombinedSkills(team._id);

    return res.json({ success: true, message: `You have left ${team.name}` });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error leaving team', error: err.message });
  }
}

export async function transferLeadership(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params;
    const { newLeaderId } = req.body;

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    if (team.leaderId !== req.user._id) {
      return res.status(403).json({ success: false, message: 'Only current leader can transfer leadership' });
    }

    const targetMembership = await TeamMembership.findOne({ teamId: id, userId: newLeaderId, status: 'active' });
    if (!targetMembership) {
      return res.status(400).json({ success: false, message: 'Target user is not an active team member' });
    }

    await TeamMembership.updateOne({ teamId: id, userId: req.user._id, status: 'active' }, { role: 'member' });
    await TeamMembership.findByIdAndUpdate(targetMembership._id, { role: 'leader' });
    await Team.findByIdAndUpdate(id, { leaderId: newLeaderId });

    return res.json({ success: true, message: 'Leadership transferred successfully' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error transferring leadership', error: err.message });
  }
}
