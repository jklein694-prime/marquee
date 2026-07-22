"""Vault linter. Universal rules run on any vault; hub rules are
profile-gated. The movie profile reproduces lib/lint.ts rule-for-rule
(hub-only autofix scope, watchlist-pageless exclusion, taste-bullet links,
dedupe, cap of 20).

Universal (always):
  dead_link        [[Target]] with no page (minus hub pageless sections);
                   path-style targets like [[movies/_index]] count as live
                   when the file exists in the vault — Obsidian resolves
                   them, and a false dead-link here would become a queued
                   "repair" that damages a healthy hub
  orphan           page with no inbound links
  duplicate_name   two pages share a basename; Obsidian links resolve to one

Hub-gated (profile.hub set):
  hub dead links, hub-inbound credit for orphans, pageless sections
  (PAGELESS_SECTIONS), and <section>_unlinked for LINKED_BULLET_SECTIONS
  bullets carrying no [[link]] (movie profile: taste_unlinked).

Index-invariant rules (profile.category_dirs set — port of lib/lint.ts
lintIndexes): each dimension _index.md mirrors its directory exactly, a page
is indexed in exactly one dimension, sub-indexes stay under 50 entries, and
the grand index (GRAND_INDEX) routes to every dimension. Kind: index_mismatch.

Only dead_link and orphan ever become queue items; the report-only kinds
surface in `gardener lint` and the Sonnet audit evidence.
"""
import os
import re

from . import frontmatter
from .wikilink import wikilinks

LINT_CAP = 20

# [[**Foo**]] -> [[Foo]]  (markdown formatting inside a wikilink target)
_FORMATTED = re.compile(r"\[\[\s*[*_`]+([^\]|#]*?)[*_`]+\s*\]\]")
# [[Foo] -> [[Foo]]  (unclosed wikilink)
_UNCLOSED = re.compile(r"\[\[([^\][\n]+)\](?!\])")


def autofix_text(text):
    text = _FORMATTED.sub(lambda m: "[[%s]]" % m.group(1).strip(), text)
    text = _UNCLOSED.sub(r"[[\1]]", text)
    return text


def autofix_vault(vault):
    """Mechanical fixes, hub-only (parity with lib/lint.ts; a hub-less vault
    has no autofix in v1). Returns list of fix descriptions."""
    if not vault.hub or not os.path.exists(vault.hub):
        return []
    before = vault.read(vault.hub)
    after = autofix_text(before)
    if after == before:
        return []
    with open(vault.hub, "w", encoding="utf-8") as fh:
        fh.write(after)
    return ["hub: normalized malformed wikilink syntax"]


def _hub_sections(hub_body):
    """[(lowercased heading, [bullet texts])] for each '## ' section."""
    out = []
    for section in hub_body.split("\n## "):
        heading = section.split("\n", 1)[0].lower().lstrip("# ")
        bullets = [
            re.sub(r"^\s*-\s+", "", line).strip()
            for line in section.split("\n")
            if re.match(r"^\s*-\s+\S", line) and "(empty" not in line
        ]
        out.append((heading, bullets))
    return out


