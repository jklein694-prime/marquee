# Marquee

Your personal movie & TV expert — a local web app with a living **taste graph**, backed by
a wiki you own. Tell it what you've watched and loved; it tracks your history, learns your
taste, and recommends what to watch next. An in-app AI expert (Claude) chats with you,
researches candidates in the background, and grows a `movie ↔ genre ↔ taste` graph as you go.

Everything lives on your machine: the wiki is plain Markdown you control, and there's no
database or cloud account required beyond a free API key.

## Quickstart

```bash
git clone https://github.com/<you>/marquee.git
cd marquee
./install.sh
```

The guided installer checks prerequisites, installs dependencies, asks for a (free) TMDB API
key, asks where to keep your wiki, and scaffolds a fresh one if you don't have one. Then:

```bash
npm run dev        # open http://localhost:3000
```

Re-run `./install.sh` any time — it's safe and idempotent. `install.sh` is a **bash script**;
on Windows that means running it from **Git Bash** (see below) rather than PowerShell or cmd.

### Before you ask for a recommendation — build your taste graph first

The very first thing to do on a fresh install is **log a batch of movies and shows you've
already seen**, with a rating for each — not ask "what should I watch?" Louie's picks come
entirely from your taste graph, and on a brand-new wiki that graph is empty. Ask for a
recommendation before logging anything and Louie has nothing to point at: no favorite
directors, no genres it knows you love, no patterns to reason from.

So spend your first few minutes just talking about what you've watched — "I watched Heat,
loved it, 9/10," one after another, or run through a director's filmography. Ten or fifteen
titles is enough for real patterns to emerge. **Then** ask for a recommendation.

**Be patient after that, too.** Every title you log sharpens the graph a little more — Louie
gets noticeably better at pointing you in the right direction after 20 logs than after 5, and
keeps improving from there. Don't judge it off the first session; the more you use it, the
more it knows.

### Prerequisites

