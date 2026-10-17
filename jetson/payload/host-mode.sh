#!/usr/bin/env bash
# host-mode.sh — turn the Nano into a pure Marquee host. Run by
# `wikigardener update` on every update (idempotent), or by hand:
#
#   sudo bash /opt/wikigardener/host-mode.sh
#
#   1. retire the on-device AI: llama-server, the gardener timer, the daily
#      suggest + notify timers and the gardener dashboard are stopped,
#      disabled and their units removed; the llama.cpp binaries and GGUF
#      models are deleted (~1-2 GB back). Claude does all the AI now.
#      KEPT: the vault, its hourly git sync, `wikigardener net|sync|update`.
#      Opt out with KEEP_LOCAL_AI=1 in /etc/wikigardener/gardener.conf.
#   2. HTTPS through Tailscale (`tailscale serve`), which iOS requires for an
#      installable home-screen app and push notifications. Needs MagicDNS +
#      HTTPS certificates enabled for the tailnet (admin console -> DNS).
set -euo pipefail

OPT="${WG_OPT:-/opt/wikigardener}"
ETC="${WG_ETC:-/etc/wikigardener}"
UNITS_DIR="${WG_UNITS_DIR:-/etc/systemd/system}"
APP_PORT="${APP_PORT:-3000}"

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash host-mode.sh" >&2; exit 1; }
conf_get() { sed -n "s/^$1=//p" "$ETC/gardener.conf" 2>/dev/null | head -1; }

# --- 1. retire the local AI ----------------------------------------------------------
if [ "$(conf_get KEEP_LOCAL_AI)" = 1 ]; then
  echo "== KEEP_LOCAL_AI=1 — leaving the on-device gardener in place"
else
  RETIRED=0
  for unit in gardener.timer gardener.service llama-server.service \
              wikigardener-suggest.timer wikigardener-suggest.service \
              wikigardener-notify.timer wikigardener-notify.service \
              wikigardener-web.service; do
    if [ -e "$UNITS_DIR/$unit" ]; then
      [ "$RETIRED" = 1 ] || echo "== retiring the on-device AI (Claude does the AI now)"
      RETIRED=1
      systemctl disable --now "$unit" >/dev/null 2>&1 || true
      rm -f "$UNITS_DIR/$unit"
      echo "   removed $unit"
    fi
  done
  if [ "$RETIRED" = 1 ]; then
    systemctl daemon-reload || true
  fi
  freed=0
  for f in "$OPT"/bin/llama-server "$OPT"/bin/llama-server-cpu "$OPT"/bin/llama-server-cuda "$OPT"/models/*.gguf; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    rm -f "$f"
    freed=1
  done
  [ "$freed" = 1 ] && echo "   deleted llama.cpp binaries and GGUF models"
  [ -d "$OPT/src" ] && { rm -rf "$OPT/src"; echo "   deleted llama.cpp sources"; }
  [ "$RETIRED" = 1 ] || [ "$freed" = 1 ] || echo "== on-device AI already retired"
fi

# --- 2. HTTPS via tailscale serve -------------------------------------------------------
if ! command -v tailscale >/dev/null 2>&1; then
  echo "== HTTPS: tailscale not installed — the app stays at http://<nano-ip>:$APP_PORT"
  echo "   (the home-screen app and push notifications need HTTPS; see jetson/README.md)"
  exit 0
fi
if ! tailscale status >/dev/null 2>&1; then
  echo "== HTTPS: tailscale is not logged in / running — skipping (run: sudo tailscale up)"
  exit 0
fi
TS_NAME="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
if tailscale serve status 2>/dev/null | grep -q "127.0.0.1:$APP_PORT\|localhost:$APP_PORT"; then
  echo "== HTTPS already on: https://${TS_NAME:-<nano>.<tailnet>.ts.net}"
  exit 0
fi
echo "== HTTPS: publishing the app on your tailnet with tailscale serve"
# the CLI syntax changed across Tailscale versions — try new, then old
if tailscale serve --bg --https=443 "http://127.0.0.1:$APP_PORT" >/dev/null 2>&1 \
   || tailscale serve --bg "$APP_PORT" >/dev/null 2>&1 \
   || tailscale serve https / "http://127.0.0.1:$APP_PORT" >/dev/null 2>&1; then
  echo "   open on your iPhone: https://${TS_NAME:-<nano>.<tailnet>.ts.net}"
  echo "   then Share -> Add to Home Screen"
else
  echo "   could not enable it. In the Tailscale admin console turn on MagicDNS and"
  echo "   HTTPS Certificates (DNS page), then run: sudo bash $OPT/host-mode.sh"
fi
