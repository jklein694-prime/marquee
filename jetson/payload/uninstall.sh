#!/usr/bin/env bash
# uninstall.sh — remove services and code. The vault (your wiki + its full
# git history) is kept unless you pass --purge-vault.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash uninstall.sh" >&2; exit 1; }

systemctl disable --now gardener.timer 2>/dev/null || true
systemctl disable --now gardener.service 2>/dev/null || true
systemctl disable --now llama-server.service 2>/dev/null || true
rm -f /etc/systemd/system/gardener.timer \
      /etc/systemd/system/gardener.service \
      /etc/systemd/system/llama-server.service
systemctl daemon-reload

rm -rf /opt/wikigardener
rm -rf /etc/wikigardener
rm -rf /var/lib/wikigardener/queue /var/lib/wikigardener/state.json \
       /var/lib/wikigardener/build.log

if [ "${1:-}" = "--purge-vault" ]; then
  rm -rf /var/lib/wikigardener
  echo "removed everything including the vault"
else
  echo "removed services and code; vault kept at /var/lib/wikigardener/vault"
fi
