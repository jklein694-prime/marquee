#!/usr/bin/env bash
# payload-smoke.sh — build the payload with fake artifacts and prove its
# structure: manifest verifies, every path install.sh needs exists, and the
# shell entrypoints parse.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JETSON="$(cd "$HERE/.." && pwd)"
OUT="$(mktemp -d)/payload"
trap 'rm -rf "$(dirname "$OUT")"' EXIT

echo "==> building fake payload in $OUT"
bash "$JETSON/build-payload.sh" --fake-artifacts --out "$OUT" >/dev/null

echo "==> verifying manifest"
( cd "$OUT" && sha256sum --quiet -c MANIFEST.sha256 )

echo "==> checking expected paths"
# shellcheck source=../PINS.env
source "$JETSON/PINS.env"
for path in \
  install.sh preflight.sh uninstall.sh setup-wizard.sh wikigardener PINS.env \
  config/gardener.conf \
  systemd/llama-server.service systemd/gardener.service systemd/gardener.timer \
  gardener/__main__.py gardener/daemon.py gardener/patch.py \
  gardener/profile.py gardener/prompts/system.txt \
  gardener/models.py gardener/sync.py gardener/webui.py gardener/net.py \
  gardener/jobs.py gardener/lock.py gardener/notify.py gardener/suggest.py \
  gardener/prompts/suggest.txt app/install-app.sh \
  models.catalog \
  systemd/wikigardener-web.service systemd/wikigardener-sync.service \
  systemd/wikigardener-sync.timer systemd/wikigardener-suggest.service \
  systemd/wikigardener-suggest.timer systemd/wikigardener-notify.service \
  systemd/wikigardener-notify.timer \
  profiles/marquee-movies.conf profiles/generic.conf \
  audit/audit.sh audit/audit.py audit/audit-system.txt \
  "models/$MODEL_1_5B_FILE" "models/$MODEL_0_5B_FILE" \
  "src/llama.cpp-${LLAMACPP_TAG}.tar.gz" \
  vault-seed/wiki/entities/Movies.md vault-seed/scripts/allocate-address.sh
do
  [ -e "$OUT/$path" ] || { echo "MISSING: $path" >&2; exit 1; }
done

echo "==> entrypoints parse"
bash -n "$OUT/install.sh" "$OUT/preflight.sh" "$OUT/uninstall.sh" "$OUT/audit/audit.sh"

echo "==> preflight refuses on non-Jetson (expected failure path)"
if [ "$(uname -m)" != "aarch64" ]; then
  if (cd "$OUT" && bash preflight.sh >/dev/null 2>&1); then
    echo "ERR: preflight should refuse on $(uname -m)" >&2; exit 1
  fi
  echo "    refused correctly"
fi

echo "payload smoke: OK"
