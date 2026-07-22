#!/usr/bin/env bash
# audit.sh — the occasional ONLINE window. Run this only after you have
# deliberately connected the Nano to WiFi:
#
#   sudo bash /opt/wikigardener/audit/audit.sh
#
# It asks Claude Sonnet to review everything the gardener did since the last
# audit, writes the review into wiki/audits/, queues the corrections for the
# offline gardener, then reminds you to disconnect.
set -euo pipefail

OPT=/opt/wikigardener
KEY_FILE=/etc/wikigardener/anthropic.key

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash audit.sh" >&2; exit 1; }

# --- key -----------------------------------------------------------------------
if [ ! -f "$KEY_FILE" ]; then
  cat >&2 <<EOF
No API key at $KEY_FILE.
One-time setup:
  echo 'sk-ant-...' | sudo tee $KEY_FILE >/dev/null
  sudo chmod 600 $KEY_FILE
EOF
  exit 1
fi
chmod 600 "$KEY_FILE"

# --- connectivity ---------------------------------------------------------------
echo "== checking connectivity to api.anthropic.com"
if ! curl -sI --max-time 15 https://api.anthropic.com >/dev/null; then
  echo "FATAL: cannot reach api.anthropic.com — connect WiFi first" >&2
  exit 1
fi

# --- freeze state so the audit sees a clean tree ----------------------------------
VAULT="$(sed -n 's/^VAULT_DIR=//p' /etc/wikigardener/gardener.conf | head -1)"
VAULT="${VAULT:-/var/lib/wikigardener/vault}"
if [ -n "$(git -C "$VAULT" status --porcelain)" ]; then
  git -C "$VAULT" add -A
  git -C "$VAULT" commit -q -m "audit: freeze dirty state before review"
fi

# --- run ------------------------------------------------------------------------
PYTHONPATH="$OPT" python3 "$OPT/audit/audit.py" --key-file "$KEY_FILE"

cat <<'EOF'

== audit complete ==
The review is in wiki/audits/, corrections are queued at top priority.

>>> DISCONNECT WIFI NOW to restore the air gap. <<<
EOF
if command -v nmcli >/dev/null; then
  read -r -p "Turn WiFi off now with nmcli? [y/N] " yn
  case "$yn" in
    [Yy]*) nmcli radio wifi off && echo "WiFi off — air gap restored." ;;
    *) echo "Leaving WiFi as-is; remember to disconnect." ;;
  esac
fi
