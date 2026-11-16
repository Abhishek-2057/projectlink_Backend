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
