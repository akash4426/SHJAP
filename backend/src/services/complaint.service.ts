import { prisma } from '../config/database.js';
import { AuditService } from './audit.service.js';
import { NotificationService } from './notification.service.js';
import { TrustScoreService } from './trust-score.service.js';
import { CategorizationService } from './categorization.service.js';
import { AccessControlService } from './access-control.service.js';
import { generateComplaintNumber, generateTrackingId, sanitizeText } from '../utils/crypto.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors.js';
import { ComplaintStatus, ComplaintPriority, SubmissionMode, UserRole, Complaint } from '@prisma/client';

export interface CreateComplaintDto {
  title: string;
  description: string;
  priority?: ComplaintPriority;
  categoryId?: string;
  departmentId?: string;
  location?: string;
  additionalInfo?: string;
  submissionMode: SubmissionMode;
  submittedById?: string; // absent for anonymous
}

export interface UpdateComplaintStatusDto {
  complaintId: string;
  newStatus: ComplaintStatus;
  reason?: string;
  changedById?: string | null;
  changedByRole?: UserRole;
  changedByLabel?: string;
}

export interface EscalateComplaintDto {
  complaintId: string;
  escalatedById: string;
  escalatedByRole: UserRole;
  reason: string;
  notes?: string;
}

export interface ResolveComplaintDto {
  complaintId: string;
  resolvedById: string;
  resolvedByRole: UserRole;
  summary: string;
  detailedResolution: string;
  actionTaken: string;
  resolutionDate?: Date;
}

// ─── State machine ───────────────────────────────────────────────────────────

/**
 * Allowed complaint status transitions. Every status change (manual or
 * automated) must pass through here, or it is rejected.
 */
