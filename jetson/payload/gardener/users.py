"""Dashboard user accounts: a tiny JSON store of profiles.

One file, /etc/wikigardener/users.json, mapping username -> record:

    {"alice": {"salt": "<hex>", "hash": "<hex>", "settings": {...}}}

Passwords are PBKDF2-HMAC-SHA256 (stdlib hashlib) — never stored in the clear.
This store is *additive*: the legacy shared dashboard token still logs in as
the built-in "admin" profile, so adding users can never lock anyone out.

The `settings` blob is per-profile scratch space (theme, preferred model
backend, etc.); the web UI reads/writes it and this module just persists it.
"""
import hashlib
import json
import os
import hmac

_ROUNDS = 120000  # pbkdf2 iterations; ~50ms on the Nano, fine for a login


def _hash(password, salt_hex):
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), _ROUNDS
    )
    return dk.hex()


def load(users_file):
    if not os.path.exists(users_file):
        return {}
    try:
        with open(users_file, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (ValueError, OSError):
        return {}


def _save(users_file, users):
    tmp = users_file + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(users, fh, indent=2, sort_keys=True)
    os.replace(tmp, users_file)
    try:
        os.chmod(users_file, 0o600)  # hashes are not secrets, but be tidy
    except OSError:
        pass


def add(users_file, username, password, settings=None):
    username = username.strip()
    if not username or username == "admin":
        raise ValueError("username must be non-empty and not 'admin' (reserved)")
    users = load(users_file)
    salt_hex = os.urandom(16).hex()
    users[username] = {
        "salt": salt_hex,
        "hash": _hash(password, salt_hex),
        "settings": settings or {},
    }
    _save(users_file, users)
    return username


def remove(users_file, username):
    users = load(users_file)
    if username in users:
        del users[username]
        _save(users_file, users)
        return True
    return False


def verify(users_file, username, password):
    """Return the username on a correct password, else None (constant-time)."""
    rec = load(users_file).get(username)
    if not rec or "salt" not in rec or "hash" not in rec:
        return None
    if hmac.compare_digest(_hash(password, rec["salt"]), rec["hash"]):
        return username
    return None


def get_settings(users_file, username):
    return load(users_file).get(username, {}).get("settings", {})


def set_settings(users_file, username, settings):
    users = load(users_file)
    if username not in users:
        return False
    users[username]["settings"] = settings
    _save(users_file, users)
    return True


def list_names(users_file):
    return sorted(load(users_file).keys())


def demo():
    """Self-check: python3 -m gardener.users"""
    import tempfile

    path = os.path.join(tempfile.mkdtemp(), "users.json")
    add(path, "alice", "hunter2")
    assert verify(path, "alice", "hunter2") == "alice", "correct password rejected"
    assert verify(path, "alice", "wrong") is None, "wrong password accepted"
    assert verify(path, "nobody", "x") is None, "unknown user accepted"
    assert list_names(path) == ["alice"]
    set_settings(path, "alice", {"backend": "local"})
    assert get_settings(path, "alice") == {"backend": "local"}
    assert remove(path, "alice") is True
    assert verify(path, "alice", "hunter2") is None, "removed user still logs in"
    # a stored hash must not equal the password
    add(path, "bob", "s3cret")
    assert "s3cret" not in json.dumps(load(path)), "password stored in clear"
    print("users.py self-check OK")


if __name__ == "__main__":
    demo()
