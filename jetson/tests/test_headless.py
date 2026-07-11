"""headless-preseed.sh bakes WiFi/hostname/SSH into a rootfs. Pure file edits
(chowns self-skip when not root), so this runs in ordinary CI — no loop
devices needed."""
import os
import subprocess

from conftest import JETSON


def test_headless_preseed(tmp_path):
    root = str(tmp_path / "rootfs")
    os.makedirs(os.path.join(root, "etc", "ssh"))
    with open(os.path.join(root, "etc", "hosts"), "w") as fh:
        fh.write("127.0.0.1 localhost\n")
    with open(os.path.join(root, "etc", "ssh", "sshd_config"), "w") as fh:
        fh.write("#PasswordAuthentication no\n")
    os.makedirs(
        os.path.join(root, "etc", "systemd", "system", "multi-user.target.wants")
    )
    key = tmp_path / "id.pub"
    key.write_text("ssh-ed25519 AAAAC3xxx test@host\n")

    subprocess.check_call(
        [
            "bash",
            os.path.join(JETSON, "image", "headless-preseed.sh"),
            root,
            "--wifi-ssid", "HomeNet",
            "--wifi-pass", "s3cret-psk",
            "--hostname", "wikigardener",
            "--ssh-pass", "loginpw",
            "--ssh-key", str(key),
            "--user", "gardener",
        ]
    )

    assert open(os.path.join(root, "etc", "hostname")).read().strip() == "wikigardener"
    assert "wikigardener" in open(os.path.join(root, "etc", "hosts")).read()

    nm = os.path.join(root, "etc", "NetworkManager", "system-connections", "HomeNet")
    assert os.path.isfile(nm)
    body = open(nm).read()
    assert "ssid=HomeNet" in body and "psk=s3cret-psk" in body
    assert "autoconnect=true" in body
    assert oct(os.stat(nm).st_mode & 0o777) == "0o600"

    assert "PasswordAuthentication yes" in open(
        os.path.join(root, "etc", "ssh", "sshd_config")
    ).read()
    ak = os.path.join(root, "home", "gardener", ".ssh", "authorized_keys")
    assert "ssh-ed25519" in open(ak).read()
    assert oct(os.stat(ak).st_mode & 0o777) == "0o600"
    assert os.path.isfile(os.path.join(root, "root", ".wg-ssh-pass"))


def test_preseed_requires_rootfs(tmp_path):
    # a path with no etc/ is rejected
    rc = subprocess.call(
        ["bash", os.path.join(JETSON, "image", "headless-preseed.sh"), str(tmp_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    assert rc == 1


def test_preseed_wifi_optional(tmp_path):
    # no --wifi-ssid -> still sets hostname/ssh, no NM keyfile
    root = str(tmp_path / "rootfs")
    os.makedirs(os.path.join(root, "etc"))
    subprocess.check_call(
        ["bash", os.path.join(JETSON, "image", "headless-preseed.sh"), root,
         "--hostname", "box"]
    )
    assert open(os.path.join(root, "etc", "hostname")).read().strip() == "box"
    assert not os.path.isdir(
        os.path.join(root, "etc", "NetworkManager", "system-connections")
    )
