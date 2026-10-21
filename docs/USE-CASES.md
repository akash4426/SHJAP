# SHJAP Grievance Portal — Use Case Coverage (UC-01 … UC-13)

Every use case maps to concrete screens, endpoints and automated tests.
Verification status refers to the automated suites: 97 unit/integration (Vitest),
6 browser E2E (Playwright), 38-check API smoke run.

## Architectural invariants

| # | Invariant | Where enforced | Verified by |
|---|---|---|---|
| 1 | Identity is never stored for anonymous complaints; impossible to attach identity retroactively | `Complaint.submittedById NULL` write path; no update path sets it; anonymized list/detail responses | `tests/integration/anonymous.spec.ts` (submittedById null, no submittedBy in payloads) |
| 2 | Anonymous complaints cannot convert to verified | dedicated endpoint only; verified endpoint rejects ANONYMOUS mode; no transition code exists | `anonymous.spec.ts`, `rbac.spec.ts` |
| 3 | Messaging and evidence upload disabled for anonymous complaints to prevent identification | `POST /messages`, `POST /evidence` guards | `anonymous.spec.ts` |
| 4 | Every status change records an audit entry and a notification | `ComplaintService.updateStatus` central guard → AuditService + NotificationService | `complaint-lifecycle.spec.ts` (history ≥ 3, notifications on resolve) |
| 5 | Tamper-evident append-only audit chain (`SHA256(prev+payload)`, `sequence` ordered, serialized writers) | `AuditService`, `AuditLog` columns | `audit-chain.spec.ts` (tamper detection reports exact sequence), smoke #12 |
| 6 | RBAC: 5 roles; backend authorization on every route; frontend performs no access decisions; unassigned complaints are the shared department-admin intake queue | `requireRole`, `requireComplaintAccess`, `AccessControlService` scope filters | `rbac.spec.ts` matrix, `complaint-lifecycle.spec.ts` intake test |
| 7 | State machine transitions validated with role checks + required reasons/details | `ALLOWED_TRANSITIONS`/`TRANSITION_ROLES` | `complaint-lifecycle.spec.ts` (invalid transitions 400, escalation reason min length) |
| 8 | Trust Score 0–100 with PENDING when evidence/process data is insufficient; recompute on evidence changes | `TrustScoreService.calculate` on create/evidence/assessment/update | smoke #11, evidence + lifecycle suites |
| 9 | Evidence stored privately (local driver default, S3 optional), authorized-only downloads, validated content | `services/storage.ts`, `evidence.routes.ts` | `evidence-scan.spec.ts` (magic bytes/executables), `evidence.spec.ts` (extension/MIME agreement, path leaks absent), smoke #21–26 |
| 10 | Consistent error envelope + Zod validation everywhere | central error handler (incl. ZodError → 400), `validators/schemas.ts` | `validators.spec.ts`, anonymous invalid-payload test |

## UC-01 — Lodge complaint (student)

- Mode selection dialog (verified vs anonymous) with clear privacy statement;
  multi-step form: mode → details → review → confirmation showing `GRP…` number
  (+ `TRK…` for anonymous).
- Location, category/department hints, additional info.
- **Endpoints**: `POST /api/complaints` (verified), `POST /api/anonymous/complaints`; auto
  categorization + assignment + trust score + notifications fire on submit.
- **Tests**: `student-submit.spec.ts` (E2E; complaint number visible on confirmation and
  listing), `anonymous-track.spec.ts`, lifecycle submit assertions; duplicate protection.

## UC-02 — Anonymous complaint submission & tracking

- Public form without login; only a `TRK-…` tracking id is returned.
- Public `/track` status timeline; nowhere exposes identity (fields forced NULL; lists
  anonymize; even MAIN_ADMIN listing shows `submittedBy: null`).
- **Tests**: `anonymous.spec.ts` (7 checks), smoke #4–#5, E2E tracking flow.

## UC-03 — Auto-categorization & department assignment

- Submitter-selected category/department is authoritative and routed
  synchronously; the rule-based classifier only fills the missing fields
  (occurrence-weighted title boost, family matching). Exact-tie/no-match rows
  stay unassigned and appear in the shared department-admin intake queue, with
  notifications to main/college admins for manual categorization.
- **Tests**: `categorization.spec.ts` (8 unit checks incl. ambiguity + no-match),
  `complaint-lifecycle.spec.ts` (explicit routing + intake visibility),
  smoke #7/#18 (auto-assignment to IT / Academic Affairs), rbac.

