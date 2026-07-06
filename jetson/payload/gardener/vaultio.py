"""Vault layout + link-graph index. Port of lib/vault.ts path helpers.

Layout (mirrors vault-template/):
  wiki/entities/Movies.md      the hub (protected: link-level edits only)
  wiki/movies/<Title (Year)>.md
  wiki/movies/genres/<Category>.md
  wiki/movies/_index.md        db index (underscore files are not pages)
  wiki/log.md                  session log (LLM read-only)
  wiki/audits/YYYY-MM-DD.md    sonnet audit notes (LLM read-only)
"""
import os

from . import frontmatter, wikilink


class Vault(object):
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.wiki = os.path.join(self.root, "wiki")
        self.movies_dir = os.path.join(self.wiki, "movies")
        self.genres_dir = os.path.join(self.movies_dir, "genres")
        self.entities_dir = os.path.join(self.wiki, "entities")
        self.audits_dir = os.path.join(self.wiki, "audits")
        self.hub = os.path.join(self.entities_dir, "Movies.md")
        self.log = os.path.join(self.wiki, "log.md")

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

    def page_files(self):
        """Every linkable content page: movies + genres."""
        return self.md_files(self.movies_dir) + self.md_files(self.genres_dir)

    def pages(self):
        """{page name (basename sans .md) -> absolute path}"""
        return {
            os.path.splitext(os.path.basename(f))[0]: f
            for f in self.page_files()
        }

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
        """Outbound wikilink targets of one page: body links + frontmatter
        genres links (same sources lib/vault.ts buildGraph uses)."""
        text = self.read(path)
        meta, content = frontmatter.parse(text)
        targets = list(wikilink.wikilinks(content))
        genres = meta.get("genres")
        if isinstance(genres, list):
            for g in genres:
                targets.extend(wikilink.wikilinks(str(g)))
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
        if os.path.exists(self.hub):
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
