import { Notification, ActivityLog } from '../models/index.js';
import { emitToUser } from '../services/socket.js';
import { INotification, UserRole } from '../types/index.js';

export async function createNotification(data: {
  userId: string;
  type: INotification['type'];
  title: string;
  message: string;
  link?: string;
}): Promise<void> {
  try {
    const notif = await Notification.create({
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link || '',
      isRead: false,
    });
    emitToUser(data.userId, 'notification', notif);
  } catch (err) {
    console.error('Error creating notification:', err);
  }
}

export async function logActivity(data: {
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
}): Promise<void> {
  try {
    await ActivityLog.create(data);
  } catch (err) {
    console.error('Error logging activity:', err);
  }
}

/**
 * Generates a unique Student ID Number: 6 digits + 2 uppercase alphabets
 * Example: 849201AB, 492018XY
 */
export function generateStudentIdNumber(): string {
  const digits = Math.floor(100000 + Math.random() * 900000).toString(); // exactly 6 digits
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // excludes ambiguous I/O
  const letter1 = letters.charAt(Math.floor(Math.random() * letters.length));
  const letter2 = letters.charAt(Math.floor(Math.random() * letters.length));
  return `${digits}${letter1}${letter2}`;
}

export async function ensureStudentIdNumbers(): Promise<void> {
  try {
    const { StudentProfile } = await import('../models/index.js');
    const profiles = await StudentProfile.find({});
    for (const p of profiles) {
      if (!p.studentIdNumber) {
        const idNum = generateStudentIdNumber();
        await StudentProfile.findByIdAndUpdate(p._id, { studentIdNumber: idNum });
        console.log(` Assigned Student ID ${idNum} to profile ${p._id}`);
      }
    }
  } catch (err: any) {
    console.error('Error ensuring student ID numbers:', err.message);
  }
}

