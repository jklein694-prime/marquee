"""Vault layout + link-graph index, driven by the vault's profile.

Generic vault (no gardener-vault.conf): every .md found by a recursive scan
is a page, except dot-directories (.obsidian, .git, .vault-meta, ...),
underscore-prefixed files and directories (_index.md, _templates/), the
audits dir, the log file, READONLY_PATHS, the profile file itself, and the
hub (editable, but only via the hub policy — never sampled as a page).

Profiled vault (e.g. profiles/marquee-movies.conf): pages live in the
declared PAGE_DIRS (each non-recursive, as lib/vault.ts's mdFiles), the hub
gets section rules, and frontmatter link keys contribute graph edges.
"""
import os

from . import frontmatter, profile as profile_mod, wikilink


class Vault(object):
    def __init__(self, root, profile=None):
        self.root = os.path.abspath(root)
        self.profile = profile or profile_mod.load(self.root)
        p = self.profile
        self.hub = self._abs_or_none(p.hub)
        self.log = self._abs_or_none(p.log_file)
        self.audits_dir = os.path.join(self.root, p.audits_dir)
        self.duplicates = []  # [(name, winner_rel, loser_rel)] from last pages()

    def _abs_or_none(self, rel):
        return os.path.join(self.root, rel) if rel else None

    # -- files ---------------------------------------------------------------

    def md_files(self, directory):
        """Non-underscore .md files directly in directory (as lib/vault.ts)."""
        if not os.path.isdir(directory):
            return []
        return sorted(
            os.path.join(directory, f)
            for f in os.listdir(directory)
            if f.endswith(".md") and not f.startswith("_")
        )

    def _excluded(self, abspath):
        """Read-only / non-page paths (see module docstring)."""
        rel = self.relpath(abspath)
        parts = rel.split(os.sep)
        if any(part.startswith(".") or part.startswith("_") for part in parts):
            return True
        if os.path.basename(abspath) == profile_mod.PROFILE_BASENAME:
            return True
        for special in (self.hub, self.log):
            if special and abspath == special:
                return True
        readonly_roots = [self.audits_dir] + [
            os.path.join(self.root, r) for r in self.profile.readonly_paths
        ]
        for ro in readonly_roots:
            if abspath == ro or abspath.startswith(ro + os.sep):
                return True
        return False

    def _walk_md(self):
        out = []
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = sorted(
                d for d in dirnames if not d.startswith(".") and not d.startswith("_")
            )
            for f in sorted(filenames):
                if not f.endswith(".md"):
                    continue
                path = os.path.join(dirpath, f)
                if not self._excluded(path):
                    out.append(path)
        return out

    def page_files(self):
        """Every linkable content page, per the profile."""
        if self.profile.page_dirs:
            files = []
            for rel in self.profile.page_dirs:
                files.extend(self.md_files(os.path.join(self.root, rel)))
            return [f for f in files if not self._excluded(f)]
        return self._walk_md()

    def pages(self):
        """{page name (basename sans .md) -> absolute path}.

        Obsidian resolves links by basename vault-wide, so duplicate names
        collapse: first in sorted-relpath order wins; losers are recorded in
        self.duplicates for lint to report.
        """
        out = {}
        duplicates = []
        for f in sorted(self.page_files(), key=lambda f: self.relpath(f)):
            name = os.path.splitext(os.path.basename(f))[0]
            if name in out:
                duplicates.append((name, self.relpath(out[name]), self.relpath(f)))
            else:
                out[name] = f
        self.duplicates = duplicates
        return out

    def read(self, path):
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()

    def relpath(self, path):
        return os.path.relpath(os.path.abspath(path), self.root)

    def resolve(self, rel):
        """Vault-relative path -> absolute, confined inside the vault.

        Returns None when the path escapes the vault root (symlinks and ..
        both covered by realpath).
        """
        abspath = os.path.realpath(os.path.join(self.root, rel))
        vault_real = os.path.realpath(self.root)
        if abspath == vault_real or abspath.startswith(vault_real + os.sep):
            return abspath
        return None

    # -- link graph ----------------------------------------------------------

    def page_links(self, path):
        """Outbound wikilink targets of one page: body links plus links in
        the profile's frontmatter link keys (marquee: genres)."""
        text = self.read(path)
        meta, content = frontmatter.parse(text)
        targets = list(wikilink.wikilinks(content))
        for key in self.profile.frontmatter_link_keys:
            value = meta.get(key)
            if isinstance(value, list):
                for v in value:
                    targets.extend(wikilink.wikilinks(str(v)))
            elif isinstance(value, str):
                targets.extend(wikilink.wikilinks(value))
        return targets

    def link_index(self):
        """(outbound, inbound): {page name -> set of page names}, edges only
        between pages that actually exist (dead links are lint's business)."""
        pages = self.pages()
        outbound = {name: set() for name in pages}
        inbound = {name: set() for name in pages}
        for name, path in pages.items():
            for target in self.page_links(path):
                if target != name and target in pages:
                    outbound[name].add(target)
                    inbound[target].add(name)
        # hub links count as inbound (an orphan linked from the hub is not
        # an orphan) but the hub itself is not a samplable page
        if self.hub and os.path.exists(self.hub):
            hub_body = frontmatter.body(self.read(self.hub))
            for target in wikilink.wikilinks(hub_body):
                if target in pages:
                    inbound[target].add("__hub__")
        return outbound, inbound

    def neighborhood(self, name):
        """The page plus its linked neighbors (both directions), names only."""
        outbound, inbound = self.link_index()
        near = set(outbound.get(name, ())) | {
            n for n in inbound.get(name, ()) if n != "__hub__"
        }
        return sorted(near)
