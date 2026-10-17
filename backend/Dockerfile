# SHJAP Grievance Portal — API server (Node 20 + Fastify + Prisma)
#
# Build context is the REPOSITORY ROOT (the Prisma schema lives at prisma/):
#   docker build -f backend/Dockerfile -t shjap-api .
#   docker run --env-file backend/.env -p 3001:3001 shjap-api
#
# Multi-stage build: deps → build (tsc) → slim runtime.
FROM node:20-slim AS deps
WORKDIR /app
# argon2 ships prebuilt binaries; install toolchain so a source build can't fail
RUN apt-get update -y && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package.json backend/package-lock.json* ./
RUN npm install

FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./
COPY prisma/ /prisma/
RUN npx prisma generate --schema /prisma/schema.prisma && npx tsc

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/.env.example ./.env.example
COPY --from=build /prisma /prisma
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:3001/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]

# First-run setup (schema + seed) via compose:
#   docker compose run --rm api npx prisma db push --schema /prisma/schema.prisma
#   docker compose run --rm api npx tsx --help (seed script is compiled? see docs/DEPLOYMENT.md)
