"""Audit flow against a mocked Anthropic /v1/messages endpoint."""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from gardener.config import Config
from gardener.gitops import Git
from gardener.workqueue import WorkQueue

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "payload", "audit"))
import audit  # noqa: E402


AUDIT_REPLY = """## Verdict
Healthy overall, two problems.

## Problems
- Collateral page links a nonexistent film.

```json
[
  {"file": "wiki/movies/Collateral (2004).md",
   "instruction": "Remove the dead link [[Nonexistent Film (1999)]] from the 'See also' line.",
   "priority": 1, "kind": "fix"},
  {"file": "wiki/movies/genres/Crime.md",
   "instruction": "Add a bullet linking [[Solaris (1972)]].",
   "priority": 3, "kind": "enrich"},
  {"file": "wiki/log.md", "instruction": "Revert the bad commit.",
   "priority": 1, "kind": "revert", "sha": "REPLACED_AT_RUNTIME"},
  {"file": "../etc/passwd", "instruction": "evil", "priority": 1, "kind": "fix"},
  {"file": "wiki/movies/Missing (1900).md", "instruction": "x", "priority": 2, "kind": "fix"},
  {"file": "wiki/log.md", "instruction": "bad sha revert", "kind": "revert", "sha": "nothex!"}
]
```
"""


class MockAnthropic(object):
    def __init__(self, reply_text):
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                outer.requests.append(
                    {
                        "path": self.path,
                        "headers": {k.lower(): v for k, v in self.headers.items()},
                        "body": json.loads(self.rfile.read(length).decode()),
                    }
                )
                body = json.dumps(
                    {"content": [{"type": "text", "text": reply_text}]}
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        thread = threading.Thread(target=self.server.serve_forever)
        thread.daemon = True
        thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def audit_env(git_vault, tmp_path, monkeypatch):
    git = Git(git_vault)
    sha = git.head()
    reply = AUDIT_REPLY.replace("REPLACED_AT_RUNTIME", sha)
    server = MockAnthropic(reply)
    conf = tmp_path / "gardener.conf"
    conf.write_text(
        "VAULT_DIR=%s\nQUEUE_DIR=%s\nSTATE_FILE=%s\n"
        % (git_vault, tmp_path / "queue", tmp_path / "state.json")
    )
    key = tmp_path / "anthropic.key"
    key.write_text("sk-ant-test")
    yield {
        "conf": str(conf),
        "key": str(key),
        "server": server,
        "vault": git_vault,
        "queue_dir": str(tmp_path / "queue"),
        "sha": sha,
    }
    server.stop()


def test_audit_end_to_end(audit_env):
    rc = audit.main(
        [
            "--conf", audit_env["conf"],
            "--key-file", audit_env["key"],
            "--base-url", audit_env["server"].url,
        ]
    )
    assert rc == 0

    # one API call with the right shape
    (req,) = audit_env["server"].requests
    assert req["path"] == "/v1/messages"
    assert req["headers"]["x-api-key"] == "sk-ant-test"
    assert req["headers"]["anthropic-version"] == "2023-06-01"
    assert req["body"]["model"] == audit.MODEL
    assert "dead wikilink" in req["body"]["messages"][0]["content"]

    # audit note written and committed, tag created
    audits_dir = os.path.join(audit_env["vault"], "wiki", "audits")
    notes = os.listdir(audits_dir)
    assert len(notes) == 1
    git = Git(audit_env["vault"])
    assert not git.dirty()
    assert git.latest_tag("audit/")

    # only the valid corrections were queued, at top priority
    q = WorkQueue(audit_env["queue_dir"])
    pending = q.pending()
    assert len(pending) == 3
    assert all(name.startswith("00-") for name, _ in pending)
    by_kind = {item["kind"] for _, item in pending}
    assert by_kind == {"fix", "enrich", "revert"}
    revert = [item for _, item in pending if item["kind"] == "revert"][0]
    assert revert["sha"] == audit_env["sha"]
    # path escape, missing file, and malformed sha were all dropped
    targets = {item["target"] for _, item in pending}
    assert "../etc/passwd" not in targets
    assert "wiki/movies/Missing (1900).md" not in targets


def test_parse_corrections_empty_and_garbage(git_vault):
    from gardener.vaultio import Vault

    v = Vault(git_vault)
    assert audit.parse_corrections("no json block", v) == []
    assert audit.parse_corrections("```json\nnot json\n```", v) == []
    assert audit.parse_corrections('```json\n{"not": "a list"}\n```', v) == []
    assert audit.parse_corrections("```json\n[]\n```", v) == []


def test_second_audit_diffs_since_last_tag(audit_env):
    audit.main(
        ["--conf", audit_env["conf"], "--key-file", audit_env["key"],
         "--base-url", audit_env["server"].url]
    )
    # a change lands after the first audit
    with open(os.path.join(audit_env["vault"], "wiki", "log.md"), "a") as fh:
        fh.write("post-audit change\n")
    Git(audit_env["vault"]).commit_all("gardener(enrich): post-audit change")
    audit.main(
        ["--conf", audit_env["conf"], "--key-file", audit_env["key"],
         "--base-url", audit_env["server"].url]
    )
    second = audit_env["server"].requests[-1]["body"]["messages"][0]["content"]
    assert "post-audit change" in second
    assert "seed" not in second.split("# Patch series")[1].split("#", 1)[0]
