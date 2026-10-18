import { describe, it, expect } from 'vitest';
import {
  passwordSchema,
  phoneSchema,
  optionalPhoneSchema,
  registerSchema,
  loginSchema,
  createComplaintSchema,
  escalateComplaintSchema,
  resolveComplaintSchema,
  reviewEscalationSchema,
  feedbackSchema,
  rejectComplaintSchema,
  createUserSchema,
} from '../../src/validators/schemas.js';

describe('validators (unit)', () => {
  describe('passwordSchema', () => {
    it('accepts a strong password', () => {
      const ok = passwordSchema.safeParse('Password@123');
      expect(ok.success).toBe(true);
    });

    it('rejects short passwords', () => {
      expect(passwordSchema.safeParse('Pa@1').success).toBe(false);
    });

    it('rejects missing uppercase', () => {
      expect(passwordSchema.safeParse('password@123').success).toBe(false);
    });

    it('rejects missing digit', () => {
      expect(passwordSchema.safeParse('Password@abc').success).toBe(false);
    });

    it('rejects missing special character', () => {
      expect(passwordSchema.safeParse('Password1234').success).toBe(false);
    });
  });

  describe('phoneSchema', () => {
    it('accepts common formats', () => {
      for (const p of ['+254700123456', '0700 123 456', '(021) 555-0100']) {
        expect(phoneSchema.safeParse(p).success).toBe(true);
      }
    });

    it('rejects letters', () => {
      expect(phoneSchema.safeParse('not-a-phone').success).toBe(false);
    });
  });

  describe('optionalPhoneSchema', () => {
    it('treats an empty string (untouched form field) as not provided', () => {
      expect(optionalPhoneSchema.parse('')).toBeUndefined();
    });

    it('treats undefined as not provided', () => {
      expect(optionalPhoneSchema.parse(undefined)).toBeUndefined();
    });

    it('passes valid numbers through', () => {
      expect(optionalPhoneSchema.parse('+254700123456')).toBe('+254700123456');
    });

    it('still rejects invalid values', () => {
      expect(optionalPhoneSchema.safeParse('abcd').success).toBe(false);
    });
  });

  describe('registerSchema', () => {
    it('lowercases the email', () => {
      const parsed = registerSchema.parse({
        email: 'Student@EXAMPLE.com',
        password: 'Password@123',
        firstName: 'A',
        lastName: 'B',
        studentId: 'S-1',
      });
      expect(parsed.email).toBe('student@example.com');
    });

    it('rejects missing studentId', () => {
      const ok = registerSchema.safeParse({
        email: 'a@b.com', password: 'Password@123', firstName: 'A', lastName: 'B',
      });
      expect(ok.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('requires a well-formed MFA code when given', () => {
      expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', mfaCode: '12345' }).success).toBe(false);
      expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', mfaCode: '123456' }).success).toBe(true);
    });
  });

  describe('createComplaintSchema', () => {
    const valid = {
      title: 'Broken classroom heater',
      description: 'The heater sparks when switched on and damaged panel was reported twice already.',
      submissionMode: 'VERIFIED',
    };

    it('accepts a valid complaint', () => {
      expect(createComplaintSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects a short title', () => {
      expect(createComplaintSchema.safeParse({ ...valid, title: 'abc' }).success).toBe(false);
    });

    it('rejects a short description', () => {
      expect(createComplaintSchema.safeParse({ ...valid, description: 'too short' }).success).toBe(false);
    });

    it('rejects an invalid priority', () => {
      expect(createComplaintSchema.safeParse({ ...valid, priority: 'HIGHEST' }).success).toBe(false);
    });
  });

  describe('escalateComplaintSchema', () => {
    it('requires a reason of at least 10 characters', () => {
      expect(escalateComplaintSchema.safeParse({ reason: 'short' }).success).toBe(false);
      expect(escalateComplaintSchema.safeParse({ reason: 'This reason is long enough for escalation' }).success).toBe(true);
    });
  });

  describe('resolveComplaintSchema', () => {
    it('requires summary, detailed resolution and action taken', () => {
      expect(resolveComplaintSchema.safeParse({
        summary: 'short', detailedResolution: 'too short', actionTaken: 'fine',
      }).success).toBe(false);
      expect(resolveComplaintSchema.safeParse({
        summary: 'This summary is adequate length',
        detailedResolution: 'This detailed resolution explains what happened end to end.',
        actionTaken: 'Action was taken promptly.',
      }).success).toBe(true);
    });
  });

  describe('reviewEscalationSchema', () => {
    it('only allows APPROVE or REJECT', () => {
      expect(reviewEscalationSchema.safeParse({ decision: 'MAYBE' }).success).toBe(false);
      expect(reviewEscalationSchema.safeParse({ decision: 'APPROVE' }).success).toBe(true);
      expect(reviewEscalationSchema.safeParse({ decision: 'REJECT', reviewNotes: 'why' }).success).toBe(true);
    });
  });

  describe('feedbackSchema', () => {
    it('bounds rating to 1..5', () => {
      expect(feedbackSchema.safeParse({ rating: 0 }).success).toBe(false);
      expect(feedbackSchema.safeParse({ rating: 6 }).success).toBe(false);
      expect(feedbackSchema.safeParse({ rating: 3 }).success).toBe(true);
    });

    it('rejects fractional ratings', () => {
      expect(feedbackSchema.safeParse({ rating: 4.5 }).success).toBe(false);
    });
  });

  describe('rejectComplaintSchema', () => {
    it('requires a reason of at least 10 characters', () => {
      expect(rejectComplaintSchema.safeParse({ reason: 'bad' }).success).toBe(false);
      expect(rejectComplaintSchema.safeParse({ reason: 'This is a sufficient abuse reason' }).success).toBe(true);
    });
  });

  describe('createUserSchema', () => {
    it('requires at least one role', () => {
      expect(createUserSchema.safeParse({
        email: 'a@b.com', password: 'Password@123', firstName: 'A', lastName: 'B', roles: [],
      }).success).toBe(false);
      expect(createUserSchema.safeParse({
        email: 'a@b.com', password: 'Password@123', firstName: 'A', lastName: 'B', roles: ['STUDENT'],
      }).success).toBe(true);
    });
  });
});
