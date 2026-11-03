import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

/**
 * Per-environment settings from committed YAML files (config/values/, see its README). Selected by:
 *   SANTHA_ENV=test|prod          → <env>.values.yaml (required)
 *   SANTHA_CLOUD=gcp|do|…         → <cloud>.<env>.values.yaml (optional overlay, e.g. gcp.prod.values.yaml)
 * Only the `backend:` section is used here. Its keys are the environment variable names in camelCase
 * (appEnv → APP_ENV, s3Endpoint → S3_ENDPOINT); UPPER_SNAKE names work too. Merge order is base, then
 * overlay, then real environment variables, which always win.
 * Secrets are refused: they come only from the environment (server .env or a secret manager).
 */
const SECRET = /(SECRET|PASSWORD|TOKEN|AUTH_KEY|API_KEY|ACCESS_KEY|SERVICE_ACCOUNT|DATABASE_URL|REDIS_URL)/;

const toEnvName = (key: string) => (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());

function valuesDir(source: Record<string, string | undefined>): string {
  const candidates = [source.SANTHA_VALUES_DIR, join(process.cwd(), 'config/values'), resolve(process.cwd(), '../../config/values'), resolve(__dirname, '../../../../config/values')];
  const dir = candidates.find((d) => d && existsSync(d));
  if (!dir) throw new Error(`config/values not found (looked in ${candidates.filter(Boolean).join(', ')}); set SANTHA_VALUES_DIR`);
  return dir;
}

function readSection(file: string): Record<string, unknown> {
  const doc = (parse(readFileSync(file, 'utf8')) ?? {}) as { backend?: Record<string, unknown> };
  return doc.backend ?? {};
}

export function valuesFor(source: Record<string, string | undefined>, allowed: ReadonlySet<string>): Record<string, string> {
  const env = source.SANTHA_ENV;
  if (!env) return {};
  const cloud = source.SANTHA_CLOUD;
  for (const [k, v] of [['SANTHA_ENV', env], ['SANTHA_CLOUD', cloud]] as const)
    if (v !== undefined && !/^[a-z0-9-]+$/.test(v)) throw new Error(`${k} must be lowercase letters, digits or dashes (got "${v}")`);

  const dir = valuesDir(source);
  const files = [join(dir, `${env}.values.yaml`), ...(cloud ? [join(dir, `${cloud}.${env}.values.yaml`)] : [])];
  for (const f of files) if (!existsSync(f)) throw new Error(`Values file missing: ${f} (SANTHA_ENV=${env}${cloud ? `, SANTHA_CLOUD=${cloud}` : ''})`);

  const out: Record<string, string> = {};
  const problems: string[] = [];
  for (const file of files) {
    for (const [key, value] of Object.entries(readSection(file))) {
      const name = toEnvName(key);
      if (!allowed.has(name)) problems.push(`${file}: backend.${key} → ${name} is not a setting the backend knows`);
      else if (SECRET.test(name)) problems.push(`${file}: backend.${key} is a secret; set ${name} in the environment instead`);
      else if (value !== null && typeof value === 'object') problems.push(`${file}: backend.${key} must be a single value`);
      else if (value !== null && value !== undefined) out[name] = String(value);
    }
  }
  if (problems.length) throw new Error(`Invalid values files:\n  - ${problems.join('\n  - ')}`);
  return out;
}
