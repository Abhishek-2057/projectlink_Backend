import { Response } from 'express';
import fs from 'fs';
import { User, StudentProfile, TeamMembership, Team } from '../models/index.js';
import { generateId } from '../config/db.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity } from '../utils/helpers.js';
import { extractResumeText, parseResumeWithGemini } from '../services/aiResumeService.js';
import { IParsedResume } from '../types/index.js';

export async function getStudents(req: AuthRequest, res: Response) {
  try {
    const {
      search,
      skill,
      skills,
      college,
      degree,
      minCgpa,
      graduationYear,
      graduationYears,
      internship,
      hasInternship,
      availability,
      page = 1,
      limit = 12,
    } = req.query;

    const filter: any = { isPublic: true };

    if (college) {
      filter.college = { $regex: String(college), $options: 'i' };
    }
    if (degree) {
      filter.degree = { $regex: String(degree), $options: 'i' };
    }
    if (availability && availability !== 'all') {
      filter.availability = availability;
    }

    const profiles = await StudentProfile.find(filter).populate('user');

    let filtered = profiles;

    // 1. Minimum CGPA filter (Rule: 1.0 means ALL/No minimum, only filter if > 1.0)
    const minCgpaNum = minCgpa ? parseFloat(String(minCgpa)) : 1.0;
    if (minCgpaNum > 1.0) {
      filtered = filtered.filter((p: any) => {
        const val = parseFloat(p.cgpa);
        return !isNaN(val) && val >= minCgpaNum;
      });
    }

    // 2. Graduation Year filter (supports single year, comma-separated, or array e.g. 2026, 2027)
    const rawYears = graduationYears || graduationYear;
    if (rawYears) {
      const yearList = Array.isArray(rawYears)
        ? rawYears.map(Number)
        : String(rawYears)
            .split(',')
            .map((y) => Number(y.trim()))
            .filter((n) => !isNaN(n) && n > 0);
      if (yearList.length > 0) {
        filtered = filtered.filter((p: any) => yearList.includes(Number(p.graduationYear)));
      }
    }

    // 3. Technical Skills filter (Case-insensitive matching)
    // Rule: Normalize both selected filter skills and student's skills array using .toLowerCase().trim()
    // Supports matching e.g. "react" to "React.js", "React", etc.
    const rawSkills = skills || skill;
    if (rawSkills) {
      const selectedSkills = Array.isArray(rawSkills)
        ? (rawSkills as string[]).map((s) => String(s).trim()).filter(Boolean)
        : String(rawSkills)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

      if (selectedSkills.length > 0) {
        filtered = filtered.filter((student: any) => {
          const studentSkills: string[] = (student.skills || []).map((s: string) =>
            s.toLowerCase().trim()
          );
          return selectedSkills.every((filterSkill) => {
            const normFilter = filterSkill.toLowerCase().trim();
            return studentSkills.some(
              (studentSkill) =>
                studentSkill === normFilter || studentSkill.includes(normFilter)
            );
          });
        });
      }
    }

    // 4. Internship Experience Check
    // Rule: Check Array.isArray(student.workExperience) && student.workExperience.length > 0
    const rawInternship = internship || hasInternship;
    if (rawInternship && rawInternship !== 'all') {
      const checkHasExperience = (p: any): boolean => {
        const exps = p.workExperience || p.workExperienceList || p.experience || [];
        return Array.isArray(exps) && exps.length > 0;
      };

      if (rawInternship === 'has' || rawInternship === 'true') {
        filtered = filtered.filter((p: any) => checkHasExperience(p));
      } else if (rawInternship === 'fresher' || rawInternship === 'false') {
        filtered = filtered.filter((p: any) => !checkHasExperience(p));
      }
    }

    // 5. Post-filter by user name or keyword search if provided
    if (search) {
      const q = String(search).toLowerCase().trim();
      filtered = filtered.filter((p: any) => {
        const nameMatch = p.user?.name?.toLowerCase().includes(q);
        const bioMatch = p.bio?.toLowerCase().includes(q);
        const skillMatch = p.skills?.some((s: string) => s.toLowerCase().includes(q));
        const collegeMatch = p.college?.toLowerCase().includes(q);
        return nameMatch || bioMatch || skillMatch || collegeMatch;
      });
    }

    const total = filtered.length;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = filtered.slice(startIndex, startIndex + limitNum);

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
    return res.status(500).json({ success: false, message: 'Error fetching students', error: err.message });
  }
}

