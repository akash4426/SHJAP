/**
 * Local database fallback for local runs (docker-free `npm run dev`).
 *
 * The Prisma engine resolves DATABASE_URL from process.env at PrismaClient
 * construction time, so the fallback is applied as an environment side
 * effect the moment this module is evaluated. It is imported (for its side
 * effect) by every module that constructs a PrismaClient:
 *
 *   - src/config/index.ts      (runtime config)
 *   - src/config/database.ts   (app PrismaClient)
 *   - src/utils/prisma.ts      (shared PrismaClient)
 *   - prisma/seed.ts           (via the backend service imports)
 *
 * Precedence: real environment > backend/.env > bundled local fallback.
 * Production always requires an explicit DATABASE_URL.
 */
import dotenv from 'dotenv';

export const LOCAL_FALLBACK_DB_URL =
  'postgresql://postgres:1234@localhost:5432/shjap_grievance?schema=public';

export function ensureDatabaseUrl(): void {
  // Load backend/.env when present. Never overrides a variable that is
  // already set in the real environment (shell / Docker / test harness).
  dotenv.config();

  if (process.env.DATABASE_URL) return;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL is required in production. ' +
        'Set it in the environment (e.g. docker run --env-file backend/.env) ' +
        'before starting the API.'
    );
  }

  process.env.DATABASE_URL = LOCAL_FALLBACK_DB_URL;
}

// Apply on import so PrismaClient constructor sites always see a URL.
ensureDatabaseUrl();
