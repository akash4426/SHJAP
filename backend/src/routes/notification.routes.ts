import { FastifyInstance } from 'fastify';
import { NotificationService } from '../services/notification.service.js';
import { authenticate, getAuthUser } from '../middleware/auth.middleware.js';
import { successResponse } from '../utils/response.js';
import { notificationQuerySchema } from '../validators/schemas.js';

export async function notificationRoutes(app: FastifyInstance) {
  // GET /api/notifications
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const q = notificationQuerySchema.parse(request.query);
    const { notifications, total } = await NotificationService.getUserNotifications(user.id, q.page, q.limit);
    const unreadCount = await NotificationService.getUnreadCount(user.id);
    return reply.send(successResponse({ notifications, total, unreadCount, page: q.page, limit: q.limit }));
  });

  // GET /api/notifications/unread-count
  app.get('/unread-count', { preHandler: [authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const count = await NotificationService.getUnreadCount(user.id);
    return reply.send(successResponse({ count }));
  });

  // PATCH /api/notifications/recents/read-all → must be declared before :id routes
  app.patch('/read-all', { preHandler: [authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    await NotificationService.markAllAsRead(user.id);
    return reply.send(successResponse(null, 'All notifications marked as read'));
  });

  // PATCH /api/notifications/:id/read
  app.patch('/:id/read', { preHandler: [authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    await NotificationService.markAsRead(id, user.id);
    return reply.send(successResponse(null, 'Notification marked as read'));
  });

  // PATCH /api/notifications/:id/unread
  app.patch('/:id/unread', { preHandler: [authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    const { id } = request.params as { id: string };
    await NotificationService.markUnread(id, user.id);
    return reply.send(successResponse(null, 'Notification marked as unread'));
  });
}