export const ALLOWED_TRANSITIONS: Record<ComplaintStatus, ComplaintStatus[]> = {
  SUBMITTED: ['CATEGORIZED', 'ASSIGNED', 'UNDER_INVESTIGATION', 'REJECTED'],
  CATEGORIZED: ['ASSIGNED', 'UNDER_INVESTIGATION', 'REJECTED'],
  ASSIGNED: ['UNDER_INVESTIGATION', 'INFORMATION_REQUESTED', 'ESCALATED', 'RESOLUTION_PROPOSED', 'RESOLVED', 'REJECTED'],
  UNDER_INVESTIGATION: ['INFORMATION_REQUESTED', 'ESCALATED', 'RESOLUTION_PROPOSED', 'RESOLVED', 'REJECTED'],
  INFORMATION_REQUESTED: ['UNDER_INVESTIGATION', 'ESCALATED', 'RESOLVED', 'REJECTED'],
  ESCALATED: ['RESOLUTION_PROPOSED', 'RESOLVED', 'UNDER_INVESTIGATION'],
  RESOLUTION_PROPOSED: ['RESOLVED', 'REJECTED', 'UNDER_INVESTIGATION'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
};

export function isTransitionAllowed(from: ComplaintStatus, to: ComplaintStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Roles permitted for a given status change target */
export const TRANSITION_ROLES: Partial<Record<ComplaintStatus, UserRole[]>> = {
  ASSIGNED: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'],
  CATEGORIZED: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'],
  UNDER_INVESTIGATION: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'],
  INFORMATION_REQUESTED: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN'],
  ESCALATED: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN'],
  RESOLUTION_PROPOSED: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN'],
  RESOLVED: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'],
  CLOSED: ['UNIVERSITY_ADMIN', 'MAIN_ADMIN'],
  REJECTED: ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'],
};

const ACTIVES: ComplaintStatus[] = ['SUBMITTED', 'CATEGORIZED', 'ASSIGNED', 'UNDER_INVESTIGATION', 'INFORMATION_REQUESTED', 'ESCALATED', 'RESOLUTION_PROPOSED'];

export class ComplaintService {
  // ─── Create ────────────────────────────────────────────────────────────────

  static async create(dto: CreateComplaintDto, ipAddress?: string) {
    // Duplicate/abuse protection: same author, same title within window
    if (dto.submittedById) {
      const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const duplicate = await prisma.complaint.findFirst({
        where: {
          submittedById: dto.submittedById,
          title: { equals: dto.title.trim(), mode: 'insensitive' },
          createdAt: { gte: windowStart },
          deletedAt: null,
        },
        select: { complaintNumber: true },
      });
      if (duplicate) {
        throw new ConflictError(`An identical complaint (${duplicate.complaintNumber}) was already submitted recently`);
      }
    }

    const complaintNumber = generateComplaintNumber();
    const trackingId = generateTrackingId();
    const isAnonymous = dto.submissionMode === 'ANONYMOUS';

    const complaint = await prisma.complaint.create({
      data: {
        complaintNumber,
        trackingId,
        title: sanitizeText(dto.title),
        description: sanitizeText(dto.description),
        priority: dto.priority ?? 'MEDIUM',
        location: dto.location ? sanitizeText(dto.location) : undefined,
        additionalInfo: dto.additionalInfo ? sanitizeText(dto.additionalInfo) : undefined,
        submissionMode: dto.submissionMode,
        submittedById: isAnonymous ? null : dto.submittedById ?? null,
        isAnonymous,
        status: 'SUBMITTED',
        statusHistory: {
          create: {
            newStatus: 'SUBMITTED',
            changedById: isAnonymous ? null : dto.submittedById ?? null,
            changedByLabel: isAnonymous ? 'Anonymous student' : undefined,
            reason: 'Complaint submitted',
          },
        },
      },
      include: {
        category: { select: { name: true, code: true } },
        department: { select: { name: true, code: true, collegeId: true } },
        submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await AuditService.log({
      actorId: isAnonymous ? undefined : dto.submittedById,
      actorRole: isAnonymous ? undefined : 'STUDENT',
      action: 'COMPLAINT_CREATED',
      entityType: 'Complaint',
      entityId: complaint.id,
      newValue: { complaintNumber, submissionMode: dto.submissionMode },
      ipAddress,
    });

    if (!isAnonymous && dto.submittedById) {
      await NotificationService.notifyComplaintSubmitted(dto.submittedById, complaint.id, complaintNumber);
    }

    // Auto-categorize + assign (deterministic rule-based classifier),
    // then compute trust score and notify the assigned department admin.
    setImmediate(() => {
      CategorizationService.categorizeAndAssign(complaint.id)
        .then(() => {
          TrustScoreService.calculate(complaint.id);
          return prisma.complaint.findUnique({
            where: { id: complaint.id },
            select: { assignedToId: true, complaintNumber: true },
          });
        })
        .then((c) => {
          if (c?.assignedToId) {
            NotificationService.notifyAssignment(c.assignedToId, complaint.id, c.complaintNumber);
          }
        })
        .catch((err) => {
          import('../utils/logger.js').then(({ logger }) => logger.error({ err }, 'Auto-categorization failed'));
        });
    });

    return complaint;
  }

  // ─── Read ──────────────────────────────────────────────────────────────────

  static async getById(complaintId: string) {
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      include: {
        category: { select: { name: true, code: true } },
        department: { select: { name: true, code: true, collegeId: true } },
        submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true, roles: true } },
        statusHistory: {
          orderBy: { changedAt: 'asc' },
          include: { changedBy: { select: { id: true, firstName: true, lastName: true, roles: true } } },
        },
        evidence: { orderBy: { createdAt: 'asc' } },
        assessments: { include: { assessedBy: { select: { id: true, firstName: true, lastName: true, roles: true } } } },
        escalations: {
          include: {
            escalatedBy: { select: { id: true, firstName: true, lastName: true, roles: true } },
            escalatedTo: { select: { id: true, firstName: true, lastName: true, roles: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        resolution: { include: { resolvedBy: { select: { id: true, firstName: true, lastName: true, roles: true } } } },
        trustScore: true,
        feedback: true,
      },
    });

    if (!complaint || complaint.deletedAt) throw new NotFoundError('Complaint');
    return complaint;
  }

  /** Strips identity fields for anonymous complaints (defense in depth) */
  static sanitizeForRequester<T extends { isAnonymous: boolean } & Record<string, unknown>>(complaint: T): T {
    if (!complaint.isAnonymous) return complaint;
    return {
      ...complaint,
      submittedById: null,
      submittedBy: null,
    } as T;
  }

  /** Anonymized public tracking payload (no identity, limited fields) */
  static async getByTrackingId(trackingId: string) {
    const complaint = await prisma.complaint.findUnique({
      where: { trackingId },
      select: {
        complaintNumber: true,
        trackingId: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        category: { select: { name: true } },
        department: { select: { name: true } },
        statusHistory: {
          orderBy: { changedAt: 'asc' },
          select: { newStatus: true, reason: true, changedByLabel: true, changedAt: true },
        },
      },
    });

    if (!complaint || complaint.title.length === 0) throw new NotFoundError('Complaint');
    return complaint;
  }

  static async list(
    user: { id: string; roles: UserRole[] },
    filters: Record<string, unknown> = {},
    { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' as 'asc' | 'desc' } = {}
  ) {
    limit = Math.min(limit, 100);
    page = Math.max(page, 1);
    const sortFields = ['createdAt', 'updatedAt', 'priority', 'status'] as const;
    const orderByField: 'createdAt' | 'updatedAt' | 'priority' | 'status' =
      (sortFields as readonly string[]).includes(sortBy) ? (sortBy as typeof sortFields[number]) : 'createdAt';

    const where = await AccessControlService.buildComplaintListWhere(user, filters);

    const [complaints, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        orderBy: { [orderByField]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { name: true } },
          department: { select: { name: true, collegeId: true } },
          submittedBy: { select: { id: true, firstName: true, lastName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          trustScore: { select: { score: true, status: true } },
          _count: { select: { evidence: true, messages: true } },
        },
      }),
      prisma.complaint.count({ where }),
    ]);

    const safe = complaints.map((c) => (c.isAnonymous ? this.anonymizeForList(c) : c));
    return { complaints: safe, total, page, limit };
  }

  /** Anonymous complaints hide identity even in admin lists */
  private static anonymizeForList<T extends { submittedBy: unknown; submittedById: string | null }>(c: T) {
    return { ...c, submittedById: null, submittedBy: null };
  }

  // ─── Update (students edit own while pending; admins adjust metadata) ─────

  static async update(
    complaintId: string,
    user: { id: string; roles: UserRole[] },
    data: Partial<{
      title: string;
      description: string;
      categoryId: string;
      departmentId: string;
      priority: ComplaintPriority;
      location: string;
      additionalInfo: string;
    }>
  ) {
    const complaint = await this.getById(complaintId);

    const isOwner = !complaint.isAnonymous && complaint.submittedById === user.id;
    const isAdmin = (['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'] as UserRole[]).some((r) => user.roles.includes(r));

    if (isOwner && !isAdmin) {
      // Student edit: only while still pending review, and only text fields
      if (complaint.status !== 'SUBMITTED' && complaint.status !== 'CATEGORIZED') {
        throw new ForbiddenError('Complaint can no longer be edited');
      }
      if ('categoryId' in data || 'departmentId' in data) {
        throw new ForbiddenError('Only administrators can change categorization');
      }
    } else if (!isOwner && !isAdmin) {
      throw new ForbiddenError('Not authorized to update this complaint');
    }

    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = sanitizeText(data.title);
    if (data.description !== undefined) patch.description = sanitizeText(data.description);
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.location !== undefined) patch.location = sanitizeText(data.location);
    if (data.additionalInfo !== undefined) patch.additionalInfo = sanitizeText(data.additionalInfo);
    if (isAdmin) {
      if (data.categoryId !== undefined) patch.categoryId = data.categoryId;
      if (data.departmentId !== undefined) patch.departmentId = data.departmentId;
      if (data.priority !== undefined) patch.priority = data.priority;
    }

    if (Object.keys(patch).length === 0) return complaint;

    const previous = { title: complaint.title, priority: complaint.priority, status: complaint.status };

    const updated = await prisma.complaint.update({ where: { id: complaintId }, data: patch });

    await AuditService.log({
      actorId: user.id,
      actorRole: user.roles[0],
      action: 'COMPLAINT_UPDATED',
      entityType: 'Complaint',
      entityId: complaintId,
      previousValue: previous,
      newValue: patch,
    });

    if (patch.categoryId !== undefined || patch.departmentId !== undefined) {
      await TrustScoreService.calculate(complaintId);
    }

    return updated;
  }

  static async softDelete(complaintId: string, user: { id: string; roles: UserRole[] }) {
    const complaint = await this.getById(complaintId);

    await prisma.complaint.update({
      where: { id: complaintId },
      data: { deletedAt: new Date() },
    });

    await AuditService.log({
      actorId: user.id,
      actorRole: user.roles[0],
      action: 'COMPLAINT_DELETED',
      entityType: 'Complaint',
      entityId: complaintId,
      previousValue: { complaintNumber: complaint.complaintNumber, status: complaint.status },
    });
  }

  // ─── Status transitions ───────────────────────────────────────────────────

  static async updateStatus(dto: UpdateComplaintStatusDto) {
    const complaint = await prisma.complaint.findUnique({
      where: { id: dto.complaintId, deletedAt: null },
      select: { id: true, status: true, complaintNumber: true, submittedById: true, isAnonymous: true },
    });
    if (!complaint) throw new NotFoundError('Complaint');

    if (!isTransitionAllowed(complaint.status, dto.newStatus)) {
      throw new ValidationError(`Cannot transition complaint from ${complaint.status} to ${dto.newStatus}`);
    }

    if (dto.changedByRole && TRANSITION_ROLES[dto.newStatus]) {
      const allowed = (TRANSITION_ROLES[dto.newStatus] ?? []).includes(dto.changedByRole);
      if (!allowed && dto.changedByRole !== 'MAIN_ADMIN') {
        throw new ForbiddenError('Your role cannot set this status');
      }
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.complaint.update({
        where: { id: dto.complaintId },
        data: {
          status: dto.newStatus,
          resolvedAt: dto.newStatus === 'RESOLVED' ? now : undefined,
          closedAt: dto.newStatus === 'CLOSED' ? now : undefined,
        },
      }),
      prisma.complaintStatusHistory.create({
        data: {
          complaintId: dto.complaintId,
          previousStatus: complaint.status,
          newStatus: dto.newStatus,
          changedById: dto.changedById ?? null,
          changedByLabel: dto.changedByLabel,
          reason: dto.reason,
        },
      }),
    ]);

    await AuditService.log({
      actorId: dto.changedById ?? undefined,
      actorRole: dto.changedByRole,
      action: 'STATUS_CHANGED',
      entityType: 'Complaint',
      entityId: dto.complaintId,
      previousValue: { status: complaint.status },
      newValue: { status: dto.newStatus, reason: dto.reason },
    });

    if (complaint.submittedById) {
      await NotificationService.notifyStatusChange(complaint.submittedById, complaint.id, complaint.complaintNumber, dto.newStatus);
    }

    TrustScoreService.calculate(dto.complaintId);
  }

  // ─── Assignment ────────────────────────────────────────────────────────────

  static async assign(
    complaintId: string,
    assignedById: string,
    assignedByRole: UserRole,
    assignedToId: string,
    notes?: string
  ) {
    const complaint = await this.getById(complaintId);

    const target = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, roles: true, isActive: true, adminProfile: { select: { departmentId: true } } },
    });
    if (!target || !target.roles.includes('DEPARTMENT_ADMIN') || !target.isActive) {
      throw new ValidationError('Assignee must be an active Department Administrator');
    }
    if (complaint.departmentId && target.adminProfile?.departmentId && target.adminProfile.departmentId !== complaint.departmentId) {
      throw new ValidationError('Assignee does not belong to the complaint department');
    }

    const wasAssigned = complaint.assignedToId;
    await prisma.$transaction([
      prisma.complaint.update({
        where: { id: complaintId },
        data: {
          assignedToId,
          ...(wasAssigned ? {} : { status: complaint.status === 'SUBMITTED' || complaint.status === 'CATEGORIZED' ? 'ASSIGNED' : complaint.status }),
        },
      }),
      prisma.complaintAssignment.create({
        data: { complaintId, assignedById, assignedToId, notes },
      }),
      ...(complaint.status === 'SUBMITTED' || complaint.status === 'CATEGORIZED'
        ? [prisma.complaintStatusHistory.create({
            data: {
              complaintId,
              previousStatus: complaint.status,
              newStatus: 'ASSIGNED',
              changedById: assignedById,
              reason: notes ? `Assigned: ${notes}` : 'Assigned to department administrator',
            },
          })]
        : []),
    ]);

    await AuditService.log({
      actorId: assignedById,
      actorRole: assignedByRole,
      action: 'ASSIGNMENT',
      entityType: 'Complaint',
      entityId: complaintId,
      previousValue: wasAssigned ? { assignedToId: wasAssigned } : undefined,
      newValue: { assignedToId, notes },
    });

    await NotificationService.notifyAssignment(assignedToId, complaintId, complaint.complaintNumber);
    if (complaint.submittedById && assignedToId !== wasAssigned) {
      await NotificationService.create({
        userId: complaint.submittedById,
        type: 'STATUS_CHANGED',
        title: 'Administrator Assigned',
        message: `Complaint ${complaint.complaintNumber} has been assigned to a department administrator.`,
        relatedComplaintId: complaintId,
      });
    }
  }

  // ─── Assess ────────────────────────────────────────────────────────────────

  static async assess(
    complaintId: string,
    assessedById: string,
    assessedByRole: UserRole,
    data: {
      investigationNotes?: string;
      evidenceAssessment?: string;
      findings?: string;
      recommendedAction?: string;
      resolutionDecision?: string;
      isInformationRequested?: boolean;
      informationRequested?: string;
    }
  ) {
    const complaint = await this.getById(complaintId);
    const clean = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? sanitizeText(v) : v])
    );

    const assessment = await prisma.complaintAssessment.upsert({
      where: { complaintId_assessedById: { complaintId, assessedById } },
      update: { ...clean, updatedAt: new Date() },
      create: { complaintId, assessedById, ...clean },
    });

    await AuditService.log({
      actorId: assessedById,
      actorRole: assessedByRole,
      action: 'ASSESSMENT',
      entityType: 'Complaint',
      entityId: complaintId,
      newValue: { isInformationRequested: data.isInformationRequested ?? false, hasFindings: !!data.findings },
    });

    // Update status based on assessment outcome
    if (data.isInformationRequested) {
      await this.updateStatus({
        complaintId,
        newStatus: 'INFORMATION_REQUESTED',
        changedById: assessedById,
        changedByRole: assessedByRole,
        reason: `Additional information requested: ${data.informationRequested ?? 'see assessment'}`,
      });
      if (complaint.submittedById) {
        await NotificationService.notifyInfoRequested(complaint.submittedById, complaintId, complaint.complaintNumber);
      }
    } else if (['ASSIGNED', 'SUBMITTED', 'CATEGORIZED'].includes(complaint.status)) {
      await this.updateStatus({
        complaintId,
        newStatus: 'UNDER_INVESTIGATION',
        changedById: assessedById,
        changedByRole: assessedByRole,
        reason: 'Assessment recorded; investigation underway',
      });
    }

    TrustScoreService.calculate(complaintId);
    return assessment;
  }

  // ─── Escalation ────────────────────────────────────────────────────────────

  static async escalate(dto: EscalateComplaintDto) {
    const complaint = await this.getById(dto.complaintId);
    if (!['ASSIGNED', 'UNDER_INVESTIGATION', 'INFORMATION_REQUESTED'].includes(complaint.status)) {
      throw new ValidationError(`Complaint in status ${complaint.status} cannot be escalated`);
    }

    // Resolve target: dept escalation → college admin of the complaint college;
    // college escalation → university admin.
    let targetId: string | undefined;
    const previousLevel = dto.escalatedByRole === 'COLLEGE_ADMIN' ? 'COLLEGE' : 'DEPARTMENT';

    if (dto.escalatedByRole === 'DEPARTMENT_ADMIN') {
      const collegeId = complaint.department?.collegeId;
      const collegeAdmin = await prisma.user.findFirst({
        where: {
          roles: { has: 'COLLEGE_ADMIN' },
          isActive: true,
          adminProfile: { collegeId },
        },
        select: { id: true },
      });
      targetId = collegeAdmin?.id;
    }

    const newLevel = previousLevel === 'DEPARTMENT' ? 'COLLEGE' : 'UNIVERSITY';

    await prisma.$transaction([
      prisma.complaint.update({
        where: { id: dto.complaintId },
        data: { status: 'ESCALATED', assignedToId: targetId ?? null },
      }),
      prisma.complaintStatusHistory.create({
        data: {
          complaintId: dto.complaintId,
          previousStatus: complaint.status,
          newStatus: 'ESCALATED',
          changedById: dto.escalatedById,
          reason: `Escalated to ${newLevel} level: ${dto.reason}`,
        },
      }),
      prisma.complaintEscalation.create({
        data: {
          complaintId: dto.complaintId,
          escalatedById: dto.escalatedById,
          escalatedToId: targetId ?? null,
          reason: sanitizeText(dto.reason),
          notes: dto.notes ? sanitizeText(dto.notes) : undefined,
          previousLevel,
          newLevel,
        },
      }),
    ]);

    await AuditService.log({
      actorId: dto.escalatedById,
      actorRole: dto.escalatedByRole,
      action: 'ESCALATION',
      entityType: 'Complaint',
      entityId: dto.complaintId,
      previousValue: { status: complaint.status },
      newValue: { reason: dto.reason, newLevel, escalatedToId: targetId },
    });

    if (complaint.submittedById) {
      await NotificationService.notifyEscalation(complaint.submittedById, dto.complaintId, complaint.complaintNumber);
    }
    if (targetId) {
      await NotificationService.notifyAssignment(targetId, dto.complaintId, complaint.complaintNumber);
    }
  }

  // ─── Review & approve/reject (college) ────────────────────────────────────

  static async reviewEscalation(
    complaintId: string,
    reviewerId: string,
    reviewerRole: UserRole,
    decision: 'APPROVE' | 'REJECT',
    reviewNotes?: string
  ) {
    const complaint = await this.getById(complaintId);
    const escalation = await prisma.complaintEscalation.findFirst({
      where: { complaintId, reviewedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!escalation) throw new NotFoundError('Pending escalation');

    await prisma.complaintEscalation.update({
      where: { id: escalation.id },
      data: {
        reviewedAt: new Date(),
        reviewedById: reviewerId,
        reviewDecision: decision,
        reviewNotes: reviewNotes ? sanitizeText(reviewNotes) : undefined,
      },
    });

    await AuditService.log({
      actorId: reviewerId,
      actorRole: reviewerRole,
      action: 'STATUS_CHANGED',
      entityType: 'ComplaintEscalation',
      entityId: escalation.id,
      newValue: { decision, reviewNotes },
    });

    return decision;
  }

  // ─── Resolution ────────────────────────────────────────────────────────────

  static async resolve(dto: ResolveComplaintDto) {
    const complaint = await this.getById(dto.complaintId);
    if (!['ASSIGNED', 'UNDER_INVESTIGATION', 'INFORMATION_REQUESTED', 'ESCALATED', 'RESOLUTION_PROPOSED'].includes(complaint.status)) {
      throw new ValidationError(`Complaint in status ${complaint.status} cannot be resolved`);
    }

    await prisma.$transaction([
      prisma.complaint.update({
        where: { id: dto.complaintId },
        data: { status: 'RESOLVED', resolvedAt: dto.resolutionDate ?? new Date() },
      }),
      prisma.complaintStatusHistory.create({
        data: {
          complaintId: dto.complaintId,
          previousStatus: complaint.status,
          newStatus: 'RESOLVED',
          changedById: dto.resolvedById,
          reason: dto.summary,
        },
      }),
      prisma.resolution.upsert({
        where: { complaintId: dto.complaintId },
        update: {
          summary: sanitizeText(dto.summary),
          detailedResolution: sanitizeText(dto.detailedResolution),
          actionTaken: sanitizeText(dto.actionTaken),
          resolvedById: dto.resolvedById,
          resolutionDate: dto.resolutionDate ?? new Date(),
        },
        create: {
          complaintId: dto.complaintId,
          resolvedById: dto.resolvedById,
          summary: sanitizeText(dto.summary),
          detailedResolution: sanitizeText(dto.detailedResolution),
          actionTaken: sanitizeText(dto.actionTaken),
          resolutionDate: dto.resolutionDate ?? new Date(),
        },
      }),
    ]);

    await AuditService.log({
      actorId: dto.resolvedById,
      actorRole: dto.resolvedByRole,
      action: 'RESOLUTION',
      entityType: 'Complaint',
      entityId: dto.complaintId,
      previousValue: { status: complaint.status },
      newValue: { summary: dto.summary },
    });

    if (complaint.submittedById) {
      await NotificationService.notifyResolved(complaint.submittedById, dto.complaintId, complaint.complaintNumber);
      await NotificationService.notifyFeedbackRequested(complaint.submittedById, dto.complaintId, complaint.complaintNumber);
    }
  }

  // ─── Feedback ──────────────────────────────────────────────────────────────

  static async submitFeedback(
    complaintId: string,
    data: { rating: number; comment?: string; studentId?: string | null; isAnonymous?: boolean }
  ) {
    if (data.rating < 1 || data.rating > 5) {
      throw new ValidationError('Rating must be between 1 and 5');
    }

    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId, deletedAt: null },
      select: { status: true, complaintNumber: true, isAnonymous: true },
    });
    if (!complaint) throw new NotFoundError('Complaint');
    if (!['RESOLVED', 'CLOSED'].includes(complaint.status)) {
      throw new ValidationError('Feedback can only be submitted for resolved complaints');
    }

    const feedback = await prisma.feedback.upsert({
      where: { complaintId },
      update: { rating: data.rating, comment: data.comment ? sanitizeText(data.comment) : undefined },
      create: {
        complaintId,
        studentId: complaint.isAnonymous || data.isAnonymous ? null : data.studentId ?? null,
        rating: data.rating,
        comment: data.comment ? sanitizeText(data.comment) : undefined,
        isAnonymous: complaint.isAnonymous || data.isAnonymous || false,
      },
    });

    await AuditService.log({
      actorId: complaint.isAnonymous ? undefined : data.studentId ?? undefined,
      actorRole: 'STUDENT',
      action: 'FEEDBACK',
      entityType: 'Complaint',
      entityId: complaintId,
      newValue: { rating: data.rating, anonymous: complaint.isAnonymous || !!data.isAnonymous },
    });

    return feedback;
  }

  // ─── Dashboards ────────────────────────────────────────────────────────────

  static async studentDashboard(userId: string) {
    const complaints = await prisma.complaint.findMany({
      where: { submittedById: userId, isAnonymous: false, deletedAt: null },
      select: { status: true, createdAt: true, resolvedAt: true },
    });

    const active = complaints.filter((c) => ACTIVES.includes(c.status)).length;
    const resolved = complaints.filter((c) => ['RESOLVED', 'CLOSED'].includes(c.status)).length;
    const feedbackPending = await prisma.complaint.count({
      where: {
        submittedById: userId,
        status: 'RESOLVED',
        feedback: null,
        deletedAt: null,
      },
    });

    const recent = await prisma.complaint.findMany({
      where: { submittedById: userId, isAnonymous: false, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        category: { select: { name: true } },
        statusHistory: { orderBy: { changedAt: 'desc' }, take: 1, select: { newStatus: true, changedAt: true } },
      },
    });

    const infoRequested = complaints.filter((c) => c.status === 'INFORMATION_REQUESTED').length;

    return {
      total: complaints.length,
      active,
      resolved,
      pending: complaints.filter((c) => ['SUBMITTED', 'CATEGORIZED'].includes(c.status)).length,
      infoRequested,
      feedbackPending,
      recent,
    };
  }

  static async deptDashboard(userId: string, departmentId?: string | null) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      OR: [{ assignedToId: userId }, ...(departmentId ? [{ departmentId }] : [])],
    };

    const complaints = await prisma.complaint.findMany({
      where,
      select: { status: true, priority: true, createdAt: true, resolvedAt: true },
    });

    const now = Date.now();
    const SLA_MS = 3 * 24 * 60 * 60 * 1000; // 3-day display SLA

    const count = (s: ComplaintStatus) => complaints.filter((c) => c.status === s).length;
    const overdue = complaints.filter(
      (c) => ACTIVES.includes(c.status) && now - c.createdAt.getTime() > SLA_MS
    ).length;

    return {
      total: complaints.length,
      new: count('SUBMITTED') + count('CATEGORIZED') + count('ASSIGNED'),
      underInvestigation: count('UNDER_INVESTIGATION'),
      informationRequested: count('INFORMATION_REQUESTED'),
      escalated: count('ESCALATED'),
      resolved: count('RESOLVED') + count('CLOSED'),
      overdue,
      byPriority: {
        URGENT: complaints.filter((c) => c.priority === 'URGENT' && ACTIVES.includes(c.status)).length,
        HIGH: complaints.filter((c) => c.priority === 'HIGH' && ACTIVES.includes(c.status)).length,
        MEDIUM: complaints.filter((c) => c.priority === 'MEDIUM' && ACTIVES.includes(c.status)).length,
        LOW: complaints.filter((c) => c.priority === 'LOW' && ACTIVES.includes(c.status)).length,
      },
    };
  }

  static async collegeDashboard(userId: string, collegeId?: string | null) {
    const departmentScope = collegeId ? { department: { collegeId } } : {};
    const base: PrismaWhere = { deletedAt: null };
    const scope: PrismaWhere = collegeId
      ? { OR: [{ ...departmentScope }, { assignedToId: userId }] }
      : { OR: [{ assignedToId: userId }] };

    const complaints = await prisma.complaint.findMany({
      where: { AND: [base, scope] },
      select: {
        id: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        complaintNumber: true,
        title: true,
        priority: true,
        department: { select: { name: true } },
        escalations: { select: { id: true, reviewedAt: true, reviewDecision: true } },
        resolution: { select: { id: true, summary: true } },
        trustScore: { select: { score: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const escalated = complaints.filter((c) => c.status === 'ESCALATED');
    const pendingApprovals = escalated.filter((c) =>
      c.escalations.some((e) => !e.reviewedAt)
    );

    const resolved = complaints.filter((c) => c.status === 'RESOLVED' || c.status === 'CLOSED');
    const avgResolutionHours = resolved.length
      ? Math.round(
          resolved.reduce(
            (sum, c) => sum + ((c.resolvedAt ?? c.createdAt).getTime() - c.createdAt.getTime()),
            0
          ) / resolved.length / (1000 * 60 * 60)
        )
      : null;

    return {
      total: complaints.length,
      escalated: escalated.length,
      pendingApprovals: pendingApprovals.length,
      resolved: resolved.length,
      avgResolutionHours,
      byStatus: complaints.reduce<Record<string, number>>((acc, c) => {
        acc[c.status] = (acc[c.status] ?? 0) + 1;
        return acc;
      }, {}),
      escalatedList: escalated.slice(0, 10),
      pendingApprovalList: pendingApprovals.slice(0, 10),
      recent: complaints.slice(0, 8),
    };
  }

  static async universityDashboard() {
    const complaints = await prisma.complaint.findMany({
      where: { deletedAt: null },
      select: {
        status: true,
        createdAt: true,
        resolvedAt: true,
        department: { select: { name: true, id: true } },
        trustScore: { select: { score: true, status: true } },
        feedback: { select: { rating: true } },
        escalations: { select: { id: true } },
      },
    });

    const active = complaints.filter((c) => ACTIVES.includes(c.status));
    const resolved = complaints.filter((c) => ['RESOLVED', 'CLOSED'].includes(c.status));
    const escalated = complaints.filter((c) => c.status === 'ESCALATED');

    const avgResolutionHours = resolved.length
      ? Math.round(
          resolved.reduce((sum, c) => sum + ((c.resolvedAt ?? c.createdAt).getTime() - c.createdAt.getTime()), 0) /
            resolved.length /
            (1000 * 60 * 60)
        )
      : null;

    const byDepartment = new Map<string, { id: string; name: string; total: number; resolved: number; escalated: number }>();
    for (const c of complaints) {
      const dept = c.department;
      if (!dept) continue;
      const entry = byDepartment.get(dept.id) ?? { id: dept.id, name: dept.name, total: 0, resolved: 0, escalated: 0 };
      entry.total += 1;
      if (['RESOLVED', 'CLOSED'].includes(c.status)) entry.resolved += 1;
      if (c.status === 'ESCALATED') entry.escalated += 1;
      byDepartment.set(dept.id, entry);
    }

    const trustScores = complaints.map((c) => c.trustScore?.score).filter((s): s is number => typeof s === 'number');
    const feedbacks = complaints.map((c) => c.feedback?.rating).filter((r): r is number => typeof r === 'number');

    return {
      total: complaints.length,
      active: active.length,
      escalated: escalated.length,
      resolved: resolved.length,
      avgResolutionHours,
      resolutionRate: complaints.length ? Math.round((resolved.length / complaints.length) * 100) : 0,
      escalationRate: complaints.length ? Math.round(
        (complaints.filter((c) => c.escalations.length > 0).length / complaints.length) * 100
      ) : 0,
      byStatus: complaints.reduce<Record<string, number>>((acc, c) => {
        acc[c.status] = (acc[c.status] ?? 0) + 1;
        return acc;
      }, {}),
      byDepartment: Array.from(byDepartment.values()).sort((a, b) => b.total - a.total),
      avgTrustScore: trustScores.length ? Math.round(trustScores.reduce((a, b) => a + b, 0) / trustScores.length) : null,
      avgSatisfaction: feedbacks.length
        ? Math.round((feedbacks.reduce((a, b) => a + b, 0) / feedbacks.length) * 10) / 10
        : null,
    };
  }
}

interface PrismaWhere {
  [key: string]: unknown;
}
