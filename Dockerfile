# syntax=docker/dockerfile:1
#
# StackUp API image. Multi-stage: build the shared package + API with pnpm,
# then run the compiled output. Works on Fly, Render, Railway, Cloud Run, or
# any container host. The server reads PORT (default 3000) and its config from
# env: APP_DB_URL, JWT_SECRET, WEB_ORIGINS, and optionally ANTHROPIC_API_KEY.

# ---- build ----------------------------------------------------------------
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
# Toolchain for argon2's native module (only used if no prebuilt binary matches).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# Install the whole workspace (api, web, shared) so we can build all three.
RUN pnpm install --frozen-lockfile
# Shared first (api + web both import it). The web is built with an EMPTY API
# base so the browser calls the API on the SAME origin that serves the app —
# single-origin deploy, no CORS. The API then serves apps/web/out via WEB_DIST.
RUN pnpm --filter @stackup/shared build \
 && NEXT_PUBLIC_API_URL="" pnpm --filter @stackup/web build \
 && pnpm --filter @stackup/api build

# ---- runtime --------------------------------------------------------------
FROM node:22-slim AS runtime
# WEB_DIST points main.ts at the static export so one service serves both the
# API and the web app at a single URL.
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/apps/web/out
WORKDIR /app
# Copy the whole built tree so pnpm's workspace symlinks (@stackup/shared)
# resolve unchanged at runtime, and the web export is present.
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]
