# wikigardener — air-gapped wiki gardener for the original Jetson Nano

A small local LLM (Qwen2.5-Instruct, running on llama.cpp) lives on your
Jetson Nano and tends a copy of your Obsidian wiki around the clock, fully
offline: it repairs broken wikilinks, adopts orphan pages, removes stale
lines, and keeps weaving new connections through random, staleness-weighted
samples of the graph. Every change is one git commit. Occasionally you
connect WiFi for a few minutes and run a **Sonnet audit**: Claude reviews
everything the gardener did, writes a review into `wiki/audits/`, and queues
corrections the gardener then works through after you disconnect.

```
online machine                    USB                Jetson Nano (offline)
--------------                    ---                ---------------------
build-payload.sh  ── models ────► stick ── install.sh ──► llama-server.service
                     llama.cpp                             gardener.timer (15min)
                     gardener/                             vault = git repo
                     your vault                            audit.sh (online window)
```

## What you need

- Original Jetson Nano DevKit (4GB or 2GB RAM — auto-detected) on JetPack 4.x
  with its stock Ubuntu 18.04. ~250GB storage is plenty; 8GB free is the floor.
- An online Linux/macOS machine with `bash`, `curl`, `rsync` (to build the USB payload).
- A USB stick (or any way to move ~2GB to the Nano).
- An Anthropic API key — only for the optional audit windows.

## 1. Build the payload (online machine)

```bash
./jetson/build-payload.sh --vault /path/to/your/obsidian/vault
```

- Downloads the pinned artifacts (see `PINS.env`): llama.cpp source tarball +
  two GGUF models (1.5B for the 4GB board, 0.5B fallback for 2GB).
- **First run fills in the `TBD` sha256 pins (trust-on-first-use) and rewrites
  `PINS.env` — commit that change.** Every later build verifies and fails hard
  on any mismatch.
- Your vault is snapshotted into `vault-seed/` (`.git`/`.obsidian` excluded).
- Output: `./wikigardener-payload/` with a `MANIFEST.sha256`. Copy the whole
  directory to the USB stick.

Before first hardware use, run the toolchain canary on the online machine
(needs docker): `./jetson/ci/gcc7-build-check.sh`. It compiles the pinned
llama.cpp tag with Ubuntu 18.04's GCC 7 — exactly what the Nano will do. If
it fails, walk `LLAMACPP_TAG` back (b1971, b1808) in `PINS.env` and rebuild.

## 2. Install (on the Nano, offline)

```bash
sudo bash /media/<usb>/wikigardener-payload/install.sh
```

What happens, in order:

1. **Preflight** — manifest verification, aarch64/L4T check, RAM tier pick
   (≥3.5GB → 1.5B model, ≥1.7GB → 0.5B), disk check, toolchain check (if
   `gcc`/`make`/etc. are missing it prints the one-time `apt install` line —
   the only step that ever needs a network), and creates a 4GB swapfile if
   swap is under 2GB.
2. **Build llama.cpp on-device** (~20–40 min, one-time). CPU/NEON build is
   mandatory; if CUDA 10.2 is present a GPU build is attempted under a 1h
   timeout — **failure is expected and fine**, the CPU binary remains.
3. Installs everything under `/opt/wikigardener`, config in
   `/etc/wikigardener`, and seeds `/var/lib/wikigardener/vault` as a git repo
   (tag `install`). Re-running the installer never touches an existing vault.
4. Enables `llama-server.service` (model resident on localhost:8080) and
   `gardener.timer` (one task every `INTERVAL_MIN`, default 15 min).
5. **Self-test**: waits for the model to load, times one completion, runs a
   lint pass and a dry-run cycle, prints the status block.

## 3. Operating it

```bash
journalctl -fu gardener                          # watch it work
PYTHONPATH=/opt/wikigardener python3 -m gardener status   # health + queue counts
PYTHONPATH=/opt/wikigardener python3 -m gardener lint     # current lint report
PYTHONPATH=/opt/wikigardener python3 -m gardener queue    # pending work
ls /var/lib/wikigardener/queue/failed/           # patches the validator rejected
git -C /var/lib/wikigardener/vault log --oneline # the full change journal
```

