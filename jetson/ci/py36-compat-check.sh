#!/usr/bin/env bash
# py36-compat-check.sh — prove the gardener runs on the Nano's Python 3.6.9.
#
# Two layers:
#   1. static: grep the gardener + audit sources for 3.7+-only constructs that
#      slip in easily (runs anywhere, no docker needed)
#   2. dynamic: run the full test suite inside a python:3.6 container
#      (needs docker + network; skipped with a warning if docker can't pull)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JETSON="$(cd "$HERE/.." && pwd)"
SRC=("$JETSON/payload/gardener" "$JETSON/payload/audit")

echo "==> static 3.6-compat scan"
fail=0
# each pattern is a 3.7+ (or otherwise unavailable-on-3.6.9) construct
declare -A PATTERNS=(
  [':=']='walrus operator (3.8)'
  ['from dataclasses']='dataclasses (3.7)'
  ['capture_output']='subprocess capture_output (3.7)'
  ['text=True']='subprocess text= kwarg (3.7; use universal_newlines=True)'
  ['from __future__ import annotations']='postponed annotations (3.7)'
  ['importlib.resources']='importlib.resources (3.7)'
  ['time.monotonic_ns']='monotonic_ns (3.7)'
  ['fromisoformat']='datetime.fromisoformat (3.7)'
)
for pat in "${!PATTERNS[@]}"; do
  if grep -rn --include='*.py' -e "$pat" "${SRC[@]}" 2>/dev/null; then
    echo "ERR: ${PATTERNS[$pat]}" >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] && echo "static scan: OK"

echo "==> dynamic: pytest under python:3.6"
if ! command -v docker >/dev/null; then
  echo "WARN: docker unavailable — skipped dynamic 3.6 run" >&2
  exit "$fail"
fi
if ! docker image inspect python:3.6-slim >/dev/null 2>&1 && \
   ! docker pull python:3.6-slim >/dev/null 2>&1; then
  echo "WARN: cannot pull python:3.6-slim — skipped dynamic 3.6 run" >&2
  exit "$fail"
fi
docker run --rm -v "$JETSON/..:/repo:ro" -w /tmp python:3.6-slim bash -euo pipefail -c "
  apt-get update -qq && apt-get install -qq -y git >/dev/null
  cp -r /repo/jetson /tmp/jetson && cp -r /repo/vault-template /tmp/vault-template
  pip install -q pytest
  git config --global user.email ci@test && git config --global user.name ci
  cd /tmp && python -m pytest jetson/tests -q
"
echo "==> python 3.6 dynamic run: OK"
exit "$fail"
