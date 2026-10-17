import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { AuthService } from '../services/auth.service.js';
import { authenticate, getAuthUser } from '../middleware/auth.middleware.js';
import { successResponse } from '../utils/response.js';
import { AuditService } from '../services/audit.service.js';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  mfaVerifySchema,
} from '../validators/schemas.js';
import { UnauthorizedError, ValidationError } from '../utils/errors.js';
import { hashToken } from '../utils/crypto.js';
import { UserRole } from '@prisma/client';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

import { randomUUID } from 'node:crypto';

/** Create access + refresh JWT pair and persist the refresh token (hashed). */
function buildTokens(app: FastifyInstance, user: { id: string; email: string; roles: UserRole[] }) {
  // jti guarantees byte-unique tokens even when two logins happen within the
  // same JWT `iat` second (deterministic HS256 would otherwise collide on the
  // unique tokenHash column).
  const token = app.jwt.sign(
    { id: user.id, email: user.email, roles: user.roles, typ: 'access', jti: randomUUID() },
    { expiresIn: config.jwt.expiresIn }
  );
  const refreshToken = app.jwt.sign(
    { id: user.id, email: user.email, roles: user.roles, typ: 'refresh', jti: randomUUID() },
    { expiresIn: config.jwt.refreshExpiresIn }
  );
  return { token, refreshToken };
}