- **Node 20+** and npm (https://nodejs.org)
- A free **TMDB API key** (https://www.themoviedb.org/settings/api) — for posters, streaming
  info, and details
- For the in-app chat expert: an **`ANTHROPIC_API_KEY`** (https://console.anthropic.com) *or*
  a logged-in [Claude Code](https://claude.com/claude-code) CLI. The graph and watchlist work
  without it; only the chat needs Claude access. See **Connect to Claude** below.
- **Windows only:** [Git for Windows](https://git-scm.com/downloads/win) (`git-scm.com`). See
  why below.

## Installing on macOS

1. **Install Node 20+.** Either the installer from [nodejs.org](https://nodejs.org), or via
   [Homebrew](https://brew.sh):
   ```bash
   brew install node
   ```
2. **Git** is already on macOS (via Xcode Command Line Tools) — if `git --version` in Terminal
   prompts you to install them, accept and it'll be ready in a minute.
3. **Clone and install:**
   ```bash
   git clone https://github.com/<you>/marquee.git
   cd marquee
   ./install.sh
   ```
4. **Run it:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000.

## Installing on Windows

Windows works the same once you're set up, but there's one wrinkle: **`install.sh` is a bash
script**, and Windows' native shells (PowerShell, cmd.exe) can't run `.sh` files. The standard
fix is **[Git for Windows](https://git-scm.com/downloads/win)** — installing it gives you both
`git` itself *and* **Git Bash**, a bash terminal that runs shell scripts like this one correctly
on Windows. This is the one thing macOS users get for free (Git + a POSIX shell) that Windows
needs an extra install for.

1. **Install [Git for Windows](https://git-scm.com/downloads/win).** Run the installer with the
   defaults — that's enough to get both `git` and Git Bash. (Alternative: if you already use
   **WSL2** — Windows Subsystem for Linux — that works too and behaves like native Linux; skip
   Git for Windows and follow the macOS/Linux steps inside your WSL terminal instead.)
2. **Install Node 20+** from [nodejs.org](https://nodejs.org) — get the **Windows Installer
   (.msi)**. Run it with the defaults. Node installed this way is on your Windows PATH, so
   both PowerShell *and* Git Bash can see `node`/`npm`.
3. **Open Git Bash** (Start menu → "Git Bash"). All the following commands go in Git Bash, not
   PowerShell:
   ```bash
   git clone https://github.com/<you>/marquee.git
   cd marquee
   ./install.sh
   ```
4. **Run it** — from Git Bash *or* PowerShell, doesn't matter once installed:
   ```
   npm run dev
   ```
   Open http://localhost:3000 in your browser.

**Don't want to install Git Bash?** You can skip `install.sh` entirely and set up by hand from
PowerShell:
```powershell
# clone via GitHub Desktop, or `git` if you have it any other way
cd marquee
copy .env.example .env.local
notepad .env.local     # fill in TMDB_API_KEY and VAULT_PATH by hand
npm install
npm run dev
```

## Connect to Claude

The chat expert (the "Louie" persona you talk to) runs on **Claude**, via the Claude Agent SDK.
Two ways to authorize it — pick whichever's easier:

**Option A — API key.** Get one at https://console.anthropic.com/settings/keys, then either
paste it when `install.sh` asks, or add it to `.env.local` yourself:
```
ANTHROPIC_API_KEY=sk-ant-...
```
Same file, same variable, on both macOS and Windows.

**Option B — Claude Code CLI login** (no key needed in `.env.local`). Install the CLI globally
and log in once:
```bash
npm install -g @anthropic-ai/claude-code
claude
```
The first run walks you through login in your browser. This works identically in Terminal
(macOS) or Git Bash / PowerShell (Windows) — `npm install -g` puts `claude` on your PATH either
way. Once logged in, Marquee's chat expert uses that session automatically; nothing else to
configure.

`install.sh` checks for both automatically and tells you which one it found.

### Connect Claude Desktop (optional)

Because the wiki is just a folder, you can also talk to your movie expert from **Claude
Desktop** — it reads and writes the same database the app visualizes. `install.sh` offers to
wire this up automatically (step 8) on both macOS and Windows. To do it by hand, add a
filesystem MCP server pointed at your wiki to Claude Desktop's config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json` (typically
  `C:\Users\<you>\AppData\Roaming\Claude\claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "marquee-wiki": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/absolute/path/to/your/wiki"]
    }
  }
}
```

Restart Claude Desktop after editing. Then add the `movie-expert` skill (or paste
`.claude/skills/movie-expert/SKILL.md` as project instructions) so Claude Desktop behaves like
the in-app expert against your wiki.

**Windows path note:** if you ran `install.sh` from Git Bash, the wiki path it wrote might look
like `/c/Users/you/marquee-wiki` (Git Bash's POSIX-style path). Claude Desktop is a native
Windows app and needs a native path in the config — if the connection doesn't work, open
`claude_desktop_config.json` and change it to `C:\\Users\\you\\marquee-wiki` (double backslashes
in JSON).

## How it works

The wiki folder (`VAULT_PATH` in `.env.local`) is the whole brain:

```
<your-wiki>/
  wiki/entities/Movies.md                  # the hub: taste digest, watchlist, Seen ledger
  wiki/movies/_index.md                    # GRAND INDEX: routing table, one row per dimension
  wiki/movies/<Title (Year)>.md            # one page per movie/show you've seen
  wiki/movies/<dimension>/_index.md        # sub-index: one line per category in that dimension
  wiki/movies/<dimension>/<Category>.md    # category pages, one directory per taste dimension
  wiki/movies/taste/Taste Profile.md       # the deep, evidence-cited taste profile
```

The seven dimensions are `genres/`, `people/`, `themes/`, `style/`, `platforms/`, `eras/`,
and `settings/`. Movie pages wikilink to category pages and back; the hub links to both. The
app parses those links into the force-directed taste graph you see on screen. The
`movie-expert` skill (vendored in `.claude/skills/`) writes to the same files as you chat.

### The wiki's index architecture (and why)

The wiki is read and written by an LLM, so its layout follows what works for LLM memory
systems (MemGPT/Letta's core-vs-archival memory, Karpathy's LLM-wiki pattern, Anthropic's
progressive-disclosure skills, Wikipedia's category rules) rather than what looks tidy to a
human. It is a **three-tier tree with exactly two index levels**:

1. **Grand index** (`wiki/movies/_index.md`, always read, kept under ~1K tokens) — a routing
   table. One row per dimension: page count, scope, and the hottest signal ("Apple TV+ >
   HBO > Netflix; CBS negative"). Its only job is answering *"which sub-index should I
   open?"* It follows Wikipedia's **container rule**: it lists sub-indexes only, never
   individual pages — so logging a movie never touches it, and it stays stable enough to
   stay cheap in the model's prompt cache.
2. **Dimension sub-indexes** (`<dimension>/_index.md`, read on demand) — one bullet per
   category page (`[[Page]] — pattern line`), mirroring the directory exactly. Because index
   = directory, freshness is *mechanically checkable*: the app's lint pass flags any
   index↔file mismatch, a page indexed in two dimensions, or a sub-index growing past its
   split point. Each category lives in exactly one sub-index (Wikipedia's most-specific
   rule); cross-dimension relationships are wikilinks inside page bodies.
3. **Leaf pages** — movie pages, category pages (each carrying its own evidence and a
   `**Pattern:**` line), and the deep `Taste Profile.md`.

**Why not one big index?** The old layout was a single flat `_index.md` (100+ entries) plus a
~69 KB hub read every turn. Flat LLM-wiki indexes degrade at roughly 100 entries — the model
skims, mis-ranks, and duplicates entries (ours had the same category indexed twice with
contradictory patterns) — and every page-add rewrites the one hot file. Worse, the giant
always-read hub is the "read everything every query" antipattern: ~17K tokens prefetched per
turn, mostly irrelevant, and edited so often it busts prompt caching.

**Why hierarchy doesn't add latency.** The unit of agent latency is a model round trip, not
file I/O — *depth* costs round trips, *width* is nearly free. So the tree is capped at two
index levels with wide fan-out, and the expert reads hub + grand index + the 1-3 relevant
sub-indexes in a single batched tool message (~one round trip). Worst case a turn needs one
extra parallel read; in exchange every turn stops prefilling ~15K tokens of taste essays,
and the always-read layer is small and stable enough to cache. Net effect: faster and
cheaper per turn, with more reliable triage.

**Two write cadences keep it honest.** Inline (every turn): new category page → one bullet
in its dimension's sub-index; done. Consolidation (every ~5 logged titles, with pattern
mining): refresh sub-index pattern lines from their pages, refresh grand-index counts and
signals, rewrite the hub's ~15-bullet taste digest, and date-stamp superseded claims in
`Taste Profile.md` (claims are never silently deleted — taste drift is data). Cheap
incremental updates drift; the periodic rebuild is what keeps the indexes trustworthy.

## Deploying / keeping it running

Marquee is meant to run as a **persistent process on a machine you own** — your laptop, a home
server, a spare PC — not on a serverless/edge platform like Vercel. Two reasons: the wiki is a
real folder on disk (`VAULT_PATH`), which serverless functions don't reliably persist between
requests, and the chat expert runs Claude Code's own executable as a long-lived subprocess,
which serverless functions aren't built to host. Running it yourself, on your own hardware, is
the whole design — not a limitation to work around.

For everyday use, `npm run dev` in a terminal you leave open is enough. For something closer to
"install once, forget about it," build it and run the production server, kept alive by a
process manager:

**Build once:**
```bash
npm run build
```

**macOS/Linux — [pm2](https://pm2.keymetrics.io/) (works from Terminal or Git Bash):**
```bash
npm install -g pm2
pm2 start "npm run start" --name marquee
pm2 save
pm2 startup        # prints a command to auto-start pm2 (and Marquee) on login/reboot
```

**Windows — pm2 also works**, with an extra package for boot-time startup:
```powershell
npm install -g pm2
npm install -g pm2-windows-startup
pm2-startup install
pm2 start "npm run start" --name marquee
pm2 save
```
(Alternative: Task Scheduler, "run at log on," action = `npm run start` with **Start in** set
to the `marquee` folder — no extra packages, a bit more manual clicking.)

Either way, check on it any time with `pm2 status` / `pm2 logs marquee`, and stop it with
`pm2 stop marquee`.

## Using it from an iPad or other devices on your network

Marquee can't be installed *on* an iPad — the dev server needs Node and the app reads your
wiki from the local filesystem, so it has to run on a Mac or PC (or a self-hosted server, see
above). But you can **use** it from any device on your home network:

```bash
npm run dev -- -H 0.0.0.0
```

Then open `http://<your-computer-ip>:3000` in Safari, Chrome, or Edge on the same Wi-Fi — this
works on an iPad, another laptop, or a phone. The UI is browser-based and works with touch.
(The Claude Desktop wiki connection above is Mac/PC only, since it runs a local process.)

## Scripts

```bash
npm run dev      # start the dev server
npm run build    # production build
npm run start    # serve the production build
```

## Tech

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Claude Agent SDK · TMDB ·
`react-force-graph-2d`.
