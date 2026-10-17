#!/usr/bin/env bash
# update.sh — `wikigardener update`: pull the latest marquee from GitHub and
# deploy it to this Nano in one command.
#
#   sudo wikigardener update            # update + rebuild the app if it changed
#   sudo wikigardener update --force    # rebuild even if already up to date
#   sudo wikigardener update log        # reattach to a running update / last result
#   sudo wikigardener update --fg       # run in this terminal instead of the background
#
# The work runs in a background systemd unit, so a dropped SSH session (phone
# locks, Termius backgrounds) doesn't kill a half-finished build — reconnect
# and run `wikigardener update log`. Steps:
#   1. WiFi on if it was off (turned back off at the end — air gap restored)
#   2. wait for the network; if raw IP works but DNS doesn't, fall back to
#      public resolvers (and restart docker so the build sees them)
#   3. app checkout: add the `origin` remote if missing, fetch the branch,
#      hard-reset to it (only build output and node_modules live there)
#   4. refresh the device code from the repo's jetson/payload: gardener,
#      audit, app installer, setup wizard, this script, the CLI
#   5. rebuild + restart the app via app/install-app.sh, unless nothing changed
#
# Repo/branch: APP_REPO= / APP_BRANCH= in /etc/wikigardener/gardener.conf,
# else the checkout's existing origin, else the default below.
set -euo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
OPT="${WG_OPT:-/opt/wikigardener}"
ETC="${WG_ETC:-/etc/wikigardener}"
VAR="${WG_VAR:-/var/lib/wikigardener}"
BIN="${WG_BIN:-/usr/local/bin}"
APP_DIR="${WG_APP_DIR:-$OPT/app-src}"
RESOLV="${WG_RESOLV:-/etc/resolv.conf}"
DEFAULT_REPO=https://github.com/jklein694-prime/marquee.git
UNIT=wikigardener-update
LOG="$VAR/update.log"
STATUS="$VAR/update.status"

FORCE=0 FG=0 MODE=run
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --fg) FG=1 ;;
    log|status) MODE=log ;;
    -h|--help) sed -n '2,24p' "$SELF" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "run as root: sudo wikigardener update" >&2; exit 1; }
mkdir -p "$VAR"

conf_get() { sed -n "s/^$1=//p" "$ETC/gardener.conf" 2>/dev/null | head -1; }

report() {
  if [ ! -f "$STATUS" ]; then
    echo "no result recorded — see: journalctl -u $UNIT" >&2
    return 1
  fi
  local rc sha
  read -r rc sha < "$STATUS" || true
  if [ "$rc" = 0 ]; then
    echo "UPDATE_OK — running ${sha:-unknown}"
  else
    echo "UPDATE FAILED (exit $rc) — full log: $LOG" >&2
    return 1
  fi
}

unit_running() {
  case "$(systemctl is-active "$UNIT" 2>/dev/null)" in
    active|activating) return 0 ;;
  esac
  return 1
}

follow() {
  echo "(runs in the background — safe to disconnect; reconnect and run 'sudo wikigardener update log')"
  tail -n +1 -F "$LOG" 2>/dev/null &
  local tp=$!
  while [ ! -f "$STATUS" ] && unit_running; do sleep 2; done
  sleep 1
  kill "$tp" 2>/dev/null || true
  wait "$tp" 2>/dev/null || true
  report
}

# --- outer: hand off to a background unit and follow it -------------------------
if [ "${WG_UPDATE_INNER:-}" != 1 ]; then
  if [ "$MODE" = log ]; then
    if unit_running; then follow; exit; fi
    tail -n 40 "$LOG" 2>/dev/null || true
    report; exit
  fi
  if [ "$FG" = 0 ] && command -v systemd-run >/dev/null; then
    if unit_running; then
      echo "an update is already running — following it"
    else
      systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
      : > "$LOG"; rm -f "$STATUS"
      systemd-run --quiet --unit="$UNIT" --setenv=WG_UPDATE_INNER=1 --setenv=HOME=/root \
        bash "$SELF" "$@"
    fi
    follow; exit
  fi
  : > "$LOG"; rm -f "$STATUS"
fi

# --- inner: the actual update ---------------------------------------------------
exec > >(tee -a "$LOG") 2>&1
exec 9>"$VAR/update.lock"
flock -n 9 || { echo "another update holds $VAR/update.lock" >&2; exit 1; }

