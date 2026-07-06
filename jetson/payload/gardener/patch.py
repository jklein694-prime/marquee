"""The safety core: every LLM output must be one JSON patch that survives
validation before a single byte lands on disk. Invalid output is discarded —
the gardener never writes on a maybe.

Schema (exactly one object):
  {
    "action":  add_link | append_bullet | replace_line | remove_line |
               retarget_link | create_stub | no_change,
    "file":    vault-relative page path,
    "anchor":  exact existing line text (grounding, must be unique in file),
    "text":    one new/replacement line (or stub one-line description),
    "target":  page name (link target / new stub name),
    "reason":  one sentence
  }

Guarantees enforced here, independent of anything the model says:
  - paths realpath-confined to the vault, and editable ONLY by membership:
    the file must be one of vault.pages() (or the hub) — audits, the log,
    underscore/dot files, READONLY_PATHS, and the profile file are never
    members, and a stray .md outside the page set is equally untouchable
  - the hub (when the profile declares one) accepts only link-level actions
    (add_link/retarget_link and remove_line of the dead link under repair)
  - anchors must occur exactly once, in the body, and never be a heading;
    remove_line additionally only removes bullets or the dead link's line
  - every [[wikilink]] written must resolve to an existing page (or the stub
    being created)
  - stubs are rendered from fixed templates — the model contributes one
    description line, never raw frontmatter; stub locations come from the
    profile's stub kinds, or (generic vaults) the dead link's own page dir
  - there is no page-deletion action at all
"""
import json
import os
import re
import time

from . import allocate, frontmatter
from .profile import PROFILE_BASENAME
from .wikilink import wikilinks

ACTIONS = (
    "add_link",
    "append_bullet",
    "replace_line",
    "remove_line",
    "retarget_link",
    "create_stub",
    "no_change",
)

# action -> required fields beyond action+reason
REQUIRED = {
    "add_link": ("file", "anchor", "text", "target"),
    "append_bullet": ("file", "text"),
    "replace_line": ("file", "anchor", "text"),
    "remove_line": ("file", "anchor"),
    "retarget_link": ("file", "anchor", "target"),
    "create_stub": ("target", "text"),
    "no_change": (),
}

MAX_REASON = 200
MAX_TEXT = 400

STUB_TEMPLATE = """---
type: entity
title: "{title}"
entity_type: {entity_type}
address: {address}
created: {today}
updated: {today}
tags:
  - {tag}
status: stub
---

# {title}

{description}
"""

# generic vaults get minimal frontmatter and NO address — .vault-meta/ stays
# out of vaults that never opted into the address scheme
GENERIC_STUB_TEMPLATE = """---
title: "{title}"
created: {today}
updated: {today}
status: stub
---

# {title}

{description}
"""


class PatchError(Exception):
    """Validation failure. Message is logged with the failed queue item."""


def extract_json(raw):
    """First balanced {...} block in the model's reply -> dict.

    Small models wrap JSON in prose; find the outermost braces of the first
    object and parse just that.
    """
    start = raw.find("{")
    if start < 0:
        raise PatchError("no JSON object in output")
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(raw)):
        ch = raw[i]
        if escape:
            escape = False
            continue
        if ch == "\\" and in_str:
            escape = True
        elif ch == '"':
            in_str = not in_str
        elif not in_str:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[start : i + 1])
                    except ValueError as exc:
                        raise PatchError("unparseable JSON: %s" % exc)
    raise PatchError("unbalanced JSON braces in output")


def _clean_line(value, field):
    if not isinstance(value, str):
        raise PatchError("%s must be a string" % field)
    if len(value) > MAX_TEXT:
        raise PatchError("%s exceeds %d chars" % (field, MAX_TEXT))
    if "\n" in value or "\r" in value:
        raise PatchError("%s must be a single line" % field)
    if any(ord(c) < 32 for c in value):
        raise PatchError("%s contains control characters" % field)
    if value.strip() == "---" or value.strip().startswith("--- "):
        raise PatchError("%s may not be a frontmatter fence" % field)
    return value


def _body_lines(text):
    """(all_lines, body_start_index) — body starts after the closing fence."""
    lines = text.split("\n")
    if lines and lines[0].strip() == frontmatter.FENCE:
        for i in range(1, len(lines)):
            if lines[i].strip() == frontmatter.FENCE:
                return lines, i + 1
    return lines, 0