## UC-04 — Department admin reviews & investigates

- Dashboard queue with counts + filters; complaint detail with assessments tab;
  assess forms (investigation notes, evidence assessment, findings, recommended
  action, resolution decision); request-info triggers INFORMATION_REQUESTED and a
  system notice in the student thread.
- **Endpoints**: `POST /:id/assess`, `POST /:id/request-info`, `GET transition-options`.
- **Tests**: lifecycle assessment/status assertions; out-of-department access denied.

## UC-05 — Escalation

- Level 1 (department) escalates to the complaint's college admin; level 2 (college)
  escalates to university admin; requires reason ≥ 10 chars; notes optional;
  status history and notifications created; violations of the transition guard → 400.
- **Tests**: lifecycle escalate; rbac out-of-scope→escalated visibility flips for
  university admin; smoke #18–#20.

## UC-06 — Department resolution proposal

- Admin resolve form requires summary/detailed resolution/action taken;
  resolution recorded with resolver identity; student notified;
  resolution visible to the student; feedback then unlockable.
- **Tests**: lifecycle resolve (200, `resolvedAt`, required-field validation), smoke #9–#10.

## UC-07 — College review (approve / reject)

- Pending escalation surfaced with review actions; APPROVE → RESOLVED; REJECT →
  UNDER_INVESTIGATION; decision + notes persisted on the escalation record.
- **Endpoint**: `POST /:id/review` (COLLEGE_ADMIN only). **UI**: Review Escalation tab.
- **Covered**: review schema acceptance tested via validators; backend unit path
  exercised through the resolve/escalate matrix.

## UC-08 — Student feedback & ratings

- Feedback unlocks on RESOLVED/CLOSED; optional 1–5 stars + optional comment;
  one record per complaint (upsert preserved history of latest rating);
  out-of-range → 400; analytics thread (satisfaction) exposes aggregates.
- **Tests**: lifecycle feedback (5★ then update to 2★), rating bounds; smoke #11.

## UC-09 — Messages

- Two-way complaint thread between the student and assigned admins (system notices
  for info requests); unread counts for badges; disabled for anonymous complaints
  with an explanatory error (privacy preservation).
- **Tests**: `anonymous.spec.ts` messaging guard; message service de-duped recipients.

## UC-10 — Notifications

- In-app notification center for submitter and admins: submission, assignment, status
  changes, info requests, admin messages, escalation, resolution, feedback requests.
- Unread counts; one-click mark-read / mark-all-read.
- **Endpoints**: `/api/notifications` list/unread/read/unread-all.
- **Tests**: lifecycle notification assertion; smoke #12 (notifications received).

## UC-11 — Trust score

- Components: evidence integrity, evidence completeness, history consistency,
  process transparency → 0–100 aggregate with LOW/MEDIUM/HIGH bands; PENDING until
  meaningful data exists; recalculated on evidence upload/verify/delete and status flows.
- **Endpoint**: `GET /:id/trust-score`; per-complaint breakdown card in the admin/detail UI.
- **Tests**: smoke #11; admin amber breakdown rendering gated on `score != null`.

## UC-12 — Metadata management (Main Admin)

- CRUD for users (activation, password reset, role assignment), departments,
  colleges, categories (default keywords), roles & managed permissions matrix,
  system settings; security overview endpoint for lockout statistics.
- **Endpoints**: `/api/admin/*`. **UI**: UsersPage plus the main admin dashboard tiles.
- **Tests**: rbac negative cases on admin endpoints; smoke #22–#23 (settings/roles).

## UC-13 — Dashboards & analytics (all admin layers)

- Role-scoped dashboards: department stack (assigned/resolved/escalated), college
  overview, university oversight (escalation funnel), main global KPIs.
- Analytics endpoints: overview, departments, categories, trust scores,
  resolution times, satisfaction, escalations — each scoped by the caller's role.
- **Tests**: smoke #15 (scoped dept analytics); dashboard pages fetch real endpoints
  (no stubs anywhere in the frontend).

## Additional guarantees

- Password reset: token generation → hashed storage → verified → marked used → all
  refresh tokens revoked after reset; generic responses avoid account enumeration.
- MFA-ready: TOTP setup/enable/disable/verify endpoints wired and enforced at login.
- File validation: extension whitelist + MIME agreement + magic bytes + executable
  signature rejection (+ optional external scanner hook).
- Rate limiting: per-IP auth rate limit and global limiter; per-account brute-force
  lockout with lock expiry.
