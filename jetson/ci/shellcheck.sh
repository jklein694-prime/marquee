#!/usr/bin/env bash
# Lint every shell script in the jetson tree.
# SC1091 (can't follow sourced file) is expected for PINS.env, which sits
# next to install.sh only after build-payload.sh assembles the payload.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JETSON="$(cd "$HERE/.." && pwd)"

command -v shellcheck >/dev/null || { echo "ERR: shellcheck required" >&2; exit 1; }

shellcheck -x -e SC1091 \
  "$JETSON"/build-payload.sh \
  "$JETSON"/payload/install.sh \
  "$JETSON"/payload/preflight.sh \
  "$JETSON"/payload/uninstall.sh \
  "$JETSON"/payload/setup-wizard.sh \
  "$JETSON"/payload/wikigardener \
  "$JETSON"/payload/audit/audit.sh \
  "$JETSON"/laptop/*.sh \
  "$JETSON"/ci/*.sh

echo "shellcheck: OK"
