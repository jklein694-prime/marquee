"""Gardener configuration: KEY=VALUE file (shell-sourceable) + defaults.

On-device file: /etc/wikigardener/gardener.conf. Tests point elsewhere via
Config(path=...) or the WIKIGARDENER_CONF env var.
"""
import os

DEFAULT_CONF = "/etc/wikigardener/gardener.conf"

DEFAULTS = {
    "VAULT_DIR": "/var/lib/wikigardener/vault",
    "QUEUE_DIR": "/var/lib/wikigardener/queue",
    "STATE_FILE": "/var/lib/wikigardener/state.json",
    "LLAMA_URL": "http://127.0.0.1:8080",
    "INTERVAL_MIN": "15",
    "MAX_CHANGES_PER_DAY": "40",
    "COOLDOWN_DAYS": "3",
    "CTX": "3072",
    "MAX_TOKENS": "300",
    "TEMPERATURE": "0.3",
    "LLM_TIMEOUT_SEC": "600",
    "TIER_OVERRIDE": "",
}

_INT_KEYS = (
    "INTERVAL_MIN",
    "MAX_CHANGES_PER_DAY",
    "COOLDOWN_DAYS",
    "CTX",
    "MAX_TOKENS",
    "LLM_TIMEOUT_SEC",
)
_FLOAT_KEYS = ("TEMPERATURE",)


def parse_conf(text):
    """KEY=VALUE lines; '#' comments and blanks ignored; quotes stripped."""
    out = {}
    for line in text.split("\n"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        out[key] = value
    return out


class Config(object):
    def __init__(self, path=None, overrides=None):
        values = dict(DEFAULTS)
        path = path or os.environ.get("WIKIGARDENER_CONF") or DEFAULT_CONF
        if os.path.exists(path):
            values.update(
                {
                    k: v
                    for k, v in parse_conf(open(path).read()).items()
                    if k in DEFAULTS
                }
            )
        if overrides:
            values.update(overrides)
        for key, raw in values.items():
            if key in _INT_KEYS:
                setattr(self, key.lower(), int(raw))
            elif key in _FLOAT_KEYS:
                setattr(self, key.lower(), float(raw))
            else:
                setattr(self, key.lower(), raw)
