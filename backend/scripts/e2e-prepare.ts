/**
 * Prepares the dedicated E2E database before the Playwright webServer boots
 * the API: pushes the current schema and seeds reference fixtures.
 */
import { execSync } from 'node:child_process';

const testDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  'postgresql://postgres:1234@localhost:5432/shjap_e2e_test?schema=public';

const env = { ...process.env, DATABASE_URL: testDatabaseUrl, NODE_ENV: 'development' };

execSync('npx prisma db push --schema ../prisma/schema.prisma --skip-generate', {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});

execSync('npx tsx ../prisma/seed.ts', {
  cwd: process.cwd(),
  env,
  stdio: 'inherit',
});
