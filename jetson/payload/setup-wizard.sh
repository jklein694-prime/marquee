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
# The nmcli connection is saved, so once this succeeds the Nano auto-rejoins
# this network on every future boot — that's what makes it headless.
if command -v nmcli >/dev/null && yes "Connect WiFi now?"; then
  country="$(ask 'WiFi country code (regulatory, e.g. US)' US)"
  iw reg set "$country" 2>/dev/null || true
  nmcli device wifi list --rescan yes || true
  ssid="$(ask 'WiFi SSID')"
  pass="$(ask 'WiFi password')"
  if nmcli device wifi connect "$ssid" password "$pass"; then
    nmcli connection modify "$ssid" connection.autoconnect yes 2>/dev/null || true
    echo "  connected — this network is saved and will auto-join on every boot."
  else
    echo "  connect failed. Check the dongle is supported (dmesg | grep -i wlan),"
    echo "  then retry:  nmcli device wifi connect <ssid> password <pw>"
  fi
fi

# --- 1b. hostname + SSH (so you can reach it with no keyboard) -------------------
if yes "Set the hostname + SSH login (recommended for headless)?"; then
  host="$(ask 'hostname (reachable as <name>.local)' wikigardener)"
  if [ -n "$host" ]; then
    hostnamectl set-hostname "$host" 2>/dev/null || echo "$host" > /etc/hostname
    # keep /etc/hosts in sync so sudo etc. resolve the name
    if grep -qE '^127\.0\.1\.1' /etc/hosts; then
      sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$host/" /etc/hosts
    else
      printf '127.0.1.1\t%s\n' "$host" >> /etc/hosts
    fi
  fi
  # openssh-server ships enabled on JetPack; make sure, and allow password login
  systemctl enable --now ssh 2>/dev/null || systemctl enable --now sshd 2>/dev/null || true
  if [ -f /etc/ssh/sshd_config ] && ! grep -qE '^\s*PasswordAuthentication\s+yes' /etc/ssh/sshd_config; then
    sed -i 's/^#\?\s*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config
    grep -qE '^\s*PasswordAuthentication' /etc/ssh/sshd_config || echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config
    systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
  fi
  login_user="${SUDO_USER:-$(logname 2>/dev/null || echo gardener)}"
  if yes "Set the SSH password for '$login_user' now?"; then
    sshpw="$(ask 'SSH password')"
    [ -n "$sshpw" ] && printf '%s:%s\n' "$login_user" "$sshpw" | chpasswd && echo "  password set for $login_user."
  fi
  if yes "Paste an SSH public key for passwordless login?"; then
    key="$(ask 'ssh public key (ssh-ed25519 …)')"
    if [ -n "$key" ]; then
      home="$(getent passwd "$login_user" | cut -d: -f6)"
      mkdir -p "$home/.ssh" && chmod 700 "$home/.ssh"
      printf '%s\n' "$key" >> "$home/.ssh/authorized_keys"
      chmod 600 "$home/.ssh/authorized_keys"
      chown -R "$login_user" "$home/.ssh"
      echo "  key installed for $login_user."
    fi
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
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST="$(hostname 2>/dev/null)"
PORT="$(sed -n 's/^DASHBOARD_PORT=//p' "$CONF" | head -1)"
echo
echo "== setup complete — you can unplug the keyboard/serial cable now =="
echo "  reach it from your Mac (no cable needed once on WiFi):"
echo "    ssh ${SUDO_USER:-gardener}@${HOST:-wikigardener}.local"
[ -n "$IP" ] && echo "    ssh ${SUDO_USER:-gardener}@$IP        # if .local doesn't resolve"
echo "    ssh ${SUDO_USER:-gardener}@192.168.55.1   # over the USB cable, anytime"
echo "  dashboard:  http://${IP:-<nano-ip>}:${PORT:-8088}"
echo "  drive it from your laptop with Claude Code / Claw Code over SSH — see jetson/laptop/."
echo
echo "  From here on: just power it on — it rejoins WiFi and SSH is ready."
