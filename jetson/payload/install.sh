#!/usr/bin/env bash
# install.sh — one command on the Nano, fully offline:
#
#   sudo bash install.sh [--profile <name|path>]
#
# Steps: preflight -> build llama.cpp on-device (CPU mandatory, CUDA
# best-effort) -> install models/code/config -> seed the vault as a git repo
# -> systemd services -> self-test. Idempotent: safe to re-run; the vault is
# never overwritten once it exists.
#
# --profile picks the vault profile (a name from profiles/, or a path to a
# gardener-vault.conf). Default: auto-detect — a seed containing
# wiki/entities/Movies.md gets the marquee-movies profile, anything else the
# generic one. A profile already present in the seed always wins.
set -euo pipefail

PAYLOAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPT=/opt/wikigardener
ETC=/etc/wikigardener
VAR=/var/lib/wikigardener
BUILD_LOG="$VAR/build.log"

PROFILE_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE_ARG="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

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

  # GCC 7 (JetPack 4.6's compiler) lacks the NEON x2/x4 load intrinsics that
  # llama.cpp's aarch64 path uses (vld1q_u8_x2, vld1q_s8_x4, ...). GCC 8.x on
  # some Jetsons too. Inject equivalent two/four-load shims, guarded so newer
  # compilers are untouched. Confirmed needed on real Nano hardware.
  echo "== injecting GCC-7 NEON compatibility shims"
  cat > "$SRC_DIR/wg-neon-compat.h" <<'EOF'
#pragma once
/* wg_gcc7_compat: NEON x2/x4 load intrinsics missing before GCC 9 */
#if defined(__aarch64__) && defined(__GNUC__) && !defined(__clang__) && __GNUC__ < 9
#include <arm_neon.h>
static inline uint8x16x2_t wg_vld1q_u8_x2(const uint8_t *p){uint8x16x2_t r;r.val[0]=vld1q_u8(p);r.val[1]=vld1q_u8(p+16);return r;}
static inline uint8x16x4_t wg_vld1q_u8_x4(const uint8_t *p){uint8x16x4_t r;r.val[0]=vld1q_u8(p);r.val[1]=vld1q_u8(p+16);r.val[2]=vld1q_u8(p+32);r.val[3]=vld1q_u8(p+48);return r;}
static inline int8x16x2_t wg_vld1q_s8_x2(const int8_t *p){int8x16x2_t r;r.val[0]=vld1q_s8(p);r.val[1]=vld1q_s8(p+16);return r;}
static inline int8x16x4_t wg_vld1q_s8_x4(const int8_t *p){int8x16x4_t r;r.val[0]=vld1q_s8(p);r.val[1]=vld1q_s8(p+16);r.val[2]=vld1q_s8(p+32);r.val[3]=vld1q_s8(p+48);return r;}
static inline int16x8x2_t wg_vld1q_s16_x2(const int16_t *p){int16x8x2_t r;r.val[0]=vld1q_s16(p);r.val[1]=vld1q_s16(p+8);return r;}
#define vld1q_u8_x2 wg_vld1q_u8_x2
#define vld1q_u8_x4 wg_vld1q_u8_x4
#define vld1q_s8_x2 wg_vld1q_s8_x2
#define vld1q_s8_x4 wg_vld1q_s8_x4
#define vld1q_s16_x2 wg_vld1q_s16_x2
#endif
EOF
  for src in ggml-quants.c ggml.c ggml-alloc.c; do
    if [ -f "$SRC_DIR/$src" ] && ! grep -q wg-neon-compat "$SRC_DIR/$src"; then
      sed -i '1i #include "wg-neon-compat.h"' "$SRC_DIR/$src"
    fi
  done

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
rsync -a "$PAYLOAD_DIR/app/" "$OPT/app/"
cp -n "$PAYLOAD_DIR/config/gardener.conf" "$ETC/gardener.conf"
cp -n "$PAYLOAD_DIR/models.catalog" "$OPT/models.catalog"
install -m 755 "$PAYLOAD_DIR/setup-wizard.sh" "$OPT/setup-wizard.sh"
install -m 755 "$PAYLOAD_DIR/wikigardener" /usr/local/bin/wikigardener
# login hint until setup is done
cat > /etc/profile.d/wikigardener-setup.sh <<'EOF'
[ -f "$HOME/.wikigardener-setup-done" ] || \
  echo "wikigardener: run 'wikigardener setup' to finish (wifi, dashboard, sync, model)"
EOF

# --- 2b. connected-appliance plumbing --------------------------------------------
# background-jobs dir + notification queue + dashboard token
mkdir -p "$VAR/jobs" "$VAR/notify"
# settings staged by a preseeded image (e.g. NTFY_TOPIC) merge into the conf once
if [ -f "$ETC/preseed.conf" ]; then
  while IFS='=' read -r pk pv; do
    [ -n "$pk" ] || continue
    if grep -q "^$pk=" "$ETC/gardener.conf"; then
      sed -i "s|^$pk=.*|$pk=$pv|" "$ETC/gardener.conf"
    else
      echo "$pk=$pv" >> "$ETC/gardener.conf"
    fi
  done < "$ETC/preseed.conf"
  rm -f "$ETC/preseed.conf"
  echo "   merged preseeded settings into gardener.conf"
