#!/usr/bin/env bash
# install-app.sh — host the Marquee web app (graph view, wiki browser, chat)
# ON the Nano at http://<nano-ip>:3000, reading the SAME vault the gardener
# tends. Run on the Nano during an ONLINE window:
#
#   sudo bash /opt/wikigardener/app/install-app.sh https://github.com/<you>/marquee.git
#
# HOW: the app is Next.js 16 / Node 20, which cannot run on JetPack 4.6's old
# glibc — so it runs inside a Docker container (containers bring their own
# libc). JetPack ships Docker.
#
# HONEST CAVEATS (hardware-verify):
#   - Node-20 container on JetPack 4.6's 4.9 kernel is believed-working but
#     unverified here. If the container won't start, use the fallback below.
#   - RAM is tight: llama-server holds ~1.5-2.6GB of the 4GB. The app service
#     is capped at 700MB and llama-server may need the 0.5b model tier when
#     both run. On a 2GB Nano, don't run both.
#   - The chat panel calls the Claude API — it works during online windows
#     (key from /etc/wikigardener/anthropic.key); graph/wiki browsing is
#     fully offline.
# FALLBACK: run the app on your laptop against a synced clone of the vault
#   (git sync keeps it fresh):  VAULT_PATH=~/vault npm run dev
set -euo pipefail

REPO_URL="${1:-}"
APP_DIR=/opt/wikigardener/app-src
VAULT=/var/lib/wikigardener/vault
KEY_FILE=/etc/wikigardener/anthropic.key
IMAGE=node:20-bookworm-slim

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash install-app.sh <repo-url>" >&2; exit 1; }
[ -n "$REPO_URL" ] || [ -d "$APP_DIR" ] || {
  echo "usage: install-app.sh <git-url-of-your-marquee-repo>" >&2; exit 2; }

if ! command -v docker >/dev/null; then
  cat >&2 <<'EOF'
Docker not found. One-time online fix:
  sudo apt update && sudo apt install -y docker.io
  sudo systemctl enable --now docker
then re-run this script.
EOF
  exit 1
fi

echo "== fetching the app"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only || echo "   (pull failed — building what's here)"
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

echo "== pulling $IMAGE (arm64)"
docker pull "$IMAGE"

echo "== npm ci + next build inside the container (slow on the Nano; one-time per update)"
# the build is the RAM-hungriest moment this device ever sees — pause the
# resident model server so the 4GB (plus swap) belongs to the compiler
LLAMA_WAS_ACTIVE=0
if systemctl is-active --quiet llama-server; then
  LLAMA_WAS_ACTIVE=1
  echo "   pausing llama-server for the build (restarted after)"
  systemctl stop llama-server
fi
BUILD_RC=0
docker run --rm -v "$APP_DIR":/app -w /app \
  -e NODE_OPTIONS=--max-old-space-size=2048 "$IMAGE" \
  sh -c "npm ci --no-audit --no-fund && npm run build" || BUILD_RC=$?
if [ "$LLAMA_WAS_ACTIVE" = 1 ]; then
  systemctl start llama-server
fi
if [ "$BUILD_RC" != 0 ]; then
  echo "FATAL: app build failed (rc=$BUILD_RC). The gardener is unaffected." >&2
  echo "Fallback: run the app on your laptop against the git-synced vault." >&2
  exit "$BUILD_RC"
fi

echo "== installing wikigardener-app.service"
API_KEY=""
[ -f "$KEY_FILE" ] && API_KEY="$(cat "$KEY_FILE")"
cat > /etc/systemd/system/wikigardener-app.service <<EOF
[Unit]
Description=Marquee wiki app (Dockerized Next.js) on :3000
After=docker.service
Requires=docker.service

[Service]
ExecStartPre=-/usr/bin/docker rm -f wikigardener-app
ExecStart=/usr/bin/docker run --name wikigardener-app --rm \\
  -p 3000:3000 -m 700m \\
  -v $APP_DIR:/app -w /app \\
  -v $VAULT:/vault:ro \\
  -e VAULT_PATH=/vault \\
  -e ANTHROPIC_API_KEY=$API_KEY \\
  $IMAGE npm start
ExecStop=/usr/bin/docker stop wikigardener-app
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now wikigardener-app.service

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

== app installed ==
  open:      http://${IP:-<nano-ip>}:3000     (graph view + wiki + chat)
  status:    systemctl status wikigardener-app
  update:    re-run this script during an online window (pulls + rebuilds)
  NOTE: the vault is mounted read-only into the app; the gardener stays the
  single writer. Chat needs an online window; browsing works offline.
EOF
