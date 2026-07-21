#!/usr/bin/env bash
# flash-sd.sh — flash the JetPack SD image to a microSD from your MAC, no
# Etcher needed. Runs on macOS (uses diskutil).
#
#   ./flash-sd.sh <jetpack .zip or .img> <disk>
#   e.g.  ./flash-sd.sh ~/Downloads/jetson-nano-sd-card-image.zip disk4
#
# Find your disk id first:   diskutil list external
# (the ~256GB entry, e.g. /dev/disk4 — pass "disk4" or "/dev/disk4")
#
# Guardrails: refuses internal/system disks, shows exactly what it's about to
# erase, and requires you to type the disk id back before writing.
set -euo pipefail

IMAGE="${1:-}"
DISK_ARG="${2:-}"
if [ -z "$IMAGE" ] || [ -z "$DISK_ARG" ]; then
  echo "usage: $0 <jetpack .zip|.img> <diskN>" >&2
  echo "  find the disk with:  diskutil list external" >&2
  exit 2
fi

[ "$(uname -s)" = Darwin ] || { echo "this flasher is for macOS (uses diskutil); on Linux use Etcher or dd" >&2; exit 1; }
[ -f "$IMAGE" ] || { echo "no such file: $IMAGE" >&2; exit 1; }

DISK="${DISK_ARG#/dev/}"          # accept disk4 or /dev/disk4
case "$DISK" in
  disk[0-9]*) ;;
  *) echo "that doesn't look like a whole-disk id: $DISK_ARG (want e.g. disk4)" >&2; exit 2 ;;
esac
case "$DISK" in
  *s[0-9]*) echo "pass the WHOLE disk (disk4), not a partition ($DISK)" >&2; exit 2 ;;
esac

INFO="$(diskutil info "/dev/$DISK")" || { echo "diskutil can't find /dev/$DISK — is the card inserted?" >&2; exit 1; }
get() { printf '%s\n' "$INFO" | sed -n "s/^ *$1: *//p" | head -1; }
NAME="$(get 'Device / Media Name')"
SIZE="$(get 'Disk Size')"
INTERNAL="$(get 'Internal')"
LOCATION="$(get 'Device Location')"

# hard refusal on anything that looks like the Mac's own disk
if [ "$INTERNAL" = "Yes" ] || [ "$LOCATION" = "Internal" ] || [ "$DISK" = "disk0" ] || [ "$DISK" = "disk1" ]; then
  echo "REFUSING: /dev/$DISK looks like an internal disk ($NAME). Flash only external card readers." >&2
  exit 1
fi

echo "About to COMPLETELY ERASE:"
echo "    /dev/$DISK — $NAME — $SIZE"
echo "and write: $IMAGE"
echo
printf 'Type the disk id (%s) to confirm: ' "$DISK"
read -r CONFIRM
[ "$CONFIRM" = "$DISK" ] || { echo "confirmation mismatch — nothing written."; exit 1; }

echo "==> unmounting"
diskutil unmountDisk "/dev/$DISK"

echo "==> writing (15-25 min; press Ctrl+T for progress; you'll be asked for your password)"
# rdisk = raw device, several times faster than /dev/diskN on macOS
case "$IMAGE" in
  *.zip)
    unzip -p "$IMAGE" '*.img' | sudo dd of="/dev/r$DISK" bs=4m
    ;;
  *.img)
    sudo dd if="$IMAGE" of="/dev/r$DISK" bs=4m
    ;;
  *)
    echo "expected a .zip or .img: $IMAGE" >&2; exit 2 ;;
esac
sync

echo "==> ejecting"
diskutil eject "/dev/$DISK" || true

cat <<'EOF'

== flash complete ==
If macOS pops up "The disk you inserted was not readable" — that's EXPECTED
(the card is now Linux-formatted). Click Eject, never Initialize.

Next (QUICKSTART step 4): microSD + WiFi dongle into the Nano, data micro-USB
cable to this Mac, power on, then:
    ls /dev/tty.usbmodem*
    screen /dev/tty.usbmodemXXXX 115200
EOF
