import os
import subprocess

import pytest

from gardener import sync as sync_mod
from gardener.config import Config
from gardener.gitops import Git
from gardener import lock


ENV = dict(
    os.environ,
    GIT_AUTHOR_NAME="t",
    GIT_AUTHOR_EMAIL="t@t",
    GIT_COMMITTER_NAME="t",
    GIT_COMMITTER_EMAIL="t@t",
)


def _git(cwd, *args):
    subprocess.check_call(["git"] + list(args), cwd=cwd, env=ENV)


@pytest.fixture
def remote_and_clone(tmp_path):
    """A bare 'remote' + a working clone seeded with one file."""
    remote = str(tmp_path / "remote.git")
    subprocess.check_call(["git", "init", "-q", "--bare", "-b", "main", remote])
    work = str(tmp_path / "work")
    subprocess.check_call(["git", "clone", "-q", remote, work], env=ENV)
    _git(work, "config", "user.name", "t")
    _git(work, "config", "user.email", "t@t")
    with open(os.path.join(work, "note.md"), "w") as fh:
        fh.write("hello\n")
    _git(work, "add", "-A")
    _git(work, "commit", "-q", "-m", "seed")
    _git(work, "push", "-q", "origin", "main")
    return remote, work


def _cfg(work, remote, tmp_path):
    return Config(
        path="/nonexistent",
        overrides={
            "VAULT_DIR": work,
            "STATE_FILE": str(tmp_path / "state.json"),
            "GIT_REMOTE": remote,
            "GIT_BRANCH": "main",
        },
    )


def test_disabled_when_no_remote(tmp_path):
    cfg = Config(path="/nonexistent", overrides={"VAULT_DIR": str(tmp_path), "GIT_REMOTE": ""})
    assert sync_mod.sync(cfg, require_online=False)["outcome"] == "disabled"


def test_clean_push_pull(remote_and_clone, tmp_path):
    remote, work = remote_and_clone
    cfg = _cfg(work, remote, tmp_path)
    # local change -> sync should commit + push it
    with open(os.path.join(work, "new.md"), "w") as fh:
        fh.write("local edit\n")
    res = sync_mod.sync(cfg, require_online=False)
    assert res["outcome"] == "ok"
    # a second clone sees the pushed commit
    other = str(tmp_path / "other")
    subprocess.check_call(["git", "clone", "-q", remote, other], env=ENV)
    assert os.path.exists(os.path.join(other, "new.md"))


def test_pulls_remote_changes(remote_and_clone, tmp_path):
    remote, work = remote_and_clone
    cfg = _cfg(work, remote, tmp_path)
    # a second clone pushes a change to the remote
    other = str(tmp_path / "other")
    subprocess.check_call(["git", "clone", "-q", remote, other], env=ENV)
    _git(other, "config", "user.name", "t")
    _git(other, "config", "user.email", "t@t")
    with open(os.path.join(other, "remote.md"), "w") as fh:
        fh.write("from elsewhere\n")
    _git(other, "add", "-A")
    _git(other, "commit", "-q", "-m", "remote change")
    _git(other, "push", "-q", "origin", "main")
    res = sync_mod.sync(cfg, require_online=False)
    assert res["outcome"] == "ok"
    assert os.path.exists(os.path.join(work, "remote.md"))


def test_conflict_writes_marker_and_leaves_clean_tree(remote_and_clone, tmp_path):
    remote, work = remote_and_clone
    cfg = _cfg(work, remote, tmp_path)
    # both sides edit the SAME line -> unrebasable
    other = str(tmp_path / "other")
    subprocess.check_call(["git", "clone", "-q", remote, other], env=ENV)
    _git(other, "config", "user.name", "t")
    _git(other, "config", "user.email", "t@t")
    with open(os.path.join(other, "note.md"), "w") as fh:
        fh.write("remote version\n")
    _git(other, "add", "-A")
    _git(other, "commit", "-q", "-m", "remote edit")
    _git(other, "push", "-q", "origin", "main")
    # local diverging edit to the same file
    with open(os.path.join(work, "note.md"), "w") as fh:
        fh.write("local version\n")
    res = sync_mod.sync(cfg, require_online=False, today="2026-07-11")
    assert res["outcome"] == "conflict"
    assert res["note"] == os.path.join("_sync-conflicts", "2026-07-11.md")
    git = Git(work)
    assert not git.dirty()  # never left mid-rebase
    # local content preserved
    with open(os.path.join(work, "note.md")) as fh:
        assert "local version" in fh.read()
    assert os.path.exists(os.path.join(work, "_sync-conflicts", "2026-07-11.md"))


def test_offline_skips(remote_and_clone, tmp_path, monkeypatch):
    remote, work = remote_and_clone
    cfg = _cfg(work, remote, tmp_path)
    monkeypatch.setattr(sync_mod.net, "online", lambda **k: False)
    assert sync_mod.sync(cfg, require_online=True)["outcome"] == "skipped"


# -- gitops remote helpers + lock ------------------------------------------------


def test_gitops_remote_helpers(remote_and_clone):
    remote, work = remote_and_clone
    git = Git(work)
    assert git.has_remote("origin")
    git.remote_set(remote, "backup")
    assert git.has_remote("backup")


def test_vault_lock_is_exclusive(tmp_path):
    lp = str(tmp_path / "vault.lock")
    with lock.vault_lock(lp):
        # a non-blocking second acquire must fail while the first is held
        with pytest.raises(BlockingIOError):
            with lock.vault_lock(lp, blocking=False):
                pass
