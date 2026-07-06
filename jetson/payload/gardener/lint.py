"""Vault linter. Universal rules run on any vault; hub rules are
profile-gated. The movie profile reproduces lib/lint.ts rule-for-rule
(hub-only autofix scope, watchlist-pageless exclusion, taste-bullet links,
dedupe, cap of 20).

Universal (always):
  dead_link        [[Target]] with no page (minus hub pageless sections)
  orphan           page with no inbound links
  duplicate_name   two pages share a basename; Obsidian links resolve to one

Hub-gated (profile.hub set):
  hub dead links, hub-inbound credit for orphans, pageless sections
  (PAGELESS_SECTIONS), and <section>_unlinked for LINKED_BULLET_SECTIONS
  bullets carrying no [[link]] (movie profile: taste_unlinked).

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

    def scan(text, where):
        for target in wikilinks(text):
            linked.add(target)
            if target not in pages and target not in pageless:
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

    return issues[:LINT_CAP]


def lint_report(vault):
    """Human-readable report, one line per issue (matches lint.ts output)."""
    return [i["detail"] for i in lint_vault(vault)]
