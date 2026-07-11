#!/usr/bin/env bash
# connect.sh — runs on YOUR LAPTOP. Sets up an SSH alias to the Nano and an
# optional tunnel so Claude Code / Claw Code on your laptop can use the Nano's
# offline llama-server as a local model provider — WITHOUT exposing it off
# localhost on the device (the tunnel is the only path in).
#
#   ./connect.sh <nano-ip> [ssh-user]
set -euo pipefail

NANO_IP="${1:-}"
SSH_USER="${2:-gardener}"
[ -n "$NANO_IP" ] || { echo "usage: ./connect.sh <nano-ip> [ssh-user]" >&2; exit 1; }

SSH_CONFIG="$HOME/.ssh/config"
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"

if ! grep -q "^Host wikigardener$" "$SSH_CONFIG" 2>/dev/null; then
  cat >> "$SSH_CONFIG" <<EOF

Host wikigardener
    HostName $NANO_IP
    User $SSH_USER
    # tunnel the Nano's localhost-only llama-server to your laptop's :8080
    LocalForward 8080 127.0.0.1:8080
EOF
  echo "added 'wikigardener' to $SSH_CONFIG"
else
  echo "'wikigardener' host already in $SSH_CONFIG — edit it there if the IP changed"
fi

cat <<'EOF'

== how to use ==
  Open the tunnel (keeps the local model reachable at http://localhost:8080):
    ssh wikigardener            # LocalForward brings up :8080 automatically

  Point an agent at the Nano's OFFLINE model (OpenAI-compatible endpoint):
    export OPENAI_BASE_URL=http://localhost:8080/v1
    export OPENAI_API_KEY=local            # llama.cpp ignores the key
    claw --model local                     # or configure a 'local' provider

  Or drive the vault directly on the device:
    ssh wikigardener
    cd /var/lib/wikigardener/vault && claw     # (or claude, if installed there)

  The dashboard stays at  http://<nano-ip>:8088 .
  llama-server remains bound to 127.0.0.1 on the Nano — this SSH tunnel is the
  only way to reach it, so the air gap is preserved when WiFi is off.
EOF
