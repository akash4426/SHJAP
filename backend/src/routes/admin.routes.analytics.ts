import { FastifyInstance } from 'fastify';
import { authenticate, getAuthUser, requireRole } from '../middleware/auth.middleware.js';
import { successResponse } from '../utils/response.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { AccessControlService } from '../services/access-control.service.js';
import { prisma } from '../config/database.js';

const ADMIN_ROLES = ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'] as const;

const adminAuth = [authenticate, requireRole(...ADMIN_ROLES)];

export async function analyticsRoutes(app: FastifyInstance) {
  // GET /api/analytics/overview
  app.get('/overview', { preHandler: adminAuth }, async (request, reply) => {
    return reply.send(successResponse(await AnalyticsService.overview(getAuthUser(request))));
  });

  // GET /api/analytics/departments — per-department performance
  app.get('/departments', { preHandler: adminAuth }, async (request, reply) => {
    return reply.send(successResponse(await AnalyticsService.departmentPerformance(getAuthUser(request))));
  });

  // GET /api/analytics/categories
  app.get('/categories', { preHandler: adminAuth }, async (request, reply) => {
    const user = getAuthUser(request);
    const complaints = await prisma.complaint.findMany({
      where: await AccessControlService.buildComplaintListWhere(user, {}),
      select: { category: { select: { id: true, name: true, code: true } }, status: true },
    });
    const counts = new Map<string, { id: string; name: string; code: string; total: number; resolved: number }>();
    for (const c of complaints) {
      const cat = c.category;
      if (!cat) continue;
      const entry = counts.get(cat.id) ?? { id: cat.id, name: cat.name, code: cat.code, total: 0, resolved: 0 };
      entry.total += 1;
      if (c.status === 'RESOLVED' || c.status === 'CLOSED') entry.resolved += 1;
      counts.set(cat.id, entry);
    }
    return reply.send(successResponse(Array.from(counts.values()).sort((a, b) => b.total - a.total)));
  });

  // GET /api/analytics/trust-scores
  app.get('/trust-scores', { preHandler: adminAuth }, async (request, reply) => {
    return reply.send(successResponse(await AnalyticsService.trustScoreDistribution(getAuthUser(request))));
  });

  // GET /api/analytics/resolution-times
  app.get('/resolution-times', { preHandler: adminAuth }, async (request, reply) => {
    return reply.send(successResponse(await AnalyticsService.resolutionTimes(getAuthUser(request))));
  });

  // GET /api/analytics/satisfaction — feedback stats
  app.get('/satisfaction', { preHandler: adminAuth }, async (request, reply) => {
    return reply.send(successResponse(await AnalyticsService.satisfaction(getAuthUser(request))));
  });

  // GET /api/analytics/escalations — escalation flow stats
  app.get('/escalations', { preHandler: adminAuth }, async (request, reply) => {
    const user = getAuthUser(request);
    const where = await AccessControlService.buildComplaintListWhere(user, {});
    const escalations = await prisma.complaintEscalation.findMany({
      where: { complaint: where },
      select: {
        previousLevel: true,
        newLevel: true,
        reviewDecision: true,
        reviewedAt: true,
        createdAt: true,
        complaint: { select: { complaintNumber: true, status: true, department: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const byLevel = { DEPARTMENT: 0, COLLEGE: 0, UNIVERSITY: 0 };
    let approved = 0;
    let rejected = 0;
    let pending = 0;
    for (const e of escalations) {
      if (e.newLevel in byLevel) byLevel[e.newLevel as 'DEPARTMENT' | 'COLLEGE' | 'UNIVERSITY'] += 1;
      if (!e.reviewDecision) pending += 1;
      else if (e.reviewDecision === 'APPROVE') approved += 1;
      else if (e.reviewDecision === 'REJECT') rejected += 1;
    }

    return reply.send(successResponse({ byLevel, approved, rejected, pending, recent: escalations.slice(0, 20) }));
  });
}
