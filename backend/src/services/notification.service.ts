import { prisma } from '../config/database.js';
import { NotificationType } from '@prisma/client';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedComplaintId?: string;
}

export class NotificationService {
  static async create(params: CreateNotificationParams): Promise<void> {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message,
        relatedComplaintId: params.relatedComplaintId,
      },
    });
  }

  static async notifyMany(userIds: string[], params: Omit<CreateNotificationParams, 'userId'>): Promise<void> {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: params.type,
        title: params.title,
        message: params.message,
        relatedComplaintId: params.relatedComplaintId,
      })),
    });
  }

  static async getUserNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where: { userId } }),
    ]);
    return { notifications, total };
  }

  static async markAsRead(notificationId: string, userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  static async markAllAsRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  static async markUnread(notificationId: string, userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: false, readAt: null },
    });
  }

  static async getUnreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }

  // Semantic helpers for common events
  static async notifyComplaintSubmitted(userId: string, complaintId: string, complaintNumber: string) {
    await this.create({
      userId,
      type: 'COMPLAINT_SUBMITTED',
      title: 'Complaint Submitted',
      message: `Your complaint ${complaintNumber} has been submitted successfully.`,
      relatedComplaintId: complaintId,
    });
  }

  static async notifyAssignment(adminId: string, complaintId: string, complaintNumber: string) {
    await this.create({
      userId: adminId,
      type: 'COMPLAINT_ASSIGNED',
      title: 'New Complaint Assigned',
      message: `Complaint ${complaintNumber} has been assigned to you for investigation.`,
      relatedComplaintId: complaintId,
    });
  }

  static async notifyStatusChange(userId: string, complaintId: string, complaintNumber: string, newStatus: string) {
    await this.create({
      userId,
      type: 'STATUS_CHANGED',
      title: 'Complaint Status Updated',
      message: `Your complaint ${complaintNumber} status has been updated to ${newStatus.replace(/_/g, ' ')}.`,
      relatedComplaintId: complaintId,
    });
  }

  static async notifyInfoRequested(userId: string, complaintId: string, complaintNumber: string) {
    await this.create({
      userId,
      type: 'INFO_REQUESTED',
      title: 'Additional Information Requested',
      message: `The administrator has requested additional information for complaint ${complaintNumber}.`,
      relatedComplaintId: complaintId,
    });
  }

  static async notifyEscalation(userId: string, complaintId: string, complaintNumber: string) {
    await this.create({
      userId,
      type: 'COMPLAINT_ESCALATED',
      title: 'Complaint Escalated',
      message: `Complaint ${complaintNumber} has been escalated for further review.`,
      relatedComplaintId: complaintId,
    });
  }

  static async notifyResolved(userId: string, complaintId: string, complaintNumber: string) {
    await this.create({
      userId,
      type: 'COMPLAINT_RESOLVED',
      title: 'Complaint Resolved',
      message: `Your complaint ${complaintNumber} has been resolved. Please provide your feedback.`,
      relatedComplaintId: complaintId,
    });
  }

  static async notifyFeedbackRequested(userId: string, complaintId: string, complaintNumber: string) {
    await this.create({
      userId,
      type: 'FEEDBACK_REQUESTED',
      title: 'Feedback Requested',
      message: `Please rate your experience with complaint ${complaintNumber}.`,
      relatedComplaintId: complaintId,
    });
  }
}