async function persistRefreshToken(userId: string, refreshToken: string, request: { ip: string; headers: Record<string, unknown> }) {
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      ipAddress: request.ip,
      userAgent: (request.headers['user-agent'] as string) ?? null,
    },
  });
}

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/register (students only; admin users are created by Main Admin)
  app.post('/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const user = await AuthService.registerStudent(body, request.ip, request.headers['user-agent']);

    await AuthService.createRoles(user.id, ['STUDENT']);

    const tokens = buildTokens(app, { id: user.id, email: user.email, roles: user.roles as UserRole[] });
    await persistRefreshToken(user.id, tokens.refreshToken, request);

    return reply.status(201).send(successResponse({ user, ...tokens }, 'Registration successful'));
  });

  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const user = await AuthService.login(body, request.ip, request.headers['user-agent'] as string);

    // MFA gate: issue short-lived mfa token only
    if (user.mfaEnabled) {
      const mfaToken = app.jwt.sign(
        { id: user.id, email: user.email, roles: user.roles, typ: 'mfa' },
        { expiresIn: config.jwt.mfaExpiresIn }
      );
      return reply.send(successResponse({ mfaRequired: true, mfaToken, emailMask: maskEmail(user.email) }, 'MFA verification required'));
    }

    const tokens = buildTokens(app, { id: user.id, email: user.email, roles: user.roles as UserRole[] });
    await persistRefreshToken(user.id, tokens.refreshToken, request);

    return reply.send(successResponse({ user, ...tokens, mfaRequired: false }, 'Login successful'));
  });

  // POST /api/auth/mfa/verify — exchange mfa token + TOTP code for real tokens
  app.post('/mfa/verify', async (request, reply) => {
    const body = mfaVerifySchema.extend({ mfaToken: z.string().min(10) }).parse({ ...(request.body as object), mfaToken: (request.body as { mfaToken?: string }).mfaToken });

    let payload: { id: string; email: string; roles: UserRole[]; typ: string };
    try {
      payload = app.jwt.verify(body.mfaToken) as typeof payload;
    } catch {
      throw new UnauthorizedError('MFA session expired. Please login again.');
    }
    if (payload.typ !== 'mfa') throw new UnauthorizedError('Invalid MFA token');

    const mfaConfig = await prisma.mFAConfiguration.findUnique({ where: { userId: payload.id } });
    if (!mfaConfig || !mfaConfig.isEnabled) throw new UnauthorizedError('MFA is not configured');

    const valid = speakeasy.totp.verify({
      secret: mfaConfig.secret,
      encoding: 'base32',
      token: body.code,
      window: 1,
    });

    if (!valid) {
      await AuditService.log({ actorId: payload.id, action: 'LOGIN_FAILED', entityType: 'MFA', entityId: payload.id, newValue: { reason: 'bad_code' }, ipAddress: request.ip });
      throw new UnauthorizedError('Invalid MFA code');
    }

    await AuditService.log({ actorId: payload.id, action: 'LOGIN', entityType: 'MFA', entityId: payload.id, newValue: { mfaVerified: true }, ipAddress: request.ip });

    const tokens = buildTokens(app, { id: payload.id, email: payload.email, roles: payload.roles });
    await persistRefreshToken(payload.id, tokens.refreshToken, request);

    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: { id: true, email: true, firstName: true, lastName: true, roles: true, mfaEnabled: true },
    });

    return reply.send(successResponse({ user, ...tokens }, 'MFA verification successful'));
  });

  // POST /api/auth/mfa/setup — generate secret + QR (not yet enabled)
  app.post('/mfa/setup', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = getAuthUser(request).id;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, mfaEnabled: true } });
    if (!user) throw new UnauthorizedError('User not found');
    if (user.mfaEnabled) throw new ValidationError('MFA is already enabled');

    const secret = speakeasy.generateSecret({
      name: `${config.mfa.issuer} (${user.email})`,
      length: 20,
    });

    await prisma.mFAConfiguration.upsert({
      where: { userId },
      update: { secret: secret.base32, isEnabled: false },
      create: { userId, secret: secret.base32, isEnabled: false },
    });

    const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url ?? '');

    return reply.send(successResponse({
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
      qrDataUrl,
    }, 'Scan the QR code in your authenticator app, then verify a code to enable MFA'));
  });

  // POST /api/auth/mfa/enable — verify code and activate
  app.post('/mfa/enable', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = getAuthUser(request).id;
    const body = mfaVerifySchema.parse(request.body);

    const mfaConfig = await prisma.mFAConfiguration.findUnique({ where: { userId } });
    if (!mfaConfig) throw new ValidationError('Run MFA setup first');

    const valid = speakeasy.totp.verify({ secret: mfaConfig.secret, encoding: 'base32', token: body.code, window: 2 });
    if (!valid) throw new ValidationError('Invalid code. Try again.');

    const backupCodes = Array.from({ length: 5 }, () => Math.random().toString(36).slice(2, 10).toUpperCase());

    await prisma.$transaction([
      prisma.mFAConfiguration.update({ where: { userId }, data: { isEnabled: true, backupCodes } }),
      prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } }),
    ]);

    await AuditService.log({ actorId: userId, action: 'SETTING_CHANGE', entityType: 'MFAConfiguration', entityId: userId, newValue: { enabled: true }, ipAddress: request.ip });

    return reply.send(successResponse({ enabled: true, backupCodes }, 'MFA enabled. Store your backup codes safely.'));
  });

  // POST /api/auth/mfa/disable — deactivate (requires code)
  app.post('/mfa/disable', { preHandler: [authenticate] }, async (request, reply) => {
    const userId = getAuthUser(request).id;
    const body = mfaVerifySchema.parse(request.body);

    const mfaConfig = await prisma.mFAConfiguration.findUnique({ where: { userId } });
    if (!mfaConfig?.isEnabled) throw new ValidationError('MFA is not enabled');

    const valid = speakeasy.totp.verify({ secret: mfaConfig.secret, encoding: 'base32', token: body.code, window: 1 });
    if (!valid) throw new ValidationError('Invalid code');

    await prisma.$transaction([
      prisma.mFAConfiguration.update({ where: { userId }, data: { isEnabled: false } }),
      prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false } }),
    ]);

    await AuditService.log({ actorId: userId, action: 'SETTING_CHANGE', entityType: 'MFAConfiguration', entityId: userId, newValue: { enabled: false }, ipAddress: request.ip });

    return reply.send(successResponse(null, 'MFA disabled'));
  });

  // POST /api/auth/refresh — rotate refresh token
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = (request.body ?? {}) as { refreshToken?: string };
    if (!refreshToken) {
      return reply.status(400).send({ success: false, error: { code: 'MISSING_TOKEN', message: 'Refresh token required' } });
    }

    const tokenHash = hashToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    let payload: { id: string; email: string; roles: UserRole[]; typ: string };
    try {
      payload = app.jwt.verify(refreshToken) as typeof payload;
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }
    if (payload.typ !== 'refresh') throw new UnauthorizedError('Invalid refresh token');

    // Rotation: revoke old, issue new pair
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { isRevoked: true } });

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.deletedAt || !user.isActive) throw new UnauthorizedError('User not found');

    const tokens = buildTokens(app, { id: user.id, email: user.email, roles: user.roles });
    await persistRefreshToken(user.id, tokens.refreshToken, request);

    return reply.send(successResponse(tokens));
  });

  // POST /api/auth/logout
  app.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const { refreshToken } = (request.body ?? {}) as { refreshToken?: string };
    if (refreshToken) {
      await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(refreshToken) }, data: { isRevoked: true } });
    } else {
      // Revoke all sessions for this user
      await prisma.refreshToken.updateMany({ where: { userId: getAuthUser(request).id }, data: { isRevoked: true } });
    }
    await AuthService.logout(getAuthUser(request).id, request.ip);
    return reply.send(successResponse(null, 'Logged out successfully'));
  });

  // POST /api/auth/forgot-password
  app.post('/forgot-password', async (request, reply) => {
    const { email } = forgotPasswordSchema.parse(request.body);
    const token = await AuthService.createPasswordResetToken(email);

    // In production the token is emailed, never returned in the API response.
    // Dev/test environments expose it to make the reset flow testable and
    // demonstrate the API.
    const payload: Record<string, unknown> = { message: 'If that email exists, a reset link has been sent' };
    if (['development', 'test'].includes(config.nodeEnv) && token) payload.resetToken = token;

    return reply.send(successResponse(payload));
  });

  // POST /api/auth/reset-password
  app.post('/reset-password', async (request, reply) => {
    const { token, password } = resetPasswordSchema.parse(request.body);
    await AuthService.resetPassword(token, password);
    return reply.send(successResponse(null, 'Password reset successful'));
  });

  // GET /api/auth/me
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const payload = getAuthUser(request);
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        roles: true, mfaEnabled: true, isActive: true, lastLoginAt: true, createdAt: true, deletedAt: true,
        studentProfile: { include: { department: true, college: true } },
        adminProfile: { include: { department: true, college: true } },
      },
    });
    if (!user || user.deletedAt) throw new UnauthorizedError('Session invalid');
    return reply.send(successResponse(user));
  });
}

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(name.length - 2, 2))}@${domain}`;
}
