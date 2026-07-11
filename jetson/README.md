# wikigardener — air-gapped wiki gardener for the original Jetson Nano

A small local LLM (Qwen2.5-Instruct, running on llama.cpp) lives on your
Jetson Nano and tends a copy of your Obsidian wiki around the clock, fully
offline: it repairs broken wikilinks, adopts orphan pages, removes stale
lines, and keeps weaving new connections through random, staleness-weighted
samples of the graph. Every change is one git commit. Occasionally you
connect WiFi for a few minutes and run a **Sonnet audit**: Claude reviews
everything the gardener did, writes a review into the audits folder, and
queues corrections the gardener then works through after you disconnect.

It works on **any Obsidian vault**. With no configuration, every `.md` found
by a recursive scan is a page (dot-directories, `_underscore` files/dirs,
audits, and the log are skipped) and the universal rules apply. An optional
`gardener-vault.conf` in the vault root teaches it your structure — hub page
and its section rules, page directories, stub locations, frontmatter link
keys, a domain description injected into the model's prompts. Two profiles
ship in `payload/profiles/`: `marquee-movies.conf` (this repo's movie wiki)
and a fully commented `generic.conf`. The installer auto-detects which one
fits your seed; override with `sudo bash install.sh --profile <name|path>`.

```
online machine                    USB                Jetson Nano (offline)
--------------                    ---                ---------------------
build-payload.sh  ── models ────► stick ── install.sh ──► llama-server.service
                     llama.cpp                             gardener.timer (15min)
                     gardener/                             vault = git repo
                     your vault                            audit.sh (online window)
```

## Hybrid appliance: high visibility & control

Beyond the offline gardener, the device is a **connected-on-demand appliance**.
The gardener still runs fully offline 24/7; you flip WiFi on when you want to:

- **LAN web dashboard** (`http://<nano-ip>:8088`) — live status + tok/s, the work
  queue (incl. the failed-patch journal), recent commits and diffs, a log
  stream, a **model picker that downloads models online**, a **prompt editor**,
  and buttons to pause/resume, run one task, audit, sync, and toggle WiFi.
  Password is the token in `/etc/wikigardener/dashboard.token`.
- **Download / switch models** (`wikigardener models …` or the dashboard): a
  curated catalog plus any Hugging Face `.gguf` URL; refuses models too big for
  your board's RAM and rolls back if a new model won't start. Any GGUF whose
  architecture the pinned llama.cpp (`b2275`) supports works — Qwen 1.5/2/2.5,
  Llama 1/2/3, Mistral, Phi-2, Gemma 1, and more. Newer architectures (Qwen3,
  Gemma 2/3, **Nemotron**) need a newer `LLAMACPP_TAG` that won't build on
  JetPack 4.6 — see the Nemotron note below.
- **Git sync** to your computer or GitHub (`wikigardener sync`, or hourly): the
  vault is a git repo, so this is push/pull with conflict-safe rebase.
- **Tune prompts** for your specific LLM work: edit them in the dashboard or in
  `<vault>/prompts/*.txt` — overrides live in the vault, sync via git, and
  survive upgrades.
- **Drive it from your laptop** with Claude Code or **Claw Code** over SSH — see
  `jetson/laptop/`. (The Nano's Ubuntu 18.04 / glibc 2.27 is too old to run
  those on-device, so they run on your machine and operate the Nano remotely.)

Two ways to get it onto the Nano:

| | Custom SD image | USB payload + installer |
|---|---|---|
| flash from scratch | ✅ `image/build-image.sh` → one `.img` → Balena Etcher | keep your JetPack, run `install.sh` from USB |
| when | fresh card, hands-off first boot | you already have a working Nano |
| risk | higher (see hardware caveats) | proven path |

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

## 1b. Or: build a flashable SD image (from scratch)

Prefer a hands-off card? Build one image with everything baked in:

```bash
sudo ./jetson/image/build-image.sh --vault /path/to/your/vault   # → wikigardener-jetson.img
```

It downloads NVIDIA's JetPack 4.6 Nano SD image (see the `JETPACK_IMAGE_URL`
note in `PINS.env` — NVIDIA gates the download, so you point it at your own
copy/mirror), injects the payload, enables a **first-boot service** that runs
`install.sh` unattended, and preseeds a `gardener` login. Flash the `.img` with
Balena Etcher, boot, log in (`gardener` / `wikigardener`, forced change), wait
for the ~20–40 min one-time build, then run `wikigardener setup`.

This is the **riskiest** path — image boot, partition layout, NVIDIA
`oem-config` coexistence, and rootfs auto-resize can only be confirmed on real
hardware. If the image won't boot, fall back to flashing NVIDIA's stock JetPack
image and running `install.sh` from USB (§2) — identical payload, proven path.
Run it on Linux as root (loop devices + ext4); on mac/Windows use a privileged
Linux VM.

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

## 3b. Connected operation (the online windows)

Finish setup once, then use the dashboard for everything:

