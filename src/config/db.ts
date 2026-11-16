import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const DATA_FILE = path.resolve(process.cwd(), 'data', 'db.json');

// Check if data directory exists
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function generateId(): string {
  return crypto.randomBytes(12).toString('hex');
}

export interface DatabaseState {
  users: any[];
  studentProfiles: any[];
  companyProfiles: any[];
  teams: any[];
  teamMemberships: any[];
  teamInvitations: any[];
  projects: any[];
  applications: any[];
  assessments: any[];
  assessmentSubmissions: any[];
  projectWorkspaces: any[];
  tasks: any[];
  milestones: any[];
  deliverables: any[];
  conversations: any[];
  messages: any[];
  notifications: any[];
  bookmarks: any[];
  reviews: any[];
  verificationRequests: any[];
  activityLogs: any[];
}

const defaultState: DatabaseState = {
  users: [],
  studentProfiles: [],
  companyProfiles: [],
  teams: [],
  teamMemberships: [],
  teamInvitations: [],
  projects: [],
  applications: [],
  assessments: [],
  assessmentSubmissions: [],
  projectWorkspaces: [],
  tasks: [],
  milestones: [],
  deliverables: [],
  conversations: [],
  messages: [],
  notifications: [],
  bookmarks: [],
  reviews: [],
  verificationRequests: [],
  activityLogs: [],
};

class FileDatabase {
  private state: DatabaseState;
  private isSaving = false;
  private saveQueued = false;

  constructor() {
    this.state = this.load();
  }

  private load(): DatabaseState {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const data = fs.readFileSync(DATA_FILE, 'utf-8');
        return { ...defaultState, ...JSON.parse(data) };
      }
    } catch (err) {
      console.error('Error loading db.json, initializing fresh store:', err);
    }
    return { ...defaultState };
  }

  public save() {
    if (this.isSaving) {
      this.saveQueued = true;
      return;
    }
    this.isSaving = true;
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving db.json:', err);
    } finally {
      this.isSaving = false;
      if (this.saveQueued) {
        this.saveQueued = false;
        this.save();
      }
    }
  }

  public getCollection<T = any>(name: keyof DatabaseState): T[] {
    if (!this.state[name]) {
      this.state[name] = [];
    }
    return this.state[name] as T[];
  }

  public reset() {
    this.state = { ...defaultState };
    this.save();
  }
}

export const fileDb = new FileDatabase();

export let isMongooseConnected = false;

export async function ensureAdminInMongo(): Promise<void> {
  if (!mongoose.connection.db) return;
  const usersCol = mongoose.connection.db.collection('users');
  const admin = await usersCol.findOne({ email: 'admin@projectlink.dev' });
  if (!admin) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('admin123', salt);
    const now = new Date().toISOString();
    await usersCol.insertOne({
      _id: 'admin_usr_001' as any,
      name: 'Platform Administrator',
      email: 'admin@projectlink.dev',
      passwordHash,
      role: 'admin',
      status: 'active',
      isEmailVerified: true,
      avatar: '',
      createdAt: now,
      updatedAt: now,
    });
    console.log(' Verified Admin credentials directly saved in MongoDB.');
  } else {
    console.log(' Admin credentials active in MongoDB.');
  }
}

export async function syncDbJsonToMongo(): Promise<void> {
  if (!mongoose.connection.db) return;
  const state = (fileDb as any).state as DatabaseState;
  for (const [colName, docs] of Object.entries(state)) {
    if (Array.isArray(docs) && docs.length > 0) {
      const col = mongoose.connection.db.collection(colName);
      const count = await col.countDocuments({});
      if (count === 0) {
        await col.insertMany(docs.map((d: any) => ({ ...d })));
        console.log(`  Synced ${docs.length} ${colName} to MongoDB collection`);
      }
    }
  }
}

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('localhost') || uri.includes('127.0.0.1')) {
    try {
      mongoose.set('strictQuery', false);
      await mongoose.connect(uri || 'mongodb://localhost:27017/projectlink', {
        serverSelectionTimeoutMS: 3000,
      });
      isMongooseConnected = true;
      console.log(' Successfully connected to MongoDB via Mongoose');
      await ensureAdminInMongo();
      await syncDbJsonToMongo();
      return;
    } catch (err: any) {
      isMongooseConnected = false;
      console.log(' Local MongoDB service not active. Using High-Performance Embedded JSON Store (data/db.json).');
      return;
    }
  }

  // Cloud Atlas connection
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    isMongooseConnected = true;
    console.log(' Successfully connected to Cloud MongoDB Atlas');
    await ensureAdminInMongo();
    await syncDbJsonToMongo();
  } catch (err: any) {
    isMongooseConnected = false;
    console.log(' Could not connect to MongoDB URI. Falling back to persistent data/db.json.');
  }
}
