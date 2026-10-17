"""host-mode.sh retires the on-device AI and turns on Tailscale HTTPS —
idempotently, keeping the vault's git sync. systemctl/tailscale/id stubbed."""
import os
import subprocess

from conftest import JETSON

SCRIPT = os.path.join(JETSON, "payload", "host-mode.sh")
STUB = "#!/usr/bin/env bash\n%s\n"

RETIRED = ["gardener.timer", "gardener.service", "llama-server.service",
           "wikigardener-suggest.timer", "wikigardener-suggest.service",
           "wikigardener-notify.timer", "wikigardener-notify.service",
           "wikigardener-web.service"]
KEPT = ["wikigardener-sync.timer", "wikigardener-sync.service", "wikigardener-app.service"]


def _stub(bindir, name, body):
    p = bindir / name
    p.write_text(STUB % body)
    p.chmod(0o755)


def _setup(tmp_path, tailscale=None, conf=""):
    opt, etc, units, bindir = (tmp_path / d for d in ("opt", "etc", "units", "stubs"))
    for d in (opt / "bin", opt / "models", opt / "src", etc, units, bindir):
        d.mkdir(parents=True)
    for u in RETIRED + KEPT:
        (units / u).write_text("[Unit]\n")
    (opt / "bin" / "llama-server-cpu").write_text("x")
    os.symlink("llama-server-cpu", str(opt / "bin" / "llama-server"))
    (opt / "models" / "qwen.gguf").write_text("x")
    (etc / "gardener.conf").write_text(conf)
    calls = tmp_path / "calls.log"
    _stub(bindir, "systemctl", 'echo "systemctl $*" >> %s' % calls)
    _stub(bindir, "id", "echo 0")
    if tailscale is not None:
        _stub(bindir, "tailscale", 'echo "tailscale $*" >> %s\n%s' % (calls, tailscale))
    env = dict(os.environ, WG_OPT=str(opt), WG_ETC=str(etc), WG_UNITS_DIR=str(units),
               PATH="%s:/usr/bin:/bin" % bindir)
    return env, opt, units, calls


def _run(env):
    return subprocess.run(["bash", SCRIPT], env=env, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, universal_newlines=True)


def test_retires_local_ai_and_keeps_sync(tmp_path):
    env, opt, units, calls = _setup(tmp_path)
    proc = _run(env)
    assert proc.returncode == 0, proc.stdout
    for u in RETIRED:
        assert not (units / u).exists(), u
    for u in KEPT:
        assert (units / u).exists(), u
    assert not (opt / "models" / "qwen.gguf").exists()
    assert not os.path.lexists(str(opt / "bin" / "llama-server"))
    assert not (opt / "src").exists()
    log = calls.read_text()
    assert "systemctl disable --now llama-server.service" in log
    assert "wikigardener-sync" not in log
    assert "tailscale not installed" in proc.stdout
    # second run: nothing left to do, still succeeds
    proc2 = _run(env)
    assert proc2.returncode == 0 and "already retired" in proc2.stdout


def test_keep_local_ai_opt_out(tmp_path):
    env, opt, units, _ = _setup(tmp_path, conf="KEEP_LOCAL_AI=1\n")
    assert _run(env).returncode == 0
    assert (units / "llama-server.service").exists()
    assert (opt / "models" / "qwen.gguf").exists()


def test_tailscale_serve_enabled(tmp_path):
    ts = ('case "$1" in\n'
          '  status) [ "$2" = "--json" ] && echo \'{"Self":{"DNSName":"wikigardener.tail934990.ts.net."}}\'; exit 0;;\n'
          '  serve) [ "$2" = "status" ] && exit 0; exit 0;;\n'
          'esac')
    env, _, _, calls = _setup(tmp_path, tailscale=ts)
    proc = _run(env)
    assert proc.returncode == 0, proc.stdout
    assert "https://wikigardener.tail934990.ts.net" in proc.stdout
    assert "tailscale serve --bg --https=443 http://127.0.0.1:3000" in calls.read_text()


def test_tailscale_serve_failure_is_not_fatal(tmp_path):
    ts = ('case "$1" in\n'
          '  status) exit 0;;\n'
          '  serve) [ "$2" = "status" ] && exit 0; exit 1;;\n'
          'esac')
    env, _, _, _ = _setup(tmp_path, tailscale=ts)
    proc = _run(env)
    assert proc.returncode == 0
    assert "HTTPS Certificates" in proc.stdout
