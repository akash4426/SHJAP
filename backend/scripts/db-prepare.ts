/**
 * One-command local database setup (first run or dev reset):
 *
 *   npm run db:setup        # from backend/
 *
 * Resolves the target DATABASE_URL with the same fallback rules as the app:
 *   1. shell environment (DATABASE_URL)
 *   2. backend/.env
 *   3. bundled local fallback: postgresql://postgres:1234@localhost:5432/shjap_grievance
 *
 * Then performs `prisma db push` (schema-synced, resets local data) and seeds
 * the full demo dataset. Local-run convenience only — production deployments
 * use `npm run db:deploy` (migrations) instead.
 */
import { execSync } from 'node:child_process';
import dotenv from 'dotenv';

dotenv.config();

const LOCAL_FALLBACK_DB_URL =
  'postgresql://postgres:1234@localhost:5432/shjap_grievance?schema=public';

const databaseUrl = process.env.DATABASE_URL || LOCAL_FALLBACK_DB_URL;
const usingFallback = !process.env.DATABASE_URL;

if (usingFallback) {
  console.warn('[db-setup] DATABASE_URL not configured — falling back to local DB:');
  console.warn(`[db-setup]   ${LOCAL_FALLBACK_DB_URL}`);
}

const env = { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' };

console.log('[db-setup] Syncing Prisma schema (existing local data will be reset)…');
execSync('npx prisma db push --force-reset --skip-generate --schema ../prisma/schema.prisma', {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

console.log('[db-setup] Seeding demo data…');
execSync('npx tsx ../prisma/seed.ts', {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

const target = databaseUrl.replace(/:\/\/([^:]+):(\${0,1}[^@]*)@/, '://$1:***@');
console.log(`[db-setup] Done. Database ${target} is ready.`);
