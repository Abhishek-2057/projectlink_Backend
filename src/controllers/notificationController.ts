import { Response } from 'express';
import { Notification } from '../models/index.js';
import { AuthRequest } from '../middleware/auth.js';

export async function getNotifications(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const notifs = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    const unreadCount = notifs.filter((n) => !n.isRead).length;

    return res.json({
      success: true,
      data: notifs,
      unreadCount,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error retrieving notifications', error: err.message });
  }
}

export async function markAsRead(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });
    const { id } = req.params;

    await Notification.findByIdAndUpdate(id, { isRead: true });
    return res.json({ success: true, message: 'Notification marked as read' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating notification', error: err.message });
  }
}

export async function markAllAsRead(req: AuthRequest, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    await Notification.updateMany({ userId: req.user._id }, { isRead: true });
    return res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: 'Error updating notifications', error: err.message });
  }
}
