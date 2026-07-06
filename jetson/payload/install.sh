#!/usr/bin/env bash
# install.sh — one command on the Nano, fully offline:
#
#   sudo bash install.sh
#
# Steps: preflight -> build llama.cpp on-device (CPU mandatory, CUDA
# best-effort) -> install models/code/config -> seed the vault as a git repo
# -> systemd services -> self-test. Idempotent: safe to re-run; the vault is
# never overwritten once it exists.
set -euo pipefail

PAYLOAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPT=/opt/wikigardener
ETC=/etc/wikigardener
VAR=/var/lib/wikigardener
BUILD_LOG="$VAR/build.log"

[ "$(id -u)" = 0 ] || { echo "run as root: sudo bash install.sh" >&2; exit 1; }

echo "== wikigardener install =="
# shellcheck source=preflight.sh
source "$PAYLOAD_DIR/preflight.sh"

# shellcheck source=../PINS.env
source "$PAYLOAD_DIR/PINS.env"

mkdir -p "$OPT/bin" "$OPT/models" "$OPT/src" "$ETC" "$VAR"

# --- 1. build llama.cpp on-device ------------------------------------------------
SRC_TARBALL="$PAYLOAD_DIR/src/llama.cpp-${LLAMACPP_TAG}.tar.gz"
SRC_DIR="$OPT/src/llama.cpp-${LLAMACPP_TAG}"
CPU_BIN="$OPT/bin/llama-server-cpu"
CUDA_BIN="$OPT/bin/llama-server-cuda"

if [ ! -x "$CPU_BIN" ]; then
  echo "== extracting llama.cpp ${LLAMACPP_TAG}"
  rm -rf "$SRC_DIR"; mkdir -p "$SRC_DIR"
  tar -xzf "$SRC_TARBALL" -C "$SRC_DIR" --strip-components=1

  echo "== CPU build (mandatory; ~20-40 min on the Nano, one-time)"
  if ! make -C "$SRC_DIR" -j"$(nproc)" server >"$BUILD_LOG" 2>&1; then
    echo "FATAL: CPU build failed — log: $BUILD_LOG" >&2
    tail -30 "$BUILD_LOG" >&2
    exit 1
  fi
  install -m 755 "$SRC_DIR/server" "$CPU_BIN"
  echo "   CPU build OK -> $CPU_BIN"
else
  echo "== CPU binary already present, skipping build"
fi

LLAMA_VARIANT=cpu
LLAMA_EXTRA_ARGS=""
if [ "${CUDA_PRESENT:-0}" = 1 ] && [ ! -x "$CUDA_BIN" ]; then
  echo "== CUDA build (best-effort; failure is fine, CPU remains)"
  export PATH="/usr/local/cuda-10.2/bin:$PATH"
  if timeout 3600 env LLAMA_CUBLAS=1 CUDA_DOCKER_ARCH=sm_53 \
       make -C "$SRC_DIR" -j2 clean server >>"$BUILD_LOG" 2>&1; then
    install -m 755 "$SRC_DIR/server" "$CUDA_BIN"
    echo "   CUDA build OK -> $CUDA_BIN"
  else
    echo "   CUDA build failed (expected on many setups) — using CPU. Log: $BUILD_LOG"
  fi
fi
if [ -x "$CUDA_BIN" ]; then
  LLAMA_VARIANT=cuda
  LLAMA_EXTRA_ARGS="-ngl 99"
fi

