"""Vault git sync to the user's computer — the "constantly sync with this
drive" feature. Runs only during an online window (the gardener itself never
needs the network).

Flow, under the vault lock so it never races the gardener's commits:
  commit any dirty state -> pull --rebase -> push.
On a rebase conflict we ABORT (never leave a mid-rebase tree), write a
conflict-marker note into the vault capturing the diverging shas, commit it,
and surface it — data is never lost, and the next audit/dashboard sees it.
"""
import os
import time

from . import lock, net
from .gitops import Git


def _conflict_note(vault_dir, local_sha, remote_sha, detail, today):
    rel = os.path.join("_sync-conflicts", "%s.md" % today)
    path = os.path.join(vault_dir, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(
            "# Sync conflict %s\n\n"
            "- local HEAD: %s\n- remote HEAD: %s\n\n"
            "Rebase was aborted to protect local history; both sides are "
            "intact. Resolve from your computer, then sync again.\n\n"
            "```\n%s\n```\n\n---\n\n" % (today, local_sha, remote_sha, detail[:2000])
        )
    return rel


def sync(cfg, today=None, require_online=True):
    """Run one sync. Returns a status dict."""
    today = today or time.strftime("%Y-%m-%d")
    if not cfg.git_remote:
        return {"outcome": "disabled", "reason": "GIT_REMOTE not set"}
    if require_online and not net.online():
        return {"outcome": "skipped", "reason": "offline"}

    git = Git(cfg.vault_dir)
    if not git.is_repo():
        return {"outcome": "error", "reason": "vault is not a git repository"}

    with lock.vault_lock(lock.lock_path_for(cfg)):
        git.remote_set(cfg.git_remote)
        if git.dirty():
            git.commit_all("sync: commit local state before pull")
        local_before = git.head()

        rc, out = git.pull_rebase(cfg.git_branch)
        if rc != 0:
            git.rebase_abort()
            remote_sha = git.head()  # abort restores local HEAD
            rel = _conflict_note(
                cfg.vault_dir, local_before, remote_sha, out, today
            )
            git.commit_all("sync: conflict marker %s" % today)
            from . import notify

            notify.queue_note(
                cfg,
                "Vault sync conflict",
                "Rebase aborted safely; both sides intact. See %s in the vault." % rel,
                tags=["warning"],
                priority="high",
            )
            notify.flush(cfg)  # we're online (sync just ran) — deliver now
            return {
                "outcome": "conflict",
                "note": rel,
                "detail": out.splitlines()[-1] if out else "",
            }

        push_rc, push_out = git.push(cfg.git_branch)
        if push_rc != 0:
            return {"outcome": "push_failed", "detail": push_out.splitlines()[-1] if push_out else ""}
        return {"outcome": "ok", "head": git.head()}
