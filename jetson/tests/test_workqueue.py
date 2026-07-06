import os
import time

from gardener import workqueue
from gardener.workqueue import WorkQueue


def test_priority_ordering(tmp_path):
    q = WorkQueue(str(tmp_path))
    q.enqueue(workqueue.PRIO_ENRICH, "enrich", {"target": "Heat (1995)"})
    q.enqueue(workqueue.PRIO_DEAD_LINK, "dead_link", {"target": "Ghost"})
    q.enqueue(workqueue.PRIO_AUDIT, "correction", {"target": "Crime"})
    name, item = q.claim()
    assert item["type"] == "correction"
    q.finish(name, ok=True)
    name, item = q.claim()
    assert item["type"] == "dead_link"


def test_claim_moves_to_active_and_finish_annotates(tmp_path):
    q = WorkQueue(str(tmp_path))
    q.enqueue(10, "dead_link", {"target": "Ghost"})
    name, item = q.claim()
    assert os.path.exists(str(tmp_path / "active" / name))
    assert q.counts()["pending"] == 0
    q.finish(name, ok=False, extra={"raw_output": "not json"})
    assert q.counts() == {"pending": 0, "active": 0, "done": 0, "failed": 1}
    failed = q._peek("failed", name)
    assert failed["ok"] is False
    assert failed["raw_output"] == "not json"


def test_empty_queue(tmp_path):
    q = WorkQueue(str(tmp_path))
    assert q.claim() == (None, None)


def test_stale_active_recovered(tmp_path):
    q = WorkQueue(str(tmp_path))
    q.enqueue(10, "dead_link", {"target": "Ghost"})
    name, _ = q.claim()
    # simulate a crash an hour+ ago
    stale = str(tmp_path / "active" / name)
    old = time.time() - workqueue.STALE_ACTIVE_SEC - 10
    os.utime(stale, (old, old))
    name2, item2 = q.claim()
    assert name2 == name
    assert item2["target"] == "Ghost"


def test_fresh_active_not_recovered(tmp_path):
    q = WorkQueue(str(tmp_path))
    q.enqueue(10, "dead_link", {"target": "Ghost"})
    q.claim()
    assert q.claim() == (None, None)


def test_duplicate_detection(tmp_path):
    q = WorkQueue(str(tmp_path))
    q.enqueue(10, "dead_link", {"target": "Ghost"})
    assert q.has_pending_type("dead_link", "Ghost")
    assert not q.has_pending_type("dead_link", "Other")
    assert not q.has_pending_type("orphan", "Ghost")


def test_prune_keeps_last_200(tmp_path):
    q = WorkQueue(str(tmp_path))
    for i in range(workqueue.KEEP_FINISHED + 25):
        name = q.enqueue(50, "enrich", {"target": "t%d" % i})
        claimed, _ = q.claim()
        q.finish(claimed, ok=True)
    assert q.counts()["done"] == workqueue.KEEP_FINISHED


def test_atomic_write_no_partial_json(tmp_path):
    q = WorkQueue(str(tmp_path))
    q.enqueue(10, "dead_link", {"target": "Ghost"})
    # no .tmp files ever visible as pending work
    assert all(not f.startswith(".") for f in os.listdir(str(tmp_path / "pending")))