export async function getStudentById(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    let profile = await StudentProfile.findOne({ userId: id }).populate('user');
    if (!profile) {
      profile = await StudentProfile.findById(id).populate('user');
    }

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Student profile not found' });
    }

    // Fetch student's teams
    const memberships = await TeamMembership.find({ userId: profile.userId, status: 'active' });
    const teamIds = memberships.map((m) => m.teamId);
    const teams = await Team.find({ _id: { $in: teamIds } });

    return res.json({
      success: true,
      data: {
        ...profile,
        teams,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error fetching student', error: err.message });
  }
}

export async function getMeProfile(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const profile = await StudentProfile.findOne({ userId: req.user._id }).populate('user');
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    return res.json({ success: true, data: profile });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving profile', error: err.message });
  }
}

export async function updateMeProfile(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const {
      name,
      avatar,
      college,
      degree,
      department,
      graduationYear,
      cgpa,
      bio,
      phone,
      careerObjective,
      educationList,
      workExperienceList,
      extraCurricular,
      trainingsCourses,
      projectList,
      portfolioList,
      accomplishments,
      skills,
      experience,
      projects,
      certifications,
      githubUrl,
      linkedinUrl,
      portfolioUrl,
      availability,
      isPublic,
    } = req.body;

    if (name || avatar) {
      await User.findByIdAndUpdate(req.user._id, {
        ...(name ? { name } : {}),
        ...(avatar ? { avatar } : {}),
      });
    }

    let profile = await StudentProfile.findOne({ userId: req.user._id });
    if (!profile) {
      profile = await StudentProfile.create({
        userId: req.user._id,
        college: college || '',
        degree: degree || '',
        graduationYear: Number(graduationYear) || new Date().getFullYear(),
        cgpa: cgpa ? Number(cgpa) : 8.0,
        bio: bio || '',
        phone: phone || '',
        careerObjective: careerObjective ?? null,
        educationList: educationList || [],
        workExperienceList: workExperienceList || [],
        extraCurricular: extraCurricular || [],
        trainingsCourses: trainingsCourses || [],
        projectList: projectList || [],
        portfolioList: portfolioList || [],
        accomplishments: accomplishments || [],
        skills: skills || [],
        experience: experience || [],
        projects: projects || [],
        certifications: certifications || [],
        githubUrl: githubUrl || '',
        linkedinUrl: linkedinUrl || '',
        portfolioUrl: portfolioUrl || '',
        availability: availability || 'immediate',
        isPublic: isPublic !== undefined ? isPublic : true,
      });
    } else {
      profile = await StudentProfile.findByIdAndUpdate(profile._id, {
        college: college ?? profile.college,
        degree: degree ?? profile.degree,
        department: department ?? profile.department,
        graduationYear: graduationYear ? Number(graduationYear) : profile.graduationYear,
        cgpa: cgpa !== undefined ? Number(cgpa) : profile.cgpa,
        bio: bio ?? profile.bio,
        phone: phone !== undefined ? phone : profile.phone,
        careerObjective: careerObjective !== undefined ? careerObjective : profile.careerObjective,
        educationList: educationList ?? profile.educationList,
        workExperienceList: workExperienceList ?? profile.workExperienceList,
        extraCurricular: extraCurricular ?? profile.extraCurricular,
        trainingsCourses: trainingsCourses ?? profile.trainingsCourses,
        projectList: projectList ?? profile.projectList,
        portfolioList: portfolioList ?? profile.portfolioList,
        accomplishments: accomplishments ?? profile.accomplishments,
        skills: skills ?? profile.skills,
        experience: experience ?? profile.experience,
        projects: projects ?? profile.projects,
        certifications: certifications ?? profile.certifications,
        githubUrl: githubUrl ?? profile.githubUrl,
        linkedinUrl: linkedinUrl ?? profile.linkedinUrl,
        portfolioUrl: portfolioUrl ?? profile.portfolioUrl,
        availability: availability ?? profile.availability,
        isPublic: isPublic !== undefined ? isPublic : profile.isPublic,
      });
    }

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'UPDATE_PROFILE',
      targetType: 'StudentProfile',
      targetId: profile?._id || req.user._id,
    });

    const refreshed = await StudentProfile.findOne({ userId: req.user._id }).populate('user');
    return res.json({ success: true, message: 'Profile updated successfully', data: refreshed });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating profile', error: err.message });
  }
}

