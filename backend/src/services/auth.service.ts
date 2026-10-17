import argon2 from 'argon2';
import { prisma } from '../config/database.js';
import { config } from '../config/index.js';
import { generateResetToken, hashToken, sanitizeText } from '../utils/crypto.js';
import { AppError, ConflictError, UnauthorizedError, ValidationError } from '../utils/errors.js';
import { AuditService } from './audit.service.js';
import { UserRole } from '@prisma/client';

export interface RegisterStudentDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  studentId: string;
  program?: string;
  year?: number;
  collegeId?: string;
  departmentId?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1, // keep memory/CPU sane on dev machines
    });
  }

  static async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  static async registerStudent(dto: RegisterStudentDto, ipAddress?: string, userAgent?: string) {
    const existing = await prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictError('Email already registered');

    const existingProfile = await prisma.studentProfile.findUnique({ where: { studentId: dto.studentId } });
    if (existingProfile) throw new ConflictError('Student ID already registered');

    const passwordHash = await this.hashPassword(dto.password);

    const user = await prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: sanitizeText(dto.firstName),
        lastName: sanitizeText(dto.lastName),
        phone: dto.phone,
        roles: ['STUDENT'],
        isEmailVerified: true, // simplified: no email verification flow in this build
        emailVerifiedAt: new Date(),
        studentProfile: {
          create: {
            studentId: dto.studentId,
            program: dto.program ? sanitizeText(dto.program) : undefined,
            year: dto.year,
            collegeId: dto.collegeId,
            departmentId: dto.departmentId,
          },
        },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roles: true,
        studentProfile: true,
        createdAt: true,
      },
    });

    await AuditService.log({
      actorId: user.id,
      actorRole: 'STUDENT',
      action: 'REGISTRATION',
      entityType: 'User',
      entityId: user.id,
      newValue: { email: user.email, studentId: dto.studentId },
      ipAddress,
      userAgent,
    });

    return user;
  }

  /**
   * Credential validation step of the login flow.
   * Returns the user when MFA is not enabled.
   * Throws AccountLocked etc. Use buildTokens for JWT/session creation.
   */
  static async login(dto: LoginDto, ipAddress?: string, userAgent?: string) {
    const user = await prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { studentProfile: true, adminProfile: true },
    });

    if (!user || user.deletedAt) {
      await AuditService.log({
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: `email:${dto.email.toLowerCase()}`,
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('Account temporarily locked. Try again later.', 423, 'ACCOUNT_LOCKED');
    }
    if (!user.isActive) {
      throw new AppError('Account is disabled. Contact administrator.', 403, 'ACCOUNT_DISABLED');
    }

    const passwordValid = await this.verifyPassword(user.passwordHash, dto.password);

    if (!passwordValid) {
      const failedAttempts = user.failedLoginAttempts + 1;
      const shouldLock = failedAttempts >= config.maxFailedLogins;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: failedAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + config.lockoutDurationMs) : null,
        },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    await AuditService.log({
      actorId: user.id,
      actorRole: (user.roles[0] as UserRole) ?? undefined,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
      mfaEnabled: user.mfaEnabled,
      studentProfile: user.studentProfile,
      adminProfile: user.adminProfile,
    };
  }

  static async createRoles(userId: string, roles: UserRole[]): Promise<void> {
    for (const role of roles) {
      let roleRow = await prisma.role.findUnique({ where: { name: role } });
      if (!roleRow) {
        roleRow = await prisma.role.create({ data: { name: role, description: `${role.replace(/_/g, ' ')} role` } });
      }
      await prisma.userRoleAssignment.upsert({
        where: { userId_roleId: { userId, roleId: roleRow.id } },
        update: {},
        create: { userId, roleId: roleRow.id },
      });
    }
  }

  /** Create password reset token. Returns '' for unknown emails (no enumeration). */
  static async createPasswordResetToken(email: string): Promise<string> {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return '';

    const token = generateResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: hashToken(token), // only store the hash
        expiresAt,
      },
    });

    await AuditService.log({
      actorId: user.id,
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: user.id,
      newValue: { requested: true },
    });

    return token;
  }

  static async resetPassword(token: string, newPassword: string): Promise<void> {
    const hashed = hashToken(token);
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: hashed },
      include: { user: true },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new ValidationError('Invalid or expired reset token');
    }

    const passwordHash = await this.hashPassword(newPassword);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate all existing refresh tokens (force re-login everywhere)
      prisma.refreshToken.updateMany({
        where: { userId: resetToken.userId },
        data: { isRevoked: true },
      }),
    ]);

    await AuditService.log({
      actorId: resetToken.userId,
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: resetToken.userId,
      newValue: { completed: true },
    });
  }

  static async logout(userId: string, ipAddress?: string) {
    await AuditService.log({
      actorId: userId,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: userId,
      ipAddress,
    });
  }
}
