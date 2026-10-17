import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database.js';
import { authenticate, getAuthUser, requireRole } from '../middleware/auth.middleware.js';
import { successResponse, paginatedResponse } from '../utils/response.js';
import { AuthService } from '../services/auth.service.js';
import { AuditService } from '../services/audit.service.js';
import { AuditLogService } from '../services/audit-query.service.js';
import {
  createUserSchema,
  updateUserSchema,
  setUserRolesSchema,
  resetUserPasswordSchema,
  departmentSchema,
  collegeSchema,
  categorySchema,
} from '../validators/schemas.js';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors.js';
import { UserRole, AuditAction } from '@prisma/client';

const MAIN_ONLY = [authenticate, requireRole('MAIN_ADMIN')];

export async function adminRoutes(app: FastifyInstance) {
  // ─── Users ─────────────────────────────────────────────────────────────────

  app.get('/users', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const q = (request.query ?? {}) as { page?: string; limit?: string; search?: string; role?: string; status?: string };
    const page = Math.max(parseInt(q.page ?? '1'), 1);
    const limit = Math.min(parseInt(q.limit ?? '20'), 100);

    const where: Record<string, unknown> = { deletedAt: null };
    if (q.search) {
      where.OR = [
        { email: { contains: q.search, mode: 'insensitive' as const } },
        { firstName: { contains: q.search, mode: 'insensitive' as const } },
        { lastName: { contains: q.search, mode: 'insensitive' as const } },
      ];
    }
    if (q.role) where.roles = { has: q.role as UserRole };
    if (q.status === 'active') where.isActive = true;
    if (q.status === 'disabled') where.isActive = false;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, firstName: true, lastName: true, phone: true,
          roles: true, isActive: true, mfaEnabled: true, lastLoginAt: true,
          failedLoginAttempts: true, lockedUntil: true, createdAt: true,
          studentProfile: { select: { studentId: true, program: true, year: true, collegeId: true, departmentId: true, department: { select: { name: true } } } },
          adminProfile: { select: { employeeId: true, designation: true, collegeId: true, departmentId: true, department: { select: { name: true } }, college: { select: { name: true } } } },
          userRoleAssignments: { select: { role: { select: { name: true } }, assignedAt: true } },
          _count: { select: { submittedComplaints: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return reply.send(paginatedResponse(users, total, page, limit));
  });

  app.post('/users', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const body = createUserSchema.parse(request.body);
    const admin = getAuthUser(request);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new ConflictError('Email already registered');

    const passwordHash = await AuthService.hashPassword(body.password);
    const isStudent = body.roles.includes('STUDENT');
    const isStaff = body.roles.some((r) => r !== 'STUDENT');

    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        roles: body.roles,
        isEmailVerified: true,
        emailVerifiedAt: new Date(),
        studentProfile: isStudent
          ? {
              create: {
                studentId: body.studentId ?? `STD-${Date.now().toString(36).toUpperCase()}`,
                program: body.program,
                year: body.year,
                collegeId: body.collegeId,
                departmentId: body.departmentId,
              },
            }
          : undefined,
        adminProfile: isStaff
          ? {
              create: {
                employeeId: body.employeeId ?? `EMP-${Date.now().toString(36).toUpperCase()}`,
                designation: body.designation ?? body.roles[0],
                collegeId: body.collegeId,
                departmentId: body.departmentId,
              },
            }
          : undefined,
      },
      select: { id: true, email: true, firstName: true, lastName: true, roles: true, isActive: true, createdAt: true },
    });

    await AuthService.createRoles(user.id, body.roles);

    await AuditService.log({
      actorId: admin.id,
      actorRole: 'MAIN_ADMIN',
      action: 'USER_MANAGEMENT',
      entityType: 'User',
      entityId: user.id,
      newValue: { action: 'CREATE', email: body.email, roles: body.roles },
      ipAddress: request.ip,
    });

    return reply.status(201).send(successResponse(user, 'User created'));
  });

  app.patch('/users/:id', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const body = updateUserSchema.parse(request.body);

    const prev = await prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true, phone: true, isActive: true } });
    if (!prev) throw new NotFoundError('User');

    const user = await prisma.user.update({
      where: { id },
      data: body,
      select: { id: true, email: true, firstName: true, lastName: true, roles: true, isActive: true },
    });

    await AuditService.log({
      actorId: admin.id,
      actorRole: 'MAIN_ADMIN',
      action: 'USER_MANAGEMENT',
      entityType: 'User',
      entityId: id,
      previousValue: prev,
      newValue: body as object,
      ipAddress: request.ip,
    });

    return reply.send(successResponse(user, 'User updated'));
  });

  // PATCH /api/admin/users/:id/roles — role management with synced cache
  app.patch('/users/:id/roles', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const { roles, collegeId, departmentId } = setUserRolesSchema.parse(request.body);

    const prev = await prisma.user.findUnique({ where: { id }, select: { roles: true } });
    if (!prev) throw new NotFoundError('User');

    const scopeProvided = collegeId !== undefined || departmentId !== undefined;
    const isStaff = roles.some((r) => r !== 'STUDENT');

    const user = await prisma.$transaction(async (tx) => {
      const roleRows = await Promise.all(
        roles.map(async (role) => {
          const found = await tx.role.findUnique({ where: { name: role } });
          return found ?? (await tx.role.create({ data: { name: role, description: `${role.replace(/_/g, ' ')} role` } }));
        })
      );

      await tx.userRoleAssignment.deleteMany({ where: { userId: id } });
      if (roleRows.length > 0) {
        await tx.userRoleAssignment.createMany({
          data: roleRows.map((role) => ({ userId: id, roleId: role.id })),
        });
      }

      // Sync the profile scope (college / department) when provided, so the
      // newly assigned admin role actually sees the right work queue.
      if (scopeProvided) {
        const scopeUpdate = {
          ...(collegeId !== undefined ? { collegeId } : {}),
          ...(departmentId !== undefined ? { departmentId } : {}),
        };
        if (isStaff) {
          await tx.administratorProfile.upsert({
            where: { userId: id },
            create: {
              userId: id,
              employeeId: `EMP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
              designation: 'Admin',
              ...scopeUpdate,
            },
            update: scopeUpdate,
          });
        } else {
          await tx.studentProfile.upsert({
            where: { userId: id },
            create: {
              userId: id,
              studentId: `STD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
              ...scopeUpdate,
            },
            update: scopeUpdate,
          });
        }
      }

      return tx.user.update({ where: { id }, data: { roles: roles as UserRole[] }, select: { id: true, email: true, roles: true, isActive: true } });
    });

    await AuditService.log({
      actorId: admin.id,
      actorRole: 'MAIN_ADMIN',
      action: 'ROLE_CHANGE',
      entityType: 'User',
      entityId: id,
      previousValue: { roles: prev.roles },
      newValue: { roles, ...(scopeProvided ? { collegeId, departmentId } : {}) },
      ipAddress: request.ip,
    });

    return reply.send(successResponse(user, 'Roles updated'));
  });

  // POST /api/admin/users/:id/reset-password — main admin account reset
  app.post('/users/:id/reset-password', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const { newPassword } = resetUserPasswordSchema.parse(request.body);

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, failedLoginAttempts: true } });
    if (!target) throw new NotFoundError('User');

    const passwordHash = await AuthService.hashPassword(newPassword);
    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      prisma.refreshToken.updateMany({ where: { userId: id }, data: { isRevoked: true } }),
    ]);

    await AuditService.log({
      actorId: admin.id,
      actorRole: 'MAIN_ADMIN',
      action: 'USER_MANAGEMENT',
      entityType: 'User',
      entityId: id,
      newValue: { action: 'PASSWORD_RESET' },
      ipAddress: request.ip,
    });

    return reply.send(successResponse(null, 'Password reset; active sessions revoked'));
  });

  // POST /api/admin/users/:id/disable | /enable — account status
  app.post('/users/:id/disable', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const user = await prisma.user.update({ where: { id }, data: { isActive: false }, select: { id: true, isActive: true } });
    await prisma.refreshToken.updateMany({ where: { userId: id }, data: { isRevoked: true } });
    await AuditService.log({
      actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'USER_MANAGEMENT',
      entityType: 'User', entityId: id, newValue: { isActive: false }, ipAddress: request.ip,
    });
    return reply.send(successResponse(user, 'User disabled'));
  });

  app.post('/users/:id/enable', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const user = await prisma.user.update({ where: { id }, data: { isActive: true, failedLoginAttempts: 0, lockedUntil: null }, select: { id: true, isActive: true } });
    await AuditService.log({
      actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'USER_MANAGEMENT',
      entityType: 'User', entityId: id, newValue: { isActive: true }, ipAddress: request.ip,
    });
    return reply.send(successResponse(user, 'User enabled'));
  });

  // ─── Roles & Permissions ─────────────────────────────────────────────────

  app.get('/roles', { preHandler: MAIN_ONLY }, async (_request, reply) => {
    const roles = await prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(successResponse(roles));
  });

  app.get('/permissions', { preHandler: MAIN_ONLY }, async (_request, reply) => {
    const permissions = await prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
    return reply.send(successResponse(permissions));
  });

  // PATCH /api/admin/roles/:roleId/permissions — assign permissions to a role
  app.patch('/roles/:roleId/permissions', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { roleId } = request.params as { roleId: string };
    const admin = getAuthUser(request);
    const { permissionIds } = (request.body ?? {}) as { permissionIds?: string[] };
    if (!Array.isArray(permissionIds)) throw new ValidationError('permissionIds array required');

    const role = await prisma.role.findUnique({ where: { id: roleId }, include: { permissions: true } });
    if (!role) throw new NotFoundError('Role');

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) }),
    ]);

    await AuditService.log({
      actorId: admin.id,
      actorRole: 'MAIN_ADMIN',
      action: 'ROLE_CHANGE',
      entityType: 'Role',
      entityId: roleId,
      previousValue: { permissions: role.permissions.map((p) => p.permissionId) },
      newValue: { permissions: permissionIds },
      ipAddress: request.ip,
    });

    return reply.send(successResponse(null, 'Role permissions updated'));
  });

  // ─── Departments / Colleges / Categories ──────────────────────────────────

  app.get('/departments', { preHandler: MAIN_ONLY }, async (_request, reply) => {
    const departments = await prisma.department.findMany({
      where: { deletedAt: null },
      include: {
        college: { select: { name: true, code: true } },
        categories: { select: { id: true, name: true, code: true } },
        admins: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
        _count: { select: { complaints: true, admins: true } },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(successResponse(departments));
  });

  app.post('/departments', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const body = departmentSchema.parse(request.body);
    const admin = getAuthUser(request);
    const existing = await prisma.department.findUnique({ where: { code: body.code } });
    if (existing) throw new ConflictError('Department code already in use');
    const department = await prisma.department.create({ data: body });
    await AuditService.log({
      actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'SETTING_CHANGE',
      entityType: 'Department', entityId: department.id, newValue: body as object, ipAddress: request.ip,
    });
    return reply.status(201).send(successResponse(department, 'Department created'));
  });

  app.patch('/departments/:id', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const body = departmentSchema.partial().parse(request.body);
    const prev = await prisma.department.findUnique({ where: { id } });
    if (!prev) throw new NotFoundError('Department');
    const department = await prisma.department.update({ where: { id }, data: body });
    await AuditService.log({
      actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'SETTING_CHANGE',
      entityType: 'Department', entityId: id,
      previousValue: { name: prev.name, code: prev.code, description: prev.description },
      newValue: body as object, ipAddress: request.ip,
    });
    return reply.send(successResponse(department, 'Department updated'));
  });

  app.get('/colleges', { preHandler: MAIN_ONLY }, async (_request, reply) => {
    const colleges = await prisma.college.findMany({
      where: { deletedAt: null },
      include: {
        departments: { select: { id: true, name: true, code: true } },
        _count: { select: { departments: true, students: true } },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(successResponse(colleges));
  });

  app.post('/colleges', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const body = collegeSchema.parse(request.body);
    const admin = getAuthUser(request);
    const existing = await prisma.college.findUnique({ where: { code: body.code } });
    if (existing) throw new ConflictError('College code already in use');
    const college = await prisma.college.create({ data: body });
    await AuditService.log({
      actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'SETTING_CHANGE',
      entityType: 'College', entityId: college.id, newValue: body as object, ipAddress: request.ip,
    });
    return reply.status(201).send(successResponse(college, 'College created'));
  });

  app.patch('/colleges/:id', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const body = collegeSchema.partial().parse(request.body);
    const prev = await prisma.college.findUnique({ where: { id } });
    if (!prev) throw new NotFoundError('College');
    const college = await prisma.college.update({ where: { id }, data: body });
    await AuditService.log({
      actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'SETTING_CHANGE',
      entityType: 'College', entityId: id,
      previousValue: { name: prev.name, code: prev.code },
      newValue: body as object, ipAddress: request.ip,
    });
    return reply.send(successResponse(college, 'College updated'));
  });

  app.get('/categories', { preHandler: MAIN_ONLY }, async (_request, reply) => {
    const categories = await prisma.complaintCategory.findMany({
      include: { department: { select: { name: true, code: true } }, _count: { select: { complaints: true } } },
      orderBy: { name: 'asc' },
    });
    return reply.send(successResponse(categories));
  });

  app.post('/categories', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const body = categorySchema.parse(request.body);
    const admin = getAuthUser(request);
    const existing = await prisma.complaintCategory.findUnique({ where: { code: body.code } });
    if (existing) throw new ConflictError('Category code already in use');
    const category = await prisma.complaintCategory.create({ data: body });
    await AuditService.log({
      actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'SETTING_CHANGE',
      entityType: 'ComplaintCategory', entityId: category.id, newValue: body as object, ipAddress: request.ip,
    });
    return reply.status(201).send(successResponse(category, 'Category created'));
  });

  app.patch('/categories/:id', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const admin = getAuthUser(request);
    const body = categorySchema.partial().parse(request.body);
    const prev = await prisma.complaintCategory.findUnique({ where: { id } });
    if (!prev) throw new NotFoundError('Category');
    const category = await prisma.complaintCategory.update({ where: { id }, data: body });
    await AuditService.log({
      actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'SETTING_CHANGE',
      entityType: 'ComplaintCategory', entityId: id,
      previousValue: { name: prev.name, keywords: prev.keywords },
      newValue: body as object, ipAddress: request.ip,
    });
    return reply.send(successResponse(category, 'Category updated'));
  });

  // ─── System Settings ───────────────────────────────────────────────────────

  app.get('/settings', { preHandler: MAIN_ONLY }, async (_request, reply) => {
    const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    return reply.send(successResponse(settings));
  });

  app.patch('/settings', { preHandler: MAIN_ONLY }, async (request, reply) => {
    const admin = getAuthUser(request);
    const { settings } = (request.body ?? {}) as { settings?: Array<{ key: string; value: unknown; description?: string }> };
    if (!Array.isArray(settings)) throw new ValidationError('settings array required');

    const results = [];
    for (const s of settings) {
      const setting = await prisma.systemSetting.upsert({
        where: { key: s.key },
        update: { value: s.value as object, description: s.description },
        create: { key: s.key, value: s.value as object, description: s.description },
      });
      await AuditService.log({
        actorId: admin.id, actorRole: 'MAIN_ADMIN', action: 'SETTING_CHANGE',
        entityType: 'SystemSetting', entityId: setting.id, newValue: { key: s.key, value: s.value }, ipAddress: request.ip,
      });
      results.push(setting);
    }

    return reply.send(successResponse(results, 'Settings updated'));
  });

  // ─── Security dashboard: logins, lockouts, chain status ───────────────────

  app.get('/security', { preHandler: MAIN_ONLY }, async (_request, reply) => {
    const [recentLogins, recentFailed, chainStatus, lockedAccounts, disabledAccounts] = await Promise.all([
      AuditLogService.list({ action: AuditAction.LOGIN, limit: 20, page: 1 }),
      AuditLogService.list({ action: AuditAction.LOGIN_FAILED, limit: 20, page: 1 }),
      AuditLogService.verify(),
      prisma.user.findMany({ where: { lockedUntil: { gt: new Date() } }, select: { id: true, email: true, lockedUntil: true } }),
      prisma.user.count({ where: { isActive: false, deletedAt: null } }),
    ]);

    return reply.send(successResponse({
      recentLogins: recentLogins.logs,
      recentFailed: recentFailed.logs,
      chainStatus,
      lockedAccounts,
      disabledAccounts,
    }));
  });
}

