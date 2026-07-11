import json
import threading
import urllib.request

import pytest

from gardener import webui
from gardener.config import Config
from gardener.webui import _ThreadingServer, make_handler


@pytest.fixture
def webcfg(git_vault, tmp_path):
    token_file = tmp_path / "dashboard.token"
    token_file.write_text("s3cret")
    return Config(
        path="/nonexistent",
        overrides={
            "VAULT_DIR": git_vault,
            "QUEUE_DIR": str(tmp_path / "queue"),
            "STATE_FILE": str(tmp_path / "state.json"),
            "JOBS_DIR": str(tmp_path / "jobs"),
            "DASHBOARD_TOKEN_FILE": str(token_file),
            "MODELS_DIR": str(tmp_path / "models"),
            "MODELS_CATALOG": str(tmp_path / "empty.catalog"),
            "RUNTIME_ENV": str(tmp_path / "runtime.env"),
            "LLAMA_URL": "http://127.0.0.1:9",
        },
    )


@pytest.fixture
def server(webcfg):
    httpd = _ThreadingServer(("127.0.0.1", 0), make_handler(webcfg))
    t = threading.Thread(target=httpd.serve_forever)
    t.daemon = True
    t.start()
    base = "http://127.0.0.1:%d" % httpd.server_address[1]
    yield base, webcfg
    httpd.shutdown()
    httpd.server_close()


def _req(base, path, method="GET", body=None, headers=None, cookie=None):
    url = base + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, resp.read().decode(), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), e.headers


def test_login_required_redirects(server):
    base, _ = server
    # urllib follows the 302 to /login (200 html); assert we didn't get the app
    status, body, _ = _req(base, "/api/status")
    assert "llama_healthy" not in body


def test_login_success_sets_cookie(server):
    base, _ = server
    status, body, headers = _req(base, "/login", "POST", {"password": "s3cret"})
    assert status == 204
    assert "wg_session=s3cret" in headers.get("Set-Cookie", "")
    assert "HttpOnly" in headers.get("Set-Cookie", "")
    assert "SameSite=Strict" in headers.get("Set-Cookie", "")


def test_login_wrong_password(server):
    base, _ = server
    status, _, _ = _req(base, "/login", "POST", {"password": "nope"})
    assert status == 401


def test_authed_status_ok(server):
    base, _ = server
    status, body, _ = _req(base, "/api/status", cookie="wg_session=s3cret")
    assert status == 200
    data = json.loads(body)
    assert "queue" in data and "pages" in data


def test_mutation_requires_csrf_and_origin(server):
    base, _ = server
    # authed but no CSRF header -> 403
    status, _, _ = _req(base, "/api/timer", "POST", {"state": "pause"},
                        cookie="wg_session=s3cret")
    assert status == 403
    # bad origin -> 403 even with CSRF
    status, _, _ = _req(base, "/api/timer", "POST", {"state": "pause"},
                        cookie="wg_session=s3cret",
                        headers={"X-WG-CSRF": "s3cret", "Origin": "http://evil.example"})
    assert status == 403


def test_mutation_with_csrf_dispatches(server, monkeypatch):
    base, cfg = server
    calls = []
    monkeypatch.setattr(webui, "_systemctl", lambda *a: calls.append(a) or 0)
    status, body, _ = _req(base, "/api/timer", "POST", {"state": "pause"},
                          cookie="wg_session=s3cret",
                          headers={"X-WG-CSRF": "s3cret"})
    assert status == 200
    assert json.loads(body)["ok"] is True
    assert calls and calls[0][0] == "stop"


def test_run_once_starts_a_job(server):
    base, cfg = server
    status, body, _ = _req(base, "/api/run-once", "POST", {},
                          cookie="wg_session=s3cret",
                          headers={"X-WG-CSRF": "s3cret"})
    assert status == 200
    jid = json.loads(body)["job"]
    # the job status file exists (the spawned wrapper writes it)
    import time as _t

    for _ in range(20):
        j = _req(base, "/api/jobs/" + jid, cookie="wg_session=s3cret")
        if j[0] == 200:
            break
        _t.sleep(0.1)
    assert j[0] == 200


def test_unauthed_mutation_rejected(server):
    base, _ = server
    status, _, _ = _req(base, "/api/timer", "POST", {"state": "pause"},
                        headers={"X-WG-CSRF": "s3cret"})
    assert status == 401


# -- prompt editor validation --------------------------------------------------


def test_write_prompt_rejects_missing_placeholders(webcfg):
    with pytest.raises(ValueError, match="missing required placeholders"):
        webui.write_prompt(webcfg, "system", "no token here")


def test_write_prompt_saves_override(webcfg):
    res = webui.write_prompt(webcfg, "system", "Custom. __VAULT_DESCRIPTION__")
    assert res["saved"] == "system"
    p = webui.read_prompt(webcfg, "system")
    assert p["overridden"] is True
    assert p["text"].startswith("Custom.")
