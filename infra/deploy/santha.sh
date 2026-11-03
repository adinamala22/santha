#!/usr/bin/env bash
# Santha server operations. Lives in /opt/santha next to compose.yml, Caddyfile, values/ and .env (docs/deploy/README.md).
# Settings: values/<SANTHA_ENV>.values.yaml (+ <SANTHA_CLOUD>.<env> overlay). Secrets: .env.
#
#   ./santha.sh deploy <tag>        pull images, back up (prod), migrate, start, wait until healthy
#   ./santha.sh rollback            redeploy the previous tag (migrations are backward compatible)
#   ./santha.sh migrate             run pending database migrations
#   ./santha.sh bootstrap           first admin + city (asks for the admin's details)
#   ./santha.sh reindex             rebuild the search index
#   ./santha.sh import <file.csv>   import products into the master catalogue
#   ./santha.sh backup              pg_dump → gzip → backup bucket, prune old dumps
#   ./santha.sh restore <object>    restore a dump from the backup bucket (asks for confirmation)
#   ./santha.sh status | logs [service]
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing /opt/santha/.env. Copy server.env.example and fill it in (config/values/secrets.md)." >&2; exit 1; }
set -a; . ./.env; set +a
: "${SANTHA_ENV:?SANTHA_ENV (test or prod) missing in .env}"

# The deploy section of the values file(s) → API_DOMAIN, WEB_DOMAIN, MEDIA_DOMAIN, ROBOTS_TAG, COMPOSE_PROFILES.
load_values() {
  local files=("values/${SANTHA_ENV}.values.yaml")
  [ -n "${SANTHA_CLOUD:-}" ] && files+=("values/${SANTHA_CLOUD}.${SANTHA_ENV}.values.yaml")
  for f in "${files[@]}"; do [ -f "$f" ] || { echo "Missing $f (copied by the deploy from config/values/)" >&2; exit 1; }; done
  local line key
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key="$(printf %s "${line%%=*}" | sed -E 's/([a-z0-9])([A-Z])/\1_\2/g' | tr '[:lower:]' '[:upper:]')"
    export "$key=${line#*=}"
  done < <(docker run --rm -v "$PWD/values:/workdir/values:ro" mikefarah/yq:4 eval-all \
    '. as $i ireduce ({}; . * $i) | .deploy // {} | to_entries | .[] | .key + "=" + (.value // "" | tostring)' "${files[@]}")
  : "${API_DOMAIN:?deploy.apiDomain missing in the values file}" "${WEB_DOMAIN:?deploy.webDomain missing in the values file}"
}
load_values

TAG="${TAG:-$(cat .tag 2>/dev/null || true)}"
export TAG
dc() { docker compose -f compose.yml --env-file .env "$@"; }

caddy_extras() {
  mkdir -p caddy.d
  if [[ ",${COMPOSE_PROFILES:-}," == *",storage,"* && -n "${MEDIA_DOMAIN:-}" ]]; then
    printf '{$MEDIA_DOMAIN} {\n\timport common\n\treverse_proxy storage:9000\n}\n' > caddy.d/media.caddy
  else
    rm -f caddy.d/media.caddy
  fi
  touch caddy.d/.keep
}

wait_healthy() {
  echo "Waiting for https://${API_DOMAIN}/v1/health/ready …"
  for _ in $(seq 1 60); do
    if curl -fsS "https://${API_DOMAIN}/v1/health/ready" >/dev/null 2>&1 && curl -fsS -o /dev/null "https://${WEB_DOMAIN}/"; then
      echo "Healthy: https://${API_DOMAIN} and https://${WEB_DOMAIN}"
      return 0
    fi
    sleep 5
  done
  echo "Not healthy after 5 minutes. Check: ./santha.sh logs api" >&2
  return 1
}

db_url() {
  # pg_dump/psql run in a postgres container on the compose network (reaches the localdb or a managed DB).
  echo "${DATABASE_URL}"
}
pg() { docker run --rm -i --network "santha-${SANTHA_ENV}_default" -e PGCONNECT_TIMEOUT=10 postgis/postgis:16-3.4 "$@"; }
s3() {
  docker run --rm -i -e AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:?}" -e AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:?}" \
    -e AWS_DEFAULT_REGION=ap-south-1 amazon/aws-cli --endpoint-url "${BACKUP_S3_ENDPOINT:?}" "$@"
}

