import { execSync } from 'node:child_process';

/**
 * Prepare the dedicated test database once per vitest session:
 *   1. push the current schema
 *   2. seed reference data (roles, permissions, departments, users, complaints)
 *
 * The integration suites create their own fresh entities (unique emails) and
 * also reuse the well-known seeded fixtures.
 */
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:1234@localhost:5432/shjap_grievance_test?schema=public';

export async function setup(): Promise<void> {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl, NODE_ENV: 'development' };

  execSync('npx prisma db push --schema ../prisma/schema.prisma --skip-generate', {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  execSync('npx tsx ../prisma/seed.ts', {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
