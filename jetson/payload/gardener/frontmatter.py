"""Flat-YAML frontmatter: a stdlib reader plus a line-wise editor.

Deliberately NOT a YAML library. Two reasons:
  - the Nano is offline and stock (no pip), so PyYAML would have to be
    vendored for cp36/aarch64 — a real failure mode for zero gain
  - the gardener must never re-serialize frontmatter: round-tripping through
    a YAML dumper reformats quoting/ordering and pollutes every git diff.
    Reading is parse-only; writing is a surgical single-line replacement.

Understands exactly the vault's conventions (see vault-template/):
  key: scalar                     -> str (or int/float/bool when unambiguous)
  key: "quoted"                   -> str
  key: ["a", "b"]                 -> list of str
  key:                            -> list of str from indented "- item" lines
    - "item"
"""
import re

FENCE = "---"


def split(text):
    """(frontmatter_lines, body) — frontmatter_lines excludes the fences.

    Returns ([], text) when there is no leading frontmatter block.
    """
    lines = text.split("\n")
    if not lines or lines[0].strip() != FENCE:
        return [], text
    for i in range(1, len(lines)):
        if lines[i].strip() == FENCE:
            return lines[1:i], "\n".join(lines[i + 1:])
    return [], text  # unterminated fence: treat the whole file as body


def body(text):
    return split(text)[1]


def _scalar(raw):
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[1:-1]
    if raw in ("true", "True"):
        return True
    if raw in ("false", "False"):
        return False
    if re.match(r"^-?\d+$", raw):
        return int(raw)
    if re.match(r"^-?\d+\.\d+$", raw):
        return float(raw)
    return raw


def _inline_list(raw):
    inner = raw.strip()[1:-1].strip()
    if not inner:
        return []
    parts = re.findall(r'"([^"]*)"|\'([^\']*)\'|([^,]+)', inner)
    return [_scalar(a or b or c) for a, b, c in parts if (a or b or c).strip()]


def parse(text):
    """(meta: dict, body: str). Unparseable lines are skipped, never fatal."""
    fm, rest = split(text)
    meta = {}
    key = None
    for line in fm:
        if not line.strip() or line.strip().startswith("#"):
            continue
        block_item = re.match(r"^\s+-\s+(.*)$", line)
        if block_item and key is not None and isinstance(meta.get(key), list):
            meta[key].append(_scalar(block_item.group(1)))
            continue
        kv = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if not kv:
            continue
        key, raw = kv.group(1), kv.group(2).strip()
        if raw == "":
            meta[key] = []  # expect indented block list items
        elif raw.startswith("[") and raw.endswith("]"):
            meta[key] = _inline_list(raw)
        else:
            meta[key] = _scalar(raw)
    return meta, rest


def set_field(text, key, value):
    """Replace (or insert) one scalar frontmatter field, touching nothing else.

    value is written verbatim (caller quotes if needed). Returns the new text;
    if the file has no frontmatter block, one is created.
    """
    lines = text.split("\n")
    if lines and lines[0].strip() == FENCE:
        for i in range(1, len(lines)):
            if lines[i].strip() == FENCE:
                break
            if re.match(r"^%s:\s*" % re.escape(key), lines[i]):
                lines[i] = "%s: %s" % (key, value)
                return "\n".join(lines)
        else:
            return text  # unterminated fence: refuse to touch
        # key absent: insert just before the closing fence
        lines.insert(i, "%s: %s" % (key, value))
        return "\n".join(lines)
    return "%s\n%s: %s\n%s\n%s" % (FENCE, key, value, FENCE, text)
