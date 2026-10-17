import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/index.js';
import { prisma } from '../../src/config/database.js';

let app: FastifyInstance | null = null;

/** Shared, lazily-built Fastify instance for in-process HTTP (inject) tests. */
export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
  }
  return app;
}

export async function login(email: string, password = 'Password@123'): Promise<string> {
  const a = await getApp();
  const res = await a.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) {
    throw new Error(`login(${email}) failed: ${res.statusCode} ${res.body}`);
  }
  return res.json().data.token;
}

export interface RequestResult {
  status: number;
  body: any;
}

export async function req(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  url: string,
  opts: { payload?: object | Buffer; token?: string } = {}
): Promise<RequestResult> {
  const a = await getApp();
  const res = await a.inject({
    method,
    url,
    payload: opts.payload as object | undefined,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
  });
  let body: any;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
}

/** A valid student account, created fresh (safe to call multiple times). */
export async function freshStudent(): Promise<{ email: string; password: string; token: string }> {
  const email = `test.student.${Date.now()}.${Math.floor(Math.random() * 10000)}@example.com`;
  const password = 'Password@123';
  await req('POST', '/api/auth/register', {
    payload: {
      email,
      password,
      firstName: 'Test',
      lastName: 'Student',
      studentId: `TST-${Date.now() % 100000000}`,
      program: 'BSc Testing',
      year: 2,
    },
  });
  const token = await login(email, password);
  return { email, password, token };
}

export async function resetDataTables(): Promise<void> {
  // Delete only rows created by tests (marked by our marker names), keeping the
  // seeded fixtures intact for subsequent files in the same session.
  const marker = 'test.student.';
  await prisma.complaint.deleteMany({ where: { submittedBy: { email: { contains: marker } } } });
  await prisma.user.deleteMany({ where: { email: { contains: marker } } });
}

/**
 * Background tasks (setImmediate) fire auto-categorization after a create;
 * poll until the predicate returns true or the timeout elapses.
 */
export async function waitFor(
  predicate: () => Promise<boolean>,
  { timeoutMs = 5000, intervalMs = 100 } = {}
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitFor: condition not met within timeout');
}

/** Poll until the complaint has a department assigned (auto-categorization). */
export async function waitForCategorized(complaintId: string): Promise<void> {
  await waitFor(async () => {
    const c = await prisma.complaint.findUnique({ where: { id: complaintId }, select: { departmentId: true } });
    return !!c?.departmentId;
  });
}

export { prisma };
