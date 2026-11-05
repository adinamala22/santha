#!/usr/bin/env bash
# Santha server operations. Lives next to compose.yml, Caddyfile, values/ and .env (docs/deploy/README.md):
# /opt/santha (test) and /opt/santha-prod (prod; the same server can host both, ADR-024).
# Settings: values/<SANTHA_ENV>.values.yaml (+ <SANTHA_CLOUD>.<env> overlay). Secrets: .env.
#
#   ./santha.sh deploy <tag> [all|backend|web]   pull, back up (prod), migrate (backend), start, wait until healthy
#   ./santha.sh rollback [backend|web]           redeploy that part's previous tag (migrations are backward compatible)
#   ./santha.sh migrate                          run pending database migrations
#   ./santha.sh bootstrap                        first admin + city (asks for the admin's details)
#   ./santha.sh reindex                          rebuild the search index
#   ./santha.sh import <file.csv>                import products into the master catalogue
#   ./santha.sh backup                           pg_dump → gzip → backup bucket (or ./backups when none), prune old
#   ./santha.sh restore <object>                 restore a dump from the backup bucket (asks for confirmation)
#   ./santha.sh tag [backend|web]                print the deployed tag (used to promote test → prod)
#   ./santha.sh status | logs [service]
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing $(pwd)/.env. Copy server.env.example and fill it in (config/values/secrets.md)." >&2; exit 1; }
set -a; . ./.env; set +a
: "${SANTHA_ENV:?SANTHA_ENV (test or prod) missing in .env}"

# The deploy section of the values file(s) → API_DOMAIN, WEB_DOMAIN, MEDIA_DOMAIN, ROBOTS_TAG, COMPOSE_PROFILES,
# INGRESS, WEB_REDIRECTS.
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

# One tag per part (ADR-024). Before the split there was a single .tag for both.
tag_of() { cat ".tag-$1" 2>/dev/null || cat .tag 2>/dev/null || true; }
BACKEND_TAG="${BACKEND_TAG:-$(tag_of backend)}"
WEB_TAG="${WEB_TAG:-$(tag_of web)}"
# compose needs both set even when only one part is deployed; an unset part is never started.
export BACKEND_TAG="${BACKEND_TAG:-none}" WEB_TAG="${WEB_TAG:-none}"

EDGE_DIR="${EDGE_DIR:-/opt/santha-edge}"
COMPOSE_FILES=(-f compose.yml)
# deploy.ingress: tunnel → no public ports; a Cloudflare Tunnel brings traffic in (compose.tunnel.yml).
[ "${INGRESS:-}" = tunnel ] && COMPOSE_FILES+=(-f compose.tunnel.yml)
# deploy.ingress: edge → the server's shared HTTPS front door serves this stack (compose.edge.yml, ADR-024).
[ "${INGRESS:-}" = edge ] && COMPOSE_FILES+=(-f compose.edge.yml)
dc() { docker compose "${COMPOSE_FILES[@]}" --env-file .env "$@"; }

caddy_extras() {
  mkdir -p caddy.d
  if [[ ",${COMPOSE_PROFILES:-}," == *",storage,"* && -n "${MEDIA_DOMAIN:-}" ]]; then
    printf '{$SITE_SCHEME:https}://{$MEDIA_DOMAIN} {\n\timport common\n\treverse_proxy storage:9000\n}\n' > caddy.d/media.caddy
  else
    rm -f caddy.d/media.caddy
  fi
  touch caddy.d/.keep
}