def _locate_anchor(text, anchor):
    """Index of the unique body line equal to anchor (whitespace-stripped
    comparison, so the model needn't reproduce indentation exactly)."""
    lines, body_start = _body_lines(text)
    hits = [
        i
        for i in range(len(lines))
        if lines[i].strip() == anchor.strip() and lines[i].strip()
    ]
    if not hits:
        raise PatchError("anchor not found: %r" % anchor[:80])
    if len(hits) > 1:
        raise PatchError("anchor not unique (%d hits): %r" % (len(hits), anchor[:80]))
    idx = hits[0]
    if idx < body_start:
        raise PatchError("anchor is inside frontmatter")
    if lines[idx].lstrip().startswith("#"):
        raise PatchError("anchor is a heading")
    return lines, idx


class Patch(object):
    """A validated patch, ready to apply."""

    def __init__(self, data, vault, context=None):
        self.vault = vault
        self.context = context or {}
        self._validate(data)

    # -- validation ------------------------------------------------------------

    def _validate(self, data):
        if not isinstance(data, dict):
            raise PatchError("patch must be a JSON object")
        action = data.get("action")
        if action not in ACTIONS:
            raise PatchError("unknown action: %r" % (action,))
        self.action = action

        reason = data.get("reason", "")
        if not isinstance(reason, str) or not reason.strip():
            raise PatchError("reason is required")
        if len(reason) > MAX_REASON:
            raise PatchError("reason exceeds %d chars" % MAX_REASON)
        self.reason = reason.strip()

        for field in REQUIRED[action]:
            if not str(data.get(field, "")).strip():
                raise PatchError("%s requires %s" % (action, field))

        self.text = (
            _clean_line(data["text"], "text") if "text" in REQUIRED[action] else ""
        )
        self.anchor = (
            _clean_line(data["anchor"], "anchor")
            if "anchor" in REQUIRED[action]
            else ""
        )
        self.target = (
            str(data.get("target", "")).strip()
            if "target" in REQUIRED[action]
            else ""
        )
        if self.target and (
            re.search(r"[/\\\[\]|#]", self.target)
            or self.target.startswith((".", "_"))
        ):
            raise PatchError("target must be a bare page name")

        if action == "no_change":
            self.path = None
            return
        if action == "create_stub":
            self._validate_create_stub()
            return

        self._validate_file(data)
        self._validate_links()
        self._validate_action_specifics()

    def _validate_file(self, data):
        rel = str(data.get("file", ""))
        abspath = self.vault.resolve(rel)
        if not abspath:
            raise PatchError("file escapes the vault: %r" % rel)
        base = os.path.basename(abspath)
        if base.startswith("_") or not base.endswith(".md") or base == PROFILE_BASENAME:
            raise PatchError("file is not an editable page: %r" % rel)
        if not os.path.isfile(abspath):
            raise PatchError("file does not exist: %r" % rel)
        # membership is the editability rule: pages() already excludes the
        # audits dir, log, read-only paths, dot/underscore trees — and a
        # stray .md outside the page set is equally untouchable
        hub_real = os.path.realpath(self.vault.hub) if self.vault.hub else None
        members = {os.path.realpath(p) for p in self.vault.pages().values()}
        if abspath != hub_real and abspath not in members:
            raise PatchError("file outside allowed directories: %r" % rel)
        if abspath == hub_real:
            if self.action not in ("add_link", "retarget_link", "remove_line"):
                raise PatchError("hub accepts only link-level actions")
            if self.action == "remove_line":
                dead = self.context.get("target", "")
                if not dead or ("[[%s" % dead) not in self.anchor:
                    raise PatchError(
                        "hub remove_line only for the dead link under repair"
                    )
        self.path = abspath

    def _validate_links(self):
        pages = set(self.vault.pages())
        new_links = set(wikilinks(self.text)) | (
            {self.target} if self.action in ("add_link", "retarget_link") else set()
        )
        for link in new_links:
            if link not in pages:
                raise PatchError("wikilink target has no page: [[%s]]" % link)

    def _validate_action_specifics(self):
        text = self.vault.read(self.path)
        if self.action in ("add_link", "replace_line", "remove_line", "retarget_link"):
            _, idx = _locate_anchor(text, self.anchor)
        if self.action == "add_link" and ("[[%s]]" % self.target) not in self.text:
            raise PatchError("add_link text must contain [[%s]]" % self.target)
        if self.action == "append_bullet" and not self.text.startswith("- "):
            raise PatchError("append_bullet text must start with '- '")
        if self.action == "remove_line":
            dead = self.context.get("target", "")
            is_bullet = self.anchor.strip().startswith("- ")
            mentions_dead = bool(dead) and ("[[%s" % dead) in self.anchor
            if not (is_bullet or mentions_dead):
                raise PatchError(
                    "remove_line only removes bullets or the dead link's line"
                )
        if self.action == "retarget_link":
            old = self.context.get("target", "")
            if not old:
                raise PatchError("retarget_link needs task context")
            if ("[[%s" % old) not in self.anchor:
                raise PatchError("anchor does not contain [[%s]]" % old)

    def _validate_create_stub(self):
        kinds = self.vault.profile.stub_kinds
        stub_dir = self.context.get("stub_dir") or ("auto" if not kinds else "")
        self.stub_kind = None
        if stub_dir in kinds:
            self.stub_kind = kinds[stub_dir]
            directory = os.path.join(self.vault.root, self.stub_kind.directory)
        elif stub_dir == "auto":
            # generic vault: the stub lands beside the page that links to it
            source = self.vault.resolve(self.context.get("source", ""))
            if not source or not os.path.isfile(source):
                raise PatchError("auto stub needs a source page in task context")
            directory = os.path.dirname(source)
        else:
            raise PatchError("invalid stub_dir in task context")
        expected = self.context.get("target", "")
        if expected and self.target != expected:
            raise PatchError(
                "stub must be named after the dead link [[%s]]" % expected
            )
        if self.target in self.vault.pages():
            raise PatchError("stub already exists: %s" % self.target)
        self.path = os.path.join(directory, "%s.md" % self.target)
        if os.path.exists(self.path):
            raise PatchError("stub already exists: %s" % self.target)
        for link in wikilinks(self.text):
            if link not in set(self.vault.pages()):
                raise PatchError("wikilink target has no page: [[%s]]" % link)
        self.stub_dir = stub_dir

    # -- application -----------------------------------------------------------

    def apply(self, today=None):
        """Write the change. Returns list of vault-relative changed files."""
        today = today or time.strftime("%Y-%m-%d")
        if self.action == "no_change":
            return []
        if self.action == "create_stub":
            return self._apply_create_stub(today)

        text = self.vault.read(self.path)
        lines, idx = (
            _locate_anchor(text, self.anchor) if self.anchor else (text.split("\n"), None)
        )
        if self.action == "add_link":
            lines.insert(idx + 1, self.text)
        elif self.action == "append_bullet":
            while lines and lines[-1] == "":
                lines.pop()
            lines.extend([self.text, ""])
        elif self.action == "replace_line":
            lines[idx] = self.text
        elif self.action == "remove_line":
            del lines[idx]
        elif self.action == "retarget_link":
            old = self.context["target"]
            lines[idx] = re.sub(
                r"\[\[%s(\|[^\]]*)?\]\]" % re.escape(old),
                "[[%s]]" % self.target,
                lines[idx],
            )
        new_text = frontmatter.set_field("\n".join(lines), "updated", today)
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(new_text)
        return [self.vault.relpath(self.path)]

    def _apply_create_stub(self, today):
        if self.stub_kind:
            content = STUB_TEMPLATE.format(
                title=self.target,
                entity_type=self.stub_kind.entity_type,
                address=allocate.allocate(self.vault.root),
                today=today,
                tag=self.stub_kind.tag,
                description=self.text,
            )
        else:
            content = GENERIC_STUB_TEMPLATE.format(
                title=self.target, today=today, description=self.text
            )
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(content)
        changed = [self.vault.relpath(self.path)]
        profile = self.vault.profile
        if (
            profile.index_file
            and profile.indexed_stub_kind
            and self.stub_dir == profile.indexed_stub_kind
        ):
            changed.extend(self._index_category())
        return changed

    def _index_category(self):
        """Mechanical side-effect: new stubs of the profile's indexed kind
        get listed in INDEX_FILE (never done by the model)."""
        index = self.vault.resolve(self.vault.profile.index_file)
        if not index or not os.path.isfile(index):
            return []
        text = self.vault.read(index)
        entry = "- [[%s]]" % self.target
        if entry in text:
            return []
        if "- (none yet)" in text:
            new = text.replace("- (none yet)", entry, 1)
        elif "## Categories" in text:
            new = text.replace("## Categories\n", "## Categories\n\n%s" % entry, 1)
            new = new.replace("\n\n\n", "\n\n")
        else:
            new = text.rstrip("\n") + "\n\n## Categories\n\n%s\n" % entry
        with open(index, "w", encoding="utf-8") as fh:
            fh.write(new)
        return [self.vault.relpath(index)]
