import { prisma } from '../config/database.js';
import { AuditService } from './audit.service.js';
import type { AuditAction } from '@prisma/client';

/**
 * Read-side of the audit log (writes go through AuditService).
 * Supports filtering, pagination, and chain verification.
 */
export class AuditLogService {
  static async list(filters: {
    action?: AuditAction;
    entityType?: string;
    entityId?: string;
    actorId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(filters.page ?? 1, 1);
    const limit = Math.min(filters.limit ?? 50, 200);

    const where: Record<string, unknown> = {};
    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.search) {
      where.OR = [
        { entityId: { contains: filters.search, mode: 'insensitive' } },
        { entityType: { contains: filters.search, mode: 'insensitive' } },
        { actor: { email: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { sequence: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: {
            select: { id: true, firstName: true, lastName: true, email: true, roles: true },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs: logs.map((l) => ({ ...l, sequence: Number(l.sequence), payload: undefined })),
      total,
      page,
      limit,
    };
  }

  static async verify() {
    return AuditService.verifyChain();
  }
}
