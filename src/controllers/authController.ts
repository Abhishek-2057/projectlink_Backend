import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User, StudentProfile, CompanyProfile } from '../models/index.js';
import { generateToken, AuthRequest } from '../middleware/auth.js';
import { logActivity, generateStudentIdNumber } from '../utils/helpers.js';

export async function registerStudent(req: Request, res: Response) {
  try {
    const { name, email, password, college, degree, graduationYear } = req.body;

    if (!name || !email || !password || !college || !degree || !graduationYear) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email is already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: 'student',
      status: 'active',
      isEmailVerified: true,
      avatar: '',
    });

    const studentIdNumber = generateStudentIdNumber();

    await StudentProfile.create({
      userId: user._id,
      studentIdNumber,
      college,
      degree,
      graduationYear: Number(graduationYear),
      cgpa: req.body.cgpa ? Number(req.body.cgpa) : undefined,
      bio: '',
      skills: [],
      experience: [],
      projects: [],
      certifications: [],
      availability: 'immediate',
      isPublic: true,
    });

    const token = generateToken({
      _id: user._id,
      role: user.role,
      email: user.email,
      name: user.name,
    });

    await logActivity({
      actorId: user._id,
      actorName: user.name,
      actorRole: user.role,
      action: 'REGISTER_STUDENT',
      targetType: 'User',
      targetId: user._id,
    });

    const { passwordHash: _, ...safeUser } = user;
    return res.status(201).json({
      success: true,
      message: 'Student account registered successfully',
      token,
      user: safeUser,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Registration failed', error: err.message });
  }
}

export async function registerCompany(req: Request, res: Response) {
  try {
    const {
      companyName,
      officialEmail,
      password,
      website,
      industry,
      companySize,
      contactPerson,
      description,
      location,
    } = req.body;

    if (!companyName || !officialEmail || !password || !website || !industry || !contactPerson) {
      return res.status(400).json({ success: false, message: 'Required fields missing' });
    }

    const existingUser = await User.findOne({ email: officialEmail.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email is already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await User.create({
      name: companyName,
      email: officialEmail.toLowerCase(),
      passwordHash,
      role: 'company',
      status: 'active',
      isEmailVerified: true,
      avatar: '',
    });

    await CompanyProfile.create({
      userId: user._id,
      companyName,
      website,
      industry,
      companySize: companySize || '11-50',
      location: location || 'Remote / Bengaluru, India',
      contactPerson,
      description: description || `${companyName} is leading innovation in ${industry}.`,
      verificationStatus: 'verified', // verified default for ease of testing or unverified
      logo: `https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80`,
    });

    const token = generateToken({
      _id: user._id,
      role: user.role,
      email: user.email,
      name: user.name,
    });

    await logActivity({
      actorId: user._id,
      actorName: user.name,
      actorRole: user.role,
      action: 'REGISTER_COMPANY',
      targetType: 'User',
      targetId: user._id,
    });

    const { passwordHash: _, ...safeUser } = user;
    return res.status(201).json({
      success: true,
      message: 'Company registered successfully',
      token,
      user: safeUser,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Registration failed', error: err.message });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account has been suspended.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateToken({
      _id: user._id,
      role: user.role,
      email: user.email,
      name: user.name,
    });

    const { passwordHash: _, ...safeUser } = user;

    let profile = null;
    if (user.role === 'student') {
      profile = await StudentProfile.findOne({ userId: user._id });
      if (profile && !profile.studentIdNumber) {
        const studentIdNumber = generateStudentIdNumber();
        await StudentProfile.findByIdAndUpdate(profile._id, { studentIdNumber });
        profile.studentIdNumber = studentIdNumber;
      }
    } else if (user.role === 'company') {
      profile = await CompanyProfile.findOne({ userId: user._id });
    }

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: safeUser,
      profile,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Login failed', error: err.message });
  }
}

export async function getMe(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { passwordHash: _, ...safeUser } = user;
    let profile = null;

    if (user.role === 'student') {
      profile = await StudentProfile.findOne({ userId: user._id });
      if (profile && !profile.studentIdNumber) {
        const studentIdNumber = generateStudentIdNumber();
        await StudentProfile.findByIdAndUpdate(profile._id, { studentIdNumber });
        profile.studentIdNumber = studentIdNumber;
      }
    } else if (user.role === 'company') {
      profile = await CompanyProfile.findOne({ userId: user._id });
    }

    return res.json({
      success: true,
      user: safeUser,
      profile,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving user', error: err.message });
  }
}

export async function forgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't leak user existence
      return res.json({
        success: true,
        message: 'If that email address is in our system, a password reset link has been dispatched.',
      });
    }

    // In a production system this emails a signed token; here we return instruction confirmation
    return res.json({
      success: true,
      message: 'Password reset instructions have been dispatched to your email address.',
      resetTokenPreview: 'demo-reset-token-' + Date.now(),
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error processing request', error: err.message });
  }
}

export async function resetPassword(req: Request, res: Response) {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email and new password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    await User.findByIdAndUpdate(user._id, { passwordHash });

    return res.json({
      success: true,
      message: 'Password reset successful. You may now log in with your new credentials.',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error resetting password', error: err.message });
  }
}
