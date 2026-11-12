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
#   ./santha.sh watch                            health check (api, web, search, last backup); alerts; heals search (ADR-042)
#   ./santha.sh install-cron                     (run once with sudo) nightly backup + a health check every 5 minutes
#   ./santha.sh tag [backend|web]                print the deployed tag (used to promote test → prod)
#   ./santha.sh status | logs [service]
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "Missing $(pwd)/.env. Copy server.env.example and fill it in (config/values/secrets.md)." >&2; exit 1; }
set -a; . ./.env; set +a
: "${SANTHA_ENV:?SANTHA_ENV (test or prod) missing in .env}"

# The deploy section of the values file(s) → API_DOMAIN, WEB_DOMAIN, MEDIA_DOMAIN, ROBOTS_TAG, COMPOSE_PROFILES,
# INGRESS, WEB_REDIRECTS; and the web section → WEB_SITE_URL, WEB_API_URL, WEB_MEDIA_ORIGIN, WEB_MAP_TILES_URL (ADR-025).
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
    '. as $i ireduce ({}; . * $i) | ((.deploy // {} | to_entries | .[] | .key + "=" + (.value // "" | tostring)), (.web // {} | to_entries | .[] | "web_" + .key + "=" + (.value // "" | tostring)))' "${files[@]}")
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
  # The edge joins every stack's own network (never the other way round: a shared network would let one stack's
  # "api" resolve to the other's). Every stack, so a recreated edge container gets all of them back.
  local caddy net
  caddy="$(docker compose -f "$EDGE_DIR/compose.yml" --env-file .env ps -q caddy)"
  for net in $(docker network ls --format '{{.Name}}' | grep -E '^santha-[a-z0-9-]+_default$'); do
    docker network connect "$net" "$caddy" 2>/dev/null || true
  done
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
  # BACKUP_S3_ENDPOINT is for non-AWS buckets (Spaces, GCS); leave it empty for a bucket on Amazon S3 itself.
  local ep=(); [ -n "${BACKUP_S3_ENDPOINT:-}" ] && ep=(--endpoint-url "${BACKUP_S3_ENDPOINT}")
  docker run --rm -i -e AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:?}" -e AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:?}" \
    -e AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-ap-south-1}" amazon/aws-cli "${ep[@]}" "$@"
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

# Sends one alert line. ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID (recommended: free, instant on a phone) and/or
# ALERT_WEBHOOK_URL (any URL that takes {"text": "..."}: Slack, Discord-compatible, n8n). With neither, it only logs.
alert() {
  local msg="[santha ${SANTHA_ENV}] $1"
  echo "ALERT: $msg" >&2
  if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS -m 10 "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" --data-urlencode "text=${msg}" >/dev/null || true
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -H 'Content-Type: application/json' -d "{\"text\":\"${msg//\"/\'}\"}" "${ALERT_WEBHOOK_URL}" >/dev/null || true
  fi
}

# Newest backup age in hours (999 when none).
backup_age_hours() {
  local newest=""
  if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
    newest="$(ls -1t backups/santha-"${SANTHA_ENV}"-*.sql.gz 2>/dev/null | head -1 || true)"
    [ -n "$newest" ] && echo $(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 )) || echo 999
  else
    newest="$(s3 s3 ls "s3://${BACKUP_S3_BUCKET}/${SANTHA_ENV}/" 2>/dev/null | awk '{print $1" "$2}' | sort | tail -1 || true)"
    [ -n "$newest" ] && echo $(( ( $(date +%s) - $(date -d "$newest" +%s) ) / 3600 )) || echo 999
  fi
}

# One pass of health checks. Alerts once per problem per state change (a marker file keeps it from repeating every
# 5 minutes). Heals what it safely can: an empty search index after a Typesense restart is rebuilt (ADR-042).
watch_once() {
  local problems=() state=".watch-state"
  curl -fsS -m 10 -o /dev/null "https://${API_DOMAIN}/v1/health/ready" || problems+=("api not ready")
  curl -fsS -m 10 -o /dev/null "https://${WEB_DOMAIN}/" || problems+=("website not answering")
  if ! dc exec -T typesense curl -fsS -m 5 http://localhost:8108/health >/dev/null 2>&1; then
    dc up -d typesense >/dev/null 2>&1 || true
    sleep 15
    if dc exec -T typesense curl -fsS -m 5 http://localhost:8108/health >/dev/null 2>&1; then
      dc run --rm tools pnpm search:reindex >/dev/null 2>&1 && problems+=("search was down: restarted and reindexed") || problems+=("search is down and could not be restarted")
    else
      problems+=("search is down and could not be restarted")
    fi
  fi
  local age; age="$(backup_age_hours)"
  [ "$age" -le 30 ] || problems+=("last backup is ${age}h old")
  local now="${problems[*]:-ok}"
  local before; before="$(cat "$state" 2>/dev/null || echo ok)"
  if [ "$now" != "$before" ]; then
    if [ "$now" = ok ]; then alert "recovered: all checks pass"; else alert "${now}"; fi
    echo "$now" > "$state"
  fi
  [ "$now" = ok ] && echo "ok" || { echo "problems: $now"; return 1; }
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
  watch) watch_once ;;
  install-cron)
    [ "$(id -u)" = 0 ] || { echo "Run with sudo: sudo ./santha.sh install-cron" >&2; exit 1; }
    dir="$(pwd)"; user="$(stat -c %U "$dir")"
    cat > "/etc/cron.d/santha-${SANTHA_ENV}" <<CRON
# Santha ${SANTHA_ENV} (ADR-042): nightly database backup at 02:30 IST (21:00 UTC), health check every 5 minutes.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 21 * * * ${user} cd ${dir} && ./santha.sh backup >> ${dir}/cron-backup.log 2>&1
*/5 * * * * ${user} cd ${dir} && ./santha.sh watch >> ${dir}/cron-watch.log 2>&1
CRON
    chmod 644 "/etc/cron.d/santha-${SANTHA_ENV}"
    echo "Installed /etc/cron.d/santha-${SANTHA_ENV} (runs as ${user})."
    ;;
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
  *) sed -n '2,19p' "$0" ;;
esac
