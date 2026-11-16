import { Response } from 'express';
import {
  Assessment,
  AssessmentSubmission,
  Application,
  Project,
  CompanyProfile,
  User,
  Team,
} from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity, createNotification } from '../utils/helpers.js';

export async function createAssessment(req: AuthRequest, res: Response) {
  try {
    if (!req.user || (req.user.role !== 'company' && (req.user.role as string) !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const { applicationId, title, instructions, deadline, attachments } = req.body;
    if (!applicationId || !title || !instructions || !deadline) {
      return res.status(400).json({ success: false, message: 'Missing required assessment parameters' });
    }

    const application = await Application.findById(applicationId);
    if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

    const project = await Project.findById(application.projectId);
    const company = await CompanyProfile.findOne({ userId: req.user._id });

    if (project?.companyId !== company?._id && (req.user.role as string) !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized for this application' });
    }

    const assessment = await Assessment.create({
      companyId: company?._id || '',
      projectId: application.projectId,
      applicationId: application._id,
      title,
      instructions,
      deadline,
      attachments: attachments || [],
      status: 'pending',
      sentAt: new Date().toISOString(),
    });

    // Update application status
    const history = application.statusHistory || [];
    history.push({
      status: 'assessment_sent',
      changedBy: req.user._id,
      timestamp: new Date().toISOString(),
      reason: `Assessment "${title}" dispatched`,
    });

    await Application.findByIdAndUpdate(applicationId, {
      status: 'assessment_sent',
      statusHistory: history,
    });

    const targetUserId = application.studentId || (await Team.findById(application.teamId || ''))?.leaderId;
    if (targetUserId) {
      await createNotification({
        userId: targetUserId,
        type: 'assessment_assigned',
        title: 'Technical Assessment Assigned',
        message: `${req.user.name} sent you an assessment: "${title}". Due by ${deadline}`,
        link: '/student/applications',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Assessment sent to applicant',
      data: assessment,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error creating assessment', error: err.message });
  }
}

export async function getAssessmentByApplication(req: AuthRequest, res: Response) {
  try {
    const { applicationId } = req.params;
    const assessment = await Assessment.findOne({ applicationId });
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found for this application' });

    const submission = await AssessmentSubmission.findOne({ assessmentId: assessment._id });

    return res.json({
      success: true,
      data: {
        ...assessment,
        submission,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving assessment', error: err.message });
  }
}

export async function submitAssessment(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'student') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params; // assessmentId
    const { answers, attachments } = req.body;

    const assessment = await Assessment.findById(id);
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

    const application = await Application.findById(assessment.applicationId);
    if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

    const submission = await AssessmentSubmission.create({
      assessmentId: id,
      applicationId: application._id,
      studentId: req.user._id,
      answers: answers || '',
      attachments: attachments || (req.file ? [`/uploads/${req.file.filename}`] : []),
      submittedAt: new Date().toISOString(),
    });

    await Assessment.findByIdAndUpdate(id, { status: 'submitted' });

    const history = application.statusHistory || [];
    history.push({
      status: 'assessment_submitted',
      changedBy: req.user._id,
      timestamp: new Date().toISOString(),
      reason: 'Student completed and submitted assessment',
    });

    await Application.findByIdAndUpdate(application._id, {
      status: 'assessment_submitted',
      statusHistory: history,
    });

    const project = await Project.findById(application.projectId);
    const company = project?.companyId ? await CompanyProfile.findById(project.companyId) : null;
    if (company) {
      await createNotification({
        userId: company.userId,
        type: 'assessment_submitted',
        title: 'Assessment Submitted',
        message: `${req.user.name} submitted their assessment for "${project?.title}"`,
        link: '/company/applications',
      });
    }

    return res.json({
      success: true,
      message: 'Assessment submitted successfully!',
      data: submission,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error submitting assessment', error: err.message });
  }
}

export async function reviewAssessment(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'company') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const { id } = req.params; // assessmentId
    const { score, feedback, nextStatus } = req.body;

    const assessment = await Assessment.findById(id);
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

    await Assessment.findByIdAndUpdate(id, {
      score: Number(score),
      feedback: feedback || '',
      status: 'reviewed',
    });

    if (nextStatus) {
      const app = await Application.findById(assessment.applicationId);
      if (app) {
        const history = app.statusHistory || [];
        history.push({
          status: nextStatus,
          changedBy: req.user._id,
          timestamp: new Date().toISOString(),
          reason: `Assessment reviewed (Score: ${score}/100)`,
        });

        await Application.findByIdAndUpdate(app._id, {
          status: nextStatus,
          statusHistory: history,
        });
      }
    }

    return res.json({ success: true, message: 'Assessment review saved successfully' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error reviewing assessment', error: err.message });
  }
}
