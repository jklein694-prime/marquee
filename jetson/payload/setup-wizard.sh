#!/usr/bin/env bash
# setup-wizard.sh — interactive first-run setup, re-runnable as
# `wikigardener setup`. Connects WiFi, sets the dashboard password, configures
# git sync to your computer, downloads a model, and tunes the gardener. bash +
# nmcli only. Everything it configures also has a manual path (see the README),
# so you can skip any step.
set -euo pipefail

ETC=/etc/wikigardener
OPT=/opt/wikigardener
CONF="$ETC/gardener.conf"
DONE="$HOME/.wikigardener-setup-done"

[ "$(id -u)" = 0 ] || { echo "run as root: sudo wikigardener setup" >&2; exit 1; }

ask() { local p="$1" d="${2:-}"; local a; read -r -p "$p${d:+ [$d]}: " a; echo "${a:-$d}"; }
yes() { local a; read -r -p "$1 [y/N] " a; [ "$a" = y ] || [ "$a" = Y ]; }
setconf() {  # setconf KEY VALUE — replace or append in gardener.conf
  local k="$1" v="$2"
  if grep -q "^$k=" "$CONF"; then
    sed -i "s|^$k=.*|$k=$v|" "$CONF"
  else
    echo "$k=$v" >> "$CONF"
  fi
}

echo "== wikigardener setup =="
echo "The gardener runs fully offline; these settings only matter during the"
echo "online windows you choose (model download, sync, audit)."
echo

# --- 1. WiFi --------------------------------------------------------------------
if command -v nmcli >/dev/null && yes "Connect WiFi now?"; then
  nmcli device wifi list --rescan yes || true
  ssid="$(ask 'WiFi SSID')"
  pass="$(ask 'WiFi password')"
  if nmcli device wifi connect "$ssid" password "$pass"; then
    echo "  connected."
  else
    echo "  connect failed — you can retry later or use: nmcli device wifi connect <ssid> password <pw>"
  fi
fi

# --- 2. dashboard password ------------------------------------------------------
if yes "Set a dashboard password now?"; then
  pw="$(ask 'dashboard password')"
  if [ -n "$pw" ]; then
    printf '%s\n' "$pw" > "$ETC/dashboard.token"
    chmod 600 "$ETC/dashboard.token"
    systemctl restart wikigardener-web 2>/dev/null || true
    echo "  saved; open http://$(hostname -I 2>/dev/null | awk '{print $1}'):$(sed -n 's/^DASHBOARD_PORT=//p' "$CONF" | head -1)"
  fi
fi

# --- 3. git sync to your computer ----------------------------------------------
if yes "Set up vault git sync to your computer / GitHub?"; then
  remote="$(ask 'git remote URL (e.g. git@github.com:you/vault.git)')"
  branch="$(ask 'branch' main)"
  if [ -n "$remote" ]; then
    setconf GIT_REMOTE "$remote"
    setconf GIT_BRANCH "$branch"
    ( cd /var/lib/wikigardener/vault
      git remote remove origin 2>/dev/null || true
      git remote add origin "$remote" )
    echo "  set. First sync (needs WiFi):  wikigardener sync"
    echo "  For SSH remotes, add the Nano's key to your host:"
    echo "    ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519 2>/dev/null; cat /root/.ssh/id_ed25519.pub"
  fi
fi

# --- 4. model -------------------------------------------------------------------
if yes "Pick / download a model now? (needs WiFi)"; then
  PYTHONPATH="$OPT" python3 -m gardener models list || true
  mid="$(ask 'catalog id or .gguf URL (blank to skip)')"
  if [ -n "$mid" ]; then
    PYTHONPATH="$OPT" python3 -m gardener models download "$mid" \
      && PYTHONPATH="$OPT" python3 -m gardener models use "$mid" \
      && echo "  active model switched."
  fi
fi

# --- 5. gardener knobs ----------------------------------------------------------
if yes "Tune the gardener (interval / daily cap)?"; then
  iv="$(ask 'minutes between tasks' "$(sed -n 's/^INTERVAL_MIN=//p' "$CONF" | head -1)")"
  cap="$(ask 'max changes per day' "$(sed -n 's/^MAX_CHANGES_PER_DAY=//p' "$CONF" | head -1)")"
  setconf INTERVAL_MIN "$iv"
  setconf MAX_CHANGES_PER_DAY "$cap"
  # re-render the timer interval
  if [ -f /etc/systemd/system/gardener.timer ]; then
    sed -i "s/OnUnitInactiveSec=.*/OnUnitInactiveSec=${iv}min/" /etc/systemd/system/gardener.timer
    systemctl daemon-reload
  fi
  echo "  Fine-tune the actual prompts from the dashboard (Prompts panel) or edit"
  echo "  /var/lib/wikigardener/vault/prompts/*.txt — they sync with your vault."
fi

touch "$DONE"
echo
echo "== setup complete =="
echo "  dashboard:  http://$(hostname -I 2>/dev/null | awk '{print $1}'):$(sed -n 's/^DASHBOARD_PORT=//p' "$CONF" | head -1)"
echo "  drive it from your laptop with Claude Code / Claw Code over SSH — see jetson/laptop/."
