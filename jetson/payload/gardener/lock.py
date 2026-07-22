"""A single advisory lock over the vault so the constantly-writing gardener
and the occasional git-sync never touch the repo at the same time.

Used as a context manager:

    with vault_lock(cfg):
        ... git-mutating work ...

fcntl.flock is advisory and released on process exit even if we crash, so a
killed cycle never leaves the vault permanently locked.
"""
import contextlib
import fcntl
import os


@contextlib.contextmanager
def vault_lock(lock_path, blocking=True):
    os.makedirs(os.path.dirname(lock_path) or ".", exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX if blocking else fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield True
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def lock_path_for(cfg):
    return os.path.join(os.path.dirname(cfg.state_file), "vault.lock")