# Shared edge (ADR-024): this stack's sites, then start/reload the one Caddy on 80/443.
edge_network() { docker network inspect santha-edge >/dev/null 2>&1 || docker network create santha-edge >/dev/null; }
edge_sites() {
  [ -d "$EDGE_DIR" ] || { echo "Missing $EDGE_DIR (copied by the deploy from infra/deploy/edge)" >&2; exit 1; }
  mkdir -p "$EDGE_DIR/sites"
  local f="$EDGE_DIR/sites/${SANTHA_ENV}.caddy" robots="${ROBOTS_TAG:-all}" e="$SANTHA_ENV"
  {
    printf 'https://%s {\n\timport common\n\theader X-Robots-Tag "%s"\n\treverse_proxy %s-api:4000 {\n\t\thealth_uri /v1/health\n\t}\n}\n\n' "$API_DOMAIN" "$robots" "$e"
    printf 'https://%s {\n\timport common\n\theader X-Robots-Tag "%s"\n\treverse_proxy %s-web:3000\n}\n\n' "$WEB_DOMAIN" "$robots" "$e"
    if [[ ",${COMPOSE_PROFILES:-}," == *",storage,"* && -n "${MEDIA_DOMAIN:-}" ]]; then
      printf 'https://%s {\n\timport common\n\theader X-Robots-Tag "%s"\n\treverse_proxy %s-storage:9000\n}\n\n' "$MEDIA_DOMAIN" "$robots" "$e"
    fi
    # e.g. www.santhaapp.com → santhaapp.com
    local r
    for r in ${WEB_REDIRECTS:+${WEB_REDIRECTS//,/ }}; do printf 'https://%s {\n\tredir https://%s{uri} permanent\n}\n\n' "$r" "$WEB_DOMAIN"; done
  } > "$f.new"
  mv "$f.new" "$f"
}
edge_up() {
  edge_sites
  # This stack's own Caddy (from before the edge) would hold 80/443.
  dc --profile own-caddy rm -sf caddy >/dev/null 2>&1 || true
  docker compose -f "$EDGE_DIR/compose.yml" --env-file .env up -d --wait
  docker compose -f "$EDGE_DIR/compose.yml" --env-file .env exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
}
ingress_up() {
  if [ "${INGRESS:-}" = edge ]; then edge_up; return; fi
  caddy_extras
  dc up -d --no-deps caddy
  [ "${INGRESS:-}" = tunnel ] && dc up -d --no-deps cloudflared
  return 0
}

# Healthy from inside first (the containers' own health checks), then the public URLs. A public check that fails
# only warns: before DNS points here (a new domain) HTTPS cannot work yet, but the stack itself is fine.
wait_healthy() {
  local part="$1" url
  local services=()
  [[ "$part" == all || "$part" == backend ]] && services+=(api worker)
  [[ "$part" == all || "$part" == web ]] && services+=(web)
  echo "Waiting for ${services[*]} to report healthy …"
  dc up -d --wait --no-deps "${services[@]}"
  [[ "$part" == web ]] && url="https://${WEB_DOMAIN}/" || url="https://${API_DOMAIN}/v1/health/ready"
  for _ in $(seq 1 24); do
    if curl -fsS -o /dev/null "$url"; then echo "Healthy and public: $url"; return 0; fi
    sleep 5
  done
  echo "WARNING: healthy on the server, but $url is not answering yet (DNS not pointing here, or HTTPS still being issued)." >&2
}

db_url() {
  # pg_dump/psql run in a postgres container on the compose network (reaches the localdb or a managed DB).
  echo "${DATABASE_URL}"
}
pg() { docker run --rm -i --network "santha-${SANTHA_ENV}_default" -e PGCONNECT_TIMEOUT=10 imresamu/postgis:16-3.4 "$@"; }
s3() {
  docker run --rm -i -e AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:?}" -e AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:?}" \
    -e AWS_DEFAULT_REGION=ap-south-1 amazon/aws-cli --endpoint-url "${BACKUP_S3_ENDPOINT:?}" "$@"
}

backup() {
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local keep="${BACKUP_KEEP_DAYS:-14}"
  if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
    # No backup bucket yet: keep dumps on this server (./backups), newest ${keep}. Set BACKUP_S3_* for off-site copies.
    mkdir -p backups
    echo "Backing up the database to $(pwd)/backups/santha-${SANTHA_ENV}-${stamp}.sql.gz (no BACKUP_S3_BUCKET set) …"
    pg pg_dump --no-owner --no-privileges --format=plain "$(db_url)" | gzip -9 > "backups/santha-${SANTHA_ENV}-${stamp}.sql.gz"
    ls -1t backups/santha-"${SANTHA_ENV}"-*.sql.gz | tail -n +"$((keep + 1))" | xargs -r rm -f
    echo "Backup done."
    return 0
  fi
  local name="${SANTHA_ENV}/santha-${SANTHA_ENV}-${stamp}.sql.gz"
  echo "Backing up the database to s3://${BACKUP_S3_BUCKET}/${name} …"
  pg pg_dump --no-owner --no-privileges --format=plain "$(db_url)" | gzip -9 | s3 s3 cp - "s3://${BACKUP_S3_BUCKET}/${name}"
  echo "Backup done."
  local cutoff
  cutoff="$(date -u -d "-${keep} days" +%Y%m%dT%H%M%SZ)"
  s3 s3 ls "s3://${BACKUP_S3_BUCKET}/${SANTHA_ENV}/" | awk '{print $4}' | while read -r f; do
    ts="${f#santha-${SANTHA_ENV}-}"; ts="${ts%.sql.gz}"
    if [[ -n "$ts" && "$ts" < "$cutoff" ]]; then s3 s3 rm "s3://${BACKUP_S3_BUCKET}/${SANTHA_ENV}/${f}" >/dev/null; echo "Pruned ${f}"; fi
  done
}

record_tag() { # part tag
  [ -f ".tag-$1" ] && cp ".tag-$1" ".tag-$1.previous"
  echo "$2" > ".tag-$1"
}

deploy_backend() {
  [[ ",${COMPOSE_PROFILES:-}," == *",localdb,"* ]] && dc up -d --wait postgres
  # Storage too, so it (re)joins the edge network when the ingress changes (media.<domain>).
  [[ ",${COMPOSE_PROFILES:-}," == *",storage,"* ]] && dc up -d --no-deps storage
  [ "$SANTHA_ENV" = prod ] && [ "$(tag_of backend)" != "" ] && backup
  dc up -d --wait redis typesense
  echo "Running migrations …"
  dc run --rm tools
  dc up -d --no-deps api worker
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  deploy)
    TAG="${1:?usage: ./santha.sh deploy <tag> [all|backend|web]}"
    part="${2:-all}"
    [[ "$part" =~ ^(all|backend|web)$ ]] || { echo "part must be all, backend or web" >&2; exit 1; }
    [[ "$part" == web && "$(tag_of backend)" == "" ]] && { echo "Deploy the backend to ${SANTHA_ENV} first (./santha.sh deploy <tag> backend)." >&2; exit 1; }
    [[ "$part" == all || "$part" == backend ]] && export BACKEND_TAG="$TAG"
    [[ "$part" == all || "$part" == web ]] && export WEB_TAG="$TAG"
    [ "${INGRESS:-}" = edge ] && edge_network
    if [ -z "${SANTHA_SKIP_PULL:-}" ]; then   # SANTHA_SKIP_PULL=1: images already on the server
      [[ "$part" == all || "$part" == backend ]] && { dc pull --quiet api worker; dc --profile tools pull --quiet tools; }
      [[ "$part" == all || "$part" == web ]] && dc pull --quiet web
    fi
    [[ "$part" == all || "$part" == backend ]] && deploy_backend
    [[ "$part" == all || "$part" == web ]] && dc up -d --no-deps web
    ingress_up
    wait_healthy "$part"
    [[ "$part" == all || "$part" == backend ]] && record_tag backend "$TAG"
    [[ "$part" == all || "$part" == web ]] && record_tag web "$TAG"
    rm -f .tag .tag.previous # the single tag from before ADR-024
    docker image prune -f >/dev/null
    echo "Deployed ${part} ${TAG} to ${SANTHA_ENV}."
    ;;
  rollback)
    part="${1:-all}"
    for p in backend web; do
      [[ "$part" == all || "$part" == "$p" ]] || continue
      prev="$(cat ".tag-$p.previous" 2>/dev/null || true)"
      [ -n "$prev" ] || { echo "No previous ${p} deploy recorded." >&2; exit 1; }
      echo "Rolling back ${p}: $(tag_of "$p") → ${prev}"
      if [ "$p" = backend ]; then export BACKEND_TAG="$prev"; svc=(api worker); else export WEB_TAG="$prev"; svc=(web); fi
      { [ -n "${SANTHA_SKIP_PULL:-}" ] || dc pull --quiet "${svc[@]}"; } && dc up -d --no-deps "${svc[@]}"
      echo "$prev" > ".tag-$p"
      wait_healthy "$p"
    done
    ;;
  tag) tag_of "${1:-backend}" ;;
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
    if [[ "$obj" == backups/* ]]; then gunzip -c "$obj"; else s3 s3 cp "s3://${BACKUP_S3_BUCKET}/${obj}" - | gunzip; fi | pg psql "$(db_url)" -v ON_ERROR_STOP=1 -q
    dc run --rm tools
    dc up -d --no-deps api worker web
    wait_healthy all
    ;;
  status) echo "Environment ${SANTHA_ENV}: backend ${BACKEND_TAG}, web ${WEB_TAG}"; dc ps ;;
  logs) dc logs -f --tail=200 "$@" ;;
  *) sed -n '2,16p' "$0" ;;
esac
