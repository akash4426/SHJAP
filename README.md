# SHJAP Grievance Portal

A full-stack **student grievance portal** with five administrative layers
(Student → Department Admin → College Admin → University Admin → Main Admin),
anonymous **and** verified complaint submission, private evidence handling,
complaint messaging, notifications, a computed trust score, role-scoped
dashboards and analytics, and a tamper-evident append-only audit log.

The application is a **modular monolith**: a React SPA talking to a Fastify API
over REST, backed by PostgreSQL through Prisma, with pluggable evidence storage
(pluggable between a private local directory, any S3-compatible store, or
Supabase Storage). The database and evidence bucket can run on **Supabase**
(verified against a live project) or entirely locally.

**Status:** 108 unit/integration tests, 7 browser E2E tests, 38-check API smoke
run, backend + frontend typecheck clean, CI on every push.

> This README has exactly two main sections: **[1. Architecture](#1-architecture)**
> — every technology and how it is wired, plus the repository/domain dictionary —
> and **[2. SRS](#2-software-requirements-specification-srs)** — modules,
> cohesion & coupling, requirements, sprint plan and traceability.

| Section | Questions it answers |
|---|---|
| **[1. Architecture](#1-architecture)** | What are the runtime pieces? Which technologies/versions are used? How is each one integrated? Where does each directory and domain concept live? How is it configured and operated? |
| **[2. SRS](#2-software-requirements-specification-srs)** | Who are the actors? What are the functional/non-functional requirements? How are modules decomposed? How cohesive/coupled are they? How were sprints divided? How is every requirement traced to code and tests? |

---

## 1. Architecture

### 1.1 System context

```mermaid
flowchart LR
  subgraph Client["Browser — React SPA"]
    UI["Pages + AuthContext<br/>TanStack Query cache"]
  end
  subgraph API["Fastify API — Node 20"]
    RT["Routes + Zod request schemas"]
    MW["Middleware<br/>JWT auth • RBAC • complaint access"]
    SV["Domain services<br/>auth • complaints • evidence • messaging<br/>notifications • trust score • audit • analytics"]
  end
  PG[("PostgreSQL<br/>Supabase or local")]
  ST[("Evidence store<br/>local dir • S3 • Supabase Storage")]

  UI -- "REST /api · Bearer JWT" --> RT
  RT --> MW --> SV
  SV -- "Prisma Client" --> PG
  SV -- "storage driver API" --> ST
```

| Runtime piece | Where | Notes |
|---|---|---|
| SPA (dev) | `http://localhost:5173` | Vite dev server, `/api` proxied to `:3001` (`VITE_API_PROXY` overrides) |
| SPA (prod) | nginx container | serves hashed assets, SPA fallback, proxies `/api/` to `shjap-api:3001` |
| API | `http://localhost:3001` | Fastify; `/health` liveness endpoint |
| Database | `DATABASE_URL` | any PostgreSQL 14+; Supabase direct or pooler URI |
| Evidence | `STORAGE_DRIVER` | `local` (default), `s3`, or `supabase` |
| E2E stack | API `:3100`, Vite `:5177` | isolated database via `E2E_DATABASE_URL` |

### 1.2 Technology inventory and integration map

#### Frontend

| Technology | Version | Role | How it is integrated |
|---|---|---|---|
| **React** | 18.3 | UI runtime | `frontend/src/main.tsx` mounts `<App/>`; all pages are function components with hooks |
| **TypeScript** | 5.3 | Type safety | strict mode (`frontend/tsconfig.json`); `tsc` runs before every build |
| **Vite** | 5.2 | Dev server + bundler | `frontend/vite.config.ts`; `server.proxy['/api']` → `localhost:3001`; production build emitted to `dist/` |
| **React Router** | 6.22 | Client-side routing | `App.tsx`: `BrowserRouter` (main.tsx) + nested role route trees; `ProtectedRoute` guards (UX only) and `RoleDashboardRedirect` after login |
| **TanStack Query** | 5.28 | Server-state cache | `QueryClientProvider` in `main.tsx` (`staleTime: 30 s`, `retry: 1`); `useQuery`/`useMutation` in 14 files; mutations invalidate scoped caches so dashboards refetch |
| **Axios** | 1.6 | HTTP client | `api/client.ts`: `baseURL: '/api'`, 30 s timeout; request interceptor attaches `Authorization: Bearer`; response interceptor performs one refresh attempt on 401 (`/auth/refresh`), rotates tokens, otherwise clears storage and redirects to `/login` |
| **React Hook Form + @hookform/resolvers** | 7.51 / 3.3 | Forms | every form (login, registration wizard, complaint wizard, admin dialogs) uses RHF with the Zod resolver |
| **Zod** | 3.22 | Client validation | form schemas in pages; shared policy mirrors in `utils/validation.ts` (password, phone) keep client messages aligned with the API |
| **Recharts** | 2.12 | Charts | status/priority/category/trust visualisations on the five role dashboards |
| **react-hot-toast** | 2.4 | Notifications (UI) | single `<Toaster/>` in `main.tsx`; success/error toasts from API responses |
| **lucide-react** | 0.363 | Icon set | used across layouts and pages |
| **Custom CSS design system** | — | Styling | `index.css` design tokens (colors, radii, shadows, spacing) + utility classes (`form-input`, `alert`, `step-indicator`, …); no UI framework dependency; PostCSS/autoprefixer pipeline |

#### Backend

| Technology | Version | Role | How it is integrated |
|---|---|---|---|
| **Node.js** | 20 | Runtime | ESM; `tsx` in development, `tsc` → `dist/` in production |
| **Fastify** | 4.26 | HTTP framework | `buildApp()` in `src/index.ts`; `trustProxy`, 12 MB body limit; exported for tests so Vitest can use `app.inject()` without listening |
| **@fastify/helmet** | 11 | Security headers | registered first (`contentSecurityPolicy: false` — API returns JSON; CSP belongs to the SPA/nginx) |
| **@fastify/cors** | 9 | Cross-origin access | `FRONTEND_URL` + `localhost:5173/:3000`, credentials enabled |
| **@fastify/jwt** | 8 | JWT signing/verification | one secret, tokens carry `typ: access \| refresh \| mfa` and a random `jti` |
| **@fastify/cookie** | 9 | Cookie parsing | registered for completeness/forward-compatible auth flows |
| **@fastify/rate-limit** | 9 | Rate limiting | global limiter (`RATE_LIMIT_MAX`/window); auth routes registered in a scoped plugin with a tighter 20/min per `IP:url` limiter |
| **@fastify/multipart** | 8 | File uploads | single file, `MAX_FILE_SIZE` (10 MB) enforced at the parser; evidence route re-validates content |
| **Zod** | 3.22 | Request validation | `src/validators/schemas.ts` — every body/query/param; parsed in route handlers; `ZodError → 400` via the central error handler |
| **Prisma / @prisma/client** | 5.10 | ORM & schema source | schema lives at `prisma/schema.prisma` (single source of truth); client generated per install; services query through the shared client |
| **PostgreSQL** | 14+ | Relational database | UUID keys, enums, `jsonb` payloads, indexes; local, Docker (`postgres:18-alpine`) or Supabase |
| **argon2** | 0.31 | Password hashing | Argon2id in `auth.service.ts`; hashes are never returned by any endpoint |
| **speakeasy + qrcode** | 2.0 / 1.5 | TOTP MFA | setup returns an otpauth URI rendered as a QR data-URL; verify/enable/disable endpoints; login issues a short-lived `mfa` token until TOTP is confirmed |
| **pino + pino-pretty** | 8.19 / 10 | Structured logging | `utils/logger.ts`; dev-pretty console output; Prisma query events logged at debug in development |
| **AWS SDK S3 + presigner** | 3.535 | S3-compatible storage | driver in `services/storage.ts`; `forcePathStyle: true` (MinIO/Supabase); downloads are short-lived presigned URLs |
| **@supabase/supabase-js** | 2.118 | Supabase Storage driver | created lazily with `SUPABASE_URL` + `SUPABASE_SECRET_KEY`; bucket auto-created privately; signed URLs for downloads |
| **dotenv + db-fallback** | 16 | Environment loading | `config/index.ts` loads `.env`; `config/db-fallback.ts` supplies a dev-only local `DATABASE_URL` when unset and refuses that fallback in production |

#### Data, storage and delivery

| Technology | Role | How it is integrated |
|---|---|---|
| **Prisma schema** | Data model owner | 26 models / 7 enums; `prisma db push` (dev), `prisma migrate` (production workflow), `prisma db seed` |
| **Supabase Postgres** | Managed database | simply `DATABASE_URL` (direct IPv6 or Session pooler URI; SSL required). Prisma owns the schema — Supabase migrations/seed are disabled in `supabase/config.toml` |
| **Supabase Storage** | Managed evidence store | native driver via secret key (`STORAGE_DRIVER=supabase`) or the S3 protocol (`STORAGE_DRIVER=s3`); private `shjap-evidence` bucket, 10 MiB, MIME whitelist (also defined in `supabase/config.toml` for the optional local stack) |
| **Supabase Auth** | **not used** | bespoke Argon2id + rotating JWT + TOTP MFA is a project requirement; `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_JWKS_URL` are accepted for completeness but not consumed |
| **Docker** | Packaging | `backend/Dockerfile`, `frontend/Dockerfile` (multi-stage build → nginx) |
| **docker-compose** | Local production-like stack | `db` (Postgres 18), `api`, `web` (nginx proxying `/api` to the API); volumes for DB + evidence |
| **nginx** | SPA hosting | history fallback, immutable asset caching, security headers, 12 MB body, `/api/` reverse proxy |
| **GitHub Actions** | CI | backend job: Postgres 16 service → `tsc --noEmit` + Vitest; frontend job: `tsc --noEmit` + `vite build` |

#### Security / auth stack (cross-cutting)

| Mechanism | Integration |
|---|---|
| **Argon2id** | registration, password reset, password change — `AuthService` |
| **JWT access tokens** | 15 min default (`JWT_EXPIRES_IN`), signed by `@fastify/jwt`; verified in `authenticate` middleware |
| **Refresh tokens** | hashed at rest (`RefreshToken.tokenHash`), single-use rotation; replay of a rotated token is rejected; TTL configurable (`JWT_REFRESH_EXPIRES_IN`, default 7 days) |
| **Logout** | revokes the presented refresh token |
| **Brute-force lockout** | `MAX_FAILED_LOGINS` (default 5) → 15-minute `lockedUntil`; failed attempts persist across restarts |
| **Password reset** | 32-byte token, only its SHA-256 stored, 1-hour expiry, single use; all refresh tokens revoked after reset; token returned in the API response only in development/test |
| **TOTP MFA** | `MFAConfiguration` model; login returns `mfaRequired` + 5-minute `mfa` token until `/auth/mfa/verify` |
| **RBAC** | `requireRole(...)` middleware + `AccessControlService` (the single authority for complaint visibility) |
| **Audit chain** | `AuditService` writes `hash = SHA256(previousHash + frozen canonical payload)` with a monotonic `sequence`; serialized in-process writers |
| **Input hardening** | Zod everywhere; central error envelope; helmet; CORS allow-list; rate limits |

#### Development, test and delivery tooling

| Technology | Version | Role | How it is integrated |
|---|---|---|---|
| **npm workspaces** | npm 9+ | Monorepo package management | root `package.json` defines `backend` + `frontend`; one install, scripts target workspaces with `--workspace` |
| **concurrently** | 8.2 | Dev-process orchestration | root `npm run dev` starts the API watcher and Vite together |
| **tsx** | 4.7 | TypeScript execution/watch | backend development runtime (`tsx watch src/index.ts`); production uses `tsc` |
| **ESLint + @typescript-eslint** | 8.57 / 7.1 | Static analysis | workspace `lint` scripts; TypeScript parser/plugin |
| **Vitest** | 1.3 | Unit + integration test runner | `backend/vitest.config.ts`; `buildApp()` + Fastify `inject()`; global setup resets/seeds the test DB |
| **Playwright** | 1.64 | Browser E2E runner | `tests/e2e/playwright.config.ts`; boots API `:3100` + Vite `:5177` against an isolated E2E DB; Chromium |
| **Prisma CLI** | 5.10 | Schema generation, push, migrate, seed | invoked through backend/root `db:*` scripts; generated client consumed by all services |
| **PostCSS + Autoprefixer** | 8.4 / 10.4 | CSS post-processing | Vite pipeline over `frontend/src/index.css`; no CSS framework |
| **Python smoke harness** | Python 3 | Live API verification | external 38-check script run against the dev stack (auth, RBAC, complaints, evidence, audit) |
| **Supabase CLI / local stack** | optional | Local Supabase services | `supabase/config.toml` defines Postgres/Storage for optional local use; Prisma retains schema ownership |

#### Integration seams

| Seam | Contract | Implementation |
|---|---|---|
| SPA → API | REST/JSON `{ success, data \| error }`, Bearer JWT | Axios instance in `api/client.ts`; Vite proxy in dev, nginx proxy in production; one refresh-and-retry on 401 |
| API → database | Prisma Client + PostgreSQL | `prisma/schema.prisma` is the schema source; services share the Prisma client; transactions for multi-row workflow writes |
| API → evidence store | driver-agnostic storage API | `services/storage.ts` selects `local`, `s3`, or `supabase`; callers only use upload/download/signed-URL/delete |
| Request → domain | Zod-validated DTO | route parses request → calls one service method; no business logic in routes |
| Authentication → authorization | access token claims + DB scope | `authenticate` resolves the user; `requireRole` and `requireComplaintAccess` delegate to `AccessControlService` |
| Domain events → audit/notifications/trust | one-way downstream calls | complaint service writes status history, then audit; notification and trust services consume the same event data |
| Code → CI | typecheck + tests + build | GitHub Actions runs backend and frontend jobs on every push; the same commands are available locally |

### 1.3 Runtime wiring (bootstrap order)

**API — `backend/src/index.ts` (`buildApp`)**

1. Fastify instance (`pino` logger configured separately in `utils/logger.ts`, `trustProxy: true`, 12 MB body limit).
2. Plugins: `helmet` → `cors` → `jwt` → `cookie` → global `rate-limit` → `multipart`.
3. `registerErrorHandler` (consistent envelope; Zod → 400; JWT/rate-limit specific codes).
4. `GET /health`.
5. Auth routes in a scoped plugin with a tighter rate limiter (`/api/auth`).
6. Domain routes: `/api/complaints` (complaints + evidence), `/api/anonymous`,
   `/api/notifications`, `/api/admin`, `/api/audit-logs`, `/api/analytics`.
7. 404 handler with the same envelope.
8. `connectDatabase()` → `listen()`; graceful shutdown on SIGTERM/SIGINT; friendly `EADDRINUSE` guidance.

`buildApp` is exported for tests; the server only starts when the module is the
process entry point (Vitest imports it without side effects).

**SPA — `frontend/src/main.tsx` → `App.tsx`**

```
QueryClientProvider → BrowserRouter → AuthProvider → Routes (+ Toaster)
```

- `AuthContext` bootstraps the session from `localStorage` by calling `/auth/me`
  (invalid/expired tokens are cleared).
- `Public` routes: landing, login, register (2-step), forgot-password, `/track`.
- `/dashboard` → `RoleDashboardRedirect` → the role's home.
- Role trees: `/student/*`, `/admin/dept/*`, `/admin/college/*`,
  `/admin/university/*`, `/admin/main/*`; all wrapped in `ProtectedRoute`.
- `AppLayout` renders a role-aware sidebar and shared notifications entry.

**Request lifecycle (typical mutation)**

```
Component → TanStack mutation → Axios (/api) → Vite proxy/nginx
→ Fastify route → Zod parse → authenticate/requireRole (+ complaint access)
→ domain service → Prisma → PostgreSQL
→ { success, data } envelope → toast → query invalidation → refetch
```

**Evidence lifecycle**

```
upload: multipart (10 MB, 1 file) → size/extension/MIME agreement/magic-byte sniff
        → executable-signature reject → storage driver → Evidence row → audit
download: authorization check → local: stream bytes | remote: signed URL (15 min)
        → EVIDENCE_ACCESSED audit entry
```

### 1.4 Repository dictionary (directory map)

```
shjap-grievance-portal/
├── backend/
│   ├── src/
│   │   ├── index.ts               Fastify wiring; API entry point
│   │   ├── config/                typed env config, Prisma lifecycle, dev DB fallback
│   │   ├── routes/                auth, complaints, evidence, anonymous, notifications, public metadata, admin, analytics
│   │   ├── services/              auth, complaint, access-control, categorization, trust-score,
│   │   │                          audit(+query), message, notification, analytics, storage
│   │   ├── middleware/            authenticate/getAuthUser/requireRole, complaint access, error handler
│   │   ├── validators/            Zod schemas for every endpoint
│   │   ├── utils/                 crypto (argon2/SHA-256/tracking ids), errors, logger, response, prisma
│   │   └── types/                 backend-only types
│   ├── scripts/                   db-prepare (reset+seed), e2e-prepare
│   └── tests/                     unit/ + integration/ (Vitest)
├── frontend/
│   ├── src/
│   │   ├── main.tsx               providers: QueryClient, Router, Toaster
│   │   ├── App.tsx                route tree, ProtectedRoute, role redirect
│   │   ├── api/client.ts          Axios instance + JWT refresh interceptor + typed endpoint groups
│   │   ├── contexts/AuthContext   session state, login/register/logout, role helpers
│   │   ├── layouts/               AppLayout (role sidebar), AuthLayout
│   │   ├── pages/                 public/ student/ dept-admin/ college-admin/ university-admin/ main-admin/ shared/
│   │   ├── components/shared/     badges, timeline, ratings, spinner, shared atoms
│   │   └── utils/validation.ts    client mirrors of password/phone policy
│   ├── nginx.conf                 production SPA server + /api proxy
│   └── Dockerfile                 multi-stage build → nginx
├── prisma/
│   ├── schema.prisma              single schema source of truth (26 models / 7 enums)
│   └── seed.ts                    demo users (all `Password@123`), complaints across states
├── supabase/
│   ├── config.toml                optional local stack; bucket definition; Prisma owns schema
│   └── .gitignore
├── tests/e2e/                     Playwright config + 3 specs (7 tests)
├── docs/                          API, ARCHITECTURE, DEPLOYMENT, USE-CASES
├── docker-compose.yml             db + api + web
└── storage/evidence/              local evidence target (content gitignored)
```

### 1.5 Domain dictionary (glossary)

| Term | Meaning in this system |
|---|---|
| **Complaint** | The central entity: description, category, priority, status, submission mode, optional owner, evidence, messages, resolutions |
| **Submission mode** | `VERIFIED` (linked to a student account) or `ANONYMOUS` (no identity stored, ever) |
| **Anonymous invariant** | Anonymous complaints have `submittedById = NULL`; no code path can set it, convert the mode, attach evidence post-submission, or message the submitter |
| **Tracking ID** | `TRK-…` public handle returned for anonymous complaints; the only way to follow one |
| **Complaint number** | Human-readable `GRP-YYYY-xxxx` reference for all complaints |
| **State machine** | Central `ALLOWED_TRANSITIONS` + `TRANSITION_ROLES` rules in `ComplaintService`; invalid transitions are rejected |
| **Escalation** | Raising a complaint to the next admin layer with level + mandatory reason and review outcome |
| **Resolution proposal** | Department-level resolution that a college admin approves or rejects |
| **RBAC** | Role-Based Access Control over 5 roles; enforced server-side on every route |
| **Scoping** | Visibility rules: department → college → university → global, plus student ownership |
| **Access control service** | The single module that answers "may this actor see/act on this complaint?" |
| **Auto-categorization** | Rule-based classifier over complaint titles; flags ambiguity for manual categorization |
| **Trust score** | 0–100 score with component factors and `PENDING` when data is insufficient; recalculated on evidence/status/assessment changes |
| **Evidence chain** | Upload validation → private storage → authorized, audited downloads → verify/delete lifecycle |
| **Audit chain** | Append-only log where each row's hash covers the previous hash + a frozen payload (tamper-evident) |
| **Canonical payload** | Byte-exact JSON frozen at audit-write time so re-serialization cannot break verification |
| **JWT types** | `access` (API calls), `refresh` (rotation), `mfa` (short-lived second factor exchange) |
| **jti** | Random JWT id guaranteeing byte-unique tokens even within the same second |
| **Lockout** | Per-account brute-force protection: `MAX_FAILED_LOGINS` failures → 15-minute lock |
| **Driver** | Storage strategy: `local`, `s3`, `supabase`, selected from `STORAGE_DRIVER` |

### 1.6 Data model (overview)

**Enums:** `UserRole` (Student, Department Admin, College Admin, University Admin, Main Admin) ·
`ComplaintStatus` (10 states from `SUBMITTED` to `REJECTED`) · `SubmissionMode` ·
`ComplaintPriority` · `EvidenceType` · `NotificationType` (8 types) ·
`AuditAction` (login/registration/complaint/evidence/assignment/escalation/resolution/…).

| Group | Models |
|---|---|
| Identity & access | `User`, `Role`, `Permission`, `RolePermission`, `UserRoleAssignment`, `StudentProfile`, `AdministratorProfile`, `MFAConfiguration`, `RefreshToken`, `PasswordResetToken` |
| Organisation | `College`, `Department` |
| Complaints | `Complaint`, `ComplaintCategory`, `ComplaintAssignment`, `ComplaintStatusHistory`, `ComplaintAssessment`, `ComplaintEscalation`, `Resolution` |
| Interaction | `Evidence`, `Message`, `Notification`, `Feedback` |
| Trust & governance | `TrustScore`, `AuditLog`, `SystemSetting` |

Key relationships: a `Complaint` optionally belongs to a student (`submittedById`
is `NULL` for anonymous), has one category/department/assignee, many status
history rows, many evidence rows and messages, one trust score, and one
resolution; `AuditLog` rows form a linear hash chain via `previousHash` +
`sequence`.

### 1.7 Configuration and environments

`backend/.env` is gitignored; `backend/.env.example` is the tracked template.
In production an explicit `DATABASE_URL` is mandatory (the local fallback is
disabled).

| Variable | Purpose / default |
|---|---|
| `DATABASE_URL` | PostgreSQL URI (Supabase direct or Session pooler) |
| `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `MFA_ISSUER` | token signing + TTLs + TOTP issuer |
| `PORT`, `HOST`, `NODE_ENV`, `FRONTEND_URL` | server + CORS origin |
| `STORAGE_DRIVER` | `local` \| `s3` \| `supabase` (default `local`) |
| `EVIDENCE_LOCAL_DIR` | local driver target (`../storage/evidence`) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL` | S3-compatible driver |
| `SUPABASE_URL` | project URL |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` server-side key (fallback: legacy `SUPABASE_SERVICE_ROLE_KEY`) |
| `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWKS_URL` | accepted; intentionally unused (no Supabase Auth) |
| `SUPABASE_STORAGE_BUCKET` | bucket name (default `shjap-evidence`, auto-created private) |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX` | rate limiting |
| `MAX_FAILED_LOGINS` | lockout threshold |
| `MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES` | upload limits |
| `DUPLICATE_WINDOW_HOURS` | duplicate-complaint detection window |
| `MALWARE_SCAN_URL` | optional external scanner hook |
| `TEST_DATABASE_URL`, `E2E_DATABASE_URL` | test/E2E databases (tooling) |

**Supabase in one paragraph.** Point `DATABASE_URL` at the Supabase Postgres URI
(direct connection or Session pooler; percent-encode special characters in the
password). For evidence set `STORAGE_DRIVER="supabase"`, `SUPABASE_URL`, and
`SUPABASE_SECRET_KEY` — the private bucket is created on first upload and
downloads use short-lived signed URLs. The S3-protocol alternative uses
`STORAGE_DRIVER="s3"` with the project's S3 endpoint/keys. Supabase **Auth is not
used** by design. Full guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §8.

### 1.8 Running, commands and demo accounts

```bash
npm install                 # npm workspaces: backend + frontend
cp backend/.env.example backend/.env   # optional locally: dev DB fallback exists
npm run db:setup            # push schema + seed (force-reset; dev/test only)
npm run dev                 # API :3001 + Vite :5173
```

Without `backend/.env`, local runs fall back to
`postgresql://postgres:1234@localhost:5432/shjap_grievance?schema=public`;
production refuses to boot without an explicit `DATABASE_URL`.

| Command | Purpose |
|---|---|
| `npm run dev` | API + SPA in watch mode |
| `npm run build` | backend `tsc` + frontend `tsc && vite build` |
| `npm run db:setup` | reset + push schema + seed (backend workspace script) |
| `npm run db:push` / `db:migrate` / `db:seed` / `db:deploy` | Prisma workflows |
| `npm test` | Vitest then Playwright |
| `npm run test:unit` / `test:e2e` | individual suites |
| `npm run lint` | ESLint (workspaces) |

**Demo accounts** — all seeded users share password `Password@123` (dev only):

| Email | Role |
|---|---|
| `student@example.com` | STUDENT |
| `department.admin@example.com` | DEPARTMENT_ADMIN — Academic Affairs |
| `facilities.admin@example.com` / `it.admin@example.com` / `finance.admin@example.com` / `student.affairs@example.com` | DEPARTMENT_ADMIN — other departments |
| `college.admin@example.com` | COLLEGE_ADMIN — Engineering (CEAS) |
| `college.admin.cbss@example.com` | COLLEGE_ADMIN — Business (CBSS) |
| `university.admin@example.com` | UNIVERSITY_ADMIN |
| `main.admin@example.com` | MAIN_ADMIN |

**Anonymous complaints.** Submitted without an account from the public form;
tracked at `/track` with the returned `TRK-…` id. They never store a submitter,
cannot receive messages or add evidence, cannot be converted to verified, and
identity fields are omitted from every response.

### 1.9 Verification architecture

| Layer | Tooling | What it proves |
|---|---|---|
| Unit (5 files) | Vitest | password/phone/register schemas, crypto helpers, categorization rules, evidence magic-byte sniffing, storage-driver resolution |
| Integration (6 files) | Vitest + Fastify `inject()` | HTTP surface on a dedicated test DB: auth & refresh rotation/replay, RBAC matrix, complaint lifecycle/state machine, anonymous invariants, evidence upload/download/delete, audit-chain tamper detection |
| E2E (3 specs / 7 tests) | Playwright (Chromium) | real browser: landing/auth, wrong + correct login, anonymous create & track, multi-step verified submission, complaint listing, department-admin queue visibility |
| API smoke (38 checks) | external Python harness (dev servers) | auth incl. token rotation/replay, RBAC, complaints, evidence upload/download/delete, anonymous guards, audit, settings |
| CI | GitHub Actions | backend: Postgres 16 service, `tsc --noEmit`, `vitest run`; frontend: `tsc --noEmit`, `vite build` |

Hermeticity: `tests/global-setup.ts` resets and seeds the test database;
`tests/setup-env.ts` pins `STORAGE_DRIVER=local` and disables rate limits, so
suites never touch a configured Supabase/S3 bucket. Last verified run:
**108/108 Vitest · 7/7 Playwright · 38/38 smoke**.

---

## 2. Software Requirements Specification (SRS)

This section condenses the SRS: purpose and actors, functional and
non-functional requirements, module decomposition with cohesion/coupling
analysis, design invariants, the sprint plan, and requirement→test traceability.

### 2.1 Purpose, scope and actors

**Purpose.** Define the requirements and design organisation of a
multi-level student grievance system that guarantees anonymity where requested,
enforces role-scoped access server-side, preserves evidence integrity, and
produces tamper-evident audit records.

**In scope.** Web SPA + REST API + relational database + private evidence store;
student self-service; five administrative layers; anonymous intake/tracking;
workflow, messaging, notifications, trust score, dashboards/analytics; audit log
with verification; admin user/role/metadata management; local, Docker and
Supabase deployment.

**Out of scope.** Native mobile apps, push/websocket real-time delivery, email/SMS
delivery infrastructure (the reset token is returned by the API in dev/test only),
multi-tenancy, SSO, external antivirus provisioning (hook only), and Supabase Auth.

| Actor | Responsibilities / permissions |
|---|---|
| **Anonymous visitor** | Submit an anonymous complaint; track it with `TRK-…`; nothing else |
| **Student** | Register/login; lodge verified complaints; track own complaints; message on verified complaints; upload evidence; give feedback |
| **Department Admin** | Scoped queue for own department plus a shared intake queue for unassigned complaints; assess, investigate, request info, escalate, propose resolution; verify evidence |
| **College Admin** | College-scoped oversight; review resolution proposals (approve/reject); review escalations |
| **University Admin** | University-wide oversight; escalated-case visibility; cross-college analytics |
| **Main Admin** | Global access; users/roles; colleges/departments/categories/settings; full audit feed + chain verification |
| **System (implicit actor)** | Auto-categorization, assignment rules, notifications, trust-score recomputation, audit hash chaining |

### 2.2 Functional requirements

Verification references are the suites in §1.9. `smoke` = 38-check API run.

#### Identity and access

| ID | Requirement | Primary module | Verified by |
|---|---|---|---|
| FR-01 | A visitor can register as a student (2-step form: identity → credentials); password policy enforced client- and server-side | Auth | `auth.spec.ts`, `validators.spec.ts`, E2E `auth` |
| FR-02 | Login with email/password; disabled accounts refused; `MAX_FAILED_LOGINS` failures lock the account for 15 minutes | Auth | `auth.spec.ts`, smoke |
| FR-03 | Access tokens short-lived; refresh tokens single-use with rotation; replaying a rotated token is rejected; logout revokes | Auth | `auth.spec.ts`, smoke |
| FR-04 | Password reset with a single-use, hashed, 1-hour token; all refresh tokens revoked afterwards; no account enumeration | Auth | `auth.spec.ts`, smoke |
| FR-05 | TOTP MFA enrolment (QR), verification at login, enable/disable | Auth | `auth.spec.ts` |
| FR-06 | Exactly five roles; every route enforces role/ownership server-side; the frontend performs no access decisions | RBAC middleware + AccessControlService | `rbac.spec.ts` (role × endpoint matrix) |
| FR-07 | Main Admin manages users (create/edit/deactivate) and roles; role changes sync profile scope (college/department) | Admin | smoke, `rbac.spec.ts` |

#### Complaints

| ID | Requirement | Primary module | Verified by |
|---|---|---|---|
| FR-08 | Student lodges a verified complaint (category, priority, description, optional evidence); explicit category/department selections are honored and routed synchronously; number `GRP-YYYY-xxxx` | Complaint service | `complaint-lifecycle.spec.ts`, E2E `student-submit` |
| FR-09 | Anonymous complaint submission without an account; `TRK-…` tracking; identity never stored; messaging/evidence disabled; no conversion path | Anonymous routes + complaint service | `anonymous.spec.ts`, E2E `anonymous-track` |
| FR-10 | Automatic categorization from the title (only for fields the submitter did not choose); ambiguity/no-match flagging; department assignment or shared intake queue | Categorization service | `categorization.spec.ts`, `complaint-lifecycle.spec.ts` |
| FR-11 | Central state machine: only allowed transitions, role-checked, with mandatory reasons where required | Complaint service | `complaint-lifecycle.spec.ts` |
| FR-12 | Scoped visibility: students see their own; department/college/university/admin scopes enforced centrally; unassigned complaints form a shared department-admin intake queue while awaiting routing | AccessControlService | `rbac.spec.ts`, `complaint-lifecycle.spec.ts` |
| FR-13 | Assignment, assessment, investigation and information requests | Complaint service | `complaint-lifecycle.spec.ts` |
| FR-14 | Escalation with level/reason and review outcome | Complaint service | `complaint-lifecycle.spec.ts` |
| FR-15 | Resolution proposal; college approve/reject; status transitions to resolved/closed/rejected | Complaint service | `complaint-lifecycle.spec.ts` |
| FR-16 | Student feedback with ratings after resolution | Complaint service | smoke, lifecycle suite |
| FR-17 | Messaging on verified complaints; participants only; system notices; anonymous blocked | Message service | smoke, `anonymous.spec.ts` |
| FR-18 | Notifications emitted on submission/assignment/status/info/escalation/resolution/feedback events | Notification service | lifecycle suite, smoke |

#### Evidence and trust

| ID | Requirement | Primary module | Verified by |
|---|---|---|---|
| FR-19 | Upload evidence (≤10 MB) with extension whitelist, extension↔MIME agreement, magic-byte sniffing, executable rejection | Evidence route + storage | `evidence.spec.ts`, `evidence-scan.spec.ts` |
| FR-20 | Downloads only after authorization; local streams bytes, remote mints short-lived signed URLs; access is audited | Evidence + storage | `evidence.spec.ts`, smoke |
| FR-21 | Evidence verification and deletion by authorized roles; deletion audited and reflected in trust score | Evidence | `evidence.spec.ts`, smoke |
| FR-22 | Trust score 0–100 with factors and `PENDING` semantics; recomputed on evidence/assessment/status changes | Trust-score service | smoke, lifecycle suite |

#### Oversight, audit and administration

| ID | Requirement | Primary module | Verified by |
|---|---|---|---|
| FR-23 | Role-scoped dashboards and analytics (overview, departments, categories, trust, resolution, satisfaction, escalations) | Analytics + dashboards | E2E pages, smoke |
| FR-24 | Append-only audit log with SHA-256 chain, monotonic sequence, serialized writers | Audit service | `audit-chain.spec.ts` |
| FR-25 | Chain verification endpoint/UI reports the exact first tampered sequence | Audit query + admin UI | `audit-chain.spec.ts`, smoke |
| FR-26 | Audit feed with filters (action, actor, entity, date) for Main Admin | Audit query | smoke |
| FR-27 | Metadata management: colleges, departments, categories, system settings | Admin routes | smoke |
| FR-28 | Consistent API envelope and validation errors for every endpoint | Error handler + Zod | `validators.spec.ts`, all integration suites |

### 2.3 Non-functional requirements

| ID | Requirement | How it is met |
|---|---|---|
| NFR-01 | **Confidentiality of credentials** | Argon2id hashes; refresh/reset tokens stored only as SHA-256; no secret ever returned by APIs |
| NFR-02 | **Anonymity is absolute** | nullable ownership columns never written for anonymous mode; no conversion route; messaging/evidence guards; response shapes omit identity |
| NFR-03 | **Server-side authorization** | every route behind `authenticate` + role/ownership checks; frontend guards are UX-only |
| NFR-04 | **Tamper evidence** | hash-chained audit rows + verification replay; frozen canonical payload |
| NFR-05 | **Input safety** | Zod on every request; centralized error mapping; upload content sniffing; body/upload size caps |
| NFR-06 | **Abuse resistance** | global + auth-specific rate limits; per-account lockout; duplicate-complaint window |
| NFR-07 | **Performance bounds** | list endpoints capped (`limit ≤ 100`, admin audit ≤ 200); DB indexes; 10 MB upload cap; Argon2id auth ~1–3 s by design |
| NFR-08 | **Reliability** | `/health`; graceful shutdown; Prisma disconnect; stateless API (single-writer audit serialization assumes one instance — see §2.5) |
| NFR-09 | **Portability** | any PostgreSQL; storage driver abstraction (local/S3/Supabase); Docker images |
| NFR-10 | **Observability** | pino structured logs; Prisma query debug in development; audit feed as business observability |
| NFR-11 | **Usability** | role-aware navigation, consistent design system, empty/loading/error states, toasts, responsive layouts |
| NFR-12 | **Maintainability** | strict TypeScript, layered modules, single Zod schema source, 115 automated checks (108 + 7), deterministic test environments |
| NFR-13 | **Cloud readiness** | full Supabase Postgres + Storage integration verified end-to-end (bucket bootstrap, signed URLs, live smoke) |

### 2.4 Module decomposition

Backend modules (one responsibility each; routes are thin adapters):

| Module | Files | Responsibility | Public interface |
|---|---|---|---|
| Configuration | `config/index.ts`, `db-fallback.ts`, `database.ts` | env parsing, fallback policy, Prisma lifecycle | `config`, `connectDatabase` |
| Validation | `validators/schemas.ts` | every request contract | Zod schemas |
| Auth | `auth.service.ts`, `auth.routes.ts` | registration, login, lockout, tokens, reset, MFA | `/api/auth/*` |
| Authorization | `middleware/auth.middleware.ts`, `complaint-access.middleware.ts`, `access-control.service.ts` | authenticate, role gate, complaint visibility, unassigned intake queue | `authenticate`, `requireRole`, `requireComplaintAccess`, `canAccess` |
| Complaints | `complaint.service.ts`, `complaint.routes.ts` | state machine, CRUD, lifecycle orchestration | `/api/complaints/*`, `/api/anonymous/*` |
| Categorization | `categorization.service.ts` | rule-based category + ambiguity | `categorize(title)` |
| Evidence | `evidence.routes.ts`, `services/storage.ts` | validation, storage drivers, download policy | `/api/complaints/:id/evidence/*` |
| Messaging | `message.service.ts`, routes in complaints | participant-only threads + system notices | `/api/complaints/:id/messages` |
| Notifications | `notification.service.ts`, `notification.routes.ts` | create/list/read notifications | `/api/notifications/*` |
| Trust score | `trust-score.service.ts` | 0–100 scoring with factors | recompute hooks |
| Audit | `audit.service.ts`, `audit-query.service.ts`, routes | hash-chain writer/verifier + feed | `/api/audit-logs/*` |
| Analytics | `analytics.service.ts`, `admin.routes.analytics.ts` | scoped aggregations | `/api/analytics/*` |
| Administration | `admin.routes.ts` | users/roles/metadata/settings | `/api/admin/*` |
| Errors/logging | `middleware/error-handler.ts`, `utils/errors.ts`, `utils/logger.ts`, `utils/response.ts` | envelope, typed errors, pino | cross-cutting |

Frontend modules: public pages, role page trees (`student`, `dept-admin`,
`college-admin`, `university-admin`, `main-admin`, `shared`), `AppLayout`
(role-aware shell), `AuthContext` (session), `api/client.ts` (transport),
`components/shared` (presentation atoms), `utils/validation.ts` (policy mirrors).

### 2.5 Cohesion and coupling

**Working definitions.** Cohesion (best→worst): functional → sequential →
communicational → procedural → temporal → logical → coincidental. Coupling
(best→worst): data → stamp → control → common → content. The design target is
*functional cohesion with data coupling*, connected through narrow interfaces.

| Module | Cohesion | Coupling (in → out) | Assessment |
|---|---|---|---|
| Validators | Functional (validation) | DTOs → none | Reused by all routes; no I/O |
| Config / utils | Functional (single utility each) | env → none | Isolated; `db-fallback` is a deliberate dev convenience |
| Auth service | Functional | user/token records → crypto/config | No HTTP dependency; testable in isolation |
| Access control | Functional (decision only) | complaint + actor → none (read-only) | **The single visibility authority**; zero writes. Department admins see own/assigned plus unassigned intake rows |
| Complaint service | Functional with sequential orchestration | DTO/records → status history, audit, notifications, trust | Intentional fan-out; one-way calls from the domain core |
| Categorization | Functional (pure) | title string → none | Lowest coupling in the codebase |
| Evidence + storage | Functional storage; **route mixes policy + orchestration** | multipart/metadata → storage driver, audit | Storage driver hides local/S3/Supabase — good. Route-level policy is a known trade-off |
| Messaging | Functional | message DTO → access control, notifications, audit | Participant resolution centralized |
| Notifications | Functional | event metadata → DB | One-way consumer calls only |
| Trust score | Functional | complaint/evidence/feedback data → DB | Recompute triggers explicit |
| Audit | Functional (single writer) | frozen payload → DB | In-process serialization; verification is read-only |
| Analytics | Functional (read-only) | scope → DB aggregates | No domain writes |
| Admin routes | **Communicational** (aggregates user/role/metadata domains) | DTOs → several models, audit, access control | Acceptable for an admin surface; lowest cohesion boundary |
| Frontend API client | Functional | REST contract → Axios | Contract-only coupling (no shared code) |
| AuthContext | Functional | token/user → Axios, storage | UI state only; not an authorization boundary |
| Role page trees | Communicational (by actor) | hooks/API → presentation | Shared detail/ad-min components prevent duplication |

**Dependency rules enforced in the codebase**

1. Direction: `routes → middleware → services → Prisma`. Services never import
   routes or middleware; no cycles.
2. Complaint visibility is decided **only** in `AccessControlService` (called by
   middleware/services), never ad hoc in an endpoint. Unrouted complaints
   (`departmentId = null`) are the one deliberate cross-department read: they
   form the shared intake queue for department-admin triage.
3. Lifecycle transitions live **only** in `ComplaintService` (state machine +
   role matrix); routes just parse and delegate.
4. Audit, notifications and trust recomputation are *downstream* consumers of
   domain events (complaint service → them), never the reverse.
5. Storage consumers depend on a driver-agnostic API (`uploadFile`,
   `downloadFile`, `getDownloadUrl`, `deleteFile`, `fileExists`) — swapping
   local/S3/Supabase changes zero call sites.
6. Frontend ↔ backend contract is REST + the `{ success, data | error }`
   envelope + JWTs only. No shared runtime package; validation rules are
   deliberately mirrored in `utils/validation.ts` for UX (documented duplication).
7. The SPA makes **no** authorization decisions; route guards exist for UX, and
   every server response is already scoped.

**Known trade-offs (documented honestly)**

- **Two Prisma entry points** exist (`config/database.ts` for lifecycle/logging
  and `utils/prisma.ts` as the shared client). They connect to the same database
  but should be consolidated to a single exported client in a future refactor.
- **Evidence routes** currently combine HTTP concerns with content policy;
  extracting an `EvidenceService` would raise cohesion.
- **Audit serialization is in-process**; horizontal scaling requires a
  database-level lock/queue to keep the chain linear.
- **Admin routes** aggregate several domains (communicational cohesion); split
  only if the surface keeps growing.
- **Unassigned complaints are visible to all department admins** so no
  submission is orphaned; this is a deliberate triage decision, not a scoping
  bug. Once routed, access narrows to the owning department/assignee.
- **Auth latency** (1–3 s) is expected from Argon2id + remote Supabase round
  trips; co-locating the API with the DB or using the pooler improves it.
- **Password/phone policy is duplicated** between frontend and backend by
  design; both files carry "keep in sync" notes, and backend tests cover the
  contract.

### 2.6 Architectural invariants and key decisions

| # | Invariant | Where enforced |
|---|---|---|
| 1 | Anonymous complaints never store identity and cannot be retro-linked | complaint creation/update paths; response shaping |
| 2 | Anonymous complaints cannot convert to verified | no transition/route exists; verified endpoints reject the mode |
| 3 | Messaging and evidence upload are disabled for anonymous complaints | route guards |
| 4 | Every status change writes status history + audit + notification | `ComplaintService.updateStatus` |
| 5 | Audit chain is append-only and tamper-evident | `AuditService` hash chain + verifier |
| 6 | RBAC is enforced backend-side on every route | `authenticate`/`requireRole` + `AccessControlService` |
| 7 | Transitions are validated against role-specific rules | `ALLOWED_TRANSITIONS`/`TRANSITION_ROLES` |
| 8 | Trust score is deterministic and `PENDING` without sufficient data | `TrustScoreService` |
| 9 | Evidence is private; downloads are authorized and audited | storage drivers + evidence routes |
| 10 | One error envelope and Zod validation everywhere | error handler + schemas |

**Key decisions.** (a) Bespoke auth (Argon2id + rotating JWT + TOTP) instead of
Supabase Auth — a stated requirement; Supabase keys are stored only for Storage.
(b) Prisma owns the schema — Supabase CLI migrations/seed are disabled.
(c) Storage behind a driver abstraction so local development, S3 and Supabase
are interchangeable. (d) A central state machine and a central access-control
service to make illegal flows and unauthorized visibility unrepresentable at the
edges. (e) Audit payloads are frozen at write time to keep hash verification
stable across JSONB re-serialization.

### 2.7 Sprint plan

Scope-based delivery slices. Each sprint ended with the exit gate: TypeScript
clean, relevant Vitest suites green, and (from Sprint 5) browser E2E green.

| Sprint | Goal | Scope / modules | Key deliverables | Exit criteria |
|---|---|---|---|---|
| **0 — Foundation** | Runnable skeleton | workspaces, TS/ESLint, Fastify bootstrap, Prisma schema, env config, Docker skeleton | `npm run dev`, `/health`, schema push + seed | API boots, DB reachable, typecheck clean |
| **1 — Identity & access** | Trustworthy accounts | auth service/routes, Argon2id, JWT rotation, lockout, reset, MFA, RBAC middleware, profiles, seed | register/login/refresh/logout, role gates, demo users | auth + RBAC integration suites green |
| **2 — Complaint core & anonymity** | End-to-end intake | complaint service/routes, state machine, categorization, assignment, anonymous intake/track, scoped listing/detail | verified + anonymous flows, `GRP-`/`TRK-` ids, status history | lifecycle + anonymous suites green; E2E intake |
| **3 — Evidence & trust** | Integrity of proof | storage drivers, upload validation, evidence lifecycle, trust-score service | magic-byte scanning, private downloads, signed URLs, trust factors | evidence + scan suites green |
| **4 — Collaboration & oversight** | Multi-layer workflow | messaging, notifications, escalation, college review, resolutions, feedback, dashboards, analytics | five role dashboards, message threads, notification inbox | workflow coverage + dashboards render |
| **5 — Audit, admin & delivery** | Governance + production shape | audit hash chain + verification UI, user/role/metadata/settings, hardening, Docker/nginx/compose, CI, Playwright | admin console, tamper detection, CI pipeline, deployment guide | full battery green; CI green |
| **6 — Cloud integration & hardening** | Supabase + release | Supabase Postgres + Storage drivers, key handling, env/docs, local stack config, auth UX fixes | live bucket bootstrap + signed URLs, verified smoke on Supabase, 108/7/38 | typecheck + all suites green on Supabase-backed run |

### 2.8 Requirements traceability

| Requirement group | Services / routes | Automated evidence |
|---|---|---|
| FR-01…FR-07 (identity/access) | `auth.*`, `middleware/auth.*`, admin users | `auth.spec.ts`, `validators.spec.ts`, E2E `auth`, smoke |
| FR-08…FR-18 (complaints/workflow) | `complaint.service`, `access-control.service`, `categorization.service`, `message/notification` services | `complaint-lifecycle.spec.ts`, `anonymous.spec.ts`, `rbac.spec.ts`, E2E `student-submit` + `anonymous-track` |
| FR-19…FR-22 (evidence/trust) | `evidence.routes`, `services/storage.ts`, `trust-score.service` | `evidence.spec.ts`, `evidence-scan.spec.ts`, `storage-driver.spec.ts`, smoke |
| FR-23…FR-28 (oversight/audit/admin) | `analytics.*`, `audit*`, `admin.routes` | `audit-chain.spec.ts`, smoke; dashboards via E2E auth specs |
| NFR-02 anonymity | complaint create/read paths, guards | `anonymous.spec.ts` (null identity, no leak, no messaging/evidence) |
| NFR-04 tamper evidence | `audit.service` | `audit-chain.spec.ts` (tamper detected at exact sequence) |
| NFR-06 abuse resistance | rate limits, lockout | `auth.spec.ts`, smoke |

### 2.9 Use-case coverage

| Use case | Summary | Where |
|---|---|---|
| UC-01 | Student lodges a complaint (multi-step) | student pages, complaint service — E2E `student-submit` |
| UC-02 | Anonymous submission & tracking | public form, `/track` — E2E `anonymous-track`; `anonymous.spec.ts` |
| UC-03 | Auto-categorization & department assignment | categorization service — unit + lifecycle suites |
| UC-04 | Department review/investigation | dept pages — lifecycle suite, smoke |
| UC-05 | Escalation | complaint service — lifecycle suite |
| UC-06 | Department resolution proposal | complaint service — lifecycle suite |
| UC-07 | College review (approve/reject) | shared admin detail — lifecycle suite |
| UC-08 | Student feedback & ratings | student detail — smoke |
| UC-09 | Messages (verified only) | message service — `anonymous.spec.ts` guard, smoke |
| UC-10 | Notifications | notification service — lifecycle suite |
| UC-11 | Trust score | trust-score service — smoke |
| UC-12 | Metadata management (Main Admin) | users page, admin routes — smoke |
| UC-13 | Dashboards & analytics (all layers) | role dashboards, analytics service — E2E renders + smoke |

Details and invariants per use case: [`docs/USE-CASES.md`](docs/USE-CASES.md).

### 2.10 Assumptions, constraints, risks, out of scope

**Assumptions.** Single API instance per deployment (in-process audit writer);
one PostgreSQL database; browsers support ES2020; local evidence storage is on a
persistent volume in production.

**Constraints.** Node 20+, PostgreSQL 14+; uploads ≤10 MB; no email provider
configured (reset tokens surfaced only in dev/test); Supabase Auth intentionally
unused; seeded demo credentials are development-only.

**Risks and mitigations.** *Remote DB latency* → pooler/co-location; *audit writer
contention* → in-process serialization, DB-level locking if scaled out;
*lockout UX* → explicit 423 message; *duplicated policy rules* → mirrored files
with sync notes + tests; *storage misconfiguration* → driver falls back safely
and errors are explicit ("cannot create bucket …" instead of silent failure).

**Out of scope.** Mobile clients, real-time push, email/SMS delivery, SSO,
multi-tenancy, malware-scanner provisioning, analytics warehousing.

### 2.11 Documentation index

- [`docs/API.md`](docs/API.md) — endpoint reference
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — condensed module map & data flow
- [`docs/USE-CASES.md`](docs/USE-CASES.md) — UC-01…UC-13 with invariants
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Docker, migrations, production checklist, Supabase §8
- `supabase/config.toml` — optional local Supabase stack (Prisma keeps schema ownership)

---

**License / usage.** Educational project. Demo credentials and seeded data are
for development only; rotate secrets and disable demo hints before any public
deployment.
