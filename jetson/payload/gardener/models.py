"""Model manager: pick, download, and switch the local GGUF the gardener
thinks with. This is the "select AI models to download from online" feature.

Downloads happen only during an online window; switching a model rewrites
runtime.env and restarts llama-server, health-polls, and rolls back if the
new model won't come up. RAM tiers mirror preflight.sh so a model that can't
fit the board is refused (unless forced). Python 3.6 stdlib only.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.request

# minimum-board thresholds, mirrored from preflight.sh
_TIER_ORDER = ["0.5b", "1.5b", "3b"]


def detect_tier(meminfo="/proc/meminfo"):
    """The board's model tier from total RAM (same thresholds as preflight)."""
    try:
        with open(meminfo) as fh:
            for line in fh:
                if line.startswith("MemTotal"):
                    kb = int(line.split()[1])
                    mb = kb // 1024
                    if mb >= 3500:
                        return "1.5b"
                    if mb >= 1700:
                        return "0.5b"
                    return "below"
    except (IOError, ValueError):
        pass
    return "unknown"


def tier_fits(model_tier, board_tier):
    """True if a model needing model_tier is safe on a board_tier device."""
    if board_tier in ("unknown", "below"):
        return board_tier == "unknown"  # unknown: allow (dev/test); below: refuse
    if model_tier not in _TIER_ORDER or board_tier not in _TIER_ORDER:
        return True
    return _TIER_ORDER.index(model_tier) <= _TIER_ORDER.index(board_tier)


def parse_catalog(text):
    """[id] blocks of key = value -> {id: {field: value}}."""
    out = {}
    current = None
    for line in text.split("\n"):
        line = line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = re.match(r"^\[([^\]]+)\]$", stripped)
        if m:
            current = m.group(1).strip()
            out[current] = {"id": current}
            continue
        if current and "=" in line:
            key, _, value = line.partition("=")
            out[current][key.strip()] = value.strip()
    return out


