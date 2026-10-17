/**
 * Cross-file guarantee: refetch tokens per file and use the shared app.
 *
 * Integration tests exercise the full HTTP surface via fastify inject() with
 * the dedicated test database prepared by the global setup (schema + seed).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { getApp, login, req, freshStudent, prisma } from './helpers.js';

describe('auth & security (integration)', () => {
  let studentEmail: string;
  let refreshToken: string;

  beforeAll(async () => {
    const s = await freshStudent();
    studentEmail = s.email;
    const a = await getApp();
    const res = await a.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: studentEmail, password: s.password },
    });
    refreshToken = res.json().data.refreshToken;
  });

  it('health endpoint responds without auth', async () => {
    const { status, body } = await req('GET', '/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('rejects an unknown endpoint with a consistent 404 envelope', async () => {
    const { status, body } = await req('GET', '/api/definitely-not-a-route');
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects wrong password without revealing account existence details', async () => {
    const { status, body } = await req('POST', '/api/auth/login', {
      payload: { email: studentEmail, password: 'WrongPassword@999' },
    });
    expect(status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('locks the account after repeated failed logins (brute-force protection)', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const { status } = await req('POST', '/api/auth/login', {
        payload: { email: studentEmail, password: 'Nope@1234' },
      });
      lastStatus = status;
    }
    // Account lockout threshold reached
    expect(lastStatus).toBe(423);

    // Clear the lock so later tests can operate on this account normally
    await prisma.user.update({
      where: { email: studentEmail },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('registration only allows student accounts (server-side role assignment)', async () => {
    const { status, body } = await req('POST', '/api/auth/register', {
      payload: {
        email: 'try.admin.register@example.com',
        password: 'Password@123',
        firstName: 'Not',
        lastName: 'Admin',
        studentId: 'TST-REG-1',
        roles: ['MAIN_ADMIN'],
      },
    });
    expect(status).toBe(201);
    // Even if roles were sent, public registration cannot mint an admin
    const role = await req('POST', '/api/auth/login', {
      payload: { email: 'try.admin.register@example.com', password: 'Password@123' },
    });
    expect(role.status).toBe(200);
    expect(role.body.data.user.roles).toEqual(['STUDENT']);
  });

  it('rotates refresh tokens for reuse-once semantics and blocks replay', async () => {
    const first = await req('POST', '/api/auth/refresh', { payload: { refreshToken } });
    expect(first.status).toBe(200);
    expect(first.body.data.token).toBeTruthy();
    expect(first.body.data.refreshToken).toBeTruthy();

    // Replay of the rotated-away token must fail
    const replay = await req('POST', '/api/auth/refresh', { payload: { refreshToken } });
    expect(replay.status).toBe(401);

    // Successive use of the new token works
    const second = await req('POST', '/api/auth/refresh', {
      payload: { refreshToken: first.body.data.refreshToken },
    });
    expect(second.status).toBe(200);
  });

  it('rejects refresh requests without a token', async () => {
    const { status } = await req('POST', '/api/auth/refresh', { payload: {} });
    expect([400, 401]).toContain(status);
  });

  it('forgot-password never leaks existence but returns a dev-only token', async () => {
    const real = await req('POST', '/api/auth/forgot-password', {
      payload: { email: 'student@example.com' },
    });
    expect(real.status).toBe(200);
    expect(real.body.data.resetToken).toBeTruthy();

    const ghost = await req('POST', '/api/auth/forgot-password', {
      payload: { email: 'ghost-unknown@example.com' },
    });
    expect(ghost.status).toBe(200);
    expect(ghost.body.data.resetToken ?? null).toBeNull();
  });

  it('completes the password reset flow and then rejects the same token', async () => {
    const forgot = await req('POST', '/api/auth/forgot-password', {
      payload: { email: studentEmail },
    });
    const token = forgot.body.data.resetToken;
    expect(token).toBeTruthy();

    const reset = await req('POST', '/api/auth/reset-password', {
      payload: { token, password: 'FreshReset@123' },
    });
    expect(reset.status).toBe(200);

    const loginWithNew = await req('POST', '/api/auth/login', {
      payload: { email: studentEmail, password: 'FreshReset@123' },
    });
    expect(loginWithNew.status).toBe(200);

    const replay = await req('POST', '/api/auth/reset-password', {
      payload: { token, password: 'FreshReset@999' },
    });
    expect(replay.status).toBe(400);
  });

  it('exposes /api/auth/me with the authenticated identity only', async () => {
    const token = await login(studentEmail, 'FreshReset@123');
    const { status, body } = await req('GET', '/api/auth/me', { token });
    expect(status).toBe(200);
    expect(body.data.email).toBe(studentEmail);
    expect(body.data.passwordHash).toBeUndefined();
  });

  it('rejects requests with malformed bearer tokens', async () => {
    const { status } = await req('GET', '/api/auth/me', { token: 'not-a-jwt' });
    expect(status).toBe(401);
  });
});
