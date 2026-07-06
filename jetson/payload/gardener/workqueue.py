"""Maildir-style journaled work queue. `ls` is the debugger.

  queue/pending/<prio>-<ts>-<type>-<slug>.json   waiting (filename sort = order)
  queue/active/...                               claimed by a running cycle
  queue/done/... , queue/failed/...              finished (pruned to last 200)

Claims are atomic os.rename moves, so power loss can never half-claim an
item; anything stranded in active/ longer than an hour (a crashed cycle) is
swept back to pending on the next startup.

Priorities: 00 audit corrections, 10 dead links, 20 orphans, 50 enrichment.
"""
import json
import os
import re
import time

PRIO_AUDIT = 0
PRIO_DEAD_LINK = 10
PRIO_ORPHAN = 20
PRIO_ENRICH = 50

STALE_ACTIVE_SEC = 3600
KEEP_FINISHED = 200
DIRS = ("pending", "active", "done", "failed")


def _slug(text):
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()[:48] or "item"


class WorkQueue(object):
    def __init__(self, root):
        self.root = root
        for d in DIRS:
            os.makedirs(os.path.join(root, d), exist_ok=True)

    def _dir(self, state):
        return os.path.join(self.root, state)

    def _listing(self, state):
        return sorted(
            f for f in os.listdir(self._dir(state)) if f.endswith(".json")
        )

    # -- producing -------------------------------------------------------------

    def enqueue(self, priority, task_type, payload, slug=""):
        """Write one pending item; returns its id (the filename)."""
        name = "%02d-%d-%s-%s.json" % (
            priority,
            int(time.time() * 1000),
            _slug(task_type),
            _slug(slug or payload.get("target", "")),
        )
        item = dict(payload, type=task_type, priority=priority)
        tmp = os.path.join(self._dir("pending"), "." + name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(item, fh, indent=2, sort_keys=True)
        os.rename(tmp, os.path.join(self._dir("pending"), name))
        return name

    def has_pending_type(self, task_type, target=None):
        """Cheap duplicate check so lint refills don't stack the same work."""
        for name in self._listing("pending"):
            item = self._peek("pending", name)
            if item.get("type") != task_type:
                continue
            if target is None or item.get("target") == target:
                return True
        return False

    # -- consuming -------------------------------------------------------------

    def claim(self):
        """Atomically move the highest-priority pending item to active/.

        Returns (id, item) or (None, None) when the queue is empty.
        """
        self.recover_stale()
        for name in self._listing("pending"):
            src = os.path.join(self._dir("pending"), name)
            dst = os.path.join(self._dir("active"), name)
            try:
                os.rename(src, dst)
            except OSError:
                continue  # raced with another consumer; try the next item
            return name, self._peek("active", name)
        return None, None

    def finish(self, name, ok, extra=None):
        """Move an active item to done/ or failed/, annotating it first."""
        src = os.path.join(self._dir("active"), name)
        item = self._peek("active", name)
        item["finished_at"] = int(time.time())
        item["ok"] = bool(ok)
        if extra:
            item.update(extra)
        with open(src, "w", encoding="utf-8") as fh:
            json.dump(item, fh, indent=2, sort_keys=True)
        os.rename(src, os.path.join(self._dir("done" if ok else "failed"), name))
        self._prune("done")
        self._prune("failed")

    def release(self, name):
        """Put an active item back to pending (e.g. LLM server hiccup)."""
        src = os.path.join(self._dir("active"), name)
        if os.path.exists(src):
            os.rename(src, os.path.join(self._dir("pending"), name))

    def recover_stale(self):
        """Return crashed cycles' items (old files in active/) to pending."""
        now = time.time()
        for name in self._listing("active"):
            path = os.path.join(self._dir("active"), name)
            try:
                age = now - os.path.getmtime(path)
            except OSError:
                continue
            if age > STALE_ACTIVE_SEC:
                os.rename(path, os.path.join(self._dir("pending"), name))

    # -- inspection ------------------------------------------------------------

    def counts(self):
        return {d: len(self._listing(d)) for d in DIRS}

    def pending(self):
        return [(n, self._peek("pending", n)) for n in self._listing("pending")]

    def _peek(self, state, name):
        with open(os.path.join(self._dir(state), name), encoding="utf-8") as fh:
            return json.load(fh)

    def _prune(self, state):
        paths = [os.path.join(self._dir(state), n) for n in self._listing(state)]
        paths.sort(key=lambda p: os.path.getmtime(p))  # oldest finished first
        for path in paths[: max(0, len(paths) - KEEP_FINISHED)]:
            os.unlink(path)