export async function uploadResume(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const fileUrl = `/uploads/${req.file.filename}`;
    const profile = await StudentProfile.findOne({ userId: req.user._id });
    if (profile) {
      await StudentProfile.findByIdAndUpdate(profile._id, { resumeUrl: fileUrl });
    }

    return res.json({
      success: true,
      message: 'Resume uploaded successfully',
      fileUrl,
      fileName: req.file.originalname,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error uploading resume', error: err.message });
  }
}

export async function uploadAvatar(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    // Read image and encode as base64 data URI to store directly inside MongoDB document
    const fileData = fs.readFileSync(req.file.path);
    const mimeType = req.file.mimetype || 'image/jpeg';
    const base64Avatar = `data:${mimeType};base64,${fileData.toString('base64')}`;

    // Update avatar directly in MongoDB user collection
    await User.findByIdAndUpdate(req.user._id, { avatar: base64Avatar });

    return res.json({
      success: true,
      message: 'Profile photo uploaded and stored in MongoDB successfully',
      avatarUrl: base64Avatar,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error uploading profile photo', error: err.message });
  }
}

export async function parseResumeAI(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!req.file) return res.status(400).json({ success: false, message: 'Please upload a PDF or DOCX resume file' });

    const fileUrl = `/uploads/${req.file.filename}`;
    const rawText = await extractResumeText(req.file.path, req.file.originalname);

    if (!rawText || rawText.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract readable text from this document. Please ensure it is not a scanned image PDF.',
      });
    }

    const { data: parsedData, usedAI, model } = await parseResumeWithGemini(
      rawText,
      req.body.apiKey
    );

    // Automatically link the uploaded resume file URL in student profile
    const profile = await StudentProfile.findOne({ userId: req.user._id });
    if (profile) {
      await StudentProfile.findByIdAndUpdate(profile._id, { resumeUrl: fileUrl });
    }

    return res.json({
      success: true,
      message: 'Resume parsed successfully',
      data: parsedData,
      usedAI,
      resumeUrl: fileUrl,
      fileName: req.file.originalname,
    });
  } catch (err: any) {
    console.error('Error in parseResumeAI:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to parse resume document',
      error: err.message,
    });
  }
}

