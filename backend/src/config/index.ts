import './db-fallback.js'; // ensure DATABASE_URL is resolved (fallback for local runs)
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Database
  databaseUrl: process.env.DATABASE_URL || '',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production-no-longer-than-required',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    mfaExpiresIn: '5m',
  },

  // MFA (TOTP via speakeasy)
  mfa: {
    issuer: process.env.MFA_ISSUER || 'SHJAP Grievance Portal',
  },

  // File Storage (S3-compatible) or private local directory
  s3: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY || '',
    secretKey: process.env.S3_SECRET_KEY || '',
    bucket: process.env.S3_BUCKET || 'shjap-evidence',
    publicUrl: process.env.S3_PUBLIC_URL || '',
  },

  // Supabase (Storage via service-role API key; Postgres via DATABASE_URL)
  // Server-side only — the service role key must never reach the frontend.
  supabase: {
    url: process.env.SUPABASE_URL || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'shjap-evidence',
  },

  // Email (SMTP) — notification service is email-ready
  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'SHJAP Grievance Portal <noreply@shjap.edu>',
  },

  // Rate Limiting
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX || '300', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '50', 10),
  },

  // Audit Log
  auditLogSecret: process.env.AUDIT_LOG_SECRET || 'audit-secret-change-in-production',

  // File Upload
  upload: {
    driver: (process.env.STORAGE_DRIVER || 'local') as 'local' | 's3' | 'supabase',
    localStorageDir: process.env.EVIDENCE_LOCAL_DIR || '../storage/evidence',
    malwareScanUrl: process.env.MALWARE_SCAN_URL || '',
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
    maxFilesPerComplaint: 10,
    allowedMimeTypes: (
      process.env.ALLOWED_MIME_TYPES ||
      'image/jpeg,image/png,image/gif,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
      .split(',')
      .map((t) => t.trim()),
  },

  // Security
  passwordMinLength: 8,
  maxFailedLogins: parseInt(process.env.MAX_FAILED_LOGINS || '5', 10),
  lockoutDurationMs: 15 * 60 * 1000, // 15 minutes

  // Workflow
  duplicateWindowHours: parseInt(process.env.DUPLICATE_WINDOW_HOURS || '24', 10),
};
