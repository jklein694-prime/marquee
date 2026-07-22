"""WiFi radio control — the only network the appliance ever touches, and only
during a deliberate window (model download, git sync, Sonnet audit). The
gardener and llama-server never use the network.

Thin wrapper over nmcli. Python 3.6 stdlib only — uses universal_newlines
rather than the 3.7 subprocess conveniences.
"""
import subprocess


def _nmcli(*args):
    try:
        proc = subprocess.run(
            ("nmcli",) + args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
        )
    except OSError as exc:
        return 1, "nmcli unavailable: %s" % exc
    return proc.returncode, proc.stdout.strip()


def status():
    """{'wifi': 'enabled'|'disabled'|'unknown', 'detail': <raw>}."""
    rc, out = _nmcli("radio", "wifi")
    if rc != 0:
        return {"wifi": "unknown", "detail": out}
    return {"wifi": out.strip() or "unknown", "detail": out}


def on():
    rc, out = _nmcli("radio", "wifi", "on")
    return rc == 0, out


def off():
    rc, out = _nmcli("radio", "wifi", "off")
    return rc == 0, out


def online(host="api.anthropic.com", timeout=10):
    """True if we can reach the network right now (a HEAD to host)."""
    try:
        proc = subprocess.run(
            ("curl", "-sI", "--max-time", str(timeout), "https://%s" % host),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return False
    return proc.returncode == 0
