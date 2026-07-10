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

Re-run `./install.sh` any time — it's safe and idempotent.

### Prerequisites

- **Node 20+** and npm (https://nodejs.org)
- A free **TMDB API key** (https://www.themoviedb.org/settings/api) — for posters, streaming
  info, and details
- For the in-app chat expert: an **`ANTHROPIC_API_KEY`** (https://console.anthropic.com) *or*
  a logged-in [Claude Code](https://claude.com/claude-code) CLI. The graph and watchlist work
  without it; only the chat needs Claude access.

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

## Connect Claude Desktop

Because the wiki is just a folder, you can also talk to your movie expert from **Claude
Desktop** — it reads and writes the same database the app visualizes.

`install.sh` offers to set this up automatically. To do it manually, add a filesystem MCP
server pointed at your wiki to Claude Desktop's config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

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

## Using it from an iPad

Marquee can't be installed *on* an iPad — the dev server needs Node and the app reads your
wiki from the local filesystem, so it has to run on a Mac or PC. But you can **use** it from an
iPad over your home network:

```bash
npm run dev -- -H 0.0.0.0
```

Then open `http://<your-computer-ip>:3000` in iPad Safari on the same Wi-Fi. The UI is
browser-based and works with touch. (The Claude Desktop wiki connection above is Mac/PC only,
since it runs a local process.)

## Scripts

```bash
npm run dev      # start the dev server
npm run build    # production build
npm run start    # serve the production build
```

## Tech

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Claude Agent SDK · TMDB ·
`react-force-graph-2d`.
