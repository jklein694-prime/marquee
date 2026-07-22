"""Proactive suggestions — the gardener speaks up instead of only tending.

Once a day (wikigardener-suggest.timer) the local model reads the taste
evidence and proposes at most SUGGEST_MAX fresh items: titles to watch next
or new areas of the wiki worth building out. Valid suggestions are written to
a dated note under the profile's SUGGESTIONS_DIR, committed (under the vault
lock), and queued as a push notification — delivered instantly if online,
else on the next online window.

Deliberately OUTSIDE the patch pipeline: suggestions never modify existing
pages, so they don't need (or get) the patch schema — they are validated
against their own tiny schema and anything malformed is dropped whole.
"""
import json
import os
import re
import time

from . import frontmatter, lint, llm, lock, notify, tasks
from .gitops import Git
from .patch import extract_json  # not used for patches; reuse the brace parser
from .vaultio import Vault
from .wikilink import wikilinks

KINDS = ("movie", "show", "area")
MAX_TITLE = 120
MAX_WHY = 300


def _hub_section(vault, prefix):
    """Bullet lines of the first hub '## ' section whose heading starts with
    prefix, plus (for seen) first-column titles of table rows."""
    if not vault.hub or not os.path.exists(vault.hub):
        return []
    body = frontmatter.body(vault.read(vault.hub))
    for section in body.split("\n## "):
        heading = section.split("\n", 1)[0].lower().lstrip("# ")
        if not heading.startswith(prefix):
            continue
        lines = section.split("\n")
        bullets = [
            re.sub(r"^\s*-\s+", "", ln).strip()
            for ln in lines
            if re.match(r"^\s*-\s+\S", ln) and "(empty" not in ln
        ]
        rows = [
            ln.split("|")[1].strip()
            for ln in lines
            if ln.strip().startswith("|") and "---" not in ln and ln.count("|") >= 2
        ]
        return bullets + [r for r in rows if r and r.lower() != "title"]
    return []


def gather_evidence(cfg, vault, git):
    taste = "\n".join("- %s" % b for b in _hub_section(vault, "taste")) or "(none yet)"
    dims = []
    for rel in vault.profile.category_dirs:
        index = os.path.join(vault.root, rel, "_index.md")
        if os.path.isfile(index):
            entries = lint._index_entries(vault.read(index))
            dims.append(
                "%s: %d pages%s"
                % (
                    os.path.basename(rel),
                    len(entries),
                    (" (%s)" % ", ".join(sorted(entries)[:8])) if entries else "",
                )
            )
    dimensions = "\n".join(dims) or "(no dimension indexes)"

    exclude = set()
    for prefix in ("seen", "watchlist", "not interested"):
        for entry in _hub_section(vault, prefix):
            links = wikilinks(entry)
            exclude.add(links[0] if links else entry.split(" — ")[0].strip())
    exclude |= set(vault.pages())
    exclude_line = ", ".join(sorted(x for x in exclude if x)[:150]) or "(nothing yet)"

    recent = "\n".join(git.subjects_between("7 days ago", "now")[:20]) or "(none)"
    return {
        "taste": taste,
        "dimensions": dimensions,
        "exclude": exclude_line,
        "recent": recent,
    }


def validate(raw, max_items):
    """The suggestions' own schema; malformed input -> []. Never raises."""
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        try:
            data = extract_json(raw)  # models love wrapping JSON in prose
        except Exception:  # noqa: BLE001
            return []
    if not isinstance(data, list):
        return []
    out = []
    for item in data[: max_items * 2]:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind", "")).strip().lower()
        title = str(item.get("title", "")).strip()
        why = str(item.get("why", "")).strip()
        if kind not in KINDS or not title or len(title) > MAX_TITLE:
            continue
        if not why or len(why) > MAX_WHY:
            continue
        out.append({"kind": kind, "title": title, "why": why})
        if len(out) >= max_items:
            break
    return out


def run(cfg, force=False, today=None):
    """One suggestion pass. Returns a status dict."""
    today = today or time.strftime("%Y-%m-%d")
    vault = Vault(cfg.vault_dir)
    git = Git(cfg.vault_dir)
    if not git.is_repo():
        return {"outcome": "error", "reason": "vault is not a git repository"}
    if not llm.health(cfg.llama_url):
        return {"outcome": "skipped", "reason": "llama-server not healthy"}

    marker = os.path.join(os.path.dirname(cfg.state_file), "last-suggest-date")
    if not force and os.path.exists(marker):
        with open(marker) as fh:
            if fh.read().strip() == today:
                return {"outcome": "skipped", "reason": "already suggested today"}

    evidence = gather_evidence(cfg, vault, git)
    # token replacement, not str.format — the template holds a literal JSON
    # example whose braces would blow up format()
    user = tasks._template("suggest", vault)
    desc = vault.profile.vault_description
    for token, value in (
        ("__VAULT_DESCRIPTION__", " This wiki is %s." % desc.rstrip(".") if desc else ""),
        ("__MAX_ITEMS__", str(cfg.suggest_max)),
        ("__TASTE__", evidence["taste"]),
        ("__DIMENSIONS__", evidence["dimensions"]),
        ("__EXCLUDE__", evidence["exclude"]),
        ("__RECENT__", evidence["recent"]),
    ):
        user = user.replace(token, value)
    try:
        raw = llm.chat(
            cfg.llama_url,
            "You output only valid JSON.",
            user,
            max_tokens=cfg.max_tokens * 2,
            temperature=0.6,  # suggestions want variety, unlike patches
            timeout=cfg.llm_timeout_sec,
        )
    except llm.LlmError as exc:
        return {"outcome": "skipped", "reason": "llm error: %s" % exc}

    items = validate(raw, cfg.suggest_max)
    with open(marker, "w") as fh:
        fh.write(today)
    if not items:
        return {"outcome": "empty", "reason": "no grounded suggestions today"}

    rel_dir = vault.profile.suggestions_dir
    note_dir = os.path.join(vault.root, rel_dir)
    os.makedirs(note_dir, exist_ok=True)
    note_path = os.path.join(note_dir, "%s.md" % today)
    lines = ["# Suggestions — %s" % today, ""]
    for it in items:
        lines.append("- **%s** (%s) — %s" % (it["title"], it["kind"], it["why"]))
    lines.append("")
    with lock.vault_lock(lock.lock_path_for(cfg)):
        with open(note_path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
        git.commit_all("gardener(suggest): %d suggestions for %s" % (len(items), today))

    notify.queue_note(
        cfg,
        "Wiki gardener — %d suggestions" % len(items),
        "\n".join("• %s (%s): %s" % (i["title"], i["kind"], i["why"]) for i in items),
        tags=["seedling"],
    )
    flushed = notify.flush(cfg)
    return {
        "outcome": "suggested",
        "count": len(items),
        "note": os.path.join(rel_dir, "%s.md" % today),
        "notified": flushed,
    }
