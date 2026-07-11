from gardener import net


class FakeProc(object):
    def __init__(self, rc, out=""):
        self.returncode = rc
        self.stdout = out


def test_status_parses_nmcli(monkeypatch):
    monkeypatch.setattr(net.subprocess, "run", lambda *a, **k: FakeProc(0, "enabled\n"))
    assert net.status()["wifi"] == "enabled"


def test_status_unknown_when_nmcli_fails(monkeypatch):
    monkeypatch.setattr(net.subprocess, "run", lambda *a, **k: FakeProc(3, "boom"))
    assert net.status()["wifi"] == "unknown"


def test_on_off_return_bool(monkeypatch):
    calls = []

    def fake_run(args, **k):
        calls.append(args)
        return FakeProc(0, "")

    monkeypatch.setattr(net.subprocess, "run", fake_run)
    assert net.on() == (True, "")
    assert net.off() == (True, "")
    assert calls[0][-1] == "on"
    assert calls[1][-1] == "off"


def test_nmcli_missing_is_graceful(monkeypatch):
    def boom(*a, **k):
        raise OSError("no nmcli")

    monkeypatch.setattr(net.subprocess, "run", boom)
    assert net.status()["wifi"] == "unknown"
    assert net.on()[0] is False


def test_online_checks_curl_rc(monkeypatch):
    monkeypatch.setattr(net.subprocess, "run", lambda *a, **k: FakeProc(0))
    assert net.online() is True
    monkeypatch.setattr(net.subprocess, "run", lambda *a, **k: FakeProc(7))
    assert net.online() is False
