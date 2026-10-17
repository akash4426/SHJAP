import { prisma } from '../config/database.js';
import { NotificationService } from './notification.service.js';
import { AuditService } from './audit.service.js';
import { logger } from '../utils/logger.js';

const categorizerLogger = logger.child({ service: 'categorizer' });

interface CategoryRule {
  keywords: string[];
  categoryCode: string;
  departmentCode: string;
}

/**
 * Deterministic rule-based complaint categorization service.
 *
 * The `classify` contract is designed so a future AI/ML classifier can
 * replace it wholesale: it takes free text and returns category + department
 * codes with a confidence, without side effects.
 */
export class CategorizationService {
  private static readonly RULES: CategoryRule[] = [
    {
      keywords: ['grade', 'mark', 'exam', 'result', 'score', 'assessment', 'test', 'credit', 'curriculum', 'syllabus'],
      categoryCode: 'ACADEMIC_ASSESSMENT',
      departmentCode: 'ACADEMICS',
    },
    {
      keywords: ['harassment', 'bully', 'bullying', 'abuse', 'discriminat', 'threat', 'intimidat', 'sexual', 'verbal'],
      categoryCode: 'HARASSMENT',
      departmentCode: 'STUDENT_AFFAIRS',
    },
    {
      keywords: ['fee', 'payment', 'refund', 'scholarship', 'financial', 'bursary', 'invoice', 'billing', 'loan'],
      categoryCode: 'FINANCIAL',
      departmentCode: 'FINANCE',
    },
    {
      keywords: ['facility', 'facilities', 'building', 'classroom', 'laboratory', 'library', 'hostel', 'dormitory', 'accommodation', 'infrastructure', 'toilet', 'washroom', 'parking', 'cleaning', 'elevator'],
      categoryCode: 'FACILITIES',
      departmentCode: 'FACILITIES',
    },
    {
      keywords: ['lecturer', 'professor', 'faculty', 'staff', 'instructor', 'teacher', 'conduct', 'unprofessional'],
      categoryCode: 'STAFF_CONDUCT',
      departmentCode: 'HUMAN_RESOURCES',
    },
    {
      keywords: ['registration', 'enrollment', 'admission', 'transcript', 'certificate', 'document', 'record', 'diploma'],
      categoryCode: 'ADMINISTRATIVE',
      departmentCode: 'REGISTRY',
    },
    {
      keywords: ['internet', 'wifi', 'wi-fi', 'computer', 'laptop', 'software', 'system', 'portal', 'login', 'password', 'email', 'printer'],
      categoryCode: 'IT_SERVICES',
      departmentCode: 'IT',
    },
    {
      keywords: ['health', 'medical', 'sick', 'clinic', 'doctor', 'nurse', 'wellness', 'mental', 'first aid'],
      categoryCode: 'HEALTH_SERVICES',
      departmentCode: 'HEALTH',
    },
  ];

  /**
   * Classify a complaint by title + description.
   * Returns matched category/department codes, or null when nothing matches.
   */
  static classify(title: string, description: string): {
    categoryCode: string;
    departmentCode: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'AMBIGUOUS';
  } | null {
    const titleText = title.toLowerCase();
    const bodyText = description.toLowerCase();

    // Occurrence counting: each keyword hit in the title counts double because
    // the title is the student's own summary of the problem.
    const occurrences = (text: string, kw: string): number => text.split(kw).length - 1;
    const weighted = (kw: string): number =>
      occurrences(titleText, kw) * 2 + occurrences(bodyText, kw);

    const scores: Array<{ rule: CategoryRule; score: number }> = [];
    for (const rule of this.RULES) {
      const score = rule.keywords.reduce((sum, kw) => sum + weighted(kw), 0);
      if (score > 0) scores.push({ rule, score });
    }

    if (scores.length === 0) return null;

    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];
    const runnerUp = scores[1]?.score ?? 0;

    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'AMBIGUOUS';
    if (scores.length > 1 && top.score === runnerUp) {
      // Exact tie between two categories — flag for manual categorization.
      confidence = 'AMBIGUOUS';
    } else if (scores.length === 1 || top.score > runnerUp * 2) {
      confidence = top.score >= 3 ? 'HIGH' : top.score >= 2 ? 'MEDIUM' : 'LOW';
    } else {
      confidence = 'MEDIUM';
    }

