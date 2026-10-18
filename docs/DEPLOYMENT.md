# SHJAP Grievance Portal — Deployment Guide

## 1. Environments and secrets

Create `backend/.env` from `backend/.env.example` and change everything marked
`CHANGE-ME`. Minimum for production:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?schema=public` |
| `JWT_SECRET` | random ≥ 32 chars (`openssl rand -hex 48`) |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | SPA origin for CORS |
| `STORAGE_DRIVER` | `local` (default) or `s3` |
| `MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES` | evidence upload policy |
| `AUTH_RATE_LIMIT_MAX`, `RATE_LIMIT_MAX` | per-IP windows (per-account lockout is separate) |
| `MALWARE_SCAN_URL` | optional external scanner |

`SMTP_*` is optional — in-app notifications work without email.

## 2. Database migrations

Development iteration uses `prisma db push` (schema from repo root):

```bash
cd backend
npx prisma db push --schema ../prisma/schema.prisma
npx tsx ../prisma/seed.ts          # demo data + role accounts (dev only!)
```

Production practice is migrations:

```bash
cd backend
npx prisma migrate dev --schema ../prisma/schema.prisma --name init   # first migration
npx prisma migrate deploy --schema ../prisma/schema.prisma            # CI/production
```

The schema file is intentionally stored at the repository root and referenced via
`prisma.schema = ../prisma/schema.prisma` so backend and tooling share one copy.

## 3. Docker (recommended)

```bash
cp backend/.env.example backend/.env           # edit secrets first
docker compose up -d --build

# one-time schema + seed/service setup
docker compose run --rm api npx prisma db push --schema /prisma/schema.prisma
docker compose run --rm api npx tsx /prisma/seed.ts     # optional demo data

