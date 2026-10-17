import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '@prisma/client';
import { ForbiddenError, UnauthorizedError, formatError } from '../utils/errors.js';

export interface JwtPayload {
  id: string;
  email: string;
  roles: UserRole[];
  typ: 'access' | 'refresh' | 'mfa';
}

/**
 * Type-safe accessor for the authenticated JWT payload.
 * @fastify/jwt decorates request.user; we cast here in one place.
 */
export function getAuthUser(request: FastifyRequest): JwtPayload {
  const user = request.user as unknown as JwtPayload | undefined;
  if (!user?.id) throw new UnauthorizedError('Invalid or expired token');
  return user;
}

/** Authenticate: verify JWT access token, attach payload to request */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = getAuthUser(request);
    if (payload.typ !== 'access') {
      reply.status(401).send(formatError(new UnauthorizedError('Invalid token type')));
      return;
    }
  } catch {
    reply.status(401).send(formatError(new UnauthorizedError('Invalid or expired token')));
  }
}

/** Authorization factory: require at least one of the given roles */
export function requireRole(...roles: UserRole[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.user) {
      reply.status(401).send(formatError(new UnauthorizedError()));
      return;
    }
    const payload = getAuthUser(request);
    const hasRole = payload.roles.some((r) => roles.includes(r));
    if (!hasRole) {
      reply.status(403).send(formatError(new ForbiddenError('Insufficient permissions')));
    }
  };
}

/**
 * Combined authenticate + role check (use as preHandler array):
 * `preHandler: authAndRole('MAIN_ADMIN')`
 */
export function authAndRole(...roles: UserRole[]) {
  return [authenticate, requireRole(...roles)];
}