export async function applyParsedResume(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const payload: IParsedResume = req.body;
    if (!payload || !payload.personal_information) {
      return res.status(400).json({ success: false, message: 'Invalid parsed resume data payload' });
    }

    const {
      personal_information,
      academic_information,
      technical_stack_skills,
      social_portfolio_links,
      additional_sections,
    } = payload;

    // 1. Update user name if present
    if (personal_information.full_name && personal_information.full_name.trim()) {
      await User.findByIdAndUpdate(req.user._id, {
        name: personal_information.full_name.trim(),
      });
    }

    // 2. Map 9 standard sections
    // Section 1: Career Objective (null if not in resume)
    const careerObjective = additional_sections?.career_objective || null;

    // Section 2: Education List
    const educationList = [];
    if (academic_information?.college_institute_name || academic_information?.degree_major) {
      educationList.push({
        id: generateId(),
        degree: academic_information.degree_major || 'B.Tech',
        college: academic_information.college_institute_name || 'Engineering Institute',
        duration: academic_information.graduation_year ? `Passing ${academic_information.graduation_year}` : '',
        cgpa: academic_information.current_cgpa || '',
      });
    }

    // Section 3: Work Experience List
    const workExperienceList = (additional_sections?.work_experience || []).map((e) => ({
      id: generateId(),
      company: e.company || '',
      role: e.role || '',
      duration: e.duration || '',
      description: e.description || '',
      type: /intern/i.test(e.role || '') ? ('internship' as const) : ('job' as const),
    }));

    // Section 4: Extra Curricular
    const extraCurricular = additional_sections?.extra_curricular_activities || [];

    // Section 5: Trainings / Courses
    const trainingsCourses = (additional_sections?.trainings_courses || []).map((t) => ({
      id: generateId(),
      title: t.title || '',
      organization: t.organization || '',
      year: t.year || '',
      certificateUrl: (t as any).certificateUrl || (t as any).link || '',
      link: (t as any).link || '',
    }));

    // Section 6: Academics / Personal Projects
    const projectList = (additional_sections?.academic_personal_projects || []).map((p) => ({
      id: generateId(),
      title: p.project_name || 'Academic Project',
      description: p.description || '',
      technologies: Array.isArray(p.tech_stack) ? p.tech_stack : [],
      link: (p as any).link || '',
      githubUrl: (p as any).githubUrl || '',
    }));

    // Section 7: Skills
    const skills = Array.isArray(technical_stack_skills?.skills) ? technical_stack_skills.skills : [];

    // Section 8: Portfolio / Work Samples
    const portfolioList = [];
    if (social_portfolio_links?.github_profile_url) {
      portfolioList.push({ id: generateId(), name: 'GitHub Profile', url: social_portfolio_links.github_profile_url });
    }
    if (social_portfolio_links?.linkedin_url) {
      portfolioList.push({ id: generateId(), name: 'LinkedIn Profile', url: social_portfolio_links.linkedin_url });
    }
    if (social_portfolio_links?.personal_website) {
      portfolioList.push({ id: generateId(), name: 'Personal Website', url: social_portfolio_links.personal_website });
    }
    (additional_sections?.portfolio_work_samples || []).forEach((sample) => {
      portfolioList.push({ id: generateId(), name: 'Work Sample', url: sample });
    });

    // Section 9: Accomplishments
    const accomplishments = additional_sections?.accomplishments_additional_details || [];

    // Key Highlights (3-4 points synthesized by AI from resume)
    const keyHighlights = Array.isArray(payload.key_highlights)
      ? payload.key_highlights
      : Array.isArray((payload as any).additional_sections?.key_highlights)
      ? (payload as any).additional_sections.key_highlights
      : [];

    // Legacy sync mappings
    const mappedProjects = projectList.map((p) => ({
      title: p.title,
      description: p.description,
      technologies: p.technologies || [],
    }));

    const mappedExperience = workExperienceList.map((e) => ({
      title: e.role,
      organization: e.company,
      duration: e.duration,
      description: e.description,
    }));

    const mappedCertifications = trainingsCourses.map(
      (c) => `${c.title}${c.organization ? ` - ${c.organization}` : ''}${c.year ? ` (${c.year})` : ''}`
    );

    // Update or create student profile in MongoDB
    let profile = await StudentProfile.findOne({ userId: req.user._id });
    const profileUpdate: any = {
      college: academic_information?.college_institute_name || profile?.college || '',
      degree: academic_information?.degree_major || profile?.degree || '',
      graduationYear: academic_information?.graduation_year ? Number(academic_information.graduation_year) : profile?.graduationYear || 2026,
      cgpa: academic_information?.current_cgpa ? Number(academic_information.current_cgpa) : profile?.cgpa,
      bio: personal_information?.professional_bio || profile?.bio || '',
      skills: skills.length > 0 ? skills : profile?.skills || [],
      githubUrl: social_portfolio_links?.github_profile_url || profile?.githubUrl,
      linkedinUrl: social_portfolio_links?.linkedin_url || profile?.linkedinUrl,
      portfolioUrl: social_portfolio_links?.personal_website || profile?.portfolioUrl,
      careerObjective: careerObjective ?? profile?.careerObjective ?? null,
      educationList: educationList.length > 0 ? educationList : profile?.educationList || [],
      workExperienceList: workExperienceList.length > 0 ? workExperienceList : profile?.workExperienceList || [],
      extraCurricular: extraCurricular.length > 0 ? extraCurricular : profile?.extraCurricular || [],
      trainingsCourses: trainingsCourses.length > 0 ? trainingsCourses : profile?.trainingsCourses || [],
      projectList: projectList.length > 0 ? projectList : profile?.projectList || [],
      portfolioList: portfolioList.length > 0 ? portfolioList : profile?.portfolioList || [],
      accomplishments: accomplishments.length > 0 ? accomplishments : profile?.accomplishments || [],
      keyHighlights: keyHighlights.length > 0 ? keyHighlights : profile?.keyHighlights || [],
      projects: mappedProjects.length > 0 ? mappedProjects : profile?.projects || [],
      experience: mappedExperience.length > 0 ? mappedExperience : profile?.experience || [],
      certifications: mappedCertifications.length > 0 ? mappedCertifications : profile?.certifications || [],
    };

    if (profile) {
      profile = await StudentProfile.findByIdAndUpdate(profile._id, profileUpdate);
    } else {
      profile = await StudentProfile.create({
        userId: req.user._id,
        ...profileUpdate,
        availability: 'immediate',
        isPublic: true,
      });
    }

    const updatedUser = await User.findById(req.user._id);
    const { passwordHash: _, ...safeUser } = (updatedUser as any) || req.user;

    await logActivity({
      actorId: req.user._id,
      actorName: safeUser.name,
      actorRole: 'student',
      action: 'RESUME_PARSED_PROFILE_UPDATED',
      targetType: 'StudentProfile',
      targetId: profile?._id || '',
    });

    const refreshed = await StudentProfile.findOne({ userId: req.user._id }).populate('user');

    return res.json({
      success: true,
      message: 'Student profile successfully auto-populated and saved to database!',
      profile: refreshed,
      data: refreshed,
      user: safeUser,
    });
  } catch (err: any) {
    console.error('Error applying parsed resume:', err);
    return res.status(500).json({
      success: false,
      message: 'Error applying parsed resume data to profile',
      error: err.message,
    });
  }
}
