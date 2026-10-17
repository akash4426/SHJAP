# SHJAP Grievance Portal

A production-quality full-stack **student grievance portal** supporting five administrative
layers (Student → Department Admin → College Admin → University Admin → Main Admin),
anonymous **and** verified complaint submission, evidence handling with private storage,
complaint messaging, notifications, a computed trust score, real-time-style dashboards,
analytics, and a tamper-evident append-only audit log.

| Layer      | Stack |
|------------|-------|
| Frontend   | React 18 + TypeScript, Vite, React Router, TanStack Query, React Hook Form, custom design system |
| Backend    | Node 20, Fastify, Zod, @fastify/jwt (access/refresh/MFA), Argon2id |
| Database   | PostgreSQL + Prisma (dev workflow: `prisma db push`; production: migrations) |
| E2E tests  | Playwright (Chromium) |
| Unit/integration | Vitest + Fastify `inject()` on a dedicated test database |
| Delivery   | Dockerfile per app, docker-compose (Postgres + nginx SPA + API) |

---

## Quick start (local development)

Requirements: **Node 20+**, **PostgreSQL 14+** (tested with PG18) running locally.

```bash
# 1. Install dependencies (npm workspaces)
npm install

# 2. Configure the backend (optional — see fallback below)
cp backend/.env.example backend/.env
# point DATABASE_URL at your local database and set a random JWT_SECRET

# 3. Create schema + demo data
npm run db:push      # backend workspace script
npm run db:seed

# 4. Run everything (API :3001 + Vite dev server :5173)
npm run dev
```

> **No-config fallback for local runs:** if `DATABASE_URL` is not set (no
> `backend/.env`), the app and tooling fall back to
> `postgresql://postgres:1234@localhost:5432/shjap_grievance?schema=public`
> so a plain `npm run db:setup` (schema reset + demo seed) followed by
> `npm run dev` works on a fresh checkout with a local Postgres. Production
> ignores this fallback — the API refuses to start without an explicit
> `DATABASE_URL`.

The Vite dev server proxies `/api` → `http://localhost:3001` (override with `VITE_API_PROXY`).

### Demo accounts (seeded)

All seeded users share password `Password@123` (dev only — change/reset in production):

| Email                        | Role(s)                                   |
|------------------------------|-------------------------------------------|
| student@example.com          | STUDENT                                   |
| department.admin@example.com | DEPARTMENT_ADMIN — Academic Affairs       |
| facilities.admin@example.com | DEPARTMENT_ADMIN — Facilities             |
| it.admin@example.com         | DEPARTMENT_ADMIN — IT Services            |
| finance.admin@example.com    | DEPARTMENT_ADMIN — Finance                |
| student.affairs@example.com  | DEPARTMENT_ADMIN — Student Affairs        |
| college.admin@example.com    | COLLEGE_ADMIN — College of Engineering (CEAS) |
| college.admin.cbss@example.com | COLLEGE_ADMIN — Business College (CBSS) |
| university.admin@example.com | UNIVERSITY_ADMIN                          |
| main.admin@example.com       | MAIN_ADMIN                                |

The seed also creates demo complaints across all lifecycle states and prints the
tracking IDs of its anonymous complaints.

### Anonymous complaints

Anyone (no account) can submit an anonymous complaint from the public form and later
follow it at `/track` using the returned `TRK-…` tracking id. Anonymous complaints:

- never store the submitter (columns are nullable and stay `NULL`);
- are excluded from identity-bearing API responses (lists `submittedBy: null`,
  detail/layout views flag anonymity);
- cannot receive messaging or post-submission evidence (identity would be exposed);
- cannot be converted to verified complaints afterwards (no code path exists).

---

## Test suite

```bash
# Backend unit tests (pure services and validators)
npm run test:unit --workspace=backend     # or: npx vitest run

# Backend integration tests — HTTP surface via Fastify inject(), dedicated test DB
# Global setup pushes the schema into shjap_grievance_test and seeds fixtures once.
npm run test:unit --workspace=backend     # same command runs both unit + integration

# Browser end-to-end (boots API on :3100 + Vite on :5177 with its own database)
npx playwright install chromium           # once
npm run test:e2e --workspace=backend      # npx playwright test --config tests/e2e/…

# 38-check API smoke run against a running dev server (python3)
python3 ../smoke.py                       # see scripts/ smoke script below
```

Current status: **97 unit/integration tests pass**, **6 E2E tests pass**,
**38/38 smoke checks pass** (`tsc --noEmit` clean for backend and frontend).

Test database: `shjap_grievance_test` (override with `TEST_DATABASE_URL`), E2E database:
`shjap_e2e_test` (override with `E2E_DATABASE_URL`).

## Commands

| Command                     | Purpose |
|-----------------------------|---------|
| `npm run dev`               | backend + frontend in watch mode |
| `npm run build`             | compile backend (tsc) + bundle frontend (vite) |
| `npm run db:push`           | apply `prisma/schema.prisma` to the configured DB |
| `npm run db:setup`          | local one-command setup: fallback DB URL + schema reset + demo seed |
| `npm run db:migrate`        | create/apply a dev migration |
| `npm run db:seed`           | seed demo data |
| `npm run test`              | backend tests then Playwright E2E |
| `npm run lint`              | eslint (workspaces) |

## Security design highlights

- **Auth**: access (15 min), refresh (7 d, single-use rotation with replay denial),
  MFA TOTP tokens; Argon2id hashes; per-account brute-force lockout; per-IP auth rate
  limit; JWT `jti` prevents same-second token collisions.
- **Authorization**: strict RBAC middleware (`requireRole`), central complaint access
  control (`AccessControlService`): department colons college colon university scoping,
  escalation-based university visibility, student ownership only.
- **Evidence**: 10 MB cap, MIME whitelist, extension whitelist + extension/MIME
  agreement, magic-byte content sniffing (PNG/JPEG/GIF/WebP/PDF/CFB/ZIP), executable
  signature rejection, optional external malware scanner hook, private local storage
  (never web-served) or S3 with short-lived presigned URLs, authenticated downloads
  with `EVIDENCE_ACCESSED` audit entries.
- **Audit log**: append-only hash chain `hash = SHA256(previousHash + frozen payload)`
  with an auto-increment `sequence`; parallel writers are serialized in-process;
  main admin verification endpoint reports the exact tampered sequence.
- **Input validation**: Zod schemas for every endpoint; consistent error envelope
  `{ success: false, error: { code, message, details? } }`; ZodError → 400.

## Documentation

- [`docs/API.md`](docs/API.md) — endpoint reference (auth, complaints, evidence,
  messages, notifications, admin, analytics, audit)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Docker, migrations, production checklist
- [`docs/USE-CASES.md`](docs/USE-CASES.md) — UC-01…UC-13 coverage map
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module map and data flow

## Repository layout

```
prisma/          schema.prisma + seed.ts (root-owned schema, shared by backend)
backend/         Fastify API src/, tests/ (unit+integration), Dockerfile
frontend/        React SPA src/, e2e specs live in ../tests/e2e, nginx.conf, Dockerfile
tests/e2e/       Playwright config + specs
storage/evidence/  local evidence driver target (gitignored content)
docs/            API, deployment, use-case and architecture docs
```