Tuning lives in `/etc/wikigardener/gardener.conf` (interval, daily change cap,
cooldown days, context size, tier override). After edits:
`sudo systemctl restart llama-server && sudo systemctl daemon-reload`.

**How a cycle works**: the timer fires → guards (model healthy? daily cap?
crash leftovers to commit?) → mechanical lint autofix if needed (no LLM) →
otherwise claim the highest-priority queue item (audit corrections, then dead
links, then orphans, then sampled enrichment; the queue refills itself from
lint + staleness-weighted sampling) → one small ChatML prompt → the reply must
be one JSON patch that survives validation (path confinement, unique-anchor
grounding, resolvable links, protected hub/log/audits, no page deletion —
see `payload/gardener/patch.py`) → apply → one git commit. Invalid output is
journaled to `queue/failed/` and **nothing is written**.

### Rollback

```bash
cd /var/lib/wikigardener/vault
git log --oneline                 # find the bad change
git revert <sha>                  # undo one change safely
git reset --hard audit/2026-07-01 # nuclear: back to a known-good audit point
```

## 4. The Sonnet audit window

When you're ready (weekly-ish is plenty):

```bash
# one-time key setup
echo 'sk-ant-...' | sudo tee /etc/wikigardener/anthropic.key >/dev/null
sudo chmod 600 /etc/wikigardener/anthropic.key

# connect WiFi, then:
sudo bash /opt/wikigardener/audit/audit.sh
# ... disconnect WiFi (the script offers to nmcli it off for you)
```

Sonnet receives the git history since the last audit, the lint report, the
failed-patch journal, and sampled pages; it writes `wiki/audits/<date>.md`
(human review + a JSON corrections block) and its corrections enter the queue
at top priority — `revert` corrections are applied mechanically via git, the
rest are handed to the local model one at a time. The vault gets an
`audit/<date>` tag, which becomes the baseline for the next audit.

## 2GB Nano notes

- Preflight auto-selects the 0.5B model and a 1200M memory ceiling for the
  server. Expect noticeably dumber (but still useful) patches; the validator
  and the audit carry more of the weight.
- Drop `CTX=2048` and consider `INTERVAL_MIN=30` in `gardener.conf`.

## First-boot hardware checklist (things only real hardware can answer)

| Check | How | Fallback if bad |
|---|---|---|
| CUDA build succeeded? | install output / `ls /opt/wikigardener/bin` | none needed — CPU variant is the design baseline |
| Tokens/sec | printed by the install self-test | smaller model (`TIER_OVERRIDE=0.5b`), `CTX=2048`, longer `INTERVAL_MIN` |
| Thermals under load | `tegrastats` during a cycle | raise `INTERVAL_MIN`; add a fan |
| Model load time from SD | `journalctl -u llama-server` | move `/opt/wikigardener/models` to USB-SSD; `TimeoutStartSec` already generous |

## Development (this repo, no Jetson needed)

```bash
python3 -m pytest jetson/tests -q        # 109 tests incl. full mocked cycles
bash jetson/ci/shellcheck.sh             # lint all shell
bash jetson/ci/payload-smoke.sh          # fake-artifact payload build + verify
bash jetson/ci/py36-compat-check.sh      # Nano's python3.6 compatibility
bash jetson/ci/gcc7-build-check.sh       # docker: GCC 7 compile canary
```

The gardener is Python 3.6 stdlib-only by design (the Nano is frozen and
offline — no pip, no wheels, no YAML lib; frontmatter is edited line-wise so
git diffs stay clean). The lint rules, wikilink regex, and address allocator
are faithful ports of `lib/lint.ts`, `lib/wikilink.ts`, and
`vault-template/scripts/allocate-address.sh` — the shell allocator and the
python one interoperate on the same counter file.
