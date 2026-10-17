import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a real running stack:
 *   - backend:  :3100 (Fastify + dedicated e2e database)
 *   - frontend: :5173 (Vite dev server proxying /api -> :3001? see vite.proxy note)
 *
 * Note: the Vite dev server proxies /api to backend 3001 by default. For e2e we
 * override the proxy target with VITE_API_PROXY= so requests reach :3100.
 *
 * Run with:   npx playwright test --config tests/e2e/playwright.config.ts
 */
const PORT = Number(process.env.E2E_PORT || 5177);
const API_PORT = Number(process.env.E2E_API_PORT || 3100);
const DB = process.env.E2E_DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/shjap_e2e_test?schema=public';

export default defineConfig({
  testDir: '.',
  name: 'e2e',
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Push schema + seed the dedicated e2e database, then boot the API
      command: 'npm run e2e:prepare --workspace=backend && npm run dev --workspace=backend',
      cwd: '../..',
      url: `http://localhost:${API_PORT}/health`,
      timeout: 180000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: DB,
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        HOST: 'localhost',
      },
    },
    {
      command: `npx vite --port ${PORT} --strictPort`,
      cwd: '../../frontend',
      url: `http://localhost:${PORT}`,
      timeout: 120000,
      reuseExistingServer: false,
      env: {
        VITE_API_PROXY: `http://localhost:${API_PORT}`,
      },
    },
  ],
});
