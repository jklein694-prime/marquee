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
  wiki/entities/Movies.md           # the hub: taste profile, watchlist, Seen ledger
  wiki/movies/<Title (Year)>.md     # one page per movie/show you've seen
  wiki/movies/genres/<Category>.md  # genres, styles, eras, directors-as-category
```

Movie pages wikilink to category pages and back; the hub links to both. The app parses those
links into the force-directed taste graph you see on screen. The `movie-expert` skill
(vendored in `.claude/skills/`) writes to the same files as you chat.

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
