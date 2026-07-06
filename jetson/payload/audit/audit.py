"""Sonnet audit — runs ONLY during the deliberate online window.

Gathers evidence (git history since the last audit tag, lint report, failed
patches, sampled pages), makes one raw HTTPS call to the Anthropic API
(stdlib urllib — no SDK, which keeps the Nano's python3.6 sufficient),
writes the audit note into wiki/audits/, and queues the machine-readable
corrections at top priority for the offline gardener to work through.

Usage (audit.sh wraps this):
    python3 audit.py [--conf /etc/wikigardener/gardener.conf]
                     [--key-file /etc/wikigardener/anthropic.key]
                     [--base-url https://api.anthropic.com]  # tests: mock
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from gardener import lint, sample, tasks  # noqa: E402
from gardener.config import Config  # noqa: E402
from gardener.gitops import Git  # noqa: E402
from gardener.vaultio import Vault  # noqa: E402
from gardener.workqueue import WorkQueue  # noqa: E402

MODEL = "claude-sonnet-5"
MAX_TOKENS = 8000
MAX_PATCH_CHARS = 30000
MAX_FAILED_SHOWN = 10
SAMPLED_PAGES = 5
MAX_CORRECTIONS = 15

HERE = os.path.dirname(os.path.abspath(__file__))


def gather_evidence(cfg, vault, git, queue):
    last_tag = git.latest_tag("audit/")
    parts = []
    parts.append(
        "# Commits since %s\n%s"
        % (last_tag or "install", git.log_since(last_tag, "--stat") or "(none)")
    )
    patches = git.log_since(last_tag, "-p")
    if len(patches) > MAX_PATCH_CHARS:
        patches = patches[:MAX_PATCH_CHARS] + "\n[... patch series truncated ...]"
    parts.append("# Patch series\n%s" % (patches or "(none)"))
    parts.append(
        "# Current lint report\n%s" % ("\n".join(lint.lint_report(vault)) or "(clean)")
    )

    failed_dir = os.path.join(cfg.queue_dir, "failed")
    failed = []
    if os.path.isdir(failed_dir):
        names = sorted(os.listdir(failed_dir))[-MAX_FAILED_SHOWN:]
        for name in names:
            with open(os.path.join(failed_dir, name), encoding="utf-8") as fh:
                item = json.load(fh)
            failed.append(
                "%s: %s (raw: %s)"
                % (name, item.get("error", "?"), str(item.get("raw_output", ""))[:300])
            )
    parts.append(
        "# Failed-task journal (validator rejections)\n%s"
        % ("\n".join(failed) or "(none)")
    )

    if vault.hub and os.path.exists(vault.hub):
        parts.append("# Hub page\n%s" % vault.read(vault.hub))

    state = sample.load_state(cfg.state_file)
    sample.seed_state(vault, state)
    pages = vault.pages()
    shown = set()
    samples = []
    for _ in range(SAMPLED_PAGES * 3):
        picked = sample.pick_page(vault, state, cooldown_days=0)
        if not picked or picked[0] in shown:
            continue
        shown.add(picked[0])
        samples.append(
            "## %s\n%s" % (picked[1], vault.read(pages[picked[0]])[:4000])
        )
        if len(shown) >= min(SAMPLED_PAGES, len(pages)):
            break
    parts.append("# Sampled pages\n%s" % "\n\n".join(samples))

    audits = sorted(os.listdir(vault.audits_dir)) if os.path.isdir(vault.audits_dir) else []
    if audits:
        with open(os.path.join(vault.audits_dir, audits[-1]), encoding="utf-8") as fh:
            parts.append("# Previous audit note\n%s" % fh.read()[:6000])

    return "\n\n".join(parts)


def call_sonnet(base_url, api_key, system, user):
    req = urllib.request.Request(
        base_url.rstrip("/") + "/v1/messages",
        data=json.dumps(
            {
                "model": MODEL,
                "max_tokens": MAX_TOKENS,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            }
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return "".join(
        block.get("text", "") for block in data.get("content", [])
    )


def parse_corrections(reply, vault):
    """The fenced ```json block -> validated correction list."""
    m = re.search(r"```json\s*(.*?)```", reply, re.DOTALL)
    if not m:
        return []
    try:
        raw = json.loads(m.group(1))
    except ValueError:
        return []
    if not isinstance(raw, list):
        return []
    out = []
    for c in raw[:MAX_CORRECTIONS]:
        if not isinstance(c, dict):
            continue
        rel = str(c.get("file", ""))
        instruction = str(c.get("instruction", "")).strip()
        kind = c.get("kind", "fix")
        if kind not in ("fix", "enrich", "revert"):
            continue
        if not instruction or len(instruction) > 500:
            continue
        resolved = vault.resolve(rel)
        if kind != "revert" and (not resolved or not os.path.isfile(resolved)):
            continue
        item = {"file": rel, "instruction": instruction, "kind": kind}
        if kind == "revert":
            sha = str(c.get("sha", "")).strip()
            if not re.match(r"^[0-9a-f]{7,40}$", sha):
                continue
            item["sha"] = sha
        out.append(item)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--conf")
    parser.add_argument("--key-file", default="/etc/wikigardener/anthropic.key")
    parser.add_argument("--base-url", default="https://api.anthropic.com")
    args = parser.parse_args(argv)

    cfg = Config(path=args.conf)
    vault = Vault(cfg.vault_dir)
    git = Git(cfg.vault_dir)
    queue = WorkQueue(cfg.queue_dir)

    with open(args.key_file) as fh:
        api_key = fh.read().strip()

    print("== gathering evidence")
    evidence = gather_evidence(cfg, vault, git, queue)
    with open(os.path.join(HERE, "audit-system.txt"), encoding="utf-8") as fh:
        system = fh.read()
    desc = vault.profile.vault_description
    system = system.replace(
        "__VAULT_DESCRIPTION__",
        " The wiki is %s." % desc.rstrip(".") if desc else "",
    )

    print("== calling %s (%d chars of evidence)" % (MODEL, len(evidence)))
    reply = call_sonnet(args.base_url, api_key, system, evidence)

    today = time.strftime("%Y-%m-%d")
    os.makedirs(vault.audits_dir, exist_ok=True)
    note_path = os.path.join(vault.audits_dir, "%s.md" % today)
    with open(note_path, "w", encoding="utf-8") as fh:
        fh.write(reply if reply.endswith("\n") else reply + "\n")
    print("== audit note: %s" % vault.relpath(note_path))

    corrections = parse_corrections(reply, vault)
    # revert corrections carry a sha the gardener applies mechanically;
    # everything else becomes a prompt for the local model
    queued = tasks.enqueue_corrections(queue, corrections)
    print("== queued %d corrections at top priority" % queued)

    git.commit_all("audit: sonnet review %s" % today)
    git.tag("audit/%s" % today)
    print("== tagged audit/%s" % today)
    return 0


if __name__ == "__main__":
    sys.exit(main())
