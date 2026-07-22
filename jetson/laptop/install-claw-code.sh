#!/usr/bin/env bash
# install-claw-code.sh — runs on YOUR LAPTOP, not the Nano.
#
# Installs Claw Code (an open-source, Claude Code-compatible agentic CLI) on
# your machine so you can drive the Nano's vault over SSH and, optionally, use
# the Nano's offline llama-server as a local model provider. This is the
# laptop side of "connect with claude code" — the Nano's Ubuntu 18.04 / glibc
# 2.27 is too old to run these tools on-device, so they live here.
#
# Idempotent. Pins a known version; override with CLAW_VERSION=...
set -euo pipefail

CLAW_VERSION="${CLAW_VERSION:-latest}"

echo "== installing Claw Code on this laptop =="

if command -v claw >/dev/null 2>&1; then
  echo "  claw already installed: $(claw --version 2>/dev/null || echo present)"
else
  # Claw Code ships an install script and npm/pipx packages; prefer whatever the
  # laptop already has. Try, in order: pipx (Python+Rust wheels), npm, curl|sh.
  if command -v pipx >/dev/null 2>&1; then
    echo "  installing via pipx"
    if [ "$CLAW_VERSION" = latest ]; then pipx install claw-code; else pipx install "claw-code==$CLAW_VERSION"; fi
  elif command -v npm >/dev/null 2>&1; then
    echo "  installing via npm"
    npm install -g "claw-code${CLAW_VERSION:+@}${CLAW_VERSION#latest}"
  else
    cat >&2 <<'EOF'
  Neither pipx nor npm found. Install one, then re-run — for example:
    python3 -m pip install --user pipx && pipx ensurepath
  Or follow the official installer at https://claw-code.codes/ .
EOF
    exit 1
  fi
fi

cat <<'EOF'

== next ==
  1. Provider setup:
     - Anthropic (cloud):  export ANTHROPIC_API_KEY=sk-ant-...
     - Nano's local model: run  ./connect.sh  then point Claw Code at
       http://localhost:8080 (OpenAI-compatible) through the SSH tunnel.
  2. Drive the Nano's vault:  ssh wikigardener   then run  claw  in the vault,
     or run claw locally against a synced clone of the vault.
EOF
