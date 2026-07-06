"""Port of lib/lint.ts — keep rule-for-rule parity with the TypeScript linter.

autofix_vault(): mechanical, deterministic in-place fixes (hub-only, exactly
as upstream — widen scope only when reports show recurring patterns elsewhere).

lint_vault(): judgment calls the LLM works through as queue items — dead
wikilinks (excluding watchlist titles that legitimately have no page yet),
orphan pages, taste bullets without a [[Category]] link. Deduped, capped at 20.
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
    """Apply mechanical fixes to the hub; returns list of fix descriptions."""
    if not os.path.exists(vault.hub):
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
    """Issues as (kind, target, where) tuples plus human strings.

    Returns a list of dicts: {kind, detail, target, where} so tasks.py can
    turn them into queue items without re-parsing strings; detail matches the
    upstream lint.ts message format.
    """
    if not os.path.exists(vault.hub):
        return []
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
    hub_body = frontmatter.body(vault.read(vault.hub))

    # watchlist bullet titles legitimately have no page yet
    pageless = set()
    for heading, bullets in _hub_sections(hub_body):
        if heading.startswith("watchlist"):
            for b in bullets:
                links = wikilinks(b)
                if links:
                    pageless.add(links[0])
        elif heading.startswith("taste"):
            for b in bullets:
                if not wikilinks(b):
                    add(
                        "taste_unlinked",
                        'taste bullet has no [[Category]] links: "%s"' % b[:80],
                        target=b[:80],
                        where="hub",
                    )

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

    scan(hub_body, "hub")
    for path in vault.page_files():
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
