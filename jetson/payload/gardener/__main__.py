"""CLI: python3 -m gardener {run-once,status,queue,lint,seed-queue}"""
import argparse
import json
import sys

from . import daemon, lint, llm, models, net, sample, sync as sync_mod
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
    models_p = sub.add_parser("models", help="list/download/use/rm local models")
    models_p.add_argument(
        "models_action", choices=("list", "download", "use", "rm")
    )
    models_p.add_argument("target", nargs="?", help="catalog id, .gguf URL, or filename")
    models_p.add_argument("--force", action="store_true", help="ignore RAM-tier fit")
    sync_p = sub.add_parser("sync", help="git push/pull the vault to your computer")
    sync_p.add_argument(
        "--allow-offline", action="store_true", help="skip the connectivity check"
    )
    web_p = sub.add_parser("web", help="serve the LAN control dashboard")
    web_p.add_argument("--host")
    web_p.add_argument("--port", type=int)
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

    if args.command == "models":
        try:
            return models.cli(cfg, args)
        except RuntimeError as exc:
            print("error: %s" % exc, file=sys.stderr)
            return 1

    if args.command == "sync":
        result = sync_mod.sync(cfg, require_online=not args.allow_offline)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result.get("outcome") in ("ok", "disabled", "skipped") else 1

    if args.command == "web":
        from . import webui

        webui.serve(cfg, host=args.host, port=args.port)
        return 0

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