curl http://localhost:3001/health              # API
open http://localhost:8080                     # nginx-served SPA, /api → api:3001
```

Services:
- `db` — PostgreSQL 18 with a named volume and health check.
- `api` — Fastify from `backend/Dockerfile` (multi-stage build of tsc output),
  healthcheck on `/health`, evidence volume at `/storage/evidence`.
- `web` — nginx serving the built SPA (`frontend/Dockerfile` + `frontend/nginx.conf`),
  SPA fallback routing plus `/api` reverse proxy (12 MB body cap for uploads).

### S3-compatible evidence storage (optional)
Enable the commented `minio` service (or point `S3_ENDPOINT` at AWS/other S3),
set `STORAGE_DRIVER=s3` plus `S3_*` keys. Downloads then return short-lived
presigned URLs instead of streaming server-side.

## 4. Bare-metal/Node deployment

```bash
npm run build            # backend tsc + frontend vite build
# serve backend/dist with pm2/systemd:  node dist/index.js   (PORT/HOST via env)
# serve frontend/dist/static assets with nginx using frontend/nginx.conf
#   (adjust proxy_pass for your host)
```

## 5. Production checklist

- [ ] `JWT_SECRET` rotated from defaults; `.env` never committed
- [ ] Database user has least privilege; TLS to Postgres
- [ ] `NODE_ENV=production` (reset tokens are never returned in the response)
- [ ] Passwords: seeded `Password@123` accounts removed/rotated immediately
- [ ] SMTP configured (if email usage desired), MFA enabled for admin accounts
- [ ] Evidence volume backed up (or S3 lifecycle rules applied)
- [ ] `/api/audit-logs/verify` scheduled as a periodic integrity check
- [ ] Log aggregation wired (logs use pino/pino-pretty in development)
- [ ] Rate limits tuned per expected campus traffic; per-account lockout confirmed
- [ ] HTTPS terminated at the proxy (nginx/Caddy/managed LB); HSTS enabled

## 6. Health, monitoring and backups

- Liveness: `GET /health`. Readiness: database connectivity inside the API.
- Logs: JSON pino events (request-level errors, audit failures).
- Database: nightly `pg_dump` plus verified restore drill.
- Evidence: `rsync`-style backup of the evidence volume or S3 bucket replication.

## 7. Scaling notes

The API is stateless (JWT + DB): run several `api` replicas behind the proxy.
Rate limiting is in-memory per instance; for strict global limits add a shared
store (e.g. `@fastify/rate-limit` Redis backend) or enforce limits at the gateway.
The audit chain serializes writers in-process — single-container deployments
maintain exact linking automatically; multi-instance deployments should route
audit writes through one dedicated instance or a DB-level advisory lock.

## 8. Supabase (Postgres + Storage)

The portal runs on Supabase with **zero code changes** — Prisma talks to
Supabase Postgres via `DATABASE_URL`, and evidence storage has two
Supabase-backed drivers built in: the native Storage API via a
**secret key** (`STORAGE_DRIVER=supabase`) or the Storage **S3 protocol**
(`STORAGE_DRIVER=s3`). A plain local directory remains the default for
offline development.

> Supabase **Auth** is intentionally not used: the platform ships its own
> Argon2id + JWT access/refresh-rotation + TOTP-MFA authentication with
> per-account lockout (see `backend/src/services/auth.service.ts`), which the
> project spec requires. Supabase provides the database and the object storage.

### 8.1 Supabase Cloud

1. Create a project at [database.new](https://database.new).
2. **Database** — copy the connection string from *Project Settings → Database*:

   | Use case | Connection string |
   |---|---|
   | Long-running API (recommended) | `postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require` |
   | Supavisor session pooler | `postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require` |
   | Supavisor transaction pooler (serverless only) | same host, port `6543`, add `?pgbouncer=true&connection_limit=1` |

   ```bash
   DATABASE_URL="postgresql://postgres:...@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
   ```

3. **Storage** — *Project Settings → API* gives you the URL and keys:

   **Option A (recommended): secret key** — *Project Settings → API Keys*
   (new-style `sb_secret_…`, or the legacy `service_role` JWT on the same page):

   ```bash
   STORAGE_DRIVER="supabase"
   SUPABASE_URL="https://PROJECT_REF.supabase.co"
   SUPABASE_SECRET_KEY="sb_secret_..."       # server-side only — never expose
   # Legacy fallbacks also accepted: SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
   SUPABASE_STORAGE_BUCKET="shjap-evidence" # auto-created (private) on first upload
   ```

   **Option B: Storage S3 protocol** (create a **private** bucket named
   `shjap-evidence` and keys under *Project Settings → Storage → S3 access keys*):

   ```bash
   STORAGE_DRIVER="s3"
   S3_ENDPOINT="https://PROJECT_REF.supabase.co/storage/v1/s3"
   S3_REGION="<your project region, e.g. us-east-1>"    # Project Settings → General
   S3_ACCESS_KEY="..."
   S3_SECRET_KEY="..."
   S3_BUCKET="shjap-evidence"
   ```

4. Prepare the schema (from `backend/`): `npm run db:push && npm run db:seed`
   (or `npm run db:setup`), then deploy as usual (Docker or bare metal).

Notes:
- Evidence objects stay private; downloads are streamed by the API after
  authorization (presigned URLs are minted per request, TTL 15 min).
- Prisma does not use RLS; authorization is enforced in the API layer. The
  connection uses the `postgres` role via the string above — keep it out of
  client bundles (it never leaves the backend).
- For Supabase backups use Dashboard → Database → Backups; evidence lives in
  the storage bucket (enable bucket backups/replication as needed).

### 8.2 Local Supabase stack (parity for development/CI)

The repo ships `supabase/config.toml` (S3 protocol enabled; `shjap-evidence`
bucket auto-created; Prisma remains the schema source of truth):

```bash
npx supabase start        # requires Docker; first run pulls images
npx supabase status       # prints DB URL, S3 access key/secret, API URL
```

Then point the backend at it:

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
STORAGE_DRIVER="s3"
S3_ENDPOINT="http://127.0.0.1:54321/storage/v1/s3"
S3_REGION="us-east-1"
S3_ACCESS_KEY="<from supabase status>"
S3_SECRET_KEY="<from supabase status>"
S3_BUCKET="shjap-evidence"
```

```bash
cd backend && npm run db:setup    # push Prisma schema + seed demo data
npm run dev                       # app now runs on the local Supabase stack
npx supabase stop                 # when done (add --no-backup to wipe local data)
```
