import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCookie from '@fastify/cookie';

import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { registerErrorHandler } from './middleware/error-handler.js';
import { logger } from './utils/logger.js';

import { authRoutes } from './routes/auth.routes.js';
import { complaintRoutes, anonymousRoutes } from './routes/complaint.routes.js';
import { publicRoutes } from './routes/public.routes.js';
import { evidenceRoutes } from './routes/evidence.routes.js';
import { notificationRoutes } from './routes/notification.routes.js';
import { adminRoutes, auditRoutes } from './routes/admin.routes.js';
import { analyticsRoutes } from './routes/admin.routes.analytics.js';

async function buildApp() {
  const app = Fastify({
    logger: false, // pino configured separately in utils/logger
    trustProxy: true,
    bodyLimit: 12 * 1024 * 1024, // upload headroom
  });

  // Security headers
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // API serves JSON only; CSP owned by frontend
    crossOriginEmbedderPolicy: false,
  });

  // CORS (cookie/token auth from the SPA origin)
  await app.register(fastifyCors, {
    origin: [config.frontendUrl, 'http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // JWT (single secret; tokens distinguish typ: access | refresh | mfa)
  await app.register(fastifyJwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.expiresIn },
  });

  await app.register(fastifyCookie);

  // Global rate limiting; auth routes get a tighter child limit below
  await app.register(fastifyRateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    errorResponseBuilder: () => ({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please try again later.' },
    }),
  });

  // Multipart for file uploads
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.upload.maxFileSize,
      files: 1,
    },
  });

  registerErrorHandler(app);

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    service: 'shjap-grievance-portal-api',
  }));

  // Auth — tighter rate limit for brute-force protection
  await app.register(async (scoped) => {
    await scoped.register(fastifyRateLimit, {
      global: false,
      max: config.rateLimit.authMax,
      timeWindow: '1 minute',
      keyGenerator: (req) => `${req.ip}:${req.url}`,
    });
    await scoped.register(authRoutes, { prefix: '/api/auth' });
  });

  // API Routes
  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(complaintRoutes, { prefix: '/api/complaints' });
  await app.register(evidenceRoutes, { prefix: '/api/complaints' });
  await app.register(anonymousRoutes, { prefix: '/api/anonymous' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(auditRoutes, { prefix: '/api/audit-logs' });
  await app.register(analyticsRoutes, { prefix: '/api/analytics' });

  // 404 handler — consistent error envelope
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });

  return app;
}

export async function startServer() {
  const app = await buildApp();

  await connectDatabase();

  try {
    const address = await app.listen({ port: config.port, host: config.host });
    logger.info(`🚀 SHJAP Grievance Portal API running at ${address}`);
    logger.info(`📋 Environment: ${config.nodeEnv}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      logger.error(
        `Port ${config.port} is already in use — another API instance is likely still running.\n` +
          `Stop it (lsof -ti:${config.port} | xargs kill) or use another port (PORT env).`
      );
    } else {
      logger.error(err, 'Failed to start server');
    }
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return app;
}

// Allow test harness to import buildApp without side effects
export { buildApp };

// When run directly (not imported by tests), start the server
const isDirectRun = process.argv[1]?.includes('index') && process.env.VITEST === undefined;
if (isDirectRun) {
  startServer();
}
