# ADR-025: One website image for all environments (runtime settings)

Status: accepted (2026-11-05)

## Context
The backend was built once and deployed to QA and PROD unchanged. The website was built **once per environment**
(`santha-web-test`, `santha-web-prod`), because Next.js inlines `NEXT_PUBLIC_*` variables and `next.config`
headers at build time: the site address, the API address, the media origin and the Content-Security-Policy.

That meant two ARM builds under emulation for every website change (20–30 minutes), and PROD did not run the
exact image QA had tested. The product owner asked for one build step for all environments.

## Decision
- **One image.** `santha-web:<commit>` is built once by "Deploy · Web" and promoted unchanged from QA to PROD.
- **Runtime settings** (`apps/web/src/lib/runtime-config.ts`):
  - **Variables:** `SITE_URL`, `PUBLIC_API_URL`, `MEDIA_ORIGIN` and `MAP_TILES_URL`, plus `API_URL` (internal,
    as before). They come from the server's environment.
  - **How they're read:** dynamic `process.env[...]` lookups, which Next.js never inlines. The old
    `NEXT_PUBLIC_*` names still work as a fallback for local dev.
  - **Browser:** the root layout injects the public ones as `window.__SANTHA__`, so client components (lead
    forms, staff delivery page, maps) use the same values.
- **Pages render on request** (`connection()` in the root layout, sitemap and robots). Each fetch keeps its own
  `revalidate` in the data cache, so the landing page still calls the API at most once a minute.
- **The CSP is built per request in the middleware** (`src/lib/csp.ts`) from the runtime settings, as strict as
  before. The other security headers stay in `next.config`.
- **On the server:** `santha.sh` exports the values file's `web` section (`WEB_SITE_URL`, `WEB_API_URL`,
  `WEB_MEDIA_ORIGIN`, `WEB_MAP_TILES_URL`), and `compose.yml` passes them to the web container. The Dockerfile
  takes no build arguments.
- **Verified:** one `next build` with no addresses set, started once with the QA settings and once with the PROD
  settings, served each environment's addresses in the injected config, the CSP, robots.txt and the sitemap.

## Consequences
- **Build time:** a website change now builds one image instead of two.
- **What PROD runs:** exactly the image tested on QA.
- **Rollback:** a website rollback to a commit from before this change won't work, because those images were
  named per environment. The pipeline refuses such commits with a clear message.
- **Rendering cost:** every page is rendered on request. At Santha's traffic this costs little; static
  generation could come back with a CDN in front later.
