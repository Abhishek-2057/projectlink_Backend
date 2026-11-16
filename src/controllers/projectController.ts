import { Response } from 'express';
import { Project, CompanyProfile, Bookmark, StudentProfile, TeamMembership, Team, Application } from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/helpers.js';

export async function getProjects(req: AuthRequest, res: Response) {
  try {
    const {
      search,
      category,
      skill,
      type,
      workMode,
      teamSize,
      maxDuration,
      sort = 'latest',
      page = 1,
      limit = 12,
    } = req.query;

    const filter: any = { status: 'published' };

    if (category && category !== 'all') {
      filter.category = { $regex: String(category), $options: 'i' };
    }
    if (type && type !== 'all') {
      filter.compensationType = type;
    }
    if (workMode && workMode !== 'all') {
      filter.workMode = workMode;
    }
    if (teamSize && teamSize !== 'all') {
      filter.preferredTeamSize = Number(teamSize);
    }
    if (maxDuration) {
      filter.durationWeeks = { $lte: Number(maxDuration) };
    }

    let projects = await Project.find(filter).populate('company');

    if (skill) {
      const s = String(skill).toLowerCase();
      projects = projects.filter((p: any) =>
        p.requiredSkills?.some((sk: string) => sk.toLowerCase().includes(s)) ||
        p.optionalSkills?.some((sk: string) => sk.toLowerCase().includes(s))
      );
    }

    if (search) {
      const q = String(search).toLowerCase();
      projects = projects.filter((p: any) => {
        const titleMatch = p.title?.toLowerCase().includes(q);
        const compMatch = p.company?.companyName?.toLowerCase().includes(q);
        const descMatch = p.shortDescription?.toLowerCase().includes(q) || p.fullDescription?.toLowerCase().includes(q);
        const skillMatch = p.requiredSkills?.some((sk: string) => sk.toLowerCase().includes(q));
        return titleMatch || compMatch || descMatch || skillMatch;
      });
    }

    // Sort
    if (sort === 'popular') {
      projects.sort((a, b) => (b.applicantCount || 0) - (a.applicantCount || 0));
    } else {
      projects.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    // Check bookmarks for logged in user
    let userBookmarks = new Set<string>();
    if (req.user) {
      const bms = await Bookmark.find({ userId: req.user._id, itemType: 'project' });
      userBookmarks = new Set(bms.map((b) => b.itemId));
    }

    const projectsWithBookmark = projects.map((p: any) => ({
      ...p,
      isBookmarked: userBookmarks.has(p._id),
    }));

    const total = projectsWithBookmark.length;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const paginated = projectsWithBookmark.slice((pageNum - 1) * limitNum, pageNum * limitNum);

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
    return res.status(500).json({ success: false, message: 'Error retrieving projects', error: err.message });
  }
}

export async function getProjectById(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const project = await Project.findById(id).populate('company');
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    let isBookmarked = false;
    let hasApplied = false;
    let userApplication = null;

    if (req.user) {
      const bm = await Bookmark.findOne({ userId: req.user._id, itemType: 'project', itemId: id });
      isBookmarked = !!bm;

      if (req.user.role === 'student') {
        const app = await Application.findOne({ projectId: id, studentId: req.user._id });
        if (app) {
          hasApplied = true;
          userApplication = app;
        } else {
          // Check if applied via a team
          const myMemberships = await TeamMembership.find({ userId: req.user._id, status: 'active' });
          const myTeamIds = myMemberships.map((m) => m.teamId);
          const teamApp = await Application.findOne({ projectId: id, teamId: { $in: myTeamIds } });
          if (teamApp) {
            hasApplied = true;
            userApplication = teamApp;
          }
        }
      }
    }

    // Similar projects
    const similar = await Project.find({
      _id: { $ne: project._id },
      category: project.category,
      status: 'published',
    })
      .populate('company')
      .limit(3);

    return res.json({
      success: true,
      data: {
        ...project,
        isBookmarked,
        hasApplied,
        userApplication,
        similarProjects: similar,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error fetching project', error: err.message });
  }
}

export async function getRecommendedProjects(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'student') {
      return res.status(401).json({ success: false, message: 'Unauthorized. Student login required.' });
    }

    const studentProfile = await StudentProfile.findOne({ userId: req.user._id });
    const memberships = await TeamMembership.find({ userId: req.user._id, status: 'active' });
    const myTeams = await Team.find({ _id: { $in: memberships.map((m) => m.teamId) } });

    const studentSkills = new Set((studentProfile?.skills || []).map((s) => s.toLowerCase()));
    const teamSkills = new Set(myTeams.flatMap((t) => t.skills || []).map((s) => s.toLowerCase()));
    const allSkills = new Set([...studentSkills, ...teamSkills]);

    const activeProjects = await Project.find({ status: 'published' }).populate('company');

    // Calculate match score
    const scored = activeProjects.map((proj: any) => {
      const required = (proj.requiredSkills || []).map((s: string) => s.toLowerCase());
      const matched = required.filter((s: string) => allSkills.has(s));

      // Skill Score (50%)
      const skillScore = required.length > 0 ? (matched.length / required.length) * 50 : 35;

      // Team Size Compatibility (20%)
      const userMaxTeamSize = Math.max(1, ...myTeams.map((t) => t.memberCount));
      const teamDiff = Math.abs(proj.preferredTeamSize - userMaxTeamSize);
      const teamScore = teamDiff === 0 ? 20 : teamDiff <= 1 ? 15 : 10;

      // Experience & Projects Score (15%)
      const hasProjects = (studentProfile?.projects?.length || 0) > 0;
      const experienceScore = hasProjects ? 15 : 10;

      // Academic Eligibility (15%)
      const academicScore = (studentProfile?.cgpa || 7) >= 7.5 ? 15 : 12;

      const totalScore = Math.min(99, Math.round(skillScore + teamScore + experienceScore + academicScore));

      const reasons: string[] = [];
      if (matched.length > 0) reasons.push(`Matches ${matched.length} required skill(s): ${matched.slice(0, 3).join(', ')}`);
      if (teamDiff <= 1) reasons.push(`Fits your team capacity (${proj.preferredTeamSize} developers)`);
      if (studentProfile?.degree) reasons.push(`Ideal for final-year ${studentProfile.degree} curriculum`);

      return {
        ...proj,
        matchScore: totalScore,
        matchReasons: reasons,
      };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore);

    return res.json({
      success: true,
      data: scored.slice(0, 10),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving recommendations', error: err.message });
  }
}

export async function getCompanyProjects(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'company') {
      return res.status(403).json({ success: false, message: 'Company authorization required' });
    }

    const company = await CompanyProfile.findOne({ userId: req.user._id });
    if (!company) return res.status(404).json({ success: false, message: 'Company profile not found' });

    const projects = await Project.find({ companyId: company._id }).sort({ createdAt: -1 });

    return res.json({ success: true, data: projects });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving company projects', error: err.message });
  }
}

export async function createProject(req: AuthRequest, res: Response) {
  try {
    if (!req.user || req.user.role !== 'company') {
      return res.status(403).json({ success: false, message: 'Only companies can publish projects' });
    }

    const company = await CompanyProfile.findOne({ userId: req.user._id });
    if (!company) return res.status(404).json({ success: false, message: 'Company profile not found' });

    const {
      title,
      category,
      shortDescription,
      fullDescription,
      problemStatement,
      goals,
      objectives,
      deliverables,
      requiredSkills,
      optionalSkills,
      preferredTeamSize,
      durationWeeks,
      startDate,
      deadline,
      workMode,
      location,
      compensationType,
      budgetOrStipend,
      status,
    } = req.body;

    if (!title || !category || !shortDescription || !fullDescription || !requiredSkills || !deadline) {
      return res.status(400).json({ success: false, message: 'Please provide all mandatory project details' });
    }

    const project = await Project.create({
      companyId: company._id,
      title,
      category,
      shortDescription,
      fullDescription,
      problemStatement: problemStatement || shortDescription,
      goals: Array.isArray(goals) ? goals : [goals].filter(Boolean),
      objectives: Array.isArray(objectives) ? objectives : [objectives].filter(Boolean),
      deliverables: Array.isArray(deliverables) ? deliverables : [deliverables].filter(Boolean),
      requiredSkills: Array.isArray(requiredSkills) ? requiredSkills : [requiredSkills],
      optionalSkills: optionalSkills || [],
      preferredTeamSize: Number(preferredTeamSize) || 3,
      durationWeeks: Number(durationWeeks) || 12,
      startDate: startDate || new Date().toISOString().split('T')[0],
      deadline,
      workMode: workMode || 'remote',
      location: location || company.location,
      compensationType: compensationType || 'paid',
      budgetOrStipend: budgetOrStipend || 'Competitive Stipend + Certificate',
      status: status || 'published',
      applicantCount: 0,
      bookmarksCount: 0,
    });

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'CREATE_PROJECT',
      targetType: 'Project',
      targetId: project._id,
    });

    return res.status(201).json({
      success: true,
      message: 'Project published successfully',
      data: project,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error creating project', error: err.message });
  }
}

export async function updateProject(req: AuthRequest, res: Response) {
  try {
    if (!req.user || (req.user.role !== 'company' && (req.user.role as string) !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { id } = req.params;

    const company = await CompanyProfile.findOne({ userId: req.user._id });
    const project = await Project.findById(id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.companyId !== company?._id && (req.user.role as string) !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to edit this project' });
    }

    const updated = await Project.findByIdAndUpdate(id, req.body);
    return res.json({ success: true, message: 'Project updated', data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating project', error: err.message });
  }
}

export async function updateProjectStatus(req: AuthRequest, res: Response) {
  try {
    if (!req.user || (req.user.role !== 'company' && (req.user.role as string) !== 'admin')) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const { id } = req.params;
    const { status } = req.body;

    const company = await CompanyProfile.findOne({ userId: req.user._id });
    const project = await Project.findById(id);
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    if (project.companyId !== company?._id && (req.user.role as string) !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized to update project status' });
    }

    const updated = await Project.findByIdAndUpdate(id, { status });
    return res.json({ success: true, message: `Project status changed to ${status}`, data: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error changing project status', error: err.message });
  }
}

export async function toggleBookmark(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params;

    const existing = await Bookmark.findOne({
      userId: req.user._id,
      itemType: 'project',
      itemId: id,
    });

    if (existing) {
      await Bookmark.findByIdAndDelete(existing._id);
      return res.json({ success: true, isBookmarked: false, message: 'Bookmark removed' });
    } else {
      await Bookmark.create({
        userId: req.user._id,
        itemType: 'project',
        itemId: id,
      });
      return res.json({ success: true, isBookmarked: true, message: 'Project bookmarked' });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error toggling bookmark', error: err.message });
  }
}
