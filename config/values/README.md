# Environment values

One file per environment holds every **non-secret** setting for the backend, the website and the three apps.
Secrets are never in these files: see [secrets.md](secrets.md).

| File | Used when |
|---|---|
| `test.values.yaml` | `SANTHA_ENV=test` (the testing environment) |
| `prod.values.yaml` | `SANTHA_ENV=prod` (production) |
| `<cloud>.<env>.values.yaml`, e.g. `gcp.prod.values.yaml` | additionally, when `SANTHA_CLOUD=gcp` (host-specific overrides) |

Values are merged in this order, and the last one wins:
1. the base file;
2. the cloud overlay;
3. real environment variables (the server's `.env` or a secret manager).

## Sections
- **`deploy`**: domains, robots tag and optional containers. Read by `infra/deploy/santha.sh`, then Caddy and Docker Compose.
- **`backend`**: settings for the API, the worker and the tools. Keys are the environment variable names in
  camelCase, so `appEnv` becomes `APP_ENV` and `s3Endpoint` becomes `S3_ENDPOINT`. Read by
  `apps/backend/src/config/values.ts` when `SANTHA_ENV` is set.
- **`web`**: build settings for the website image (`NEXT_PUBLIC_*`). Read by `.github/workflows/deploy.yml`.
- **`apps`**: flavor and API address for the Flutter builds. Read by `.github/workflows/apps-release.yml`.

## Rules
- Change values **in git** and deploy. The deploy copies this folder to the server (`/opt/santha/values`) along
  with the images of the same commit. Don't edit it on the server.
- The backend refuses:
  - unknown keys (typos);
  - nested values;
  - anything that looks like a secret (`*SECRET*`, `*PASSWORD*`, `*_KEY`s, `DATABASE_URL`…).
- `apps/backend/src/config/values.spec.ts` checks that the committed `test`, `prod` and `gcp.prod` files are valid.
  CI fails on a broken value before anything is deployed.
- To try a value locally: `SANTHA_ENV=test pnpm --filter backend dev`. You still need the secrets in `.env`.
