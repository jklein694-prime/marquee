import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from gardener import notify
from gardener.config import Config


class MockNtfy(object):
    def __init__(self):
        self.posts = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                outer.posts.append(
                    {
                        "path": self.path,
                        "title": self.headers.get("Title", ""),
                        "tags": self.headers.get("Tags", ""),
                        "priority": self.headers.get("Priority", ""),
                        "body": self.rfile.read(length).decode(),
                    }
                )
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"{}")

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        t = threading.Thread(target=self.server.serve_forever)
        t.daemon = True
        t.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def ncfg(tmp_path):
    server = MockNtfy()
    cfg = Config(
        path="/nonexistent",
        overrides={
            "NOTIFY_DIR": str(tmp_path / "notify"),
            "NTFY_TOPIC": "my-private-topic",
            "NTFY_SERVER": server.url,
        },
    )
    yield cfg, server
    server.stop()


def test_queue_and_flush(ncfg, monkeypatch):
    cfg, server = ncfg
    monkeypatch.setattr(notify.net, "online", lambda **k: True)
    notify.queue_note(cfg, "Suggestions ready", "• Thief (1981) — Mann", tags=["seedling"])
    assert notify.pending_count(cfg) == 1
    res = notify.flush(cfg)
    assert res == {"sent": 1, "failed": 0, "skipped_reason": ""}
    assert notify.pending_count(cfg) == 0
    (post,) = server.posts
    assert post["path"] == "/my-private-topic"
    assert post["title"] == "Suggestions ready"
    assert post["tags"] == "seedling"
    assert "Thief (1981)" in post["body"]
    # moved to sent/
    assert len(os.listdir(os.path.join(cfg.notify_dir, "sent"))) == 1


def test_offline_keeps_queue(ncfg, monkeypatch):
    cfg, server = ncfg
    monkeypatch.setattr(notify.net, "online", lambda **k: False)
    notify.queue_note(cfg, "t", "m")
    res = notify.flush(cfg)
    assert res["skipped_reason"] == "offline"
    assert notify.pending_count(cfg) == 1
    assert server.posts == []


def test_no_topic_is_noop(tmp_path):
    cfg = Config(
        path="/nonexistent",
        overrides={"NOTIFY_DIR": str(tmp_path / "n"), "NTFY_TOPIC": ""},
    )
    notify.queue_note(cfg, "t", "m")
    assert notify.flush(cfg)["skipped_reason"] == "NTFY_TOPIC not set"
    assert notify.pending_count(cfg) == 1


def test_flush_empty_queue(ncfg):
    cfg, _ = ncfg
    assert notify.flush(cfg)["sent"] == 0


def test_bad_note_does_not_stop_the_rest(ncfg, monkeypatch):
    cfg, server = ncfg
    monkeypatch.setattr(notify.net, "online", lambda **k: True)
    pending = os.path.join(cfg.notify_dir, "pending")
    os.makedirs(pending, exist_ok=True)
    with open(os.path.join(pending, "0-garbage.json"), "w") as fh:
        fh.write("not json")
    notify.queue_note(cfg, "good", "note")
    res = notify.flush(cfg)
    assert res["sent"] == 1
    assert res["failed"] == 1