def lint_vault(vault):
    """Issues as dicts {kind, detail, target, where}; detail matches the
    upstream lint.ts message format for the shared kinds."""
    issues = []
    seen = set()

    def add(kind, detail, target="", where=""):
        if detail in seen:
            return
        seen.add(detail)
        issues.append(
            {"kind": kind, "detail": detail, "target": target, "where": where}
        )

    pages = vault.pages()

    for name, winner, loser in vault.duplicates:
        add(
            "duplicate_name",
            "duplicate page name '%s': %s shadows %s" % (name, winner, loser),
            target=name,
            where=loser,
        )

    # -- hub rules (profile-gated) --------------------------------------------
    pageless = set()
    hub_body = None
    if vault.hub and os.path.exists(vault.hub):
        hub_body = frontmatter.body(vault.read(vault.hub))
        profile = vault.profile
        for heading, bullets in _hub_sections(hub_body):
            if any(heading.startswith(s) for s in profile.pageless_sections):
                for b in bullets:
                    links = wikilinks(b)
                    if links:
                        pageless.add(links[0])
            elif any(heading.startswith(s) for s in profile.linked_bullet_sections):
                section = next(
                    s for s in profile.linked_bullet_sections if heading.startswith(s)
                )
                for b in bullets:
                    if not wikilinks(b):
                        add(
                            "%s_unlinked" % section,
                            '%s bullet has no [[Category]] links: "%s"'
                            % (section, b[:80]),
                            target=b[:80],
                            where="hub",
                        )

    # -- universal rules --------------------------------------------------------
    linked = set()
    # the hub is a real page even though it's never in pages() — [[Movies]]
    # from a taste page must not read as dead
    live = set(pages)
    if vault.hub:
        live.add(os.path.splitext(os.path.basename(vault.hub))[0])

    def resolves_as_path(target):
        """[[movies/_index]]-style links: Obsidian resolves them by path
        suffix anywhere in the vault, so they're live if any .md file's
        vault-relative path ends with the target."""
        if "/" not in target:
            return False
        rel = target if target.endswith(".md") else target + ".md"
        for dirpath, dirnames, filenames in os.walk(vault.root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for f in filenames:
                if not f.endswith(".md"):
                    continue
                full_rel = vault.relpath(os.path.join(dirpath, f))
                if full_rel == rel or full_rel.endswith(os.sep + rel):
                    return True
        return False

    def scan(text, where):
        for target in wikilinks(text):
            linked.add(target)
            if target in live or target in pageless:
                continue
            if resolves_as_path(target):
                continue
            add(
                "dead_link",
                "dead wikilink [[%s]] in %s" % (target, where),
                target=target,
                where=where,
            )

    if hub_body is not None:
        scan(hub_body, "hub")
    for path in sorted(pages.values(), key=lambda p: vault.relpath(p)):
        scan(vault.read(path), os.path.basename(path))

    for name in pages:
        if name not in linked:
            add(
                "orphan",
                "orphan page (no inbound links): %s.md" % name,
                target=name,
                where=vault.relpath(pages[name]),
            )

    for detail in _lint_indexes(vault):
        add("index_mismatch", detail)

    return issues[:LINT_CAP]


_INDEX_BULLET = re.compile(r"^-\s+\[\[")


def _index_entries(text):
    """Pages named by '- [[Page]] — ...' bullets (first wikilink per bullet)."""
    out = set()
    for line in text.split("\n"):
        if _INDEX_BULLET.match(line):
            links = wikilinks(line)
            if links:
                out.add(links[0])
    return out


def _lint_indexes(vault):
    """Port of lib/lint.ts lintIndexes: each dimension _index.md mirrors its
    directory, one dimension per page, size ceiling, grand-index routing."""
    profile = vault.profile
    if not profile.category_dirs:
        return []
    issues = []
    grand = ""
    if profile.grand_index:
        grand_path = vault.resolve(profile.grand_index)
        if grand_path and os.path.isfile(grand_path):
            grand = vault.read(grand_path)
    seen = {}  # page -> dimension it's indexed under
    for rel in profile.category_dirs:
        directory = os.path.join(vault.root, rel)
        dim = os.path.basename(rel.rstrip("/"))
        if not os.path.isdir(directory):
            continue
        index_file = os.path.join(directory, "_index.md")
        if not os.path.isfile(index_file):
            issues.append("missing sub-index: %s/_index.md" % rel)
            continue
        on_disk = {
            os.path.splitext(os.path.basename(f))[0]
            for f in vault.md_files(directory)
        }
        indexed = _index_entries(vault.read(index_file))
        for p in sorted(on_disk - indexed):
            issues.append("%s/_index.md is missing its page [[%s]]" % (dim, p))
        for p in sorted(indexed):
            if p not in on_disk:
                issues.append(
                    "%s/_index.md lists [[%s]] but %s/%s.md does not exist"
                    % (dim, p, dim, p)
                )
            elif p in seen:
                issues.append(
                    "[[%s]] indexed in both %s/ and %s/ (must be exactly one)"
                    % (p, seen[p], dim)
                )
            else:
                seen[p] = dim
        if len(indexed) > 50:
            issues.append(
                "%s/_index.md has %d entries (>50) — needs a dimension split "
                "at next consolidation" % (dim, len(indexed))
            )
        if grand and ("%s/_index" % rel.rstrip("/").split("/", 1)[-1]) not in grand:
            issues.append(
                "grand index %s has no row for dimension %s/"
                % (profile.grand_index, dim)
            )
    return issues


def lint_report(vault):
    """Human-readable report, one line per issue (matches lint.ts output)."""
    return [i["detail"] for i in lint_vault(vault)]
