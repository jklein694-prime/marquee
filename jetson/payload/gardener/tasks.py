"""Task builders: turn lint issues, samples, and audit corrections into queue
items, and render each claimed item into (system, user, patch-context).

Task types:
  dead_link   repair [[target]] that points nowhere      (prio 10, from lint)
  orphan      add an inbound link to an unlinked page    (prio 20, from lint)
  enrich      one improvement in a sampled neighborhood  (prio 50, sampled)
  stale       enrich, but on the stalest page            (prio 50, daily)
  correction  apply a Sonnet audit instruction           (prio 00, from audit)

taste_unlinked lint issues are deliberately NOT queued: fixing them means
rewriting hub taste bullets, which the hub write-policy reserves for the
Sonnet audit window. They stay visible in `gardener lint` output.
"""
import os

from . import sample, workqueue

PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")

PAGE_CHARS = 4800  # ~1200 tokens
NEIGHBOR_CHARS = 800  # ~200 tokens each
MAX_PAGES_LISTED = 120


def _template(name):
    with open(os.path.join(PROMPTS_DIR, "%s.txt" % name), encoding="utf-8") as fh:
        return fh.read()


def system_prompt(vault):
    """The fixed system prompt, with the vault's own domain description
    injected by token replacement (the template holds literal JSON braces,
    so str.format is off the table)."""
    desc = vault.profile.vault_description
    blurb = " This wiki is %s." % desc.rstrip(".") if desc else ""
    return _template("system").replace("__VAULT_DESCRIPTION__", blurb).strip()


def _truncate(text, limit):
    if len(text) <= limit:
        return text
    return text[:limit].rsplit("\n", 1)[0] + "\n[... truncated ...]"


def _page_excerpt(vault, path, limit=PAGE_CHARS):
    return _truncate(vault.read(path), limit)


def _pages_list(vault):
    names = sorted(vault.pages())
    listed = names[:MAX_PAGES_LISTED]
    suffix = "" if len(names) <= MAX_PAGES_LISTED else " (+%d more)" % (
        len(names) - MAX_PAGES_LISTED
    )
    return ", ".join("[[%s]]" % n for n in listed) + suffix


def _neighbors_block(vault, names):
    pages = vault.pages()
    parts = []
    for n in names:
        if n in pages:
            parts.append(
                "%s (%s):\n---\n%s\n---"
                % (n, vault.relpath(pages[n]), _page_excerpt(vault, pages[n], NEIGHBOR_CHARS))
            )
    return "\n\n".join(parts) if parts else "(none)"


# -- enqueue -------------------------------------------------------------------


def enqueue_lint_issues(queue, issues):
    """Dead links and orphans become queue items (deduped against pending)."""
    added = 0
    for issue in issues:
        kind, target = issue["kind"], issue["target"]
        if kind == "dead_link" and not queue.has_pending_type("dead_link", target):
            queue.enqueue(
                workqueue.PRIO_DEAD_LINK,
                "dead_link",
                {"target": target, "where": issue["where"]},
            )
            added += 1
        elif kind == "orphan" and not queue.has_pending_type("orphan", target):
            queue.enqueue(
                workqueue.PRIO_ORPHAN,
                "orphan",
                {"target": target, "where": issue["where"]},
            )
            added += 1
    return added


def enqueue_enrich(queue, vault, state, cooldown_days, rng=None, stale=False):
    """One sampled-neighborhood (or stalest-page) task, if any page is due."""
    picked = (
        sample.stalest_page(vault, state)
        if stale
        else sample.pick_page(vault, state, cooldown_days, rng=rng)
    )
    if not picked:
        return 0
    name, rel = picked
    task_type = "stale" if stale else "enrich"
    if queue.has_pending_type("enrich", name) or queue.has_pending_type("stale", name):
        return 0
    queue.enqueue(
        workqueue.PRIO_ENRICH,
        task_type,
        {"target": name, "where": rel},
    )
    return 1


def enqueue_corrections(queue, corrections):
    """Validated Sonnet audit corrections -> priority-00 items."""
    added = 0
    for c in corrections:
        payload = {
            "target": c["file"],
            "instruction": c["instruction"],
            "kind": c.get("kind", "fix"),
        }
        if "sha" in c:
            payload["sha"] = c["sha"]  # mechanical revert needs the commit
        queue.enqueue(
            workqueue.PRIO_AUDIT,
            "correction",
            payload,
            slug=os.path.basename(c["file"]),
        )
        added += 1
    return added


