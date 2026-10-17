import { prisma } from '../config/database.js';
import { NotificationService } from './notification.service.js';
import { AuditService } from './audit.service.js';
import { sanitizeText } from '../utils/crypto.js';
import { ValidationError } from '../utils/errors.js';
import { UserRole } from '@prisma/client';

/**
 * Complaint-scoped secure messaging.
 *
 * Verified complaints: the student ↔ the responsible administrator(s).
 * Anonymous complaints: messaging is disabled entirely to protect identity.
 */
export class MessageService {
  /** Determine conversation recipients for a sender in a complaint context */
  static async resolveRecipients(complaintId: string, senderId: string, senderRole: UserRole) {
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      select: { submittedById: true, assignedToId: true, isAnonymous: true },
    });
    if (!complaint || complaint.isAnonymous) throw new ValidationError('Messaging is unavailable for this complaint');

    const isStudentSender = complaint.submittedById === senderId;
    let recipientId: string;

    if (isStudentSender) {
      // Student writes to the assigned administrator (or latest reviewer)
      const admins = await prisma.message.findMany({
        where: { complaintId, sender: { roles: { hasSome: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'] } } },
        select: { senderId: true },
        distinct: ['senderId'],
        orderBy: { createdAt: 'desc' },
      });
      recipientId = complaint.assignedToId ?? admins[0]?.senderId ?? senderId;
      if (recipientId === senderId) {
        throw new ValidationError('No administrator is assigned to this complaint yet');
      }
    } else {
      // Administrator writes to the student
      if (!complaint.submittedById) throw new ValidationError('Complaint has no student recipient');
      recipientId = complaint.submittedById;
    }

    return { senderId, recipientId };
  }

  static async send(complaintId: string, senderId: string, recipientId: string, text: string) {
    const isAdminSender = await senderRoleIsAdmin(senderId);

    const message = await prisma.message.create({
      data: { complaintId, senderId, recipientId, message: sanitizeText(text) },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, roles: true } },
        recipient: { select: { id: true, firstName: true, lastName: true, roles: true } },
      },
    });

    await NotificationService.create({
      userId: recipientId,
      type: 'ADMIN_MESSAGE',
      title: isAdminSender ? 'New message from administrator' : 'New message from student',
      message: 'You have a new message about a complaint.',
      relatedComplaintId: complaintId,
    });

    await AuditService.log({
      actorId: senderId,
      actorRole: await actorRole(senderId),
      action: 'MESSAGE_SENT',
      entityType: 'Message',
      entityId: message.id,
      newValue: { complaintId, direction: isAdminSender ? 'admin_to_student' : 'student_to_admin' },
    });

    return message;
  }

  /** Small system notice delivered as a message (e.g. info requests) */
  static async sendSystemNotice(complaintId: string, recipientId: string, actorId: string, text: string) {
    await prisma.message.create({
      data: { complaintId, senderId: actorId, recipientId, message: `Administrator request: ${sanitizeText(text)}` },
    });
    await NotificationService.notifyInfoRequested(recipientId, complaintId, '');
  }
}

async function senderRoleIsAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { roles: true } });
  return !!user?.roles.some((r) => r !== 'STUDENT');
}

async function actorRole(userId: string): Promise<UserRole | undefined> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { roles: true } });
  return user?.roles[0];
}
