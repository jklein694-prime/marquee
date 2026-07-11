#!/usr/bin/env bash
# build-image.sh — produce a ready-to-flash SD image for the original Jetson
# Nano: stock JetPack 4.6 + the whole wikigardener stack + a first-boot unit
# that runs install.sh unattended. Flash the result with Balena Etcher.
#
#   sudo ./jetson/image/build-image.sh --vault /path/to/your/vault
#   # -> wikigardener-jetson.img  (then: Balena Etcher -> SD)
#
# RUNS ON A LINUX LAPTOP as root (needs loop devices + ext4). On macOS/Windows
# run it inside a privileged Linux VM or `docker run --privileged` — ext4fuse
# is read-only and won't work.
#
# THE RISKIEST PIECE. Steps that can only be confirmed on real hardware are
# flagged [HW]. If the built image won't boot, fall back to: flash NVIDIA's
# stock JetPack image, then run payload/install.sh from a USB stick (identical
# payload, proven path — see README).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JETSON="$(cd "$HERE/.." && pwd)"
# shellcheck source=../PINS.env
source "$JETSON/PINS.env"

OUT="wikigardener-jetson.img"
VAULT="$JETSON/vault-template"
COMPRESS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --vault) VAULT="$2"; shift 2 ;;
    --xz) COMPRESS=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "run as root (loop devices + mount): sudo $0 ..." >&2; exit 1; }
[ "$(uname -s)" = Linux ] || { echo "Linux only — use a privileged Linux VM on mac/win" >&2; exit 1; }
for t in losetup mount umount rsync parted; do
  command -v "$t" >/dev/null || { echo "missing tool: $t" >&2; exit 1; }
done

WORK="$(mktemp -d)"
MNT="$WORK/mnt"
mkdir -p "$MNT"
LOOP=""
cleanup() {
  if mountpoint -q "$MNT"; then umount "$MNT" || true; fi
  if [ -n "$LOOP" ]; then losetup -d "$LOOP" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# --- 1. base JetPack image (pinned, trust-on-first-use sha) ----------------------
BASE_ZIP="$WORK/jetpack.zip"
BASE_IMG="$WORK/sd-blob.img"
echo "==> fetching base JetPack image"
if [ -z "${JETPACK_IMAGE_URL:-}" ]; then
  cat >&2 <<'EOF'
FATAL: JETPACK_IMAGE_URL not set in PINS.env.
The Nano SD image must be downloaded from NVIDIA (login/redirect makes a
stable direct URL awkward to pin). Download "Jetson Nano Developer Kit SD
Card Image" (JetPack 4.6.x) from developer.nvidia.com, then either set
JETPACK_IMAGE_URL to a mirror you control, or drop the unzipped .img at
$BASE_IMG and re-run.
EOF
  [ -f "$BASE_IMG" ] || exit 1
else
  curl -fL --retry 3 -o "$BASE_ZIP" "$JETPACK_IMAGE_URL"
  if [ "$JETPACK_IMAGE_SHA256" != "TBD" ]; then
    echo "$JETPACK_IMAGE_SHA256  $BASE_ZIP" | sha256sum -c -
  fi
  echo "==> unzipping"
  unzip -p "$BASE_ZIP" > "$BASE_IMG"
fi

cp "$BASE_IMG" "$OUT"

# --- 2. attach + find rootfs ----------------------------------------------------
echo "==> attaching image"
LOOP="$(losetup -fP --show "$OUT")"
# [HW] rootfs is partition 1 (APP) on the Nano SD image; the ~13 firmware
# partitions follow it. Verify against your revision:
parted -s "$LOOP" print || true
ROOT_PART="${LOOP}p1"
[ -e "$ROOT_PART" ] || { echo "FATAL: $ROOT_PART not found — check partition layout" >&2; exit 1; }
mount "$ROOT_PART" "$MNT"

# NOTE: we deliberately do NOT resize the rootfs here. The APP partition ships
# with room for the ~2GB payload, and JetPack's first-boot service grows it to
# fill the SD card on the device. [HW: confirm auto-resize fires.]

# --- 3. build + inject the payload ----------------------------------------------
echo "==> assembling payload"
PAYDIR="$WORK/payload"
bash "$JETSON/build-payload.sh" --out "$PAYDIR" --vault "$VAULT" \
  ${FAKE_ARTIFACTS:+--fake-artifacts}
echo "==> injecting into /opt/wikigardener-firstboot"
mkdir -p "$MNT/opt/wikigardener-firstboot"
rsync -a "$PAYDIR/" "$MNT/opt/wikigardener-firstboot/"

# --- 4. enable the firstboot unit OFFLINE (no running systemd) -------------------
echo "==> enabling first-boot service"
install -D -m 644 "$JETSON/payload/systemd/wikigardener-firstboot.service" \
  "$MNT/etc/systemd/system/wikigardener-firstboot.service"
mkdir -p "$MNT/etc/systemd/system/multi-user.target.wants"
ln -sf /etc/systemd/system/wikigardener-firstboot.service \
  "$MNT/etc/systemd/system/multi-user.target.wants/wikigardener-firstboot.service"

# --- 5. headless user preseed (robust path around L4T's oem-config) --------------
# [HW] oem-config sentinel names vary by L4T revision; the fallback (let
# oem-config run once on a monitor) is documented in the README.
echo "==> preseeding a login user + disabling nv-oem-config"
if command -v qemu-aarch64-static >/dev/null 2>&1; then
  cp "$(command -v qemu-aarch64-static)" "$MNT/usr/bin/" || true
  chroot "$MNT" /usr/bin/qemu-aarch64-static /bin/bash -euc '
    id gardener >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo gardener
    echo "gardener:wikigardener" | chpasswd
    chage -d 0 gardener   # force password change on first login
  ' || echo "   [warn] chroot preseed failed — fall back to on-monitor oem-config"
  rm -f "$MNT/usr/bin/qemu-aarch64-static"
else
  echo "   [warn] qemu-aarch64-static not installed — skipping preseed."
  echo "          Install qemu-user-static, or complete NVIDIA's oem-config on a"
  echo "          monitor once (the firstboot unit still runs afterward)."
fi
# disable the L4T first-boot wizard so ours runs unattended
rm -f "$MNT/etc/systemd/system/multi-user.target.wants/nv-oem-config.service" 2>/dev/null || true
rm -f "$MNT/etc/systemd/system/nvfb-early.service" 2>/dev/null || true

# --- 6. finish ------------------------------------------------------------------
echo "==> unmounting"
sync
umount "$MNT"; mountpoint -q "$MNT" || true
losetup -d "$LOOP"; LOOP=""
trap - EXIT
rm -rf "$WORK"

if [ "$COMPRESS" = 1 ]; then
  echo "==> compressing (xz)"
  xz -T0 -f "$OUT"
  OUT="$OUT.xz"
fi

cat <<EOF

== image ready: $OUT ==
  Flash it with Balena Etcher (or: xzcat/dd) to an SD card (>=32GB), insert,
  and boot the Nano. First boot: log in as 'gardener' / 'wikigardener'
  (you'll be forced to change the password), the firstboot service runs
  install.sh once (~20-40 min, builds llama.cpp), then run 'wikigardener setup'.

  [HW] Only real hardware confirms: image boots, p1=rootfs, oem-config
  coexistence, first-boot rootfs auto-resize, CUDA build, tok/s. If boot
  fails, use the fallback: flash NVIDIA's stock image + run install.sh from
  USB (see jetson/README.md).
EOF
