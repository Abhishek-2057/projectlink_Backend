import { Response } from 'express';
import {
  ProjectWorkspace,
  Project,
  Milestone,
  Task,
  Deliverable,
  Team,
  TeamMembership,
  CompanyProfile,
  User,
  Review,
} from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity, createNotification } from '../utils/helpers.js';
import { emitToWorkspace } from '../services/socket.js';

// Verify user authorization for a given workspace
async function checkWorkspaceAccess(workspace: any, user: any): Promise<boolean> {
  if (user.role === 'admin') return true;

  if (user.role === 'company') {
    const company = await CompanyProfile.findOne({ userId: user._id });
    return workspace.companyId === company?._id || workspace.companyId === user._id;
  }

  if (user.role === 'student') {
    if (workspace.studentId === user._id) return true;
    if (workspace.teamId) {
      const membership = await TeamMembership.findOne({
        teamId: workspace.teamId,
        userId: user._id,
        status: 'active',
      });
      return !!membership;
    }
  }

  return false;
}

export async function getWorkspace(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { projectId } = req.params;

    let workspace = await ProjectWorkspace.findOne({ projectId }).populate('project').populate('company');
    if (!workspace) {
      // Check if project exists and user has rights
      const project = await Project.findById(projectId);
      if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

      // Create fallback workspace if project is in_progress
      const company = await CompanyProfile.findById(project.companyId);
      workspace = await ProjectWorkspace.create({
        projectId,
        companyId: project.companyId,
        applicationId: 'auto-gen-' + projectId,
        applicantType: 'individual',
        status: 'active',
        repositoryUrl: 'https://github.com/projectlink-workspace/' + project.title.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        liveDemoUrl: '',
        documentationUrl: '',
      });
    }

    const hasAccess = await checkWorkspaceAccess(workspace, req.user);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Access denied: You are not a collaborator on this workspace' });
    }

    // Fetch Milestones, Tasks, Deliverables, Team Members
    const milestones = await Milestone.find({ workspaceId: workspace._id }).sort({ order: 1 });
    const tasks = await Task.find({ workspaceId: workspace._id }).sort({ createdAt: -1 });
    const deliverables = await Deliverable.find({ workspaceId: workspace._id }).sort({ submittedAt: -1 });

    let collaborators: any[] = [];
    if (workspace.teamId) {
      const mems = await TeamMembership.find({ teamId: workspace.teamId, status: 'active' }).populate('user');
      collaborators = mems.map((m: any) => ({
        _id: m.userId,
        name: m.user?.name,
        avatar: m.user?.avatar,
        role: m.role,
      }));
    } else if (workspace.studentId) {
      const student = await User.findById(workspace.studentId);
      if (student) {
        collaborators = [
          {
            _id: student._id,
            name: student.name,
            avatar: student.avatar,
            role: 'Lead Developer',
          },
        ];
      }
    }

    return res.json({
      success: true,
      data: {
        workspace,
        milestones,
        tasks,
        deliverables,
        collaborators,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving workspace', error: err.message });
  }
}

export async function updateWorkspaceLinks(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params; // workspaceId
    const { repositoryUrl, liveDemoUrl, documentationUrl } = req.body;

    const workspace = await ProjectWorkspace.findById(id);
    if (!workspace) return res.status(404).json({ success: false, message: 'Workspace not found' });

    const hasAccess = await checkWorkspaceAccess(workspace, req.user);
    if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized' });

    const updated = await ProjectWorkspace.findByIdAndUpdate(id, {
      repositoryUrl: repositoryUrl ?? workspace.repositoryUrl,
      liveDemoUrl: liveDemoUrl ?? workspace.liveDemoUrl,
      documentationUrl: documentationUrl ?? workspace.documentationUrl,
    });

    emitToWorkspace(id, 'workspace_updated', updated);

    return res.json({ success: true, message: 'Workspace links updated', data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating workspace', error: err.message });
  }
}

export async function createTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { workspaceId, title, description, priority, assignedTo, dueDate, milestoneId } = req.body;

    if (!workspaceId || !title) {
      return res.status(400).json({ success: false, message: 'Workspace ID and title are required' });
    }

    const workspace = await ProjectWorkspace.findById(workspaceId);
    if (!workspace) return res.status(404).json({ success: false, message: 'Workspace not found' });

    const task = await Task.create({
      workspaceId,
      milestoneId: milestoneId || '',
      title,
      description: description || '',
      status: 'todo',
      priority: priority || 'medium',
      assignedTo: assignedTo || '',
      dueDate: dueDate || '',
      comments: [],
    });

    emitToWorkspace(workspaceId, 'task_created', task);

    return res.status(201).json({ success: true, message: 'Task created', data: task });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error creating task', error: err.message });
  }
}

