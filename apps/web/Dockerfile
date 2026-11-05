# Santha web (landing, store pages, ops console): Next.js standalone server. Build from the repo root, ONCE for
# every environment (ADR-025): the site, API and media addresses and the CSP are runtime settings, given to the
# container as SITE_URL, PUBLIC_API_URL, MEDIA_ORIGIN, MAP_TILES_URL and API_URL (infra/deploy/compose.yml).
#   docker build -f apps/web/Dockerfile -t santha-web .
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile --filter web...
COPY design design
COPY packages/santha_ui/fonts packages/santha_ui/fonts
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
ENV NEXT_STANDALONE=1
RUN pnpm --filter web sync:brand && pnpm --filter web exec next build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 CMD curl -fsS -o /dev/null http://localhost:3000/ || exit 1
# Every setting is read at runtime from the environment (src/lib/runtime-config.ts); nothing environment-specific is built in.
CMD ["node", "apps/web/server.js"]