backup() {
  local name="${SANTHA_ENV}/santha-${SANTHA_ENV}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  echo "Backing up the database to s3://${BACKUP_S3_BUCKET}/${name} …"
  pg pg_dump --no-owner --no-privileges --format=plain "$(db_url)" | gzip -9 | s3 s3 cp - "s3://${BACKUP_S3_BUCKET}/${name}"
  echo "Backup done."
  local keep="${BACKUP_KEEP_DAYS:-14}" cutoff
  cutoff="$(date -u -d "-${keep} days" +%Y%m%dT%H%M%SZ)"
  s3 s3 ls "s3://${BACKUP_S3_BUCKET}/${SANTHA_ENV}/" | awk '{print $4}' | while read -r f; do
    ts="${f#santha-${SANTHA_ENV}-}"; ts="${ts%.sql.gz}"
    if [[ -n "$ts" && "$ts" < "$cutoff" ]]; then s3 s3 rm "s3://${BACKUP_S3_BUCKET}/${SANTHA_ENV}/${f}" >/dev/null; echo "Pruned ${f}"; fi
  done
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  deploy)
    TAG="${1:?usage: ./santha.sh deploy <tag>}"; export TAG
    caddy_extras
    [ -n "${SANTHA_SKIP_PULL:-}" ] || dc pull --quiet   # SANTHA_SKIP_PULL=1: images already on the server
    [[ ",${COMPOSE_PROFILES:-}," == *",localdb,"* ]] && { dc up -d --wait postgres; }
    [ "$SANTHA_ENV" = prod ] && [ -f .tag ] && backup
    dc up -d --wait redis typesense
    echo "Running migrations …"
    dc run --rm tools
    [ -f .tag ] && cp .tag .tag.previous
    echo "$TAG" > .tag
    dc up -d --remove-orphans
    wait_healthy
    docker image prune -f >/dev/null
    ;;
  rollback)
    prev="$(cat .tag.previous 2>/dev/null || true)"
    [ -n "$prev" ] || { echo "No previous deploy recorded." >&2; exit 1; }
    echo "Rolling back ${TAG} → ${prev}"
    TAG="$prev"; export TAG
    { [ -n "${SANTHA_SKIP_PULL:-}" ] || dc pull --quiet; } && dc up -d --remove-orphans
    echo "$prev" > .tag
    wait_healthy
    ;;
  migrate) dc run --rm tools ;;
  bootstrap)
    read -r -p "Admin email: " BOOTSTRAP_ADMIN_EMAIL
    read -r -p "Admin mobile (+91…): " BOOTSTRAP_ADMIN_PHONE
    read -r -p "Admin name: " BOOTSTRAP_ADMIN_NAME
    read -r -s -p "Admin password (14+ characters): " BOOTSTRAP_ADMIN_PASSWORD; echo
    export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PHONE BOOTSTRAP_ADMIN_NAME BOOTSTRAP_ADMIN_PASSWORD
    dc run --rm -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PHONE -e BOOTSTRAP_ADMIN_NAME -e BOOTSTRAP_ADMIN_PASSWORD \
      tools pnpm bootstrap
    ;;
  reindex) dc run --rm tools pnpm search:reindex ;;
  import)
    f="${1:?usage: ./santha.sh import <file.csv> [--dry-run]}"; shift
    dc run --rm -v "$(realpath "$f"):/tmp/import.csv:ro" tools pnpm catalogue:import /tmp/import.csv "$@"
    ;;
  backup) backup ;;
  restore)
    obj="${1:?usage: ./santha.sh restore <object key, e.g. prod/santha-prod-20261103T000000Z.sql.gz>}"
    echo "This REPLACES the ${SANTHA_ENV} database with ${obj}. The API and worker stop meanwhile."
    read -r -p "Type the environment name (${SANTHA_ENV}) to continue: " confirm
    [ "$confirm" = "$SANTHA_ENV" ] || { echo "Cancelled."; exit 1; }
    dc stop api worker web
    pg psql "$(db_url)" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS postgis;'
    s3 s3 cp "s3://${BACKUP_S3_BUCKET}/${obj}" - | gunzip | pg psql "$(db_url)" -v ON_ERROR_STOP=1 -q
    dc run --rm tools
    dc up -d
    wait_healthy
    ;;
  status) echo "Environment ${SANTHA_ENV}, tag ${TAG:-none}"; dc ps ;;
  logs) dc logs -f --tail=200 "$@" ;;
  *) sed -n '2,15p' "$0" ;;
esac
