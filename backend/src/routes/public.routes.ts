import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database.js';
import { successResponse } from '../utils/response.js';

/**
 * Unauthenticated, read-only metadata needed to render complaint forms.
 * Only active categories/departments and non-sensitive fields are exposed.
 */
export async function publicRoutes(app: FastifyInstance) {
  app.get('/categories', async (_request, reply) => {
    const categories = await prisma.complaintCategory.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true, departmentId: true },
      orderBy: { name: 'asc' },
    });
    return reply.send(successResponse(categories));
  });

  app.get('/departments', async (_request, reply) => {
    const departments = await prisma.department.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        code: true,
        college: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return reply.send(successResponse(departments));
  });
}
