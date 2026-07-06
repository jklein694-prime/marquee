"""The single-cycle orchestrator: systemd's timer fires, run_once() does at
most ONE small thing, commits it, and exits. One writer, no races, save as
you go — the discipline is borrowed from the movie-expert skill; the timer
provides the loop and the duty cycle.
"""
import time

from . import lint, llm, sample, tasks
from .gitops import Git
from .patch import Patch, PatchError, extract_json
from .vaultio import Vault
from .workqueue import WorkQueue


def _status(outcome, **details):
    d = dict(details)
    d["outcome"] = outcome
    return d


def _daily_log(vault, git, state, today, dry_run):
    """First cycle of a new day: prepend yesterday's one-line summary to
    wiki/log.md (only when something changed yesterday)."""
    if state.get("_last_log_date") == today:
        return None
    state["_last_log_date"] = today
    if dry_run:
        return None
    yesterday = time.strftime(
        "%Y-%m-%d", time.localtime(time.time() - 86400)
    )
    subjects = git.subjects_between("%s 00:00" % yesterday, "%s 00:00" % today)
    lines = [s for s in subjects if s.startswith("gardener(")]
    if not lines:
        return None
    counts = {}
    for s in lines:
        kind = s[len("gardener("):].split(")", 1)[0]
        counts[kind] = counts.get(kind, 0) + 1
    breakdown = ", ".join("%d %s" % (n, k) for k, n in sorted(counts.items()))
    entry = "## [%s] gardener — %d changes (%s)\n" % (
        yesterday,
        len(lines),
        breakdown,
    )
    text = vault.read(vault.log)
    log_lines = text.split("\n")
    insert_at = 1 if log_lines and log_lines[0].startswith("# ") else 0
    log_lines.insert(insert_at, "\n" + entry.rstrip())
    with open(vault.log, "w", encoding="utf-8") as fh:
        fh.write("\n".join(log_lines))
    git.commit_all("gardener(log): daily summary for %s" % yesterday)
    return entry.strip()


def _refill(queue, vault, state, cfg, rng, today):
    """Empty queue: lint issues first, then one sampled task. The daily
    staleness sweep replaces the random sample on the first refill of a day."""
    issues = lint.lint_vault(vault)
    added = tasks.enqueue_lint_issues(queue, issues)
    stale_sweep = state.get("_last_stale_date") != today
    added += tasks.enqueue_enrich(
        queue, vault, state, cfg.cooldown_days, rng=rng, stale=stale_sweep
    )
    if stale_sweep:
        state["_last_stale_date"] = today
    return added


def run_once(cfg, dry_run=False, rng=None, today=None):
    """One gardening cycle. Returns a status dict (also the CLI's output)."""
    today = today or time.strftime("%Y-%m-%d")
    vault = Vault(cfg.vault_dir)
    git = Git(cfg.vault_dir)
    queue = WorkQueue(cfg.queue_dir)

    # -- guards ------------------------------------------------------------
    if not git.is_repo():
        return _status("error", error="vault is not a git repository")
    if not llm.health(cfg.llama_url):
        return _status("skipped", reason="llama-server not healthy")
    if git.dirty():
        if dry_run:
            return _status("skipped", reason="vault dirty (dry run)")
        git.commit_all("gardener(recover): commit partial state after crash")
    changes_today = git.commits_since_midnight()
    if changes_today >= cfg.max_changes_per_day:
        return _status(
            "skipped",
            reason="daily change cap reached (%d)" % cfg.max_changes_per_day,
        )

    state = sample.load_state(cfg.state_file)
    sample.seed_state(vault, state)

    logged = _daily_log(vault, git, state, today, dry_run)

    # -- mechanical autofix is a full cycle's work when it fires ------------
    hub_text = vault.read(vault.hub)
    if lint.autofix_text(hub_text) != hub_text:
        if dry_run:
            return _status("would_autofix")
        fixes = lint.autofix_vault(vault)
        git.commit_all("gardener(autofix): %s" % "; ".join(fixes))
        sample.save_state(cfg.state_file, state)
        return _status("applied", task="autofix", detail=fixes)

    # -- claim work (refill when empty) --------------------------------------
    if dry_run:
        pend = queue.counts()["pending"]
        issues = lint.lint_report(vault)
        sample.save_state(cfg.state_file, state)
        return _status(
            "dry_run", pending=pend, lint_issues=issues, daily_log=logged
        )

    name, item = queue.claim()
    if item is None:
        _refill(queue, vault, state, cfg, rng, today)
        name, item = queue.claim()
    if item is None:
        sample.save_state(cfg.state_file, state)
        return _status("idle", reason="no work: vault is clean and rested")

    # -- mechanical audit reverts skip the LLM entirely ----------------------
    if item["type"] == "correction" and item.get("kind") == "revert":
        sha = item.get("sha", "")
        try:
            git.revert(sha)
            queue.finish(name, ok=True)
            return _status("applied", task=name, action="revert", sha=sha)
        except RuntimeError as exc:
            queue.finish(name, ok=False, extra={"error": str(exc)})
            return _status("failed", task=name, error=str(exc))

    # -- one LLM round --------------------------------------------------------
    try:
        system, user, context = tasks.render(vault, state, item)
    except tasks.TaskRenderError as exc:
        queue.finish(name, ok=False, extra={"error": str(exc)})
        return _status("failed", task=name, error=str(exc))

    try:
        raw = llm.chat(
            cfg.llama_url,
            system,
            user,
            max_tokens=cfg.max_tokens,
            temperature=cfg.temperature,
            timeout=cfg.llm_timeout_sec,
        )
    except llm.LlmError as exc:
        # server hiccup, not the item's fault: release for a later retry
        queue.release(name)
        return _status("skipped", reason="llm error: %s" % exc, task=name)

    try:
        patch = Patch(extract_json(raw), vault, context=context)
    except PatchError as exc:
        queue.finish(name, ok=False, extra={"error": str(exc), "raw_output": raw})
        sample.save_state(cfg.state_file, state)
        return _status("rejected", task=name, error=str(exc))

    target_rel = item.get("where") or item.get("target", "")
    if patch.action == "no_change":
        # a considered no-op still cools the page down so churn stops
        _touch_item_page(vault, state, item)
        sample.save_state(cfg.state_file, state)
        queue.finish(name, ok=True, extra={"action": "no_change"})
        return _status("applied", task=name, action="no_change", reason=patch.reason)

    changed = patch.apply(today=today)
    message = "gardener(%s): %s\n\nfiles: %s\ntask: %s" % (
        item["type"],
        patch.reason,
        ", ".join(changed),
        name,
    )
    sha = git.commit_all(message)
    for rel in changed:
        sample.touch(state, rel)
    _touch_item_page(vault, state, item)
    sample.save_state(cfg.state_file, state)
    queue.finish(name, ok=True, extra={"action": patch.action, "commit": sha})
    return _status(
        "applied",
        task=name,
        action=patch.action,
        files=changed,
        commit=sha,
        reason=patch.reason,
        target=target_rel,
    )


def _touch_item_page(vault, state, item):
    pages = vault.pages()
    target = item.get("target", "")
    if target in pages:
        sample.touch(state, vault.relpath(pages[target]))
