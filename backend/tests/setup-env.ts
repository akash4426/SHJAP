/**
 * Runs BEFORE every test file in each worker process — must be side-effect
 * light and run ahead of any module import that reads DATABASE_URL.
 *
 * The Prisma engine resolves DATABASE_URL from process.env at client
 * construction, so pointing it at the dedicated test database here gives
 * every test run an isolated database.
 */
process.env.NODE_ENV = 'test';

process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:1234@localhost:5432/shjap_grievance_test?schema=public';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Test suites make many rapid in-process requests; the global rate limiter
// would throttle legitimate test traffic. Brute-force lockout (per-account,
// DB-backed) remains fully active and is exercised by auth tests.
process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '100000';
process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || '100000';
