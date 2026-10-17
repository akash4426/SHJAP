# SHJAP Grievance Portal — Architecture

## Module map

```
backend/src
├── index.ts                 Fastify wiring: security headers, CORS, JWT, rate limits,
│                            multipart (uploads), routes, error handler, /health
├── config/
│   ├── index.ts             Central typed config (env-driven; all values validated local defaults)
│   └── database.ts          Prisma client + connect/disconnect + query logging (dev)
├── routes/
│   ├── auth.routes.ts       register/login/MFA/refresh/logout/forgot-reset/me
│   ├── complaint.routes.ts  complaint lifecycle incl. state machine routes; anonymous routes
│   ├── evidence.routes.ts   multipart upload with content validation; verify/delete/download
│   ├── notification.routes.ts
│   ├── admin.routes.ts      users/roles/permissions/departments/colleges/categories/settings/security + audit feed/verify
│   └── admin.routes.analytics.ts  scoped analytics (overview/departments/categories/trust/resolution/satisfaction/escalations)
├── services/
│   ├── auth.service.ts      Argon2id hashing, registration, login lockout accounting,
│   │                        TOTP MFA, password reset tokens, dev credential seeding
│   ├── complaint.service.ts central state machine (ALLOWED_TRANSITIONS + TRANSITION_ROLES),
│   │                        create/list/get/update/lifecycle transitions, dashboards
│   ├── access-control.service.ts  the only place complaint visibility is decided (scope filters)
│   ├── categorization.service.ts  rule-based classifier (occurrence-weighted titles, ambiguity flagging)
│   ├── trust-score.service.ts     0–100 score with PENDING semantics + component factors
│   ├── audit.service.ts     append-only hash chain writer/verifier (serialized writers)
│   ├── audit-query.service.ts     admin audit feed queries
│   ├── message.service.ts   complaint messaging incl. system notices + recipient resolution
│   ├── notification.service.ts    all notification creation points
│   └── storage.ts           dual driver (local private dir / S3 presigned) + content sniffing
├── middleware/
│   ├── auth.middleware.ts   authenticate (verify token), getAuthUser, requireRole
│   ├── complaint-access.middleware.ts  loads complaint + requires AccessControlService pass
│   └── error-handler.ts     consistent envelope; ZodError→400; specific JWT/rate-limit errors
├── validators/schemas.ts    every request body/query schema (Zod)
└── utils/                   crypto (Argon2 helpers, SHA-256, tracking ids, sanitizers), response, errors, logger

prisma/                      schema.prisma (root), seed.ts
frontend/src
├── api/client.ts            typed axios instance + JWT refresh interceptor
├── contexts/AuthContext.tsx session state/storage + role helpers
├── components/shared/       badges, timeline, ratings, layout atoms
├── layouts/                 AppLayout (role-aware sidebar), AuthLayout
└── pages/
    ├── public/              landing, login, register, forgot-password, anonymous tracking
    ├── student/             dashboard, lodge (multi-step), my complaints, detail+feedback+upload
    ├── dept-admin/          dashboard, complaints queue, investigate
    ├── college-admin/       dashboard (+ escalated review)
    ├── university-admin/    oversight dashboard
    ├── main-admin/          dashboard, users, audit logs (incl. chain verification)
    └── shared/              AdminComplaintDetail (assess/escalate/resolve/review/evidence),
                              notifications, profile (MFA setup)

tests/                       backend vitest suite lives in backend/tests;
                             tests/e2e holds Playwright config + specs
```

## Data model (high level)

- `User` (roles array cache synced with Role/UserRoleAssignment), StudentProfile,
  AdministratorProfile; MFAConfiguration; RefreshToken (hashed, single-use);
  PasswordResetToken (hashed).
- `Complaint` (number GRP-YYYY-xxxx, trackingId TRK-…, status/priority enums,
  submissionMode, anonymous + needsManualCategorization flags, assigned/dept/category
  links, timestamps); ComplaintStatusHistory (reasons); ComplaintAssessment;
  ComplaintEscalation (level + review decision); Resolution; Feedback;
  Evidence (paths + metadata only); Message (thread); Notification;
  TrustScore (score + factors); AuditLog (frozen payload, hash, previousHash,
  monotonic sequence).

## Request flow (complaint lifecycle)

1. React → Vite proxy → Fastify route → Zod schema → service → Prisma.
2. `ComplaintService` owns all transitions; each transition appends status history,
   audit event and notification (single-writer serialized audit chain).
3. Listings/detail shapes run through `AccessControlService` so role scoping and the
   anonymous-invariant can never be bypassed by a specific route.
4. Frontend queries invalidate/react-query caches per mutation to refetch scoped data.

## Trust model

- Complaint identity: never attached for anonymous submissions; verified submissions
  link student identity for messaging and follow-up.
- Evidence chain: upload → sniffed content validation → private storage; downloads
  authorized per uploader/assigned/elevated roles and audited; deletions audited
  and trust-score-affecting.
- Audit: `hash = SHA256(previousHash + canonical payload)`, sequence-ordered,
  verification endpoint replays the whole chain and pinpoints the first tampered
  sequence; the canonical payload is frozen at write time (byte-exact), so jsonb
  re-serialization can never invalidate the chain.
