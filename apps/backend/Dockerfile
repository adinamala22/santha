# Santha backend images. Build from the repo root:
#   docker build -f apps/backend/Dockerfile --target runtime -t santha-backend .   # API (default command) and worker
#   docker build -f apps/backend/Dockerfile --target tools   -t santha-tools .     # migrations and one-off scripts
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/
COPY apps/backend/prisma apps/backend/prisma
RUN pnpm install --frozen-lockfile --filter backend...
COPY apps/backend apps/backend
# Per-environment settings (SANTHA_ENV=test|prod picks config/values/<env>.values.yaml)
COPY config/values config/values
RUN pnpm --filter backend build && pnpm deploy --filter backend --prod /out && cp -r apps/backend/dist apps/backend/prisma /out/ \
    && cd /out && node /repo/apps/backend/node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

# One-off jobs with the full toolchain (Prisma CLI, TypeScript scripts). The deploy runs it before every release:
#   migrate (default) · bootstrap (first admin + city) · search:reindex · catalogue:import <csv>
FROM build AS tools
WORKDIR /repo/apps/backend
ENV NODE_ENV=production SANTHA_VALUES_DIR=/repo/config/values
CMD ["pnpm", "migrate:deploy"]

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out /app
COPY --from=build /repo/config/values /app/config/values
ENV SANTHA_VALUES_DIR=/app/config/values
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 CMD curl -fsS http://localhost:4000/v1/health || exit 1
# API by default; the worker runs the same image with `node dist/worker.js`.
CMD ["node", "dist/main.js"]
