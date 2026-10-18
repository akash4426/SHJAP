import { z } from 'zod';
import { ComplaintStatus, SubmissionMode, ComplaintPriority, NotificationType, UserRole, AuditAction } from '@prisma/client';

// ─── Shared primitives ───────────────────────────────────────────────────────

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

export const phoneSchema = z
  .string()
  .regex(/^\+?[\d\s\-().]{7,20}$/, 'Invalid phone number');

/**
 * Optional phone fields: an empty string (untouched/cleared form field) means
 * "not provided" and must not fail validation. Transforms '' -> undefined.
 */
export const optionalPhoneSchema = z
  .union([phoneSchema, z.literal('')])
  .optional()
  .transform((value) => (value === '' || value === undefined ? undefined : value));

// ─── Auth ────────────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: passwordSchema,
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  phone: optionalPhoneSchema,
  studentId: z.string().min(1, 'Student ID is required').max(20),
  collegeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  program: z.string().max(100).optional(),
  year: z.number().int().min(1).max(10).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().length(6, 'MFA code must be 6 digits').optional(),
});

export const mfaVerifySchema = z.object({
  code: z.string().length(6, 'MFA code must be 6 digits'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

// ─── Complaints ──────────────────────────────────────────────────────────────

export const createComplaintSchema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters').max(200, 'Title must not exceed 200 characters'),
  description: z.string().min(20, 'Description must be at least 20 characters').max(5000, 'Description must not exceed 5000 characters'),
  priority: z.nativeEnum(ComplaintPriority).optional(),
  categoryId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  location: z.string().max(300).optional(),
  additionalInfo: z.string().max(2000).optional(),
  submissionMode: z.nativeEnum(SubmissionMode),
});

export const updateComplaintSchema = z.object({
  title: z.string().min(5).max(200).optional(),
  description: z.string().min(20).max(5000).optional(),
  categoryId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  priority: z.nativeEnum(ComplaintPriority).optional(),
  location: z.string().max(300).optional(),
  additionalInfo: z.string().max(2000).optional(),
});

export const complaintQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'priority', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  status: z.nativeEnum(ComplaintStatus).optional(),
  priority: z.nativeEnum(ComplaintPriority).optional(),
  categoryId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  submissionMode: z.nativeEnum(SubmissionMode).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  search: z.string().max(200).optional(),
});

export const assignComplaintSchema = z.object({
  assignedToId: z.string().uuid('Invalid admin ID'),
  notes: z.string().max(1000).optional(),
});

export const assessComplaintSchema = z
  .object({
    investigationNotes: z.string().max(5000).optional(),
    evidenceAssessment: z.string().max(5000).optional(),
    findings: z.string().max(5000).optional(),
    recommendedAction: z.string().max(5000).optional(),
    resolutionDecision: z.string().max(5000).optional(),
    isInformationRequested: z.boolean().default(false),
    informationRequested: z.string().max(2000).optional(),
  })
  .refine((d) => !d.isInformationRequested || (d.informationRequested ?? d.investigationNotes ?? '').length > 0, {
    message: 'Specify what information is requested',
  });

export const escalateComplaintSchema = z.object({
  reason: z.string().min(10, 'Escalation reason must be at least 10 characters').max(2000),
  notes: z.string().max(2000).optional(),
});

export const resolveComplaintSchema = z.object({
  summary: z.string().min(10, 'Resolution summary must be at least 10 characters').max(500),
  detailedResolution: z.string().min(20, 'Detailed resolution must be at least 20 characters').max(5000),
  actionTaken: z.string().min(10, 'Action taken must be at least 10 characters').max(2000),
  resolutionDate: z.string().datetime().optional(),
});

export const reviewEscalationSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reviewNotes: z.string().max(2000).optional(),
});

export const closeComplaintSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const rejectComplaintSchema = z.object({
  reason: z.string().min(10, 'Rejection reason must be at least 10 characters').max(2000),
});

export const feedbackSchema = z.object({
  rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5'),
  comment: z.string().max(1000).optional(),
});

export const createMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(4000),
});

// ─── Notifications ──────────────────────────────────────────────────────────

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  isRead: z.enum(['true', 'false']).optional().transform((v) => (v === undefined ? undefined : v === 'true')),
  type: z.nativeEnum(NotificationType).optional(),
});

// ─── Admin ──────────────────────────────────────────────────────────────────

export const createUserSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase(),
  password: passwordSchema,
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  phone: optionalPhoneSchema,
  roles: z.array(z.nativeEnum(UserRole)).min(1, 'At least one role is required'),
  studentId: z.string().max(20).optional(),
  collegeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  program: z.string().max(100).optional(),
  year: z.number().int().min(1).max(10).optional(),
  employeeId: z.string().max(20).optional(),
  designation: z.string().max(100).optional(),
});

export const updateUserSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  phone: optionalPhoneSchema,
  isActive: z.boolean().optional(),
});

export const setUserRolesSchema = z.object({
  roles: z.array(z.nativeEnum(UserRole)).min(0),
  // Optional scope sync for the chosen role(s); `null` clears the scope.
  collegeId: z.string().uuid().nullish(),
  departmentId: z.string().uuid().nullish(),
});

export const resetUserPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const departmentSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(20).regex(/^[A-Z0-9_]+$/, 'Uppercase letters, digits and _ only'),
  description: z.string().max(500).optional(),
  collegeId: z.string().uuid(),
});

export const collegeSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(20).regex(/^[A-Z0-9_]+$/, 'Uppercase letters, digits and _ only'),
  description: z.string().max(500).optional(),
});

export const categorySchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/, 'Uppercase letters, digits and _ only'),
  description: z.string().max(500).optional(),
  departmentId: z.string().uuid(),
  keywords: z.array(z.string().min(2)).default([]),
});

export const settingSchema = z.object({
  key: z.string().min(2).max(100),
  value: z.unknown(),
});

export const systemSettingsUpdatedSchema = z.object({
  settings: z.array(
    z.object({
      key: z.string().min(2).max(100),
      value: z.unknown(),
      description: z.string().max(500).optional(),
    })
  ),
});

// ─── Evidence ────────────────────────────────────────────────────────────────

export const evidenceQuerySchema = z.object({
  complaintId: z.string().uuid(),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  action: z.nativeEnum(AuditAction).optional(),
  entityType: z.string().max(100).optional(),
  actorId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});
