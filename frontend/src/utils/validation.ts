import { z } from 'zod';

/**
 * Frontend mirror of the backend password policy
 * (backend/src/validators/schemas.ts → passwordSchema).
 * Keeping the two in sync avoids confusing server-side 400s for users.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100, 'Password must be at most 100 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

export const PASSWORD_HINT = 'Min. 8 characters with upper & lower case, a number and a symbol';
