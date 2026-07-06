#!/usr/bin/env bash
# preflight.sh — is this Nano ready? Sourced by install.sh; also runnable
# standalone:  sudo bash preflight.sh --report-only
#
# Exports (when sourced): TIER (1.5b|0.5b), MODEL_FILE, RAM_MB, L4T_OK
set -euo pipefail

PAYLOAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_ONLY=0
[ "${1:-}" = "--report-only" ] && REPORT_ONLY=1

say()  { echo "  [preflight] $*"; }
die()  { echo "  [preflight] FATAL: $*" >&2; exit 1; }

# --- payload integrity (USB corruption is real) -------------------------------
if [ -f "$PAYLOAD_DIR/MANIFEST.sha256" ]; then
  say "verifying payload manifest..."
  (cd "$PAYLOAD_DIR" && sha256sum --quiet -c MANIFEST.sha256) \
    || die "payload corrupted — recopy the USB stick"
  say "manifest OK"
else
  say "WARN: no MANIFEST.sha256 (dev tree?) — skipping integrity check"
fi

# --- architecture --------------------------------------------------------------
ARCH="$(uname -m)"
if [ "$ARCH" != "aarch64" ]; then
  if [ "$REPORT_ONLY" = 1 ]; then
    say "WARN: arch is $ARCH, not aarch64 — this is not a Jetson"
  else
    die "arch is $ARCH, not aarch64 — run this on the Jetson Nano"
  fi
fi

# --- L4T / JetPack --------------------------------------------------------------
L4T_OK=0
if [ -f /etc/nv_tegra_release ]; then
  L4T_LINE="$(head -1 /etc/nv_tegra_release)"
  say "L4T: $L4T_LINE"
  case "$L4T_LINE" in
    *"R32"*) L4T_OK=1; say "JetPack 4.x confirmed" ;;
    *) say "WARN: not L4T R32 (JetPack 4.x) — CPU build will still work" ;;
  esac
else
  say "WARN: /etc/nv_tegra_release missing — not JetPack? CPU build only"
fi
export L4T_OK

# --- RAM tier -------------------------------------------------------------------
RAM_KB="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
RAM_MB=$((RAM_KB / 1024))
export RAM_MB
say "RAM: ${RAM_MB}MB"

# shellcheck source=config/gardener.conf
TIER_OVERRIDE="$(sed -n 's/^TIER_OVERRIDE=//p' "$PAYLOAD_DIR/config/gardener.conf" 2>/dev/null | head -1 || true)"
if [ -n "$TIER_OVERRIDE" ]; then
  TIER="$TIER_OVERRIDE"
  say "tier forced by TIER_OVERRIDE: $TIER"
elif [ "$RAM_MB" -ge 3500 ]; then
  TIER="1.5b"
elif [ "$RAM_MB" -ge 1700 ]; then
  TIER="0.5b"
else
  die "only ${RAM_MB}MB RAM — below the 2GB Nano; unsupported"
fi
say "model tier: $TIER"
export TIER

case "$TIER" in
  1.5b) MODEL_FILE="qwen2.5-1.5b-instruct-q4_k_m.gguf" ;;
  0.5b) MODEL_FILE="qwen2.5-0.5b-instruct-q4_k_m.gguf" ;;
  *) die "unknown tier: $TIER" ;;
esac
[ -f "$PAYLOAD_DIR/models/$MODEL_FILE" ] \
  || die "model missing from payload: models/$MODEL_FILE"
export MODEL_FILE

# --- disk -----------------------------------------------------------------------
FREE_GB="$(df -BG --output=avail /opt 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)"
say "free disk on /opt's filesystem: ${FREE_GB}GB"
[ "$FREE_GB" -ge 8 ] || { [ "$REPORT_ONLY" = 1 ] || die "need >=8GB free"; }

# --- toolchain ------------------------------------------------------------------
MISSING=""
for tool in gcc g++ make git python3 rsync; do
  command -v "$tool" >/dev/null || MISSING="$MISSING $tool"
done
if [ -n "$MISSING" ]; then
  say "missing tools:$MISSING"
  say "one-time online fix:  sudo apt update && sudo apt install -y build-essential git python3 rsync"
  [ "$REPORT_ONLY" = 1 ] || die "install the missing tools first (see line above)"
fi

# --- swap (build + 1.5B model need headroom) --------------------------------------
SWAP_KB="$(awk '/SwapTotal/{print $2}' /proc/meminfo)"
SWAP_MB=$((SWAP_KB / 1024))
say "swap: ${SWAP_MB}MB"
if [ "$SWAP_MB" -lt 2048 ] && [ "$REPORT_ONLY" = 0 ]; then
  say "creating 4GB /swapfile..."
  if ! fallocate -l 4G /swapfile 2>/dev/null; then
    dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  fi
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  say "swap enabled"
fi

# --- CUDA (informational — the build attempt decides) ------------------------------
if [ -x /usr/local/cuda-10.2/bin/nvcc ] || command -v nvcc >/dev/null; then
  say "CUDA toolkit present — install will attempt a GPU build"
  export CUDA_PRESENT=1
else
  say "no CUDA toolkit — CPU-only build"
  export CUDA_PRESENT=0
fi

say "preflight OK (tier=$TIER, model=$MODEL_FILE)"
