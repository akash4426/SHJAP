import '../config/db-fallback.js'; // ensure DATABASE_URL fallback before client construction
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

const prismaLogger = logger.child({ service: 'prisma' });

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    prismaLogger.debug({ query: e.query, duration: e.duration }, 'DB Query');
  });
}

prisma.$on('error', (e) => {
  prismaLogger.error(e, 'DB Error');
});

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    prismaLogger.info('Database connected successfully');
  } catch (error) {
    prismaLogger.error(error, 'Failed to connect to database');
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  prismaLogger.info('Database disconnected');
}
