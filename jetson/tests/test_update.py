"""update.sh (`wikigardener update`) end to end against a local git remote.

The app checkout starts in the state a real Nano was found in: one commit
behind, no `origin` remote, no upstream — exactly what made `git pull` (and
so install-app.sh) quietly rebuild stale code. nmcli/systemctl/id/getent/
python3 are stubbed on PATH; the app build is a stub installer."""
import os
import shutil
import subprocess

from conftest import JETSON

UPDATE = os.path.join(JETSON, "payload", "update.sh")

STUB = "#!/usr/bin/env bash\n%s\n"


def _git(cwd, *args):
    return subprocess.check_output(
        ["git", "-C", str(cwd)] + list(args), universal_newlines=True
    ).strip()


def _commit(work, msg):
    _git(work, "add", "-A")
    _git(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", msg)


def _stub(bindir, name, body):
    path = bindir / name
    path.write_text(STUB % body)
    path.chmod(0o755)


def _setup(tmp_path):
    work = tmp_path / "work"
    payload = work / "jetson" / "payload"
    (payload / "gardener").mkdir(parents=True)
    (payload / "audit").mkdir()
    (payload / "app").mkdir()
    (payload / "gardener" / "__init__.py").write_text("")
    (payload / "audit" / "audit.py").write_text('MODEL = "old"\n')
    (payload / "app" / "install-app.sh").write_text("true\n")
    (payload / "setup-wizard.sh").write_text("true\n")
    (payload / "wikigardener").write_text("true\n")
    shutil.copy(UPDATE, str(payload / "update.sh"))
    _git(tmp_path, "init", "-q", "-b", "main", str(work))
    _commit(work, "old")
    old = _git(work, "rev-parse", "HEAD")
    (payload / "audit" / "audit.py").write_text('MODEL = "claude-sonnet-5-5"\n')
    (payload / "gardener" / "new_module.py").write_text("")
    _commit(work, "new")
    remote = tmp_path / "remote.git"
    _git(tmp_path, "clone", "-q", "--bare", str(work), str(remote))

    opt = tmp_path / "opt"
    app = opt / "app-src"
    _git(tmp_path, "clone", "-q", str(remote), str(app))
    _git(app, "reset", "-q", "--hard", old)
    _git(app, "remote", "remove", "origin")  # the broken state from the field
    (opt / "gardener").mkdir()
    (opt / "gardener" / "stale.py").write_text("")

    etc = tmp_path / "etc"
    etc.mkdir()
    (etc / "gardener.conf").write_text("APP_REPO=%s\n" % remote)

    bindir = tmp_path / "stubs"
    bindir.mkdir()
    calls = tmp_path / "calls.log"
    _stub(bindir, "nmcli",
          'echo "nmcli $*" >> %s; [ "$*" = "radio wifi" ] && echo disabled; true' % calls)
    _stub(bindir, "systemctl",
          'echo "systemctl $*" >> %s\n'
          'if [ "$1" = is-active ]; then\n'
          '  [ "${STUB_APP_ACTIVE:-}" = 1 ] && [[ "$*" == *wikigardener-app* ]] && exit 0\n'
          '  echo inactive; exit 3\nfi; true' % calls)
    _stub(bindir, "id", "echo 0")
    _stub(bindir, "getent", "true")
    _stub(bindir, "python3", "true")  # can_reach: the network is "up"
    installer = tmp_path / "installer.sh"
    installer.write_text('echo "built SKIP_PULL=$WG_SKIP_PULL" >> %s\n' % calls)

    env = dict(
        os.environ,
        PATH="%s:%s" % (bindir, os.environ["PATH"]),
        WG_OPT=str(opt), WG_ETC=str(etc), WG_VAR=str(tmp_path / "var"),
        WG_BIN=str(tmp_path / "bin"), WG_APP_DIR=str(app),
        WG_RESOLV=str(tmp_path / "resolv.conf"),
        WG_APP_INSTALLER=str(installer),
    )
    os.makedirs(env["WG_BIN"])
    return dict(env=env, app=app, opt=opt, remote=remote, calls=calls,
                var=tmp_path / "var", new=_git(work, "rev-parse", "HEAD"))


def _run(s, *args, **extra):
    env = dict(s["env"], **extra)
    return subprocess.run(["bash", UPDATE, "--fg"] + list(args), env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          universal_newlines=True)


def test_update_repairs_checkout_and_deploys(tmp_path):
    s = _setup(tmp_path)
    proc = _run(s)
    assert proc.returncode == 0, proc.stdout

    app = s["app"]
    assert _git(app, "rev-parse", "HEAD") == s["new"]
    assert _git(app, "remote", "get-url", "origin") == str(s["remote"])
    assert _git(app, "rev-parse", "--abbrev-ref", "@{u}") == "origin/main"

    opt = s["opt"]
    assert "claude-sonnet-5-5" in (opt / "audit" / "audit.py").read_text()
    assert (opt / "gardener" / "new_module.py").exists()
    assert not (opt / "gardener" / "stale.py").exists()  # replaced, not merged
    assert (opt / "update.sh").exists()
    assert os.path.exists(os.path.join(s["env"]["WG_BIN"], "wikigardener"))

    calls = s["calls"].read_text()
    assert "built SKIP_PULL=1" in calls
    # WiFi was off: turned on for the update, back off afterwards
    assert calls.index("nmcli radio wifi on") < calls.index("nmcli radio wifi off")
    assert (s["var"] / "update.status").read_text().startswith("0 ")


def test_update_skips_rebuild_when_current(tmp_path):
    s = _setup(tmp_path)
    assert _run(s).returncode == 0
    s["calls"].write_text("")
    proc = _run(s, STUB_APP_ACTIVE="1")
    assert proc.returncode == 0, proc.stdout
    assert "skipping rebuild" in proc.stdout
    assert "built" not in s["calls"].read_text()
    # --force rebuilds anyway
    assert _run(s, "--force", STUB_APP_ACTIVE="1").returncode == 0
    assert "built SKIP_PULL=1" in s["calls"].read_text()


def test_update_failure_still_restores_wifi(tmp_path):
    s = _setup(tmp_path)
    conf = os.path.join(s["env"]["WG_ETC"], "gardener.conf")
    with open(conf, "w") as fh:
        fh.write("APP_REPO=%s\n" % (tmp_path / "missing.git"))
    proc = _run(s)
    assert proc.returncode != 0
    assert "nmcli radio wifi off" in s["calls"].read_text()
    assert not (s["var"] / "update.status").read_text().startswith("0 ")
    assert "built" not in s["calls"].read_text()


def test_background_mode_follows_and_reports(tmp_path):
    # systemd-run stub: run the unit's command inline with its --setenv vars,
    # so the outer hand-off + follow + report path is exercised
    s = _setup(tmp_path)
    _stub(tmp_path / "stubs", "systemd-run",
          'envs=(); while [[ "$1" == --* ]]; do\n'
          '  [[ "$1" == --setenv=* ]] && envs+=("${1#--setenv=}"); shift; done\n'
          'env "${envs[@]}" "$@" >/dev/null 2>&1')
    proc = subprocess.run(["bash", UPDATE], env=s["env"], stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, universal_newlines=True)
    assert proc.returncode == 0, proc.stdout
    assert "safe to disconnect" in proc.stdout
    assert "UPDATE_OK" in proc.stdout and "new" in proc.stdout
    assert _git(s["app"], "rev-parse", "HEAD") == s["new"]
    # reattaching afterwards shows the result
    log = subprocess.run(["bash", UPDATE, "log"], env=s["env"], stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, universal_newlines=True)
    assert log.returncode == 0 and "UPDATE_OK" in log.stdout
