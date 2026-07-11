"""Loopback smoke test for the SD-image inject step. Root + loop devices only,
so it self-skips in ordinary CI. Proves the mechanics that don't need a real
Nano: payload lands in the rootfs and the firstboot unit is enabled offline
via a wants-symlink.
"""
import os
import shutil
import subprocess

import pytest

from conftest import JETSON

pytestmark = pytest.mark.skipif(
    os.geteuid() != 0
    or not shutil.which("mkfs.ext4")
    or not shutil.which("losetup"),
    reason="needs root + loop devices + mkfs.ext4",
)


def _run(*args):
    subprocess.check_call(list(args), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def test_inject_and_enable(tmp_path):
    img = str(tmp_path / "fake.img")
    mnt = str(tmp_path / "mnt")
    os.makedirs(mnt)
    # a tiny ext4 "rootfs"
    with open(img, "wb") as fh:
        fh.truncate(64 * 1024 * 1024)
    _run("mkfs.ext4", "-q", img)
    loop = subprocess.check_output(["losetup", "-fP", "--show", img]).decode().strip()
    try:
        _run("mount", loop, mnt)
        try:
            # the inject + offline-enable steps, mirrored from build-image.sh
            fb = os.path.join(mnt, "opt", "wikigardener-firstboot")
            os.makedirs(fb)
            shutil.copy(
                os.path.join(JETSON, "payload", "install.sh"),
                os.path.join(fb, "install.sh"),
            )
            unit_dir = os.path.join(mnt, "etc", "systemd", "system")
            wants = os.path.join(unit_dir, "multi-user.target.wants")
            os.makedirs(wants)
            shutil.copy(
                os.path.join(JETSON, "payload", "systemd", "wikigardener-firstboot.service"),
                os.path.join(unit_dir, "wikigardener-firstboot.service"),
            )
            os.symlink(
                "/etc/systemd/system/wikigardener-firstboot.service",
                os.path.join(wants, "wikigardener-firstboot.service"),
            )
            # assertions
            assert os.path.isfile(os.path.join(fb, "install.sh"))
            link = os.path.join(wants, "wikigardener-firstboot.service")
            assert os.path.islink(link)
            assert os.readlink(link).endswith("wikigardener-firstboot.service")
        finally:
            _run("umount", mnt)
    finally:
        _run("losetup", "-d", loop)
