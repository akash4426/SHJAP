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
