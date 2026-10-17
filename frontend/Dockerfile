# SHJAP Grievance Portal — frontend (React SPA served by nginx)
#
# Build context is the REPOSITORY ROOT:
#   docker build -f frontend/Dockerfile -t shjap-web .
#
# Runtime nginx serves the built SPA, proxies /api → shjap-api:3001 and
# rewrites unknown paths to index.html (client routing).
FROM node:20-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
# The API base is same-origin /api (nginx reverse proxy), no build arg needed.
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/ >/dev/null || exit 1
