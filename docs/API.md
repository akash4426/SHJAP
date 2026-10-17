# SHJAP Grievance Portal — API Reference

Base URL (dev): `http://localhost:3001`
All authenticated requests send `Authorization: Bearer <access token>`.
Every response uses one envelope:

```json
{ "success": true,  "data": { ... }, "message": "optional" }
{ "success": false, "error": { "code": "STRING", "message": "string", "details": "optional" } }
```

Validation failures return `400` with `code: "VALIDATION_ERROR"`.
 Unauthorized/forbidden/missing/conflicts return `401/403/404/409/423/429`.

Roles: `STUDENT`, `DEPARTMENT_ADMIN`, `COLLEGE_ADMIN`, `UNIVERSITY_ADMIN`, `MAIN_ADMIN`.

---

## Authentication (`/api/auth`)

All routes are rate-limited per IP (see `AUTH_RATE_LIMIT_MAX`).

| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /register` | — | Student self-registration (emails, password policy, student id). Role fixed to STUDENT server-side. Returns token pair + refresh cookie-less body `{ user, token, refreshToken }`. |
| `POST /login` | — | `{ email, password }`. When MFA is enabled returns `{ mfaRequired: true, mfaToken, emailMask }` instead of tokens. Never logs failed attempts beyond lockout accounting. |
| `POST /mfa/verify` | — | `{ mfaToken, code }` → full token pair. |
| `POST /mfa/setup` | ✔ | Generates TOTP secret + QR data URL (not yet enabled). |
| `POST /mfa/enable` | ✔ | `{ secret, code }` — confirms and switches MFA on. |
| `POST /mfa/disable` | ✔ | `{ code }`. |
| `POST /refresh` | — | `{ refreshToken }` — single-use rotation: old token revoked, new pair returned; replaying a used token → 401. |
| `POST /logout` | ✔ | `{ refreshToken }` revokes that session, no body revokes all sessions. |
| `POST /forgot-password` | — | `{ email }` → generic response; in dev/test the response also carries `resetToken` for tooling. |
| `POST /reset-password` | — | `{ token, password }` — token single-use; revokes all refresh tokens. |
| `GET /me` | ✔ | Current identity + profiles (`studentProfile`, `adminProfile`). |

---

## Complaints (`/api/complaints`)

State machine (guarded server-side; transitions recorded with a reason in status history):

```
SUBMITTED → CATEGORIZED → ASSIGNED → UNDER_INVESTIGATION → INFORMATION_REQUESTED
                                        ↓                      ↓
                              ESCALATED (dept→college, college→univ)
                                        ↓
                              RESOLUTION_PROPOSED → RESOLVED → CLOSED
                                        REJECTED (early abuse/unfounded path)
```

| Method & Path | Auth / role | Purpose |
|---|---|---|
| `POST /` | ✔ STUDENT | Submit a `{ title, description, submissionMode: 'VERIFIED', priority?, categoryId?, departmentId?, location?, additionalInfo? }` complaint. Auto-categorization + department assignment run right after; duplicate title within the 24h window → 409. `submissionMode: 'ANONYMOUS'` rejected here (use the public endpoint). |
| `GET /` | ✔ | Role-scoped paginated list. Filters: `status, priority, categoryId, departmentId, submissionMode, dateFrom, dateTo, search, sortBy, sortOrder, page, limit`. Students see only their own; dept admins their department (+assigned); college admins their college; university admins escalated/work assigned to them; main admins everything. Anonymous rows never include submitter fields. |
| `GET /:id` | ✔ scope | Full detail (category, department, submitter identity when non-anonymous, assessments, escalations, resolution, trust score, evidence, feedback, counts). |
| `PATCH /:id` | ✔ owner-while-pending / admins | Edit metadata fields. |
| `DELETE /:id` | MAIN_ADMIN | Soft delete. |
| `POST /:id/assign` | MAIN / COLLEGE / UNIVERSITY admins | `{ assignedToId, notes? }` → ASSIGNED. |
| `POST /:id/assess` | admins | Investigation/assessment body; `isInformationRequested: true` + text → INFORMATION_REQUESTED. |
| `POST /:id/escalate` | DEPT / COLLEGE admins | `{ reason (min 10), notes? }` → ESCALATED; dept→ college of the complaint, college→ university. |
| `POST /:id/review` | COLLEGE admin | `{ decision: 'APPROVE'\|'REJECT', reviewNotes? }` on a pending escalation. |
| `POST /:id/resolve` | admins | `{ summary (≥10), detailedResolution (≥20), actionTaken (≥10) }` → RESOLVED (+ notification to student). |
| `POST /:id/request-info` | DEPT / COLLEGE admins | `{ request }` → INFORMATION_REQUESTED + in-app system notice via the messaging thread. |
| `POST /:id/reject` | admins | `{ reason (≥10) }` → REJECTED. |
| `POST /:id/close` | UNIVERSITY / MAIN | `{ reason? }` → CLOSED (terminal). |
| `POST /:id/feedback` | ✔ complainant | `{ rating: 1..5, comment? }` on RESOLVED/CLOSED; upserts the single feedback record. |
| `GET /:id/feedback` | ✔ scope | Feedback record or null. |
| `GET /:id/history` | ✔ scope | Status history array with reasons. |
| `GET /:id/transition-options` | ✔ scope | Allowed transitions for the current status/role (drives admin UI actions). |
| `GET /:id/audit-log` | ✔ scope | Audit entries for this complaint. |
| `GET /:id/trust-score` | ✔ scope | Trust score + component factors (or PENDING). |

---

## Messaging (`/api/complaints/:id/messages`)

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /messages` | ✔ scope | Thread (senders/recipients included); marks incoming as read. **Anonymous complaints → disabled (error).** |
| `GET /messages/unread-count` | ✔ scope | Unread count for the caller. |
| `POST /messages` | ✔ scope | `{ message }` — recipients resolved server-side (student ↔ assigned admins); anonymous complaints → disabled. |

