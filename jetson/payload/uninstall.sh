#!/usr/bin/env bash
# uninstall.sh — remove services and code. The vault (your wiki + its full
# git history) is kept unless you pass --purge-vault.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash uninstall.sh" >&2; exit 1; }

for unit in gardener.timer gardener.service llama-server.service \
            wikigardener-web.service wikigardener-sync.timer \
            wikigardener-sync.service; do
  systemctl disable --now "$unit" 2>/dev/null || true
  rm -f "/etc/systemd/system/$unit"
done
systemctl daemon-reload

rm -rf /opt/wikigardener
rm -rf /etc/wikigardener
rm -rf /var/lib/wikigardener/queue /var/lib/wikigardener/state.json \
       /var/lib/wikigardener/build.log /var/lib/wikigardener/jobs \
       /var/lib/wikigardener/vault.lock

if [ "${1:-}" = "--purge-vault" ]; then
  rm -rf /var/lib/wikigardener
  echo "removed everything including the vault"
else
  echo "removed services and code; vault kept at /var/lib/wikigardener/vault"
fi
