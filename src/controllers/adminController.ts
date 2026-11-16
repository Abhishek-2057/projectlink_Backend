import { Response } from 'express';
import {
  User,
  StudentProfile,
  CompanyProfile,
  Team,
  Project,
  ProjectWorkspace,
  VerificationRequest,
  ActivityLog,
} from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity, createNotification } from '../utils/helpers.js';

export async function getAnalytics(req: AuthRequest, res: Response) {
  try {
    const totalStudents = await User.countDocuments({ role: 'student' });
    const totalCompanies = await User.countDocuments({ role: 'company' });
    const verifiedCompanies = await CompanyProfile.countDocuments({ verificationStatus: 'verified' });
    const totalTeams = await Team.countDocuments();
    const publishedProjects = await Project.countDocuments({ status: 'published' });
    const activeProjects = await Project.countDocuments({ status: 'in_progress' });
    const completedProjects = await Project.countDocuments({ status: 'completed' });
    const pendingVerifications = await VerificationRequest.countDocuments({ status: 'pending' });

    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(6);
    const recentProjects = await Project.find().populate('company').sort({ createdAt: -1 }).limit(5);

    return res.json({
      success: true,
      data: {
        stats: {
          totalStudents,
          totalCompanies,
          verifiedCompanies,
          totalTeams,
          publishedProjects,
          activeProjects,
          completedProjects,
          pendingVerifications,
        },
        recentUsers: recentUsers.map(({ passwordHash, ...u }) => u),
        recentProjects,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving analytics', error: err.message });
  }
}

export async function getUsers(req: AuthRequest, res: Response) {
  try {
    const { role, status, search, page = 1, limit = 20 } = req.query;

    const filter: any = {};
    if (role && role !== 'all') filter.role = role;
    if (status && status !== 'all') filter.status = status;

    let users = await User.find(filter).sort({ createdAt: -1 });

    if (search) {
      const q = String(search).toLowerCase();
      users = users.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }

    const total = users.length;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const paginated = users
      .slice((pageNum - 1) * limitNum, pageNum * limitNum)
      .map(({ passwordHash, ...safe }) => safe);

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
    return res.status(500).json({ success: false, message: 'Error fetching users', error: err.message });
  }
}

export async function updateUserStatus(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'active' | 'suspended'

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or suspended' });
    }

    const updated = await User.findByIdAndUpdate(id, { status });
    if (!updated) return res.status(404).json({ success: false, message: 'User not found' });

    await logActivity({
      actorId: req.user!._id,
      actorName: req.user!.name,
      actorRole: req.user!.role,
      action: status === 'suspended' ? 'SUSPEND_USER' : 'ACTIVATE_USER',
      targetType: 'User',
      targetId: id,
    });

    return res.json({ success: true, message: `User marked as ${status}`, data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating user status', error: err.message });
  }
}

export async function getVerificationRequests(req: AuthRequest, res: Response) {
  try {
    const requests = await VerificationRequest.find().sort({ submittedAt: -1 });
    return res.json({ success: true, data: requests });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error fetching verification requests', error: err.message });
  }
}

export async function reviewVerification(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params; // verificationRequestId
    const { status, adminNotes } = req.body; // 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected' });
    }

    const vReq = await VerificationRequest.findById(id);
    if (!vReq) return res.status(404).json({ success: false, message: 'Verification request not found' });

    await VerificationRequest.findByIdAndUpdate(id, {
      status,
      adminNotes: adminNotes || '',
      reviewedAt: new Date().toISOString(),
    });

    const companyVerificationStatus = status === 'approved' ? 'verified' : 'rejected';
    await CompanyProfile.findByIdAndUpdate(vReq.companyId, {
      verificationStatus: companyVerificationStatus,
    });

    const company = await CompanyProfile.findById(vReq.companyId);
    if (company) {
      await createNotification({
        userId: company.userId,
        type: 'application_received',
        title: `Company Verification ${status === 'approved' ? 'Approved' : 'Declined'}`,
        message: `Your company verification documents have been ${status}. ${adminNotes || ''}`,
        link: '/company/profile',
      });
    }

    return res.json({ success: true, message: `Verification request ${status}` });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error reviewing verification', error: err.message });
  }
}

export async function getActivityLogs(req: AuthRequest, res: Response) {
  try {
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).limit(100);
    return res.json({ success: true, data: logs });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error fetching activity logs', error: err.message });
  }
}