---

## Evidence (`/api/complaints/:id/evidence`)

| Method & Path | Auth | Purpose |
| `GET /evidence` | ✔ scope | Metadata list (`id, originalName, fileSize, mimeType, type, description, isVerified, uploadedById, createdAt`) — no server paths or contents. |
| `GET /evidence/:evidenceId/download` | ✔ uploader/assigned/elevated | Local driver streams the file; S3 driver returns `{ downloadUrl, expiresIn: 900 }`. Audits `EVIDENCE_ACCESSED`. |
| `POST /evidence/:evidenceId/verify` | admins | Marks evidence verified. |
| `DELETE /evidence/:evidenceId` | uploader or MAIN_ADMIN | Deletes file + record, recalculates trust score. |

---

## Anonymous complaints (`/api/anonymous`)

| Method & Path | Auth | Purpose |
|---|---|---|
| `POST /complaints` | — | Public anonymous submission → `{ trackingId, complaintNumber, status }` only. Identity columns remain NULL. |
| `GET /complaints/:trackingId` | — | Public status timeline by tracking id (never identity). |

---

## Notifications (`/api/notifications`)

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /` | ✔ | Paginated, filterable (`isRead=true|false`, `type`). |
| `GET /unread-count` | ✔ | Badge count. |
| `PATCH /:id/read` / `PATCH /:id/unread` | ✔ | Toggle a notification. |
| `PATCH /read-all` | ✔ | Mark all read. |

Notification types cover submission, assignment, status changes, info requests,
admin messages, escalations, resolution and feedback requests.

---

## Admin (`/api/admin`, role-gated per endpoint)

| Area | Endpoints (GET list / POST create / PATCH update unless noted) |
|---|---|
| Users | `GET /users` (MAIN), `POST /users` (MAIN), `PATCH /users/:id`, `PATCH /users/:id/roles`, `POST /users/:id/enable\|disable`, `POST /users/:id/reset-password` — MAIN only |
| Departments / Colleges | list also for admins (`GET /departments`, `GET /colleges`); create/update MAIN only |
| Categories | `GET /categories`, create/update MAIN only |
| Roles & permissions | `GET /roles`, `GET /permissions`, `PATCH /roles/:roleId/permissions` — MAIN only |
| Settings | `GET /settings`, `PATCH /settings` — MAIN only |
| Security overview | `GET /security` — MAIN only (recent lockouts, failed-login and session statistics) |
| Dashboard data | `GET /complaint/:id` (scoped complaint read incl. transition metadata) |

---

## Analytics (`/api/analytics`)

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /overview` | admins | Role-scoped totals: counts, resolved, escalated, pending, resolution rate, escalation rate, `byStatus`, `byPriority`. |
| `GET /departments` | admins | Volume + resolution performance per department (admin's scope). |
| `GET /categories` | admins | Volume per complaint category. |
| `GET /trust-scores` | admins | Trust score distribution + latest scores. |
| `GET /resolution-times` | admins | Average resolution time series/buckets. |
| `GET /satisfaction` | admins | Feedback rating averages. |
| `GET /escalations` | admins | Escalation funnel + pending reviews. |

## Audit log (`/api/audit-logs`)

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /` | MAIN_ADMIN | Filterable feed (`action, entityType, actorId, search, page, limit`) including `hash`, `previousHash`, frozen payloads. |
| `GET /verify` | MAIN_ADMIN | Replays the full hash chain; `{ valid, totalEntries, tamperedAtSequence? }`. |

---

## Health

`GET /health` → `{ status: "ok", timestamp, version, service }` (no auth).
