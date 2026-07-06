#!/usr/bin/env bash
# build-payload.sh — run on an ONLINE machine to assemble the USB payload.
#
#   ./jetson/build-payload.sh --vault /path/to/your/obsidian/vault
#   cp -r wikigardener-payload /media/you/USBSTICK/
#
# Downloads the pinned models + llama.cpp source, verifies sha256s from
# PINS.env (trust-on-first-use: TBD pins are filled in and written back on
# the first run — commit the updated PINS.env), copies the installer tree
# and your vault snapshot, and writes MANIFEST.sha256 for the Nano-side
# integrity check.
#
#   --out DIR          output directory (default ./wikigardener-payload)
#   --vault PATH       vault snapshot to seed (default vault-template/)
#   --fake-artifacts   CI: tiny placeholders instead of real downloads
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PINS="$HERE/PINS.env"
# shellcheck source=PINS.env
source "$PINS"

OUT="./wikigardener-payload"
VAULT="$REPO/vault-template"
FAKE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --vault) VAULT="$2"; shift 2 ;;
    --fake-artifacts) FAKE=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

say() { echo "==> $*"; }
sha() { sha256sum "$1" | awk '{print $1}'; }

# fetch <url> <dest> <pin-var-name>
# verifies against the pinned sha256; a TBD pin is computed and written back
fetch() {
  local url="$1" dest="$2" pin_var="$3" pinned actual
  pinned="${!pin_var}"
  if [ ! -f "$dest" ]; then
    say "downloading $(basename "$dest")"
    curl -fL --retry 3 -o "$dest.part" "$url"
    mv "$dest.part" "$dest"
  else
    say "already have $(basename "$dest")"
  fi
  actual="$(sha "$dest")"
  if [ "$pinned" = "TBD" ]; then
    say "PIN FILLED (trust-on-first-use): $pin_var=$actual"
    sed -i.bak "s|^${pin_var}=\"TBD\"|${pin_var}=\"${actual}\"|" "$PINS"
    rm -f "$PINS.bak"
  elif [ "$pinned" != "$actual" ]; then
    echo "FATAL: sha256 mismatch for $dest" >&2
    echo "  pinned: $pinned" >&2
    echo "  actual: $actual" >&2
    echo "artifact changed upstream — investigate before trusting it" >&2
    exit 1
  else
    say "sha256 OK: $(basename "$dest")"
  fi
}

say "assembling payload in $OUT"
mkdir -p "$OUT/models" "$OUT/src"

# --- artifacts ------------------------------------------------------------------
if [ "$FAKE" = 1 ]; then
  say "--fake-artifacts: writing placeholders"
  echo "fake gguf 1.5b" > "$OUT/models/$MODEL_1_5B_FILE"
  echo "fake gguf 0.5b" > "$OUT/models/$MODEL_0_5B_FILE"
  tar -czf "$OUT/src/llama.cpp-${LLAMACPP_TAG}.tar.gz" -C "$HERE" PINS.env
else
  fetch "$MODEL_1_5B_URL" "$OUT/models/$MODEL_1_5B_FILE" MODEL_1_5B_SHA256
  fetch "$MODEL_0_5B_URL" "$OUT/models/$MODEL_0_5B_FILE" MODEL_0_5B_SHA256
  fetch "$LLAMACPP_URL" "$OUT/src/llama.cpp-${LLAMACPP_TAG}.tar.gz" LLAMACPP_SHA256
fi

# --- installer tree -------------------------------------------------------------
say "copying installer + gardener"
rsync -a --delete \
  --exclude '__pycache__' --exclude '*.pyc' \
  "$HERE/payload/" "$OUT/" \
  --exclude models --exclude src --exclude vault-seed
cp "$PINS" "$OUT/PINS.env"

# --- vault seed ------------------------------------------------------------------
say "seeding vault snapshot from: $VAULT"
[ -d "$VAULT" ] || { echo "FATAL: vault not found: $VAULT" >&2; exit 1; }
rsync -a --delete --exclude .git --exclude .obsidian "$VAULT/" "$OUT/vault-seed/"

# --- manifest --------------------------------------------------------------------
say "writing MANIFEST.sha256"
( cd "$OUT"
  rm -f MANIFEST.sha256
  find . -type f -print0 | sort -z \
    | xargs -0 sha256sum > /tmp/wikigardener-manifest.$$
  mv /tmp/wikigardener-manifest.$$ MANIFEST.sha256
)

say "payload ready:"
du -sh "$OUT"
du -sh "$OUT"/models/* "$OUT"/src/* 2>/dev/null || true
cat <<EOF

Next steps:
  1. If PINS.env gained new hashes above, commit it.
  2. Copy the payload to a USB stick (or straight onto the Nano's storage):
       cp -r "$OUT" /media/<you>/<USB>/
  3. On the Nano:  sudo bash /media/<usb>/wikigardener-payload/install.sh
EOF
