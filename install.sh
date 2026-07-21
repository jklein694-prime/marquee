#!/usr/bin/env bash
#
# Marquee installer — guided setup for the personal movie & TV expert.
# Safe to re-run: every step is idempotent.
#
#   ./install.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.local"
TEMPLATE="$SCRIPT_DIR/vault-template"

# --- pretty output ------------------------------------------------------------
if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RED=$'\033[31m'; CYN=$'\033[36m'; RST=$'\033[0m'
else
  B=""; DIM=""; GRN=""; YEL=""; RED=""; CYN=""; RST=""
fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$B" "$*" "$RST"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YEL" "$RST" "$*"; }
err()  { printf '%s✗%s %s\n' "$RED" "$RST" "$*"; }

ask() { local q="$1" def="${2:-}" ans; read -r -p "$(printf '%s%s%s%s: ' "$CYN" "$q" "$RST" "${def:+ [$def]}")" ans; printf '%s' "${ans:-$def}"; }
yesno() { local ans; read -r -p "$(printf '%s%s%s [y/N]: ' "$CYN" "$1" "$RST")" ans; [[ "$ans" =~ ^[Yy] ]]; }

env_get() { [ -f "$ENV_FILE" ] && (grep "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-) || true; }
env_set() {
  touch "$ENV_FILE"
  grep -v "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" 2>/dev/null || true
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
}

# --- 0. banner ----------------------------------------------------------------
cat <<BANNER

${B}Marquee${RST} — your personal movie & TV expert
${DIM}A local Next.js app with a living taste graph, backed by a wiki you own.${RST}
This walkthrough gets you from clone to running app. Re-run it any time.
BANNER

# --- 1. prerequisites ---------------------------------------------------------
step "Checking prerequisites"
missing=0
if command -v node >/dev/null 2>&1; then
  node_major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$node_major" -ge 20 ] 2>/dev/null; then ok "node $(node -v)"; else warn "node $(node -v) — Marquee needs Node 20+. Upgrade from https://nodejs.org"; fi
else
  err "node not found — install Node 20+ from https://nodejs.org"; missing=1
fi
command -v npm >/dev/null 2>&1 && ok "npm $(npm -v)" || { err "npm not found (comes with Node)"; missing=1; }
command -v git >/dev/null 2>&1 && ok "git $(git --version | awk '{print $3}')" || warn "git not found — only needed if you plan to push to GitHub"
if [ "$missing" -eq 1 ]; then err "Install the missing tools above, then re-run ./install.sh"; exit 1; fi

# Windows note: you're only here because you're running this from Git Bash
# (or WSL) — cmd.exe/PowerShell can't run a .sh file directly. That's expected;
# `npm run dev` afterward works fine from any shell, Git Bash included.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ON_WINDOWS=1 ;;
  *) ON_WINDOWS=0 ;;
esac

# --- 2. dependencies ----------------------------------------------------------
step "Installing dependencies (npm install)"
( cd "$SCRIPT_DIR" && npm install )
ok "Dependencies installed"

# --- 3. TMDB API key ----------------------------------------------------------
step "TMDB API key"
say "${DIM}Marquee uses The Movie Database for posters, streaming info, and details.${RST}"
say "${DIM}Get a free key at https://www.themoviedb.org/settings/api${RST}"
existing_tmdb="$(env_get TMDB_API_KEY)"
if [ -n "$existing_tmdb" ]; then
  say "Found an existing key in .env.local (…${existing_tmdb: -4})."
  tmdb_key="$existing_tmdb"
  if yesno "Replace it with a new key?"; then tmdb_key="$(ask 'Paste your TMDB API key')"; fi
else
  tmdb_key="$(ask 'Paste your TMDB API key (or leave blank to add later)')"
fi
[ -n "$tmdb_key" ] && ok "TMDB key set" || warn "No TMDB key — posters/streaming will be blank until you add TMDB_API_KEY to .env.local"

# --- 4. wiki location ---------------------------------------------------------
step "Where should your movie wiki live?"
say "${DIM}This folder is your database — the app reads and writes movie pages here.${RST}"
default_vault="$HOME/Documents/marquee-wiki"
[ -d "$HOME/Documents/claude-obsidian/wiki/movies" ] && default_vault="$HOME/Documents/claude-obsidian"
vault="$(ask 'Wiki folder' "$default_vault")"
vault="${vault/#\~/$HOME}"                       # expand a leading ~
case "$vault" in /*) ;; *) vault="$SCRIPT_DIR/$vault";; esac   # make relative paths absolute

if [ -e "$vault/wiki" ]; then
  ok "Found an existing wiki at $vault — leaving it untouched"
else
  mkdir -p "$vault"
  cp -R "$TEMPLATE/." "$vault/"
  ok "Created a fresh wiki at $vault"
fi
chmod +x "$vault/scripts/allocate-address.sh" 2>/dev/null || true

# --- 5. Claude auth for the in-app chat agent ---------------------------------
step "Claude access (for the in-app chat expert)"
anthropic_key="$(env_get ANTHROPIC_API_KEY)"
if [ -n "$anthropic_key" ]; then
  ok "ANTHROPIC_API_KEY already in .env.local"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  ok "ANTHROPIC_API_KEY found in your environment"
elif command -v claude >/dev/null 2>&1; then
  ok "Claude Code CLI detected — the app will use its login. (Set ANTHROPIC_API_KEY in .env.local to override.)"
else
  say "${DIM}The chat expert runs on Claude. Add an API key from https://console.anthropic.com/settings/keys${RST}"
  anthropic_key="$(ask 'Paste an ANTHROPIC_API_KEY (or leave blank to skip)')"
  [ -n "$anthropic_key" ] && ok "Anthropic key set" || warn "No Claude auth — the graph/watchlist work, but the chat expert needs a key or a logged-in Claude CLI"
fi

# --- 6. write .env.local ------------------------------------------------------
step "Writing .env.local"
[ -n "$tmdb_key" ]      && env_set TMDB_API_KEY "$tmdb_key"
env_set VAULT_PATH "$vault"
[ -n "$anthropic_key" ] && env_set ANTHROPIC_API_KEY "$anthropic_key"
ok ".env.local written (VAULT_PATH=$vault)"

# --- 7. movie-expert skill ----------------------------------------------------
step "movie-expert skill"
ok "Vendored in this repo at .claude/skills/movie-expert — Claude Code loads it here automatically"
if yesno "Also install it globally (~/.claude/skills) so it's available in any Claude Code session?"; then
  mkdir -p "$HOME/.claude/skills"
  cp -R "$SCRIPT_DIR/.claude/skills/movie-expert" "$HOME/.claude/skills/"
  ok "Copied to ~/.claude/skills/movie-expert"
fi

# --- 8. optional: connect Claude Desktop --------------------------------------
step "Connect Claude Desktop (optional)"
if [ "$ON_WINDOWS" -eq 1 ]; then
  cfg_dir="${APPDATA:-$HOME/AppData/Roaming}/Claude"
else
  cfg_dir="$HOME/Library/Application Support/Claude"
fi
if [ -d "$cfg_dir" ]; then
  say "${DIM}This points Claude Desktop at your wiki via the filesystem MCP server, so you can${RST}"
  say "${DIM}chat with your movie expert there against the same database the app visualizes.${RST}"
  if yesno "Add the marquee-wiki server to Claude Desktop?"; then
    if command -v python3 >/dev/null 2>&1; then
      python3 - "$cfg_dir/claude_desktop_config.json" "$vault" <<'PY'
import json, sys
path, vault = sys.argv[1], sys.argv[2]
try:
    with open(path) as f: cfg = json.load(f)
except Exception:
    cfg = {}
cfg.setdefault("mcpServers", {})["marquee-wiki"] = {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", vault],
}
with open(path, "w") as f: json.dump(cfg, f, indent=2)
PY
      ok "Added marquee-wiki to Claude Desktop — restart Claude Desktop to load it"
    else
      warn "python3 not found — see the README for the manual claude_desktop_config.json snippet"
    fi
  fi
else
  say "${DIM}Claude Desktop not detected — skipping. See the README to connect it later.${RST}"
fi

# --- 9. done ------------------------------------------------------------------
cat <<DONE

${GRN}${B}Setup complete.${RST}

Start the app:
  ${B}npm run dev${RST}        then open ${CYN}http://localhost:3000${RST}

On the same network from an iPad? Run:
  ${B}npm run dev -- -H 0.0.0.0${RST}   and open http://<this-mac-ip>:3000 in Safari

Your wiki:  $vault
DONE
