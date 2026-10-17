import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError, formatError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const errLogger = logger.child({ service: 'error-handler' });

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(formatError(error));
      return;
    }

    // Validation errors from Zod (schema.parse failures).
    // The message surfaces the first field issue so clients can show
    // actionable feedback (e.g. "password: must contain an uppercase letter").
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const message =
        first
          ? first.path.length > 0
            ? `${first.path.join('.')}: ${first.message}`
            : first.message
          : 'Request validation failed';
      reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message,
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }

    // Validation errors from Zod/Fastify
    if (error.validation) {
      reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
        },
      });
      return;
    }

    // JWT errors
    if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED' || error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
      reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
      });
      return;
    }

    // Rate limit errors
    if (error.statusCode === 429) {
      reply.status(429).send({
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' },
      });
      return;
    }

    errLogger.error({ err: error, url: request.url, method: request.method }, 'Unhandled error');

    reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal server error occurred',
      },
    });
  });
}
