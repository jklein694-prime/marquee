#!/usr/bin/env bash
# headless-preseed.sh — bake WiFi + SSH + hostname into a Jetson rootfs so the
# Nano boots with no monitor/keyboard, joins WiFi, and is SSH-reachable.
#
# Two ways to use it (both need Linux — ext4 can't be written from macOS):
#   1. build-image.sh calls it on the image it just mounted (see that script).
#   2. Stand-alone on an already-flashed card: mount the card's rootfs (the
#      big ext4 "APP" partition) on a Linux box, then:
#        sudo ./headless-preseed.sh /mnt/APP \
#          --wifi-ssid MyNet --wifi-pass 's3cret' --hostname wikigardener \
#          --ssh-pass 'pw' [--ssh-key ~/.ssh/id_ed25519.pub] [--user gardener]
#
# All edits are to the mounted rootfs; nothing runs on the device here.
set -euo pipefail

ROOT="${1:-}"
if [ -z "$ROOT" ]; then
  echo "usage: headless-preseed.sh <mounted-rootfs> [flags]" >&2; exit 2
fi
shift
[ -d "$ROOT/etc" ] || { echo "not a rootfs (no $ROOT/etc): $ROOT" >&2; exit 1; }

SSID="" PSK="" COUNTRY="US" HOST="wikigardener" USER_NAME="gardener"
SSH_PASS="" SSH_KEY="" ANTHROPIC_KEY="" NTFY_TOPIC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --wifi-ssid) SSID="$2"; shift 2 ;;
    --wifi-pass) PSK="$2"; shift 2 ;;
    --wifi-country) COUNTRY="$2"; shift 2 ;;
    --hostname) HOST="$2"; shift 2 ;;
    --user) USER_NAME="$2"; shift 2 ;;
    --ssh-pass) SSH_PASS="$2"; shift 2 ;;
    --ssh-key) SSH_KEY="$2"; shift 2 ;;
    --anthropic-key) ANTHROPIC_KEY="$2"; shift 2 ;;
    --ntfy-topic) NTFY_TOPIC="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

say() { echo "  [preseed] $*"; }

# --- hostname -------------------------------------------------------------------
say "hostname: $HOST"
echo "$HOST" > "$ROOT/etc/hostname"
if grep -qE '^127\.0\.1\.1' "$ROOT/etc/hosts" 2>/dev/null; then
  sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$HOST/" "$ROOT/etc/hosts"
else
  printf '127.0.1.1\t%s\n' "$HOST" >> "$ROOT/etc/hosts"
fi

# --- WiFi (NetworkManager keyfile) ----------------------------------------------
if [ -n "$SSID" ]; then
  say "wifi: $SSID (country $COUNTRY)"
  NMDIR="$ROOT/etc/NetworkManager/system-connections"
  mkdir -p "$NMDIR"
  # NM 1.10 (Ubuntu 18.04) reads keyfiles named by connection id, no extension,
  # mode 0600 root:root. autoconnect brings it up on boot with no interaction.
  cat > "$NMDIR/$SSID" <<EOF
[connection]
id=$SSID
type=wifi
autoconnect=true

[wifi]
mode=infrastructure
ssid=$SSID

[wifi-security]
key-mgmt=wpa-psk
psk=$PSK

[ipv4]
method=auto

[ipv6]
method=auto
EOF
  chmod 600 "$NMDIR/$SSID"
  chown 0:0 "$NMDIR/$SSID" 2>/dev/null || true
  # regulatory domain so the radio comes up
  if [ -f "$ROOT/etc/default/crda" ]; then
    sed -i "s/^REGDOMAIN=.*/REGDOMAIN=$COUNTRY/" "$ROOT/etc/default/crda" || true
  fi
fi

# --- SSH: enable service, allow password, install key ---------------------------
say "ssh: enable + password auth"
# JetPack ships ssh enabled; assert it via a wants-symlink in case it isn't
for svc in ssh ssh.service; do
  if [ -f "$ROOT/lib/systemd/system/$svc" ] || [ -f "$ROOT/etc/systemd/system/$svc" ]; then
    ln -sf "/lib/systemd/system/ssh.service" \
      "$ROOT/etc/systemd/system/multi-user.target.wants/ssh.service" 2>/dev/null || true
    break
  fi
done
if [ -f "$ROOT/etc/ssh/sshd_config" ]; then
  sed -i 's/^#\?\s*PasswordAuthentication.*/PasswordAuthentication yes/' "$ROOT/etc/ssh/sshd_config"
  grep -qE '^\s*PasswordAuthentication\s+yes' "$ROOT/etc/ssh/sshd_config" \
    || echo 'PasswordAuthentication yes' >> "$ROOT/etc/ssh/sshd_config"
fi
# avahi so <hostname>.local resolves from the Mac
if [ -f "$ROOT/lib/systemd/system/avahi-daemon.service" ]; then
  ln -sf "/lib/systemd/system/avahi-daemon.service" \
    "$ROOT/etc/systemd/system/multi-user.target.wants/avahi-daemon.service" 2>/dev/null || true
fi

# --- account: password + authorized key -----------------------------------------
# The user itself is created by build-image.sh's chroot step; here we only set
# credentials, which don't need a chroot (edit files directly). If the user
# doesn't exist yet, these are written and take effect once it does.
HOMEDIR="$ROOT/home/$USER_NAME"
if [ -n "$SSH_KEY" ] && [ -f "$SSH_KEY" ]; then
  say "ssh key -> $USER_NAME"
  mkdir -p "$HOMEDIR/.ssh"; chmod 700 "$HOMEDIR/.ssh"
  cat "$SSH_KEY" >> "$HOMEDIR/.ssh/authorized_keys"
  chmod 600 "$HOMEDIR/.ssh/authorized_keys"
  # uid may not resolve on the host; build-image chowns after user creation
  chown -R 1000:1000 "$HOMEDIR/.ssh" 2>/dev/null || true
fi
# Password is set by build-image.sh inside the chroot (needs chpasswd against
# the target's /etc/shadow); we export it so that step can pick it up.
if [ -n "$SSH_PASS" ]; then
  say "password staged for $USER_NAME (applied in chroot)"
  mkdir -p "$ROOT/root"
  printf '%s' "$SSH_PASS" > "$ROOT/root/.wg-ssh-pass"
  chmod 600 "$ROOT/root/.wg-ssh-pass"
fi

# --- Claude credentials + notification topic (baked to YOUR account) ------------
# The image then contains these in plaintext — do not share the .img.
if [ -n "$ANTHROPIC_KEY" ]; then
  say "anthropic api key -> /etc/wikigardener/anthropic.key"
  mkdir -p "$ROOT/etc/wikigardener"
  printf '%s\n' "$ANTHROPIC_KEY" > "$ROOT/etc/wikigardener/anthropic.key"
  chmod 600 "$ROOT/etc/wikigardener/anthropic.key"
fi
if [ -n "$NTFY_TOPIC" ]; then
  say "ntfy topic staged (picked up by install.sh)"
  mkdir -p "$ROOT/etc/wikigardener"
  printf 'NTFY_TOPIC=%s\n' "$NTFY_TOPIC" > "$ROOT/etc/wikigardener/preseed.conf"
  chmod 600 "$ROOT/etc/wikigardener/preseed.conf"
fi

say "done — WiFi/SSH/hostname baked into $ROOT"
