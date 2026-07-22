import os
import subprocess

import pytest

from gardener import allocate


def test_monotonic(tmp_path):
    root = str(tmp_path)
    assert allocate.allocate(root) == "c-000001"
    assert allocate.allocate(root) == "c-000002"
    assert allocate.peek(root) == "c-000003"
    # peek reserves nothing
    assert allocate.allocate(root) == "c-000003"


def test_corrupt_counter_raises(tmp_path):
    root = str(tmp_path)
    meta = tmp_path / ".vault-meta"
    meta.mkdir()
    (meta / "address-counter.txt").write_text("not-a-number")
    with pytest.raises(allocate.CounterCorrupt):
        allocate.allocate(root)


def test_stale_lock_times_out_fast(tmp_path, monkeypatch):
    root = str(tmp_path)
    lockdir = tmp_path / ".vault-meta" / ".address.lock.d"
    lockdir.mkdir(parents=True)
    monkeypatch.setattr(allocate.time, "sleep", lambda s: None)
    with pytest.raises(allocate.LockTimeout):
        allocate.allocate(root)


def test_shell_interop(fixture_vault):
    """allocate-address.sh and allocate.py share one counter faithfully."""
    script = os.path.join(fixture_vault, "scripts", "allocate-address.sh")
    a = allocate.allocate(fixture_vault)
    b = (
        subprocess.check_output(["bash", script])
        .decode()
        .strip()
    )
    c = allocate.allocate(fixture_vault)
    assert (a, b, c) == ("c-000001", "c-000002", "c-000003")