fi
if [ ! -f "$ETC/dashboard.token" ]; then
  head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$ETC/dashboard.token"
  echo >> "$ETC/dashboard.token"
  echo "   generated dashboard token (set your own in \`wikigardener setup\`)"
fi
chmod 600 "$ETC/dashboard.token"

# tier-dependent memory ceiling for the model server
if [ "$TIER" = "1.5b" ]; then MEMORY_MAX=2600M; else MEMORY_MAX=1200M; fi
cat > "$ETC/runtime.env" <<EOF
MODEL_FILE=$MODEL_FILE
CTX=$(sed -n 's/^CTX=//p' "$ETC/gardener.conf" | head -1)
LLAMA_VARIANT=$LLAMA_VARIANT
LLAMA_EXTRA_ARGS=$LLAMA_EXTRA_ARGS
EOF
echo "   tier=$TIER variant=$LLAMA_VARIANT"

# --- 3. vault --------------------------------------------------------------------
if [ ! -d "$VAR/vault/.git" ]; then
  echo "== seeding vault from payload snapshot"
  mkdir -p "$VAR/vault"
  rsync -a --exclude .git "$PAYLOAD_DIR/vault-seed/" "$VAR/vault/"

  # pick the vault profile: explicit flag > profile shipped in the seed >
  # auto-detect by layout
  if [ -n "$PROFILE_ARG" ]; then
    if [ -f "$PROFILE_ARG" ]; then
      PROFILE_SRC="$PROFILE_ARG"
    elif [ -f "$PAYLOAD_DIR/profiles/$PROFILE_ARG.conf" ]; then
      PROFILE_SRC="$PAYLOAD_DIR/profiles/$PROFILE_ARG.conf"
    else
      echo "FATAL: unknown profile: $PROFILE_ARG (have: $(cd "$PAYLOAD_DIR/profiles" && printf '%s ' *.conf | sed 's/\.conf//g'))" >&2
      exit 1
    fi
  elif [ -f "$VAR/vault/wiki/entities/Movies.md" ]; then
    PROFILE_SRC="$PAYLOAD_DIR/profiles/marquee-movies.conf"
  else
    PROFILE_SRC="$PAYLOAD_DIR/profiles/generic.conf"
  fi
  cp -n "$PROFILE_SRC" "$VAR/vault/gardener-vault.conf"
  echo "   profile: $(basename "$PROFILE_SRC") -> gardener-vault.conf"

  # the address scheme is a marquee-profile feature; generic vaults never
  # get a .vault-meta unless their seed brought one
  if grep -q '^STUB_KIND_' "$VAR/vault/gardener-vault.conf" 2>/dev/null; then
    mkdir -p "$VAR/vault/.vault-meta"
    [ -f "$VAR/vault/.vault-meta/address-counter.txt" ] \
      || echo 0 > "$VAR/vault/.vault-meta/address-counter.txt"
  fi

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
sed "s/__MEMORY_MAX__/$MEMORY_MAX/" \
  "$PAYLOAD_DIR/systemd/llama-server.service" > /etc/systemd/system/llama-server.service
cp "$PAYLOAD_DIR/systemd/gardener.service" /etc/systemd/system/
sed "s/__INTERVAL_MIN__/${INTERVAL_MIN:-15}/" \
  "$PAYLOAD_DIR/systemd/gardener.timer" > /etc/systemd/system/gardener.timer
for unit in wikigardener-web.service wikigardener-sync.service \
            wikigardener-sync.timer wikigardener-suggest.service \
            wikigardener-suggest.timer wikigardener-notify.service \
            wikigardener-notify.timer; do
  cp "$PAYLOAD_DIR/systemd/$unit" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable --now llama-server.service
systemctl enable gardener.timer
systemctl enable --now wikigardener-web.service
systemctl enable wikigardener-sync.timer wikigardener-suggest.timer \
                 wikigardener-notify.timer

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

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

== wikigardener installed ==
  tier:     $TIER ($MODEL_FILE)
  engine:   llama.cpp ${LLAMACPP_TAG} [$LLAMA_VARIANT]
  vault:    $VAR/vault   (git repo; every change is a commit)
  services: llama-server, gardener.timer (${INTERVAL_MIN:-15}min), wikigardener-web, wikigardener-sync.timer

  dashboard:       http://${IP:-<nano-ip>}:$(sed -n 's/^DASHBOARD_PORT=//p' "$ETC/gardener.conf" | head -1)
                   password: contents of $ETC/dashboard.token
  finish setup:    wikigardener setup    (wifi, git sync, models, prompts)
  watch it work:   journalctl -fu gardener
  status:          PYTHONPATH=$OPT python3 -m gardener status
  audit window:    sudo bash $OPT/audit/audit.sh   (only when you connect WiFi)
EOF
