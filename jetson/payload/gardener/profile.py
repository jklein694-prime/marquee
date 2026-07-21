"""Vault profile: how a particular vault is laid out.

Loaded from <vault>/gardener-vault.conf — the file travels, syncs, and
versions WITH the vault (it's part of the seed git commit, so any tampering
shows up in history). Missing file = generic mode: recursively scan the
whole vault for pages, no hub, universal rules only. A profile adds layout
hints; the shipped profiles/marquee-movies.conf reproduces the marquee
movie-wiki behavior exactly.

The profile file is read-only to the LLM by construction: it isn't .md, it
never appears in pages(), and patch.py rejects it by basename outright.
"""
import os

from .config import parse_conf

PROFILE_BASENAME = "gardener-vault.conf"

_STRING_KEYS = {
    # key -> default (generic mode)
    "VAULT_DESCRIPTION": "",
    "HUB": "",
    "LOG_FILE": "",
    "AUDITS_DIR": "_audits",
    "STUB_DEFAULT": "",
    "INDEX_FILE": "",
    "INDEXED_STUB_KIND": "",
    "GRAND_INDEX": "",
    "SUGGESTIONS_DIR": "_suggestions",
}
_LIST_KEYS = {
    # colon-separated (paths can contain spaces and commas)
    "PAGE_DIRS": [],
    "PAGELESS_SECTIONS": [],
    "LINKED_BULLET_SECTIONS": [],
    "FRONTMATTER_LINK_KEYS": [],
    "READONLY_PATHS": [],
    "CATEGORY_DIRS": [],
}


class StubKind(object):
    """One kind of stub page a profile allows: where it lives and the
    frontmatter identity the fixed template stamps on it."""

    def __init__(self, directory, entity_type, tag):
        self.directory = directory
        self.entity_type = entity_type
        self.tag = tag


class Profile(object):
    def __init__(self, values=None):
        values = values or {}
        for key, default in _STRING_KEYS.items():
            setattr(self, key.lower(), str(values.get(key, default)).strip())
        for key, default in _LIST_KEYS.items():
            raw = str(values.get(key, "")).strip()
            setattr(
                self,
                key.lower(),
                [p.strip() for p in raw.split(":") if p.strip()] if raw else list(default),
            )
        # STUB_KIND_<NAME>="dir|entity_type|tag"; kind name = <name> lowercased
        self.stub_kinds = {}
        for key, raw in values.items():
            if not key.startswith("STUB_KIND_"):
                continue
            name = key[len("STUB_KIND_"):].lower()
            parts = [p.strip() for p in str(raw).split("|")]
            if len(parts) == 3 and all(parts) and name:
                self.stub_kinds[name] = StubKind(*parts)

    @property
    def generic(self):
        """True when pages are found by recursive scan (no PAGE_DIRS)."""
        return not self.page_dirs


def load(vault_root):
    """Profile for a vault; missing/unreadable file -> generic defaults."""
    path = os.path.join(vault_root, PROFILE_BASENAME)
    try:
        with open(path, encoding="utf-8") as fh:
            return Profile(parse_conf(fh.read()))
    except IOError:
        return Profile()
