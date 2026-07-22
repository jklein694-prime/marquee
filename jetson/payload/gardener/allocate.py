"""Port of vault-template/scripts/allocate-address.sh — same counter file,
same c-%06d format, same mkdir spinlock, so the shell script and this module
can interoperate on one vault without ever double-issuing an address.
"""
import os
import time


class CounterCorrupt(Exception):
    pass


class LockTimeout(Exception):
    pass


def _paths(vault_root):
    meta = os.path.join(vault_root, ".vault-meta")
    return os.path.join(meta, "address-counter.txt"), os.path.join(
        meta, ".address.lock.d"
    )


def _read_counter(counter):
    try:
        with open(counter, "r") as fh:
            raw = fh.read().strip()
    except IOError:
        return 0
    if not raw.isdigit():
        raise CounterCorrupt("counter corrupt: %r" % raw)
    return int(raw)


def peek(vault_root):
    counter, _ = _paths(vault_root)
    return "c-%06d" % (_read_counter(counter) + 1)


def allocate(vault_root):
    """Reserve and return the next address (e.g. 'c-000001')."""
    counter, lock = _paths(vault_root)
    os.makedirs(os.path.dirname(counter), exist_ok=True)
    for _ in range(100):
        try:
            os.mkdir(lock)
            break
        except OSError:
            time.sleep(0.05)
    else:
        raise LockTimeout("could not acquire %s" % lock)
    try:
        n = _read_counter(counter) + 1
        with open(counter, "w") as fh:
            fh.write("%d\n" % n)
        return "c-%06d" % n
    finally:
        os.rmdir(lock)
