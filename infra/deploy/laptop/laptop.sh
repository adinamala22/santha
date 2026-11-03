#!/usr/bin/env bash
# TEST environment on your own computer (Linux, or WSL 2 on Windows), reachable from phones through a
# Cloudflare Tunnel. Same stack and santha.sh as a cloud VM, but the images are built here instead of pulled
# from GitHub Packages. Values: test.values.yaml + laptop.test.values.yaml. Guide: docs/deploy/README.md.
#
#   sudo infra/deploy/laptop/laptop.sh deploy        build images from this checkout, copy the stack, deploy
#   sudo infra/deploy/laptop/laptop.sh <command>     any santha.sh command: bootstrap, status, logs api, migrate…
#
# The first run creates /opt/santha/.env with random secrets and stops so you can paste the tunnel token.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
STACK=/opt/santha
BUILD=/var/tmp/santha-build   # a Linux-side copy: building from /mnt/<drive> is very slow on WSL
REGISTRY=santha-local

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo), because Docker and /opt/santha need it." >&2; exit 1; }
command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }

rand() { openssl rand -hex "$1"; }

create_env() {
  mkdir -p "$STACK"
  local db; db="$(rand 24)"
  umask 077
  cat > "$STACK/.env" <<EOF
# TEST on this computer (infra/deploy/laptop/laptop.sh). Secrets only; settings are in the values files.
SANTHA_ENV=test
SANTHA_CLOUD=laptop
REGISTRY=${REGISTRY}
# Unused here: Cloudflare provides HTTPS, so Caddy requests no certificates.
ACME_EMAIL=unused@example.com

# Cloudflare → Zero Trust → Networks → Tunnels → your tunnel → the token after "--token" (docs/deploy/README.md)
CLOUDFLARE_TUNNEL_TOKEN=

LOCALDB_PASSWORD=${db}
# Host port for SQL tools (127.0.0.1 only); 5432 is taken by the local dev stack.
LOCALDB_PORT=5433
DATABASE_URL=postgresql://santha:${db}@postgres:5432/santha
JWT_ACCESS_SECRET=$(rand 32)
JWT_REFRESH_SECRET=$(rand 32)
TYPESENSE_API_KEY=$(rand 24)
S3_ACCESS_KEY=$(rand 10)
S3_SECRET_KEY=$(rand 24)

# Payments: in-app mock until you add Razorpay TEST keys (rzp_test_…). Then delete PAYMENTS_PROVIDER below
# so the test values file's razorpay_sandbox applies, and run deploy again.
PAYMENTS_PROVIDER=mock
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

MSG91_AUTH_KEY=
MSG91_TEMPLATE_ID=
FCM_SERVICE_ACCOUNT_B64=
GOOGLE_MAPS_SERVER_KEY=
POSTHOG_KEY=
EOF
  chmod 600 "$STACK/.env"
}

values() { # merged test + laptop overlay; prints one key, e.g. values .web.apiUrl
  docker run --rm -v "$REPO/config/values:/workdir/values:ro" mikefarah/yq:4 eval-all \
    '. as $i ireduce ({}; . * $i) | '"$1"' // ""' values/test.values.yaml values/laptop.test.values.yaml
}

deploy() {
  if [ ! -f "$STACK/.env" ]; then
    create_env
    echo "Created $STACK/.env with random secrets."
    echo "Next: paste your Cloudflare tunnel token into CLOUDFLARE_TUNNEL_TOKEN there (nano $STACK/.env), then run deploy again."
    exit 1
  fi
  grep -Eq '^CLOUDFLARE_TUNNEL_TOKEN=.+' "$STACK/.env" || {
    echo "CLOUDFLARE_TUNNEL_TOKEN is empty in $STACK/.env. See docs/deploy/README.md, 'Test on your own computer'." >&2; exit 1; }

  local git=(git -c safe.directory='*' -C "$REPO") tag
  tag="$("${git[@]}" rev-parse --short=12 HEAD)"
  [ -z "$("${git[@]}" status --porcelain)" ] || tag="${tag}-dirty-$(date -u +%Y%m%d%H%M%S)"

  echo "Copying the source to $BUILD …"
  mkdir -p "$BUILD"
  # Skip what .dockerignore skips anyway (dependencies, build output, the Flutter apps, local secrets).
  rsync -a --delete --delete-excluded \
    --exclude .git --exclude node_modules --exclude .next --exclude dist --exclude build --exclude .dart_tool \
    --exclude coverage --exclude graphify-out --exclude /apps/consumer --exclude /apps/merchant --exclude /apps/rider \
    --include .env.example --exclude '.env' --exclude '.env.*' --exclude '*.jks' --exclude '*.keystore' \
    "$REPO/" "$BUILD/"

  echo "Building images $REGISTRY/santha-*:$tag (the first build takes several minutes) …"
  docker build -q -f "$BUILD/apps/backend/Dockerfile" --target runtime -t "$REGISTRY/santha-backend:$tag" "$BUILD"
  docker build -q -f "$BUILD/apps/backend/Dockerfile" --target tools -t "$REGISTRY/santha-tools:$tag" "$BUILD"
  docker build -q -f "$BUILD/apps/web/Dockerfile" -t "$REGISTRY/santha-web-test:$tag" \
    --build-arg NEXT_PUBLIC_SITE_URL="$(values .web.siteUrl)" \
    --build-arg NEXT_PUBLIC_API_URL="$(values .web.apiUrl)" \
    --build-arg NEXT_PUBLIC_MEDIA_ORIGIN="$(values .web.mediaOrigin)" \
    "$BUILD"

  echo "Copying the stack to $STACK …"
  cp "$REPO"/infra/deploy/{compose.yml,compose.tunnel.yml,Caddyfile,santha.sh} "$STACK/"
  chmod +x "$STACK/santha.sh"
  rm -rf "$STACK/values" && mkdir -p "$STACK/values"
  cp "$REPO"/config/values/*.values.yaml "$STACK/values/"

  SANTHA_SKIP_PULL=1 "$STACK/santha.sh" deploy "$tag"
  # Keep the current and previous builds (for rollback); drop older local images.
  docker images --format '{{.Repository}}:{{.Tag}}' | grep "^$REGISTRY/santha-" \
    | grep -v -e ":$tag\$" -e ":$(cat "$STACK/.tag.previous" 2>/dev/null || echo none)\$" | xargs -r docker rmi >/dev/null || true
}

case "${1:-help}" in
  deploy) deploy ;;
  help|-h|--help) sed -n '2,9p' "$0" ;;
  *)
    [ -x "$STACK/santha.sh" ] || { echo "Run 'laptop.sh deploy' first." >&2; exit 1; }
    SANTHA_SKIP_PULL=1 exec "$STACK/santha.sh" "$@"
    ;;
esac
