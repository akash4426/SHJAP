import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database.js';
import { ComplaintService, ALLOWED_TRANSITIONS } from '../services/complaint.service.js';
import { authenticate, getAuthUser, requireRole } from '../middleware/auth.middleware.js';
import { requireComplaintAccess, getComplaint } from '../middleware/complaint-access.middleware.js';
import { MessageService } from '../services/message.service.js';
import { AuditService } from '../services/audit.service.js';
import { successResponse, paginatedResponse } from '../utils/response.js';
import { ValidationError, BadRequestError } from '../utils/errors.js';
import {
  createComplaintSchema,
  complaintQuerySchema,
  assignComplaintSchema,
  assessComplaintSchema,
  escalateComplaintSchema,
  resolveComplaintSchema,
  reviewEscalationSchema,
  closeComplaintSchema,
  rejectComplaintSchema,
  feedbackSchema,
  createMessageSchema,
  updateComplaintSchema,
} from '../validators/schemas.js';
import { UserRole } from '@prisma/client';

const ADMIN_ROLES: UserRole[] = ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'];

export async function complaintRoutes(app: FastifyInstance) {
  // ─── Core CRUD ────────────────────────────────────────────────────────────

  // POST /api/complaints — submit verified complaint (students)
  app.post('/', { preHandler: [authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!user.roles.includes('STUDENT')) throw new BadRequestError('Only students can submit complaints');

    const body = createComplaintSchema.parse(request.body);
    if (body.submissionMode === 'ANONYMOUS') {
      throw new ValidationError('Use /api/anonymous/complaints for anonymous submissions');
    }

    const complaint = await ComplaintService.create({ ...body, submittedById: user.id }, request.ip);
    return reply.status(201).send(successResponse(complaint, 'Complaint submitted successfully'));
  });

  // GET /api/complaints — role-scoped list with filters
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const q = complaintQuerySchema.parse(request.query);
    const { complaints, total, page, limit } = await ComplaintService.list(
      getAuthUser(request),
      { ...q } as Record<string, unknown>,
      { page: q.page, limit: q.limit, sortBy: q.sortBy, sortOrder: q.sortOrder }
    );
    return reply.send(paginatedResponse(complaints, total, page, limit));
  });

  // GET /api/complaints/:id
  app.get('/:id', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const full = await ComplaintService.getById(complaint.id);
    return reply.send(successResponse(full));
  });

  // PATCH /api/complaints/:id
  app.patch('/:id', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const body = updateComplaintSchema.parse(request.body);
    const updated = await ComplaintService.update(getComplaint(request).id, getAuthUser(request), body);
    return reply.send(successResponse(updated, 'Complaint updated'));
  });

  // DELETE /api/complaints/:id — soft delete, only MAIN_ADMIN
  app.delete('/:id', { preHandler: [authenticate, requireRole('MAIN_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await ComplaintService.softDelete(id, getAuthUser(request));
    return reply.send(successResponse(null, 'Complaint deleted'));
  });

  // ─── Workflow actions ─────────────────────────────────────────────────────

  // POST /api/complaints/:id/assign — (re)assign to a department admin
  app.post('/:id/assign', { preHandler: [authenticate, requireRole('MAIN_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN'), requireComplaintAccess] }, async (request, reply) => {
    const body = assignComplaintSchema.parse(request.body);
    const user = getAuthUser(request);
    await ComplaintService.assign(getComplaint(request).id, user.id, user.roles[0], body.assignedToId, body.notes);
    return reply.send(successResponse(null, 'Complaint assigned'));
  });

  // POST /api/complaints/:id/assess — record assessment / investigation notes
  app.post('/:id/assess', { preHandler: [authenticate, requireRole(...ADMIN_ROLES), requireComplaintAccess] }, async (request, reply) => {
    const body = assessComplaintSchema.parse(request.body);
    const user = getAuthUser(request);

    // Only the assigned/department admin (or higher) may assess
    if (user.roles[0] === 'DEPARTMENT_ADMIN') {
      const complaint = getComplaint(request);
      if (complaint.assignedToId && complaint.assignedToId !== user.id) {
        throw new ValidationError('Complaint is assigned to another department administrator');
      }
    }

    const assessment = await ComplaintService.assess(getComplaint(request).id, user.id, user.roles[0], body);
    return reply.send(successResponse(assessment, 'Assessment recorded'));
  });

  // POST /api/complaints/:id/escalate
  app.post('/:id/escalate', { preHandler: [authenticate, requireRole('DEPARTMENT_ADMIN', 'COLLEGE_ADMIN'), requireComplaintAccess] }, async (request, reply) => {
    const body = escalateComplaintSchema.parse(request.body);
    const user = getAuthUser(request);
    await ComplaintService.escalate({
      complaintId: getComplaint(request).id,
      escalatedById: user.id,
      escalatedByRole: user.roles[0],
      reason: body.reason,
      notes: body.notes,
    });
    return reply.send(successResponse(null, 'Complaint escalated'));
  });

  // POST /api/complaints/:id/review — college admin approve/reject pending escalation
  app.post('/:id/review', { preHandler: [authenticate, requireRole('COLLEGE_ADMIN'), requireComplaintAccess] }, async (request, reply) => {
    const body = reviewEscalationSchema.parse(request.body);
    const user = getAuthUser(request);
    const complaint = getComplaint(request);

    const pending = await prisma.complaintEscalation.findFirst({
      where: { complaintId: complaint.id, reviewedAt: null },
    });
    if (!pending) throw new ValidationError('No pending escalation to review');

    if (body.decision === 'APPROVE') {
      // Approve the department resolution proposal → resolution stands, complaint becomes RESOLVED
      const resolution = await prisma.resolution.findUnique({ where: { complaintId: complaint.id } });
      if (!resolution) {
        throw new ValidationError('No resolution proposal exists. Approve applies to proposed resolutions.');
      }
      await ComplaintService.updateStatus({
        complaintId: complaint.id,
        newStatus: 'RESOLVED',
        changedById: user.id,
        changedByRole: user.roles[0],
        reason: `Escalation reviewed and resolution approved: ${body.reviewNotes ?? body.decision}`,
      });
    } else {
      await ComplaintService.updateStatus({
        complaintId: complaint.id,
        newStatus: 'UNDER_INVESTIGATION',
        changedById: user.id,
        changedByRole: user.roles[0],
        reason: `Resolution rejected: ${body.reviewNotes ?? 'no reason provided'}`,
      });
    }

    await prisma.complaintEscalation.update({
      where: { id: pending.id },
      data: {
        reviewedAt: new Date(),
        reviewedById: user.id,
        reviewDecision: body.decision,
        reviewNotes: body.reviewNotes,
      },
    });

    return reply.send(successResponse(null, `Escalation ${body.decision === 'APPROVE' ? 'approved' : 'rejected'}`));
  });

  // POST /api/complaints/:id/resolve
  app.post('/:id/resolve', { preHandler: [authenticate, requireRole(...ADMIN_ROLES), requireComplaintAccess] }, async (request, reply) => {
    const body = resolveComplaintSchema.parse(request.body);
    const user = getAuthUser(request);
    await ComplaintService.resolve({
      complaintId: getComplaint(request).id,
      resolvedById: user.id,
      resolvedByRole: user.roles[0],
      summary: body.summary,
      detailedResolution: body.detailedResolution,
      actionTaken: body.actionTaken,
      resolutionDate: body.resolutionDate ? new Date(body.resolutionDate) : undefined,
    });
    return reply.send(successResponse(null, 'Complaint resolved'));
  });

  // POST /api/complaints/:id/close
  app.post('/:id/close', { preHandler: [authenticate, requireRole('UNIVERSITY_ADMIN', 'MAIN_ADMIN'), requireComplaintAccess] }, async (request, reply) => {
    const body = closeComplaintSchema.parse(request.body ?? {});
    const user = getAuthUser(request);
    await ComplaintService.updateStatus({
      complaintId: getComplaint(request).id,
      newStatus: 'CLOSED',
      changedById: user.id,
      changedByRole: user.roles[0],
      reason: body.reason ?? 'Complaint closed',
    });
    return reply.send(successResponse(null, 'Complaint closed'));
  });

  // POST /api/complaints/:id/reject — abuse/unfounded rejection with reason
  app.post('/:id/reject', { preHandler: [authenticate, requireRole(...ADMIN_ROLES), requireComplaintAccess] }, async (request, reply) => {
    const body = rejectComplaintSchema.parse(request.body);
    const user = getAuthUser(request);
    await ComplaintService.updateStatus({
      complaintId: getComplaint(request).id,
      newStatus: 'REJECTED',
      changedById: user.id,
      changedByRole: user.roles[0],
      reason: body.reason,
    });
    return reply.send(successResponse(null, 'Complaint rejected'));
  });

  // ─── Request additional information (moves to INFORMATION_REQUESTED) ──────

  app.post('/:id/request-info', { preHandler: [authenticate, requireRole('DEPARTMENT_ADMIN', 'COLLEGE_ADMIN'), requireComplaintAccess] }, async (request, reply) => {
    const { request: message } = (request.body ?? {}) as { request?: string };
    if (!message || message.trim().length < 10) {
      throw new ValidationError('Describe what additional information is needed');
    }
    const user = getAuthUser(request);
    const complaint = getComplaint(request);

    await prisma.complaintAssessment.upsert({
      where: { complaintId_assessedById: { complaintId: complaint.id, assessedById: user.id } },
      update: { isInformationRequested: true, informationRequested: message, updatedAt: new Date() },
      create: { complaintId: complaint.id, assessedById: user.id, isInformationRequested: true, informationRequested: message },
    });

    await ComplaintService.updateStatus({
      complaintId: complaint.id,
      newStatus: 'INFORMATION_REQUESTED',
      changedById: user.id,
      changedByRole: user.roles[0],
      reason: `Additional information requested: ${message}`,
    });

    if (complaint.submittedById) {
      await MessageService.sendSystemNotice(complaint.id, complaint.submittedById, user.id, message);
    }

    await AuditService.log({
      actorId: user.id,
      actorRole: user.roles[0],
      action: 'ASSESSMENT',
      entityType: 'Complaint',
      entityId: complaint.id,
      newValue: { informationRequested: message },
      ipAddress: request.ip,
    });

    return reply.send(successResponse(null, 'Information requested from student'));
  });

  // ─── History & timeline ────────────────────────────────────────────────────

  app.get('/:id/history', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const history = await prisma.complaintStatusHistory.findMany({
      where: { complaintId: complaint.id },
      orderBy: { changedAt: 'asc' },
      include: { changedBy: { select: { id: true, firstName: true, lastName: true, roles: true } } },
    });
    return reply.send(successResponse(history));
  });

  app.get('/:id/audit-log', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const user = getAuthUser(request);
    // Complaint-scoped audit trail: visible to admins; students see their own
    const logs = await prisma.auditLog.findMany({
      where: { entityId: complaint.id, entityType: 'Complaint' },
      orderBy: { sequence: 'asc' },
      include: { actor: { select: { firstName: true, lastName: true, roles: true } } },
      take: 100,
    });
    const serialized = logs.map((l) => ({ ...l, sequence: Number(l.sequence), payload: undefined }));
    if (!ADMIN_ROLES.includes(user.roles[0])) {
      return reply.send(successResponse(serialized.filter((l) => l.actorId === user.id)));
    }
    return reply.send(successResponse(serialized));
  });

  // ─── Trust Score ───────────────────────────────────────────────────────────

  app.get('/:id/trust-score', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const trustScore = await prisma.trustScore.findUnique({ where: { complaintId: complaint.id } });
    return reply.send(successResponse(trustScore));
  });

  // ─── Messages ──────────────────────────────────────────────────────────────

  app.get('/:id/messages', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const user = getAuthUser(request);

    if (complaint.isAnonymous) {
      // Anonymous complaints have no student identity → messaging disabled
      return reply.send(successResponse([], 'Anonymous complaints do not support messaging'));
    }

    const messages = await prisma.message.findMany({
      where: { complaintId: complaint.id },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true, roles: true } },
        recipient: { select: { id: true, firstName: true, lastName: true, roles: true } },
      },
    });

    // Mark incoming messages as read
    await prisma.message.updateMany({
      where: { complaintId: complaint.id, recipientId: user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return reply.send(successResponse(messages));
  });

  app.post('/:id/messages', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const body = createMessageSchema.parse(request.body);
    const user = getAuthUser(request);
    const complaint = getComplaint(request);

    if (complaint.isAnonymous) {
      throw new ValidationError('Anonymous complaints do not support messaging to preserve privacy');
    }

    const { senderId, recipientId } = await MessageService.resolveRecipients(complaint.id, user.id, user.roles[0]);
    const message = await MessageService.send(complaint.id, senderId, recipientId, body.message);

    return reply.status(201).send(successResponse(message, 'Message sent'));
  });

  app.get('/:id/messages/unread-count', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const user = getAuthUser(request);
    const count = await prisma.message.count({ where: { complaintId: complaint.id, recipientId: user.id, isRead: false } });
    return reply.send(successResponse({ count }));
  });

  // ─── Feedback ──────────────────────────────────────────────────────────────

  app.post('/:id/feedback', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const body = feedbackSchema.parse(request.body);
    const user = getAuthUser(request);
    const complaint = getComplaint(request);

    if (!complaint.isAnonymous && complaint.submittedById !== user.id) {
      throw new ValidationError('Only the complainant can provide feedback');
    }

    const feedback = await ComplaintService.submitFeedback(complaint.id, {
      rating: body.rating,
      comment: body.comment,
      studentId: user.id,
      isAnonymous: complaint.isAnonymous || !!(body as { isAnonymous?: boolean }).isAnonymous,
    });
    return reply.status(201).send(successResponse(feedback, 'Feedback submitted. Thank you!'));
  });

  app.get('/:id/feedback', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const feedback = await prisma.feedback.findUnique({ where: { complaintId: complaint.id } });
    return reply.send(successResponse(feedback));
  });

  // GET /api/complaints/:id/transition-options — allowed next states for UI
  app.get('/:id/transition-options', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    return reply.send(successResponse({ current: complaint.status, allowed: ALLOWED_TRANSITIONS[complaint.status] }));
  });
}

// ─── Anonymous complaint flows (no auth) ───────────────────────────────────

export async function anonymousRoutes(app: FastifyInstance) {
  // POST /api/anonymous/complaints
  app.post('/complaints', async (request, reply) => {
    const body = createComplaintSchema.parse({
      ...(request.body as object),
      submissionMode: 'ANONYMOUS',
    });

    if (body.submissionMode !== 'ANONYMOUS') {
      throw new ValidationError('Endpoint is for anonymous submissions only');
    }

    const complaint = await ComplaintService.create({ ...body, submissionMode: 'ANONYMOUS' }, request.ip);

    return reply.status(201).send(
      successResponse(
        {
          trackingId: complaint.trackingId,
          complaintNumber: complaint.complaintNumber,
          status: complaint.status,
        },
        'Anonymous complaint submitted. Save your tracking ID — your identity cannot be attached later.'
      )
    );
  });

  // GET /api/anonymous/complaints/:trackingId
  app.get('/complaints/:trackingId', async (request, reply) => {
    const { trackingId } = request.params as { trackingId: string };
    const complaint = await ComplaintService.getByTrackingId(trackingId);
    return reply.send(successResponse(complaint));
  });
}