// ─── Audit log routes (main admin) ───────────────────────────────────────────

export async function auditRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireRole('MAIN_ADMIN')] }, async (request, reply) => {
    const q = (request.query ?? {}) as { page?: string; limit?: string; action?: string; entityType?: string; actorId?: string; search?: string };
    const result = await AuditLogService.list({
      action: q.action as AuditAction | undefined,
      entityType: q.entityType,
      actorId: q.actorId,
      search: q.search,
      page: parseInt(q.page ?? '1'),
      limit: Math.min(parseInt(q.limit ?? '50'), 200),
    });
    return reply.send(paginatedResponse(result.logs, result.total, result.page, result.limit));
  });

  // Chain integrity verification
  app.get('/verify', { preHandler: [authenticate, requireRole('MAIN_ADMIN')] }, async (_request, reply) => {
    const verification = await AuditLogService.verify();
    return reply.send(successResponse(verification));
  });

  // Complaint-scoped audit history (admins with complaint access)
  app.get('/complaint/:id', { preHandler: [authenticate, requireRole('DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const q = (request.query ?? {}) as { page?: string; limit?: string };
    const result = await AuditLogService.list({ entityType: 'Complaint', entityId: id, page: parseInt(q.page ?? '1'), limit: Math.min(parseInt(q.limit ?? '50'), 200) });
    return reply.send(paginatedResponse(result.logs, result.total, result.page, result.limit));
  });
}