# --- 2. models / code / config ---------------------------------------------------
echo "== installing models and gardener"
for f in "$PAYLOAD_DIR"/models/*.gguf; do
  [ -e "$f" ] || continue
  cp -n "$f" "$OPT/models/"
done
[ -f "$OPT/models/$MODEL_FILE" ] || { echo "FATAL: $MODEL_FILE missing" >&2; exit 1; }

rsync -a --delete "$PAYLOAD_DIR/gardener/" "$OPT/gardener/"
rsync -a "$PAYLOAD_DIR/audit/" "$OPT/audit/"
cp -n "$PAYLOAD_DIR/config/gardener.conf" "$ETC/gardener.conf"

# tier-dependent memory ceiling for the model server
if [ "$TIER" = "1.5b" ]; then MEMORY_MAX=2600M; else MEMORY_MAX=1200M; fi
cat > "$ETC/runtime.env" <<EOF
MODEL_FILE=$MODEL_FILE
CTX=$(sed -n 's/^CTX=//p' "$ETC/gardener.conf" | head -1)
LLAMA_VARIANT=$LLAMA_VARIANT
LLAMA_EXTRA_ARGS=$LLAMA_EXTRA_ARGS
MEMORY_MAX=$MEMORY_MAX
EOF
echo "   tier=$TIER variant=$LLAMA_VARIANT"

# --- 3. vault --------------------------------------------------------------------
if [ ! -d "$VAR/vault/wiki" ]; then
  echo "== seeding vault from payload snapshot"
  mkdir -p "$VAR/vault"
  rsync -a --exclude .git "$PAYLOAD_DIR/vault-seed/" "$VAR/vault/"
  mkdir -p "$VAR/vault/.vault-meta"
  [ -f "$VAR/vault/.vault-meta/address-counter.txt" ] \
    || echo 0 > "$VAR/vault/.vault-meta/address-counter.txt"
  mkdir -p "$VAR/vault/wiki/audits"
  ( cd "$VAR/vault"
    git init -q
    git config user.name "wiki-gardener"
    git config user.email "gardener@localhost"
    git add -A
    git commit -q -m "install: seed vault"
    git tag install
  )
else
  echo "== vault already present — leaving it untouched"
fi

# --- 4. systemd ------------------------------------------------------------------
echo "== installing services"
INTERVAL_MIN="$(sed -n 's/^INTERVAL_MIN=//p' "$ETC/gardener.conf" | head -1)"
cp "$PAYLOAD_DIR/systemd/llama-server.service" /etc/systemd/system/
cp "$PAYLOAD_DIR/systemd/gardener.service" /etc/systemd/system/
sed "s/__INTERVAL_MIN__/${INTERVAL_MIN:-15}/" \
  "$PAYLOAD_DIR/systemd/gardener.timer" > /etc/systemd/system/gardener.timer
systemctl daemon-reload
systemctl enable --now llama-server.service
systemctl enable gardener.timer

# --- 5. self-test ----------------------------------------------------------------
echo "== self-test"
echo "   waiting for llama-server (model load from SD can take minutes)..."
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1 && break
  sleep 5
done
curl -sf http://127.0.0.1:8080/health >/dev/null \
  || { echo "FATAL: llama-server never became healthy — journalctl -u llama-server" >&2; exit 1; }

echo "   one test completion (times the model)..."
START=$(date +%s)
REPLY="$(curl -sf http://127.0.0.1:8080/completion \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"<|im_start|>user\nReply with exactly: OK<|im_end|>\n<|im_start|>assistant\n","n_predict":8,"temperature":0}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("content","").strip())')"
ELAPSED=$(( $(date +%s) - START ))
echo "   model replied: '$REPLY' in ${ELAPSED}s"

echo "   lint + dry-run cycle..."
PYTHONPATH="$OPT" python3 -m gardener lint || true
PYTHONPATH="$OPT" python3 -m gardener run-once --dry-run

systemctl start gardener.timer

cat <<EOF

== wikigardener installed ==
  tier:     $TIER ($MODEL_FILE)
  engine:   llama.cpp ${LLAMACPP_TAG} [$LLAMA_VARIANT]
  vault:    $VAR/vault   (git repo; every change is a commit)
  services: llama-server.service (running), gardener.timer (every ${INTERVAL_MIN:-15}min)

  watch it work:   journalctl -fu gardener
  status:          PYTHONPATH=$OPT python3 -m gardener status
  audit window:    sudo bash $OPT/audit/audit.sh   (only when you connect WiFi)
EOF
