import { Response } from 'express';
import {
  Application,
  Project,
  Team,
  TeamMembership,
  CompanyProfile,
  StudentProfile,
  User,
  ProjectWorkspace,
  Milestone,
} from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity, createNotification } from '../utils/helpers.js';
import { ApplicationStatus } from '../types/index.js';

export async function applyToProject(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Only students can apply to projects' });
    }

    const { id } = req.params; // projectId
    const { applicantType, teamId, coverLetter, proposal, portfolioLinks, answers } = req.body;

    const project = await Project.findById(id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.status !== 'published') {
      return res.status(400).json({ success: false, message: 'This project is not currently accepting applications' });
    }

    if (!coverLetter) {
      return res.status(400).json({ success: false, message: 'Cover letter is required' });
    }

    let applicationData: any = {
      projectId: id,
      applicantType: applicantType || 'individual',
      coverLetter,
      proposal: proposal || '',
      portfolioLinks: portfolioLinks || [],
      answers: answers || [],
      status: 'pending',
      statusHistory: [
        {
          status: 'pending',
          changedBy: req.user._id,
          timestamp: new Date().toISOString(),
          reason: 'Application submitted',
        },
      ],
      appliedAt: new Date().toISOString(),
    };

    if (applicantType === 'team') {
      if (!teamId) {
        return res.status(400).json({ success: false, message: 'Team ID is required for team applications' });
      }

      const team = await Team.findById(teamId);
      if (!team) return res.status(404).json({ success: false, message: 'Selected team not found' });

      if (team.leaderId !== req.user._id) {
        return res.status(403).json({
          success: false,
          message: 'Only the designated team leader can submit applications on behalf of the team',
        });
      }

      // Check if team already applied
      const existingTeamApp = await Application.findOne({ projectId: id, teamId });
      if (existingTeamApp && existingTeamApp.status !== 'withdrawn') {
        return res.status(400).json({ success: false, message: 'This team has already submitted an application for this project' });
      }

      applicationData.teamId = teamId;
    } else {
      // Individual application
      const existingApp = await Application.findOne({ projectId: id, studentId: req.user._id });
      if (existingApp && existingApp.status !== 'withdrawn') {
        return res.status(400).json({ success: false, message: 'You have already applied for this project' });
      }

      applicationData.studentId = req.user._id;
    }

    const application = await Application.create(applicationData);

    // Increment applicant count on project
    await Project.findByIdAndUpdate(id, { applicantCount: (project.applicantCount || 0) + 1 });

    // Notify company
    const company = await CompanyProfile.findById(project.companyId);
    if (company) {
      await createNotification({
        userId: company.userId,
        type: 'application_received',
        title: 'New Project Application',
        message: `${req.user.name} applied for "${project.title}" ${applicantType === 'team' ? 'as a team' : ''}`,
        link: '/company/applications',
      });
    }

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'APPLY_PROJECT',
      targetType: 'Application',
      targetId: application._id,
    });

    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully!',
      data: application,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error submitting application', error: err.message });
  }
}