# -- render a claimed item into a prompt ----------------------------------------


class TaskRenderError(Exception):
    pass


def _where_file(vault, item):
    """Resolve the page an item works on; 'where' may be 'hub', a basename,
    or a vault-relative path."""
    where = item.get("where", "")
    if where == "hub":
        if not vault.hub:
            raise TaskRenderError("item names the hub but the vault has none")
        return vault.hub
    pages = vault.pages()
    base = os.path.splitext(os.path.basename(where))[0]
    if base in pages:
        return pages[base]
    resolved = vault.resolve(where) if where else None
    if resolved and os.path.isfile(resolved):
        return resolved
    raise TaskRenderError("cannot resolve page for item: %r" % (item,))


def render(vault, state, item):
    """(system, user, context) for one claimed queue item."""
    task_type = item["type"]
    pages_line = _pages_list(vault)

    if task_type == "dead_link":
        path = _where_file(vault, item)
        profile = vault.profile
        source_rel = vault.relpath(path)
        # stub placement: the profile's default kind, else beside the linking
        # page ("auto"). A hub-located dead link in a kind-less vault has no
        # sane stub home, so that option is withheld from the model entirely.
        context = {"target": item["target"]}
        if profile.stub_default and profile.stub_default in profile.stub_kinds:
            context["stub_dir"] = profile.stub_default
        elif not profile.stub_kinds and item.get("where") != "hub":
            context["stub_dir"] = "auto"
            context["source"] = source_rel
        stub_option = (
            '- create_stub: if [[{target}]] deserves its own page ("target" '
            'must be exactly "{target}", "text" is a one-line description '
            "based only on context shown).\n".format(target=item["target"])
            if "stub_dir" in context
            else ""
        )
        user = _template("dead_link").format(
            target=item["target"],
            where=item["where"],
            file=source_rel,
            page=_page_excerpt(vault, path),
            pages=pages_line,
            stub_option=stub_option,
        )
        return system_prompt(vault), user, context

    if task_type == "orphan":
        pages = vault.pages()
        name = item["target"]
        if name not in pages:
            raise TaskRenderError("orphan page vanished: %r" % name)
        neighbors = sample.pick_neighbors(vault, state, name)
        if not neighbors:
            # nothing links it and it links nothing: offer the profile's
            # category dirs as adoption candidates, else its sibling pages
            profile = vault.profile
            if profile.category_dirs:
                candidates = [
                    n
                    for n in sorted(pages)
                    if any(
                        vault.relpath(pages[n]).startswith(d.rstrip("/") + "/")
                        for d in profile.category_dirs
                    )
                ]
            else:
                own_dir = os.path.dirname(pages[name])
                candidates = [
                    n
                    for n in sorted(pages)
                    if n != name and os.path.dirname(pages[n]) == own_dir
                ]
            neighbors = candidates[:3]
        user = _template("orphan").format(
            target=name,
            orphan_file=vault.relpath(pages[name]),
            page=_page_excerpt(vault, pages[name]),
            neighbors=_neighbors_block(vault, neighbors),
            pages=pages_line,
        )
        return system_prompt(vault), user, {"target": name}

    if task_type in ("enrich", "stale"):
        pages = vault.pages()
        name = item["target"]
        if name not in pages:
            raise TaskRenderError("sampled page vanished: %r" % name)
        neighbors = sample.pick_neighbors(vault, state, name)
        user = _template("enrich").format(
            file=vault.relpath(pages[name]),
            page=_page_excerpt(vault, pages[name]),
            neighbors=_neighbors_block(vault, neighbors),
            pages=pages_line,
        )
        return system_prompt(vault), user, {}

    if task_type == "correction":
        rel = item["target"]
        resolved = vault.resolve(rel)
        if not resolved or not os.path.isfile(resolved):
            raise TaskRenderError("correction file missing: %r" % rel)
        user = _template("correction").format(
            file=rel,
            instruction=item["instruction"],
            page=_page_excerpt(vault, resolved),
            pages=pages_line,
        )
        return system_prompt(vault), user, {}

    raise TaskRenderError("unknown task type: %r" % task_type)