export async function updateTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params; // taskId
    const { status, title, description, priority, assignedTo, dueDate } = req.body;

    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const updated = await Task.findByIdAndUpdate(id, {
      status: status ?? task.status,
      title: title ?? task.title,
      description: description ?? task.description,
      priority: priority ?? task.priority,
      assignedTo: assignedTo ?? task.assignedTo,
      dueDate: dueDate ?? task.dueDate,
    });

    emitToWorkspace(task.workspaceId, 'task_updated', updated);

    return res.json({ success: true, message: 'Task updated', data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating task', error: err.message });
  }
}

export async function addTaskComment(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params; // taskId
    const { text } = req.body;

    if (!text) return res.status(400).json({ success: false, message: 'Comment text is required' });

    const task = await Task.findById(id);
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

    const comment = {
      _id: 'c_' + Date.now(),
      userId: req.user._id,
      userName: req.user.name,
      userAvatar: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100`,
      text,
      createdAt: new Date().toISOString(),
    };

    const updated = await Task.findByIdAndUpdate(id, {
      $push: { comments: comment },
    });

    emitToWorkspace(task.workspaceId, 'task_comment_added', { taskId: id, comment });

    return res.json({ success: true, message: 'Comment added', data: comment });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error adding comment', error: err.message });
  }
}

export async function submitDeliverable(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Only students can submit deliverables' });
    }

    const { workspaceId, title, description, githubUrl, liveDemoUrl } = req.body;
    if (!workspaceId || !title) {
      return res.status(400).json({ success: false, message: 'Workspace ID and deliverable title are required' });
    }

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    const deliverable = await Deliverable.create({
      workspaceId,
      title,
      description: description || '',
      fileUrl,
      githubUrl,
      liveDemoUrl,
      submittedBy: req.user._id,
      submittedByName: req.user.name,
      submittedAt: new Date().toISOString(),
      status: 'pending',
    });

    emitToWorkspace(workspaceId, 'deliverable_submitted', deliverable);

    return res.status(201).json({ success: true, message: 'Deliverable submitted for review', data: deliverable });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error submitting deliverable', error: err.message });
  }
}

export async function reviewDeliverable(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'company') {
      return res.status(403).json({ success: false, message: 'Only companies can review deliverables' });
    }

    const { id } = req.params; // deliverableId
    const { status, feedback } = req.body;

    const deliverable = await Deliverable.findById(id);
    if (!deliverable) return res.status(404).json({ success: false, message: 'Deliverable not found' });

    const updated = await Deliverable.findByIdAndUpdate(id, {
      status,
      feedback: feedback || '',
    });

    emitToWorkspace(deliverable.workspaceId, 'deliverable_reviewed', updated);

    return res.json({ success: true, message: `Deliverable marked as ${status}`, data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error reviewing deliverable', error: err.message });
  }
}

export async function completeProject(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'company') {
      return res.status(403).json({ success: false, message: 'Only companies can mark projects complete' });
    }

    const { id } = req.params; // workspaceId
    const { rating, feedback } = req.body;

    const workspace = await ProjectWorkspace.findById(id);
    if (!workspace) return res.status(404).json({ success: false, message: 'Workspace not found' });

    await ProjectWorkspace.findByIdAndUpdate(id, {
      status: 'completed',
      finalRating: Number(rating) || 5,
      finalFeedback: feedback || 'Outstanding collaboration and technical execution!',
      completedAt: new Date().toISOString(),
    });

    await Project.findByIdAndUpdate(workspace.projectId, { status: 'completed' });

    // Store review
    await Review.create({
      projectId: workspace.projectId,
      reviewerId: req.user._id,
      targetType: workspace.applicantType === 'team' ? 'team' : 'student',
      targetId: workspace.applicantType === 'team' ? workspace.teamId || '' : workspace.studentId || '',
      rating: Number(rating) || 5,
      comment: feedback || 'Completed project successfully!',
    });

    // If team, increment team completedProjectsCount
    if (workspace.teamId) {
      const team = await Team.findById(workspace.teamId);
      if (team) {
        await Team.findByIdAndUpdate(workspace.teamId, {
          completedProjectsCount: (team.completedProjectsCount || 0) + 1,
        });
      }
    }

    emitToWorkspace(id, 'project_completed', { workspaceId: id, rating, feedback });

    return res.json({ success: true, message: 'Project marked as completed and review submitted!' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error completing project', error: err.message });
  }
}