WIFI_WAS="" NEW=""
finish() {
  local rc=$?
  if [ "$WIFI_WAS" = disabled ]; then
    echo "== WiFi back off (air gap restored)"
    nmcli radio wifi off || true
  fi
  [ "$rc" = 0 ] || echo "!! update failed (exit $rc)"
  echo "$rc $NEW" > "$STATUS"
}
trap finish EXIT

can_reach() {
  python3 -c "import socket,sys; socket.create_connection((sys.argv[1], 443), 5).close()" "$1" \
    >/dev/null 2>&1
}

echo "== $(date '+%F %T') wikigardener update"

# 1. network
if command -v nmcli >/dev/null; then
  WIFI_WAS="$(nmcli radio wifi 2>/dev/null || true)"
  if [ "$WIFI_WAS" = disabled ]; then
    echo "== WiFi on for the update"
    nmcli radio wifi on
  fi
fi
net_up() { can_reach 1.1.1.1 || can_reach 8.8.8.8; }
echo "== waiting for the network"
for _ in $(seq 1 30); do net_up && break; sleep 2; done
net_up || { echo "FATAL: no internet (WiFi connected? try: wikigardener net status)" >&2; exit 1; }
if ! getent hosts github.com >/dev/null 2>&1; then
  echo "== DNS not resolving — switching $RESOLV to public resolvers"
  rm -f "$RESOLV"
  printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "$RESOLV"
  systemctl restart docker 2>/dev/null || true
  getent hosts github.com >/dev/null 2>&1 || { echo "FATAL: DNS still broken" >&2; exit 1; }
fi

# 2. app checkout
BRANCH="$(conf_get APP_BRANCH)"; BRANCH="${BRANCH:-main}"
REPO="$(conf_get APP_REPO)"
[ -n "$REPO" ] || REPO="$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)"
REPO="${REPO:-$DEFAULT_REPO}"
echo "== fetching $REPO ($BRANCH)"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
  OLD=none
else
  OLD="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || echo none)"
  if git -C "$APP_DIR" remote get-url origin >/dev/null 2>&1; then
    git -C "$APP_DIR" remote set-url origin "$REPO"
  else
    git -C "$APP_DIR" remote add origin "$REPO"
  fi
  git -C "$APP_DIR" fetch --depth 1 origin \
    "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
  git -C "$APP_DIR" branch -q -u "origin/$BRANCH"
fi
NEW="$(git -C "$APP_DIR" log -1 --format='%h %s')"
echo "   now at: $NEW"

# 3. device code from the repo's payload
PAYLOAD="$APP_DIR/jetson/payload"
if [ -d "$PAYLOAD/gardener" ]; then
  echo "== refreshing device code from jetson/payload"
  # staged swap so a gardener timer firing mid-copy never sees half a package
  rm -rf "$OPT/gardener.new" "$OPT/gardener.old"
  cp -a "$PAYLOAD/gardener" "$OPT/gardener.new"
  find "$OPT/gardener.new" -name __pycache__ -prune -exec rm -rf {} +
  [ -d "$OPT/gardener" ] && mv "$OPT/gardener" "$OPT/gardener.old"
  mv "$OPT/gardener.new" "$OPT/gardener"
  rm -rf "$OPT/gardener.old"
  mkdir -p "$OPT/audit" "$OPT/app"
  cp -a "$PAYLOAD/audit/." "$OPT/audit/"
  cp -a "$PAYLOAD/app/." "$OPT/app/"
  # rename into place: bash reads scripts lazily, and this one is running
  swap_in() { install -m 755 "$1" "$2.new" && mv -f "$2.new" "$2"; }
  swap_in "$PAYLOAD/setup-wizard.sh" "$OPT/setup-wizard.sh"
  swap_in "$PAYLOAD/update.sh" "$OPT/update.sh"
  swap_in "$PAYLOAD/wikigardener" "$BIN/wikigardener"
  if systemctl is-active --quiet wikigardener-web 2>/dev/null; then
    systemctl restart wikigardener-web || true
  fi
else
  echo "   (no jetson/payload in this checkout — device code left as is)"
fi

# 4. app rebuild
if [ "$FORCE" = 0 ] && [ "$OLD" = "$(git -C "$APP_DIR" rev-parse HEAD)" ] \
   && systemctl is-active --quiet wikigardener-app 2>/dev/null; then
  echo "== app already up to date and running — skipping rebuild (--force to rebuild)"
else
  echo "== rebuilding the app (slow on the Nano — ~10-20 min)"
  WG_SKIP_PULL=1 bash "${WG_APP_INSTALLER:-$OPT/app/install-app.sh}"
fi

echo "== done: $NEW"
