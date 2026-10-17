import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts', 'tests/integration/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 180000,
    globalSetup: 'tests/global-setup.ts',
    setupFiles: ['tests/setup-env.ts'],
    // Prisma's query engine cannot be torn down inside worker threads at
    // process exit; forking isolates that cleanly.
    pool: 'forks',
    // Integration suites share one test database — run spec files sequentially
    fileParallelism: false,
  },
});

