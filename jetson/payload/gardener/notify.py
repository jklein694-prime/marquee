"""Push notifications — how the gardener talks to you.

Delivery is via ntfy (https://ntfy.sh): you install the ntfy app on your
phone/Mac, subscribe to a private topic, and set NTFY_TOPIC in gardener.conf
(the wizard does this). Publishing is one HTTP POST — no account, no SDK.

Offline-safe by design: notes are queued as files (maildir-style, like the
work queue) and flushed whenever the device is online — immediately when
possible, else by the hourly notify timer or the next online window. The
gardener never blocks on the network.

  notify/pending/<ts>-<slug>.json   waiting to send
  notify/sent/...                   delivered (pruned to last 200)
"""
import json
import os
import re
import time
import urllib.request

from . import net

KEEP_SENT = 200


def _dir(cfg, state):
    d = os.path.join(cfg.notify_dir, state)
    os.makedirs(d, exist_ok=True)
    return d


def _slug(text):
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()[:40] or "note"


def queue_note(cfg, title, message, tags=None, priority=None):
    """Queue one notification. Returns its filename."""
    name = "%d-%s.json" % (int(time.time() * 1000), _slug(title))
    note = {
        "title": title,
        "message": message,
        "tags": tags or [],
        "priority": priority or "default",
        "queued_at": int(time.time()),
    }
    pending = _dir(cfg, "pending")
    tmp = os.path.join(pending, "." + name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(note, fh, indent=2)
    os.rename(tmp, os.path.join(pending, name))
    return name


def _post(cfg, note):
    url = "%s/%s" % (cfg.ntfy_server.rstrip("/"), cfg.ntfy_topic)
    headers = {"Title": note["title"].encode("utf-8", "replace").decode("ascii", "replace")}
    if note.get("tags"):
        headers["Tags"] = ",".join(note["tags"])
    if note.get("priority") and note["priority"] != "default":
        headers["Priority"] = str(note["priority"])
    req = urllib.request.Request(
        url, data=note["message"].encode("utf-8"), headers=headers
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status == 200


def flush(cfg, require_online=True):
    """Send everything pending. Returns {sent, failed, skipped_reason}."""
    if not cfg.ntfy_topic:
        return {"sent": 0, "failed": 0, "skipped_reason": "NTFY_TOPIC not set"}
    pending = _dir(cfg, "pending")
    names = sorted(f for f in os.listdir(pending) if f.endswith(".json"))
    if not names:
        return {"sent": 0, "failed": 0, "skipped_reason": ""}
    if require_online and not net.online(
        host=cfg.ntfy_server.split("//", 1)[-1].split("/", 1)[0]
    ):
        return {"sent": 0, "failed": 0, "skipped_reason": "offline"}
    sent = failed = 0
    sent_dir = _dir(cfg, "sent")
    for name in names:
        path = os.path.join(pending, name)
        try:
            with open(path, encoding="utf-8") as fh:
                note = json.load(fh)
            if _post(cfg, note):
                os.rename(path, os.path.join(sent_dir, name))
                sent += 1
            else:
                failed += 1
        except Exception:  # noqa: BLE001 - one bad note must not stop the rest
            failed += 1
    _prune(sent_dir)
    return {"sent": sent, "failed": failed, "skipped_reason": ""}


def _prune(sent_dir):
    names = sorted(f for f in os.listdir(sent_dir) if f.endswith(".json"))
    for name in names[: max(0, len(names) - KEEP_SENT)]:
        os.unlink(os.path.join(sent_dir, name))


def pending_count(cfg):
    pending = os.path.join(cfg.notify_dir, "pending")
    if not os.path.isdir(pending):
        return 0
    return len([f for f in os.listdir(pending) if f.endswith(".json")])