    return {
      categoryCode: top.rule.categoryCode,
      departmentCode: top.rule.departmentCode,
      confidence,
    };
  }

  /**
   * Apply categorization to a freshly submitted complaint:
   * resolve category + department, assign a department administrator,
   * move status to CATEGORIZED/ASSIGNED, notify the assignee, audit the event.
   * Ambiguous results are flagged for manual categorization and surfaced to admins.
   */
  static async categorizeAndAssign(complaintId: string): Promise<void> {
    const complaint = await prisma.complaint.findUnique({
      where: { id: complaintId },
      select: { id: true, title: true, description: true, status: true, complaintNumber: true },
    });

    if (!complaint || complaint.status !== 'SUBMITTED') return;

    const result = this.classify(complaint.title, complaint.description);

    if (!result || result.confidence === 'AMBIGUOUS') {
      // Manual categorization required
      await prisma.complaint.update({
        where: { id: complaintId },
        data: { needsManualCategorization: true },
      });

      await prisma.complaintStatusHistory.create({
        data: {
          complaintId,
          previousStatus: 'SUBMITTED',
          newStatus: 'SUBMITTED',
          changedByLabel: 'System (auto-categorization)',
          reason: 'Automatic categorization was ambiguous — manual categorization required',
        },
      });

      await AuditService.log({
        action: 'COMPLAINT_CREATED',
        entityType: 'Complaint',
        entityId: complaintId,
        newValue: { autoCategorization: 'AMBIGUOUS', flagged: 'needsManualCategorization' },
      });

      // Notify authorized administrators to categorize manually
      const mainAdmins = await prisma.user.findMany({
        where: { roles: { has: 'MAIN_ADMIN' }, isActive: true, deletedAt: null },
        select: { id: true },
      });
      const collegeAdmins = await prisma.user.findMany({
        where: { roles: { has: 'COLLEGE_ADMIN' }, isActive: true, deletedAt: null },
        select: { id: true },
      });

      for (const admin of [...mainAdmins, ...collegeAdmins]) {
        await NotificationService.create({
          userId: admin.id,
          type: 'STATUS_CHANGED',
          title: 'Manual Categorization Needed',
          message: `Complaint ${complaint.complaintNumber} could not be auto-categorized. Please assign a category.`,
          relatedComplaintId: complaintId,
        });
      }

      categorizerLogger.warn({ complaintId }, 'Ambiguous complaint flagged for manual categorization');
      return;
    }

    const category = await prisma.complaintCategory.findFirst({
      where: { code: result.categoryCode, isActive: true },
    });

    const department = await prisma.department.findFirst({
      where: { code: result.departmentCode, isActive: true },
    });

    // Find an active department administrator of that department
    let assignedAdminId: string | null = null;
    if (department) {
      const admin = await prisma.user.findFirst({
        where: {
          roles: { has: 'DEPARTMENT_ADMIN' },
          isActive: true,
          deletedAt: null,
          adminProfile: { departmentId: department.id },
        },
        select: { id: true },
      });
      assignedAdminId = admin?.id ?? null;
    }

    const newStatus: 'ASSIGNED' | 'CATEGORIZED' = assignedAdminId ? 'ASSIGNED' : 'CATEGORIZED';

    await prisma.$transaction([
      prisma.complaint.update({
        where: { id: complaintId },
        data: {
          categoryId: category?.id ?? null,
          departmentId: department?.id ?? null,
          assignedToId: assignedAdminId,
          status: newStatus,
        },
      }),
      prisma.complaintStatusHistory.create({
        data: {
          complaintId,
          previousStatus: 'SUBMITTED',
          newStatus,
          changedById: assignedAdminId ?? null,
          changedByLabel: assignedAdminId ? undefined : 'System (auto-categorization)',
          reason: `Auto-categorized as ${result.categoryCode} with ${result.confidence} confidence${assignedAdminId ? ' and assigned' : ''}`,
        },
      }),
    ]);

    await AuditService.log({
      action: 'ASSIGNMENT',
      entityType: 'Complaint',
      entityId: complaintId,
      newValue: {
        autoCategorized: true,
        categoryCode: result.categoryCode,
        departmentCode: result.departmentCode,
        confidence: result.confidence,
        assignedToId: assignedAdminId,
      },
    });

    if (assignedAdminId) {
      await NotificationService.notifyAssignment(assignedAdminId, complaintId, complaint.complaintNumber);
    }

    categorizerLogger.info({ complaintId, ...result }, 'Complaint auto-categorized');
  }
}
