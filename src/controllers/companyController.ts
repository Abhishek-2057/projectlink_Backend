import { Response } from 'express';
import { User, CompanyProfile, Project, VerificationRequest } from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';
import { logActivity, createNotification } from '../utils/helpers.js';

export async function getCompanies(req: AuthRequest, res: Response) {
  try {
    const { search, industry, location, page = 1, limit = 12 } = req.query;

    const filter: any = {};
    if (industry) filter.industry = { $regex: String(industry), $options: 'i' };
    if (location) filter.location = { $regex: String(location), $options: 'i' };

    let companies = await CompanyProfile.find(filter).populate('user');
    if (search) {
      const q = String(search).toLowerCase();
      companies = companies.filter(
        (c: any) =>
          c.companyName.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.industry.toLowerCase().includes(q)
      );
    }

    const total = companies.length;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const paginated = companies.slice((pageNum - 1) * limitNum, pageNum * limitNum);

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
    return res.status(500).json({ success: false, message: 'Error fetching companies', error: err.message });
  }
}

export async function getCompanyById(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    let company = await CompanyProfile.findOne({ userId: id }).populate('user');
    if (!company) {
      company = await CompanyProfile.findById(id).populate('user');
    }

    if (!company) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    const projects = await Project.find({
      companyId: company._id,
      status: { $in: ['published', 'in_progress', 'completed'] },
    });

    return res.json({
      success: true,
      data: {
        ...company,
        projects,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving company', error: err.message });
  }
}

export async function getMeProfile(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const company = await CompanyProfile.findOne({ userId: req.user._id }).populate('user');
    if (!company) {
      return res.status(404).json({ success: false, message: 'Company profile not found' });
    }

    return res.json({ success: true, data: company });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error fetching profile', error: err.message });
  }
}

export async function updateMeProfile(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const {
      companyName,
      logo,
      website,
      industry,
      companySize,
      location,
      contactPerson,
      contactPhone,
      description,
      socialLinks,
    } = req.body;

    let company = await CompanyProfile.findOne({ userId: req.user._id });
    if (!company) {
      company = await CompanyProfile.create({
        userId: req.user._id,
        companyName: companyName || req.user.name,
        logo: logo || '',
        website: website || '',
        industry: industry || 'Technology',
        companySize: companySize || '11-50',
        location: location || '',
        contactPerson: contactPerson || req.user.name,
        contactPhone: contactPhone || '',
        description: description || '',
        verificationStatus: 'unverified',
        socialLinks: socialLinks || {},
      });
    } else {
      company = await CompanyProfile.findByIdAndUpdate(company._id, {
        companyName: companyName ?? company.companyName,
        logo: logo ?? company.logo,
        website: website ?? company.website,
        industry: industry ?? company.industry,
        companySize: companySize ?? company.companySize,
        location: location ?? company.location,
        contactPerson: contactPerson ?? company.contactPerson,
        contactPhone: contactPhone ?? company.contactPhone,
        description: description ?? company.description,
        socialLinks: socialLinks ?? company.socialLinks,
      });
    }

    if (companyName || logo) {
      await User.findByIdAndUpdate(req.user._id, {
        ...(companyName ? { name: companyName } : {}),
        ...(logo ? { avatar: logo } : {}),
      });
    }

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'UPDATE_COMPANY_PROFILE',
      targetType: 'CompanyProfile',
      targetId: company?._id || req.user._id,
    });

    const refreshed = await CompanyProfile.findOne({ userId: req.user._id }).populate('user');
    return res.json({ success: true, message: 'Company profile updated', data: refreshed });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating profile', error: err.message });
  }
}

export async function submitVerification(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const company = await CompanyProfile.findOne({ userId: req.user._id });
    if (!company) return res.status(404).json({ success: false, message: 'Company profile not found' });

    const { documents } = req.body;
    const docList = documents || (req.file ? [`/uploads/${req.file.filename}`] : ['Certificate_of_Incorporation.pdf']);

    await CompanyProfile.findByIdAndUpdate(company._id, {
      verificationStatus: 'pending',
      verificationDocuments: docList,
    });

    const vReq = await VerificationRequest.create({
      companyId: company._id,
      companyName: company.companyName,
      documents: docList,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    });

    await logActivity({
      actorId: req.user._id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'SUBMIT_VERIFICATION',
      targetType: 'VerificationRequest',
      targetId: vReq._id,
    });

    return res.json({
      success: true,
      message: 'Verification request submitted for admin review',
      data: vReq,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error submitting verification', error: err.message });
  }
}
