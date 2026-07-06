"""Port of lib/wikilink.ts — same regex, same semantics.

Supports [[Target]], aliased [[Target|label]], and strips #anchors by
excluding them from the target group.
"""
import re

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]")


def wikilinks(text):
    """All wikilink targets in text, stripped, in order of appearance."""
    return [m.group(1).strip() for m in WIKILINK.finditer(text)]