export async function getProjectApplications(req: AuthRequest, res: Response) {
  try {
    if (!req.user || (req.user.role !== 'company' && (req.user.role as string) !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params; // projectId
    const { status, type } = req.query;

    const company = await CompanyProfile.findOne({ userId: req.user._id });
    const project = await Project.findById(id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.companyId !== company?._id && (req.user.role as string) !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to view applications for this project' });
    }

    const filter: any = { projectId: id };
    if (status && status !== 'all') filter.status = status;
    if (type && type !== 'all') filter.applicantType = type;

    const apps = await Application.find(filter).populate('student').populate('team');

    // Attach student profiles and team details
    const populated = await Promise.all(
      apps.map(async (app: any) => {
        let studentProfile = null;
        let teamDetails = null;

        if (app.studentId) {
          studentProfile = await StudentProfile.findOne({ userId: app.studentId });
        }
        if (app.teamId) {
          const t = await Team.findById(app.teamId).populate('leader');
          const members = await TeamMembership.find({ teamId: app.teamId, status: 'active' }).populate('user');
          teamDetails = { ...t, members };
        }

        return {
          ...app,
          studentProfile,
          teamDetails,
        };
      })
    );

    return res.json({ success: true, data: populated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving applications', error: err.message });
  }
}

export async function getMyApplications(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // Find direct applications OR team applications where student is member
    const memberships = await TeamMembership.find({ userId: req.user._id, status: 'active' });
    const myTeamIds = memberships.map((m) => m.teamId);

    const apps = await Application.find({
      $or: [{ studentId: req.user._id }, { teamId: { $in: myTeamIds } }],
    })
      .populate('project')
      .populate('team')
      .sort({ appliedAt: -1 });

    const populated = await Promise.all(
      apps.map(async (app: any) => {
        let company = null;
        if (app.project?.companyId) {
          company = await CompanyProfile.findById(app.project.companyId);
        }
        return {
          ...app,
          company,
        };
      })
    );

    return res.json({ success: true, data: populated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving your applications', error: err.message });
  }
}

export async function getApplicationById(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const app = await Application.findById(id).populate('project').populate('student').populate('team');
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    let studentProfile = null;
    if (app.studentId) {
      studentProfile = await StudentProfile.findOne({ userId: app.studentId });
    }

    let teamDetails = null;
    if (app.teamId) {
      const t = await Team.findById(app.teamId).populate('leader');
      const mems = await TeamMembership.find({ teamId: app.teamId, status: 'active' }).populate('user');
      teamDetails = { ...t, members: mems };
    }

    return res.json({
      success: true,
      data: {
        ...app,
        studentProfile,
        teamDetails,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error fetching application', error: err.message });
  }
}

export async function updateApplicationStatus(req: AuthRequest, res: Response) {
  try {
    if (!req.user || (req.user.role !== 'company' && (req.user.role as string) !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Only companies or admins can update application status' });
    }

    const { id } = req.params;
    const { status, reason } = req.body;

    const validStatuses: ApplicationStatus[] = [
      'pending',
      'under_review',
      'shortlisted',
      'assessment_sent',
      'assessment_submitted',
      'interview_scheduled',
      'accepted',
      'rejected',
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid target status' });
    }

    const app = await Application.findById(id);
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const project = await Project.findById(app.projectId);
    const company = await CompanyProfile.findOne({ userId: req.user._id });

    if (project?.companyId !== company?._id && (req.user.role as string) !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to update this application' });
    }

    const history = app.statusHistory || [];
    history.push({
      status,
      changedBy: req.user._id,
      timestamp: new Date().toISOString(),
      reason: reason || `Status changed to ${status}`,
    });

    const updated = await Application.findByIdAndUpdate(id, {
      status,
      statusHistory: history,
    });

    // Notify student or team leader
    const targetUserId = app.studentId || (await Team.findById(app.teamId || ''))?.leaderId;
    if (targetUserId) {
      await createNotification({
        userId: targetUserId,
        type:
          status === 'accepted'
            ? 'application_accepted'
            : status === 'shortlisted'
            ? 'application_shortlisted'
            : 'application_received',
        title: `Application ${status.replace('_', ' ').toUpperCase()}`,
        message: `Your application for "${project?.title}" is now ${status.replace('_', ' ')}`,
        link: '/student/applications',
      });
    }

    // If accepted, auto-create ProjectWorkspace if not already existing
    let workspace = null;
    if (status === 'accepted') {
      workspace = await ProjectWorkspace.findOne({ applicationId: app._id });
      if (!workspace) {
        workspace = await ProjectWorkspace.create({
          projectId: app.projectId,
          companyId: project?.companyId || '',
          applicationId: app._id,
          applicantType: app.applicantType,
          studentId: app.studentId,
          teamId: app.teamId,
          status: 'active',
          repositoryUrl: 'https://github.com/projectlink-workspace/' + (project?.title || 'project').toLowerCase().replace(/[^a-z0-9]/g, '-'),
          liveDemoUrl: '',
          documentationUrl: '',
        });

        // Initialize default project milestones
        await Milestone.create({
          workspaceId: workspace._id,
          title: 'Milestone 1: Architecture & Requirements Specification',
          description: 'Define system architecture, API specifications, and database schema.',
          deadline: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
          order: 1,
          status: 'in_progress',
        });

        await Milestone.create({
          workspaceId: workspace._id,
          title: 'Milestone 2: Core Feature Implementation & Testing',
          description: 'Implement core modules, connect APIs, and perform unit/integration testing.',
          deadline: new Date(Date.now() + 45 * 86400000).toISOString().split('T')[0],
          order: 2,
          status: 'pending',
        });

        await Milestone.create({
          workspaceId: workspace._id,
          title: 'Milestone 3: Final Delivery & Deployment',
          description: 'Deploy staging environment, complete documentation, and present final project deliverables.',
          deadline: new Date(Date.now() + 75 * 86400000).toISOString().split('T')[0],
          order: 3,
          status: 'pending',
        });

        // Update project status to in_progress
        await Project.findByIdAndUpdate(app.projectId, { status: 'in_progress' });
      }
    }

    return res.json({
      success: true,
      message: `Application marked as ${status}`,
      data: updated,
      workspace,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating status', error: err.message });
  }
}

export async function withdrawApplication(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params;
    const app = await Application.findById(id);
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    // Verify ownership
    if (app.applicantType === 'individual' && app.studentId !== req.user._id) {
      return res.status(403).json({ success: false, message: 'Not authorized to withdraw this application' });
    }
    if (app.applicantType === 'team') {
      const team = await Team.findById(app.teamId || '');
      if (team?.leaderId !== req.user._id) {
        return res.status(403).json({ success: false, message: 'Only team leader can withdraw team applications' });
      }
    }

    if (!['pending', 'under_review', 'shortlisted'].includes(app.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot withdraw application when it is already '${app.status}'`,
      });
    }

    const history = app.statusHistory || [];
    history.push({
      status: 'withdrawn',
      changedBy: req.user._id,
      timestamp: new Date().toISOString(),
      reason: 'Withdrawn by student',
    });

    const updated = await Application.findByIdAndUpdate(id, {
      status: 'withdrawn',
      statusHistory: history,
    });

    return res.json({ success: true, message: 'Application withdrawn successfully', data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error withdrawing application', error: err.message });
  }
}