```bash
wikigardener setup            # wifi, dashboard password, git sync, model, prompts
wikigardener net on|off|status
wikigardener models list|download <id|url>|use <id>|rm <file>
wikigardener sync             # push/pull the vault to your computer (needs WiFi)
```

- **Dashboard**: `http://<nano-ip>:8088`, password from
  `/etc/wikigardener/dashboard.token`. It's the fastest way to watch tok/s, the
  queue, commits, and logs, and to download/switch models or edit prompts. It
  runs as root behind a token + CSRF + same-origin check — **scope port 8088 to
  your LAN** (`ufw allow from 192.168.0.0/16 to any port 8088`).
- **Git sync**: set a remote in the wizard. For SSH remotes, add the Nano's key
  (`ssh-keygen … ; cat /root/.ssh/id_ed25519.pub`) to your host. Conflicts are
  never lost — a rebase clash writes a `_sync-conflicts/<date>.md` note and
  leaves both sides intact.
- **Drive from your laptop** (Claude Code / Claw Code): on your machine, run
  `jetson/laptop/install-claw-code.sh` then `jetson/laptop/connect.sh <nano-ip>`.
  That adds an SSH `wikigardener` alias with a tunnel so laptop agents can use
  the Nano's offline model at `http://localhost:8080` — `llama-server` stays
  bound to localhost, so the air gap holds when WiFi is off.

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
failed-patch journal, and sampled pages; it writes `<AUDITS_DIR>/<date>.md`
(`wiki/audits/` on the movie profile, `_audits/` generic — human review + a
JSON corrections block) and its corrections enter the queue
at top priority — `revert` corrections are applied mechanically via git, the
rest are handed to the local model one at a time. The vault gets an
`audit/<date>` tag, which becomes the baseline for the next audit.

## Nemotron / bigger models (needs an Orin, not the original Nano)

NVIDIA Nemotron is staged in `models.catalog` (`ram_tier = orin`) but **cannot
run on the original Jetson Nano** on two counts: the smallest Nemotron is 4B
(too big for the shared 4GB — a 256GB flash drive is storage, not RAM, and
swap-running a 4B is unusably slow), and its architecture needs a 2025-era
llama.cpp that will not build on JetPack 4.6 / GCC 7 / CUDA 10.2. The model
manager therefore refuses it here ("✗tier" in the picker).

It becomes a first-class option on an **Orin Nano (8GB, JetPack 5/6)**: bump
`LLAMACPP_TAG` to a current release (the newer glibc/CUDA there build it
fine), and the staged catalog entries light up. An Orin also lets Claude Code
run on-device. If you move to an Orin, ping me to wire a proper "orin" build
variant (newer pin + JetPack 5/6 preflight).

## 2GB Nano notes

- Preflight auto-selects the 0.5B model and a 1200M memory ceiling for the
  server. Expect noticeably dumber (but still useful) patches; the validator
  and the audit carry more of the weight.
- Drop `CTX=2048` and consider `INTERVAL_MIN=30` in `gardener.conf`.

## First-boot hardware checklist (things only real hardware can answer)

| Check | How | Fallback if bad |
|---|---|---|
| SD image boots / `p1` is rootfs | Etcher-flash + boot | flash NVIDIA's stock image + `install.sh` from USB (identical payload) |
| `oem-config` coexistence / user preseed | first boot reaches a login | let oem-config run once on a monitor; firstboot runs after |
| First-boot rootfs auto-resize | `df -h /` after boot | grow manually with `resize2fs` |
| CUDA build succeeded? | install output / `ls /opt/wikigardener/bin` | none needed — CPU variant is the design baseline |
| Tokens/sec | dashboard, or the install self-test | smaller model (dashboard picker / `TIER_OVERRIDE`), `CTX=2048`, longer `INTERVAL_MIN` |
| Thermals under load | `tegrastats` during a cycle | raise `INTERVAL_MIN`; add a fan |
| `nmcli` headless WiFi | `wikigardener net status` | manual `nmcli`/`wpa_supplicant` (wizard prints steps) |
| Dashboard reachable on LAN | open `http://<nano-ip>:8088` | check firewall; bind is `0.0.0.0` by default |

## Development (this repo, no Jetson needed)

```bash
python3 -m pytest jetson/tests -q        # full suite: gardener + models/sync/webui/image
bash jetson/ci/shellcheck.sh             # lint all shell (installer, wizard, image, laptop)
bash jetson/ci/payload-smoke.sh          # fake-artifact payload build + verify
bash jetson/ci/py36-compat-check.sh      # Nano's python3.6 compatibility
bash jetson/ci/gcc7-build-check.sh       # docker: GCC 7 compile canary
sudo python3 -m pytest jetson/tests/test_image_build.py  # loopback image-inject (root only)
```

The gardener is Python 3.6 stdlib-only by design (the Nano is frozen and
offline — no pip, no wheels, no YAML lib; frontmatter is edited line-wise so
git diffs stay clean). The lint rules, wikilink regex, and address allocator
are faithful ports of `lib/lint.ts`, `lib/wikilink.ts`, and
`vault-template/scripts/allocate-address.sh` — the shell allocator and the
python one interoperate on the same counter file.