def load_catalog(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return parse_catalog(fh.read())
    except IOError:
        return {}


def current_model(runtime_env):
    """(model_file, ctx) from runtime.env, or (None, None)."""
    model, ctx = None, None
    try:
        with open(runtime_env) as fh:
            for line in fh:
                if line.startswith("MODEL_FILE="):
                    model = line.split("=", 1)[1].strip()
                elif line.startswith("CTX="):
                    ctx = line.split("=", 1)[1].strip()
    except IOError:
        pass
    return model, ctx


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def installed(models_dir):
    if not os.path.isdir(models_dir):
        return []
    return sorted(f for f in os.listdir(models_dir) if f.endswith(".gguf"))


def list_models(cfg):
    catalog = load_catalog(cfg.models_catalog)
    board = detect_tier()
    have = set(installed(cfg.models_dir))
    active, _ = current_model(cfg.runtime_env)
    rows = []
    for mid, entry in sorted(catalog.items()):
        rows.append(
            {
                "id": mid,
                "name": entry.get("name", mid),
                "file": entry.get("file", ""),
                "ram_tier": entry.get("ram_tier", "?"),
                "fits": tier_fits(entry.get("ram_tier", ""), board),
                "installed": entry.get("file", "") in have,
                "active": entry.get("file", "") == active,
            }
        )
    return {"board_tier": board, "active": active, "models": rows}


def _download(url, dest, expected_sha=None):
    """Fetch url to dest atomically; verify sha256 when known."""
    tmp = dest + ".part"
    try:
        with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as out:
            shutil.copyfileobj(resp, out)
    except Exception as exc:  # noqa: BLE001 - urllib raises many types
        if os.path.exists(tmp):
            os.unlink(tmp)
        # curl fallback (some HF redirects behave better under curl)
        rc = subprocess.call(
            ["curl", "-fL", "--retry", "3", "-o", tmp, url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if rc != 0:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise RuntimeError("download failed: %s" % exc)
    if expected_sha and expected_sha != "TBD":
        actual = _sha256(tmp)
        if actual != expected_sha:
            os.unlink(tmp)
            raise RuntimeError(
                "sha256 mismatch: expected %s got %s" % (expected_sha, actual)
            )
    os.rename(tmp, dest)
    return dest


def download(cfg, id_or_url, force=False):
    """Download a catalog entry (by id) or a raw .gguf URL. Returns a dict."""
    catalog = load_catalog(cfg.models_catalog)
    board = detect_tier()
    if id_or_url in catalog:
        entry = catalog[id_or_url]
        if not force and not tier_fits(entry.get("ram_tier", ""), board):
            raise RuntimeError(
                "model tier %s does not fit this board (%s); use --force to override"
                % (entry.get("ram_tier"), board)
            )
        url, fname, sha = entry["url"], entry["file"], entry.get("sha256")
    else:
        url = id_or_url
        if not url.startswith(("http://", "https://")) or not url.endswith(".gguf"):
            raise RuntimeError("not a catalog id or a .gguf URL: %r" % id_or_url)
        fname = os.path.basename(url.split("?", 1)[0])
        sha = None  # trust-on-first-use for arbitrary URLs
    os.makedirs(cfg.models_dir, exist_ok=True)
    dest = os.path.join(cfg.models_dir, fname)
    _download(url, dest, sha)
    return {"file": fname, "path": dest, "sha_verified": bool(sha and sha != "TBD")}


def _write_runtime_env(runtime_env, updates):
    """Rewrite only the given keys in runtime.env, preserving everything else
    (LLAMA_VARIANT / LLAMA_EXTRA_ARGS must survive)."""
    lines = []
    seen = set()
    try:
        with open(runtime_env) as fh:
            for line in fh:
                key = line.split("=", 1)[0].strip()
                if key in updates:
                    lines.append("%s=%s\n" % (key, updates[key]))
                    seen.add(key)
                else:
                    lines.append(line if line.endswith("\n") else line + "\n")
    except IOError:
        pass
    for key, value in updates.items():
        if key not in seen:
            lines.append("%s=%s\n" % (key, value))
    with open(runtime_env, "w") as fh:
        fh.writelines(lines)


def use(cfg, id_or_file, restart=True, health=None, force=False):
    """Switch the active model. Rewrites MODEL_FILE (+CTX from the catalog),
    restarts llama-server, health-polls, rolls back on failure."""
    catalog = load_catalog(cfg.models_catalog)
    board = detect_tier()
    ctx = None
    fname = id_or_file
    if id_or_file in catalog:
        entry = catalog[id_or_file]
        fname = entry["file"]
        ctx = entry.get("ctx")
        if not force and not tier_fits(entry.get("ram_tier", ""), board):
            raise RuntimeError(
                "model tier %s does not fit this board (%s); use --force"
                % (entry.get("ram_tier"), board)
            )
    dest = os.path.join(cfg.models_dir, fname)
    if not os.path.isfile(dest):
        raise RuntimeError("model not downloaded: %s" % fname)

    backup = None
    if os.path.exists(cfg.runtime_env):
        backup = cfg.runtime_env + ".bak"
        shutil.copy(cfg.runtime_env, backup)

    updates = {"MODEL_FILE": fname}
    if ctx:
        updates["CTX"] = ctx
    _write_runtime_env(cfg.runtime_env, updates)

    if not restart:
        return {"file": fname, "restarted": False}

    subprocess.call(["systemctl", "restart", "llama-server"])
    ok = (health or _default_health)(cfg.llama_url)
    if not ok:
        if backup:
            shutil.copy(backup, cfg.runtime_env)
            subprocess.call(["systemctl", "restart", "llama-server"])
        raise RuntimeError("new model failed health check; rolled back to previous")
    return {"file": fname, "restarted": True}


def _default_health(url):
    from . import llm

    for _ in range(60):
        if llm.health(url):
            return True
        import time

        time.sleep(5)
    return False


def remove(cfg, fname):
    active, _ = current_model(cfg.runtime_env)
    if fname == active:
        raise RuntimeError("refusing to remove the active model: %s" % fname)
    path = os.path.join(cfg.models_dir, fname)
    if not os.path.isfile(path):
        raise RuntimeError("no such model: %s" % fname)
    os.unlink(path)
    return {"removed": fname}


def cli(cfg, args):
    """Dispatch for `gardener models …`. Returns an exit code."""
    action = args.models_action
    if action == "list":
        print(json.dumps(list_models(cfg), indent=2, sort_keys=True))
        return 0
    if action == "download":
        print(json.dumps(download(cfg, args.target, force=args.force), indent=2))
        return 0
    if action == "use":
        print(json.dumps(use(cfg, args.target, force=args.force), indent=2))
        return 0
    if action == "rm":
        print(json.dumps(remove(cfg, args.target), indent=2))
        return 0
    return 2
