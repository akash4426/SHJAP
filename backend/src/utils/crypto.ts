import { createHash, randomBytes, randomUUID } from 'crypto';

/** Generate a unique complaint number like GRP-2026-A1B2C */
export function generateComplaintNumber(): string {
  const year = new Date().getFullYear();
  const random = randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars → collision-resistant
  return `GRP-${year}-${random}`;
}

/** Generate a secure random tracking ID for anonymous complaints */
export function generateTrackingId(): string {
  return `TRK-${randomBytes(9).toString('hex').toUpperCase()}`;
}

/** UUID via crypto (no external dep) */
export function uuid(): string {
  return randomUUID();
}

/** Generate a secure path for evidence storage (private, non-guessable) */
export function generateEvidencePath(complaintId: string, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? 'bin';
  const uid = randomUUID();
  return `evidence/${complaintId}/${uid}.${ext}`;
}

/** Generate password reset token (raw value; only its hash is stored) */
export function generateResetToken(): string {
  return randomBytes(32).toString('hex');
}

export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Token used for DB storage: only the hash is persisted */
export function hashToken(rawToken: string): string {
  return sha256(rawToken);
}

/** Compute audit log chain hash: hash = SHA256(previousHash + canonicalEventData) */
export function computeAuditHash(previousHash: string | null, eventData: object): string {
  const payload = (previousHash ?? '') + JSON.stringify(eventData);
  return sha256(payload);
}

/** Sanitize a filename to prevent path traversal and odd characters */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'file';
}

/** Basic HTML/script stripping for free-text fields (defense in depth vs stored XSS) */
export function sanitizeText(input: string): string {
  return input
    .replace(/<[^>]*>?/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}
