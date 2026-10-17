import { prisma } from '../config/database.js';
import { UserRole, Prisma } from '@prisma/client';
import { ForbiddenError } from '../utils/errors.js';

interface AuthContextUser {
  id: string;
  roles: UserRole[];
}

interface ProfileScope {
  departmentId?: string | null;
  collegeId?: string | null;
}

interface ComplaintScope {
  submittedById?: string | null;
  assignedToId?: string | null;
  departmentId?: string | null;
  department?: { collegeId: string } | null;
  isAnonymous?: boolean;
  status?: string;
}

/**
 * Central complaint authorization.
 *
 * Scope rules (mirrors the specification):
 * - STUDENT: only their own verified complaints (never anonymous others).
 * - DEPARTMENT_ADMIN: complaints assigned to them, or belonging to their department.
 * - COLLEGE_ADMIN: complaints within departments of their college.
 * - UNIVERSITY_ADMIN: escalated / resolved / closed complaints university-wide,
 *   plus anything explicitly assigned to them.
 * - MAIN_ADMIN: everything.
 */
export class AccessControlService {
  /** Load the relevant admin scope (department / college) for a user */
  static async getAdminScope(userId: string, role: UserRole): Promise<ProfileScope> {
    if (role === 'DEPARTMENT_ADMIN' || role === 'COLLEGE_ADMIN') {
      const profile = await prisma.administratorProfile.findUnique({
        where: { userId },
        select: { departmentId: true, collegeId: true },
      });
      return { departmentId: profile?.departmentId ?? null, collegeId: profile?.collegeId ?? null };
    }
    return {};
  }

  /** Resolve the effective college of a complaint (via its department) */
  static complaintCollegeId(complaint: ComplaintScope): string | null {
    return complaint.department?.collegeId ?? null;
  }

  static canAccess(user: AuthContextUser, complaint: ComplaintScope, scope: ProfileScope): boolean {
    for (const role of user.roles) {
      switch (role) {
        case 'STUDENT':
          if (complaint.submittedById === user.id && !complaint.isAnonymous) return true;
          break;
        case 'DEPARTMENT_ADMIN':
          if (scope.departmentId && complaint.departmentId === scope.departmentId) return true;
          if (complaint.assignedToId === user.id) return true;
          break;
        case 'COLLEGE_ADMIN': {
          const collegeId = AccessControlService.complaintCollegeId(complaint);
          if (scope.collegeId && collegeId === scope.collegeId) return true;
          if (complaint.assignedToId === user.id) return true;
          break;
        }
        case 'UNIVERSITY_ADMIN':
          if (['ESCALATED', 'RESOLUTION_PROPOSED', 'RESOLVED', 'CLOSED'].includes(complaint.status ?? '')) return true;
          if (complaint.assignedToId === user.id) return true;
          break;
        case 'MAIN_ADMIN':
          return true;
      }
    }
    return false;
  }

  /** Assert access; throws ForbiddenError when denied */
  static async assertComplaintAccess(user: AuthContextUser, complaint: ComplaintScope): Promise<ProfileScope> {
    const primary = user.roles[0];
    const scope = await this.getAdminScope(user.id, primary);
    if (!this.canAccess(user, complaint, scope)) {
      throw new ForbiddenError('You are not authorized to access this complaint');
    }
    return scope;
  }

  /** Bulk visibility filter for complaint lists, combined with user filters */
  static async buildComplaintListWhere(
    user: AuthContextUser,
    filters: Record<string, unknown> = {}
  ): Promise<Prisma.ComplaintWhereInput> {
    const where: Prisma.ComplaintWhereInput = { deletedAt: null };
    const scopeConditions: Prisma.ComplaintWhereInput[] = [];
    let needsScope = false;

    for (const role of user.roles) {
      switch (role) {
        case 'STUDENT':
          scopeConditions.push({ submittedById: user.id, isAnonymous: false });
          break;
        case 'DEPARTMENT_ADMIN': {
          needsScope = true;
          break;
        }
        case 'COLLEGE_ADMIN': {
          needsScope = true;
          break;
        }
        case 'UNIVERSITY_ADMIN':
          scopeConditions.push({
            OR: [
              { status: { in: ['ESCALATED', 'RESOLUTION_PROPOSED', 'RESOLVED', 'CLOSED'] as Prisma.EnumComplaintStatusFilter[] } },
              { assignedToId: user.id },
            ] as Prisma.ComplaintWhereInput[],
          });
          break;
        case 'MAIN_ADMIN':
          return this.applyFilters(where, filters);
      }
    }

    if (user.roles.includes('DEPARTMENT_ADMIN') || user.roles.includes('COLLEGE_ADMIN')) {
      const scope = await this.getAdminScope(user.id, user.roles[0]);
      if (user.roles.includes('DEPARTMENT_ADMIN') && scope.departmentId) {
        scopeConditions.push({ OR: [{ departmentId: scope.departmentId }, { assignedToId: user.id }] });
      } else if (user.roles.includes('COLLEGE_ADMIN') && scope.collegeId) {
        scopeConditions.push({
          OR: [
            { department: { collegeId: scope.collegeId } },
            { assignedToId: user.id },
          ],
        });
      } else {
        scopeConditions.push({ assignedToId: user.id });
      }
    }

    if (scopeConditions.length === 0 && !needsScope) {
      // Non-admin, non-student shouldn't reach here; deny all
      scopeConditions.push({ submittedById: '__NONE__' });
    }

    // Combine role scopes with OR, then apply user filters with AND
    let roleCondition: Prisma.ComplaintWhereInput;
    if (scopeConditions.length === 1) {
      roleCondition = scopeConditions[0];
    } else {
      roleCondition = { OR: scopeConditions };
    }

    const filtered = this.applyFilters({ AND: [roleCondition] } as Prisma.ComplaintWhereInput, filters);
    return { AND: [roleCondition, ...((filtered.AND as Prisma.ComplaintWhereInput[]) ?? [])] };
  }

  private static applyFilters(where: Prisma.ComplaintWhereInput, filters: Record<string, unknown>): Prisma.ComplaintWhereInput {
    const w = { ...where } as Prisma.ComplaintWhereInput & Record<string, unknown>;
    if (filters.status) w.status = filters.status as Prisma.EnumComplaintStatusFilter;
    if (filters.statusIn) w.status = { in: filters.statusIn } as Prisma.ComplaintWhereInput['status'];
    if (filters.priority) w.priority = filters.priority as Prisma.EnumComplaintPriorityFilter;
    if (filters.categoryId) w.categoryId = filters.categoryId as string;
    if (filters.departmentId) w.departmentId = filters.departmentId as string;
    if (filters.submissionMode) w.submissionMode = filters.submissionMode as Prisma.EnumSubmissionModeFilter;
    if (filters.createdAfter || filters.createdBefore) {
      const range: Prisma.DateTimeFilter = {};
      if (filters.createdAfter) range.gte = filters.createdAfter as Date;
      if (filters.createdBefore) range.lte = filters.createdBefore as Date;
      w.createdAt = range;
    }
    if (filters.search) {
      const s = String(filters.search);
      w.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { complaintNumber: { contains: s, mode: 'insensitive' } },
      ];
    }
    return w as Prisma.ComplaintWhereInput;
  }
}
