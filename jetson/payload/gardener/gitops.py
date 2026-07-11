"""Thin git wrapper — the vault's git history IS the gardener's journal.

Every applied patch becomes one commit; recovery after a crash is "commit
whatever is dirty"; the daily change cap is a git log count; audits diff
against the last audit tag. Python 3.6: universal_newlines, no text=.
"""
import subprocess


class Git(object):
    def __init__(self, workdir):
        self.workdir = workdir

    def _run(self, *args, **kwargs):
        check = kwargs.pop("check", True)
        proc = subprocess.run(
            ("git",) + args,
            cwd=self.workdir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
        )
        if check and proc.returncode != 0:
            raise RuntimeError(
                "git %s failed (%d):\n%s"
                % (" ".join(args), proc.returncode, proc.stdout)
            )
        return proc.stdout.strip()

    def _run_rc(self, *args):
        """(returncode, output) — for callers that must inspect status rather
        than treat non-zero as fatal (sync's pull/push/rebase)."""
        proc = subprocess.run(
            ("git",) + args,
            cwd=self.workdir,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
        )
        return proc.returncode, proc.stdout.strip()

    def is_repo(self):
        try:
            return (
                self._run("rev-parse", "--is-inside-work-tree", check=False)
                == "true"
            )
        except OSError:
            return False

    def init(self, name="wiki-gardener", email="gardener@localhost"):
        self._run("init", "-q")
        self._run("config", "user.name", name)
        self._run("config", "user.email", email)

    def dirty(self):
        return bool(self._run("status", "--porcelain"))

    def commit_all(self, message):
        """Stage everything and commit; returns the new sha ('' if no-op)."""
        self._run("add", "-A")
        if not self._run("status", "--porcelain"):
            return ""
        self._run("commit", "-q", "-m", message)
        return self.head()

    def head(self):
        return self._run("rev-parse", "HEAD")

    def commits_since_midnight(self, author=None):
        args = ["rev-list", "--count", "--since=midnight", "HEAD"]
        if author:
            args.append("--author=%s" % author)
        out = self._run(*args, check=False)
        return int(out) if out.isdigit() else 0

    def tag(self, name):
        self._run("tag", "-f", name)

    def latest_tag(self, prefix):
        # audit tags embed their date (audit/YYYY-MM-DD), so reverse refname
        # order is chronological and, unlike creatordate, never ties
        out = self._run(
            "tag", "--list", "%s*" % prefix, "--sort=-refname", check=False
        )
        tags = [t for t in out.split("\n") if t]
        return tags[0] if tags else ""

    def log_since(self, ref, fmt="--stat"):
        rev_range = "%s..HEAD" % ref if ref else "HEAD"
        return self._run("log", fmt, rev_range, check=False)

    def subjects_between(self, since, until):
        """Commit subject lines in a wall-clock window (for the daily log)."""
        out = self._run(
            "log", "--pretty=%s", "--since=%s" % since, "--until=%s" % until,
            check=False,
        )
        return [s for s in out.split("\n") if s]

    def revert(self, sha):
        self._run("revert", "--no-edit", sha)

    # -- remote sync (all rc-inspecting; the wrapper otherwise raises) --------

    def remote_set(self, url, name="origin"):
        """Point `name` at url, adding or updating it."""
        rc, _ = self._run_rc("remote", "get-url", name)
        if rc == 0:
            self._run("remote", "set-url", name, url)
        else:
            self._run("remote", "add", name, url)

    def has_remote(self, name="origin"):
        rc, _ = self._run_rc("remote", "get-url", name)
        return rc == 0

    def pull_rebase(self, branch, remote="origin"):
        """(ok, output). ok=False leaves a possibly-mid-rebase tree the caller
        must clean up (see rebase_abort)."""
        return self._run_rc("pull", "--rebase", remote, branch)

    def rebase_abort(self):
        self._run_rc("rebase", "--abort")

    def push(self, branch, remote="origin"):
        return self._run_rc("push", remote, "HEAD:%s" % branch)
