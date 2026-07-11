"""CLI: python3 -m gardener {run-once,status,queue,lint,seed-queue}"""
import argparse
import json
import sys

from . import daemon, lint, llm, net, sample
from .config import Config
from .gitops import Git
from .vaultio import Vault
from .workqueue import WorkQueue


def main(argv=None):
    parser = argparse.ArgumentParser(prog="gardener")
    parser.add_argument("--conf", help="path to gardener.conf")
    sub = parser.add_subparsers(dest="command")
    run = sub.add_parser("run-once", help="do at most one gardening task")
    run.add_argument("--dry-run", action="store_true")
    sub.add_parser("status", help="health, counts, recent state")
    sub.add_parser("queue", help="list pending work")
    sub.add_parser("lint", help="print the vault lint report")
    sub.add_parser("seed-queue", help="refill the queue from lint + sampling")
    net_p = sub.add_parser("net", help="wifi radio control (on|off|status)")
    net_p.add_argument("action", choices=("on", "off", "status"))
    args = parser.parse_args(argv)

    if args.command == "net":
        if args.action == "status":
            print(json.dumps(net.status(), indent=2, sort_keys=True))
            return 0
        ok, out = (net.on() if args.action == "on" else net.off())
        print(out)
        return 0 if ok else 1

    cfg = Config(path=args.conf)
    vault = Vault(cfg.vault_dir)
    queue = WorkQueue(cfg.queue_dir)

    if args.command == "run-once":
        result = daemon.run_once(cfg, dry_run=args.dry_run)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result.get("outcome") != "error" else 1

    if args.command == "status":
        git = Git(cfg.vault_dir)
        print(
            json.dumps(
                {
                    "llama_healthy": llm.health(cfg.llama_url),
                    "vault": cfg.vault_dir,
                    "vault_is_repo": git.is_repo(),
                    "changes_today": git.commits_since_midnight()
                    if git.is_repo()
                    else None,
                    "queue": queue.counts(),
                    "pages": len(vault.pages()),
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0

    if args.command == "queue":
        for name, item in queue.pending():
            print("%s\t%s\t%s" % (name, item.get("type"), item.get("target", "")))
        return 0

    if args.command == "lint":
        for line in lint.lint_report(vault):
            print(line)
        return 0

    if args.command == "seed-queue":
        state = sample.load_state(cfg.state_file)
        sample.seed_state(vault, state)
        import time

        added = daemon._refill(
            queue, vault, state, cfg, None, time.strftime("%Y-%m-%d")
        )
        sample.save_state(cfg.state_file, state)
        print("queued %d items" % added)
        return 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
