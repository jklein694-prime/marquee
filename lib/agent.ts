import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import path from "path";
import { MOVIE_EXPERT_PROMPT, MOVIE_PAGE_TEMPLATE } from "./prompt";
import { VAULT, MOVIES_DIR, mdFiles } from "./vault";
import { activeSnoozes, notInterested } from "./watchlist";
import { search, details, similar, discover } from "./tmdb";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
});

// loose title equality: page names swap ":" for " -" and snoozes are lowercased,
// so compare on lowercased alphanumerics only ("Spider-Man - No Way Home (2021)"
// == "spider-man: no way home (2021)")
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// hard gate for recommendation cards: a wiki/movies/ page existing means SEEN
// (pages exist only for seen titles — ground truth, unlike the trimmed hub
// table), active snoozes mean "not now", and the hub's "## Not interested"
// section is a permanent veto. Enforced here so a forgetful model can never
// surface any of them in the UI.
function recFilter(movies: { title: string; year: number }[]) {
  const blocked = new Set<string>();
  for (const f of mdFiles(MOVIES_DIR)) blocked.add(norm(path.basename(f, ".md")));
  for (const s of activeSnoozes()) blocked.add(norm(s));
  for (const t of notInterested()) blocked.add(norm(t));
  const dropped: string[] = [];
  const kept = movies.filter((m) => {
    const hit = blocked.has(norm(`${m.title} (${m.year})`)) || blocked.has(norm(m.title));
    if (hit) dropped.push(`${m.title} (${m.year})`);
    return !hit;
  });
  return { kept, dropped };
}

export function runTurn(
  userText: string,
  sessionId: string | undefined,
  emit: (ev: object) => void,
  onBlockingWidget?: () => void
) {
  // SDK MCP servers require streaming input mode: with a plain string prompt the
  // input channel closes early and in-process tool calls fail with "Stream closed"
  // on long turns. Hold the stream open until the caller signals the turn is done.
  let finish!: () => void;
  const turnDone = new Promise<void>((resolve) => (finish = resolve));
  async function* promptStream() {
    yield {
      type: "user" as const,
      message: { role: "user" as const, content: userText },
      parent_tool_use_id: null,
    };
    await turnDone;
  }
  const ui = createSdkMcpServer({
    name: "ui",
    tools: [
      tool(
        "present_options",
        "Show the user selectable choices inline in chat (chips/checkboxes). After calling this, END YOUR TURN — the selection arrives as the next user message.",
        {
          title: z.string(),
          mode: z.enum(["single", "multi"]),
          options: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              sublabel: z.string().optional(),
            })
          ),
          context: z.string().optional().describe("One line shown under the title"),
        },
        async (args) => {
          emit({ type: "widget", widget: "options", data: args });
          onBlockingWidget?.();
          return ok("Displayed. End your turn now; the selection arrives as the next user message.");
        }
      ),
      tool(
        "movie_checklist",
        "Ask the user which of these movies they have seen, with a checkbox per movie and an optional 1-10 rating for each seen one. Use when probing viewing history (candidates, classics of a genre, a director's filmography). After calling this, END YOUR TURN — the results arrive as the next user message.",
        {
          title: z.string(),
          movies: z.array(z.object({ title: z.string(), year: z.number().optional() })),
        },
        async (args) => {
          emit({ type: "widget", widget: "checklist", data: args });
          onBlockingWidget?.();
          return ok("Displayed. End your turn now; the results arrive as the next user message.");
        }
      ),
      tool(
        "show_recommendations",
        "Render rich movie recommendation cards inline in chat. Include poster_path from TMDB when available.",
        {
          movies: z.array(
            z.object({
              title: z.string(),
              year: z.number(),
              why: z.string().describe("One line: why it fits their answers and taste graph"),
              genres: z.array(z.string()).optional(),
              streaming: z.string().optional(),
              poster_path: z.string().optional().describe("TMDB poster_path, e.g. /abc.jpg"),
            })
          ),
        },
        async (args) => {
          const { kept, dropped } = recFilter(args.movies);
          if (kept.length) emit({ type: "widget", widget: "recs", data: { ...args, movies: kept } });
          return ok(
            dropped.length
              ? `${kept.length ? "Cards displayed." : "NO cards displayed."} Dropped (seen, snoozed, or Not interested — never re-suggest these): ${dropped.join(", ")}. ${kept.length < 2 ? "Find replacements so the user still gets 2-3 picks." : ""}`
              : "Cards displayed."
          );
        }
      ),
    ],
  });

  const tmdb = createSdkMcpServer({
    name: "tmdb",
    tools: [
      tool(
        "search_movie",
        "Search TMDB for a movie or TV show by title (and optional year). Set media:'tv' for shows. Returns id, title, year, media, overview, vote_average, poster_path.",
        { query: z.string(), year: z.number().optional(), media: z.enum(["movie", "tv"]).optional() },
        async (a) => ok(await search(a.query, a.year, a.media))
      ),
      tool(
        "movie_details",
        "Full TMDB details for a movie or TV id: runtime, seasons (tv), genres, director/creator, US streaming providers, poster_path. Set media:'tv' for shows.",
        { id: z.number(), media: z.enum(["movie", "tv"]).optional() },
        async (a) => ok(await details(a.id, a.media))
      ),
      tool(
        "similar_movies",
        "TMDB recommendations similar to a movie or TV id. Set media:'tv' for shows.",
        { id: z.number(), media: z.enum(["movie", "tv"]).optional() },
        async (a) => ok(await similar(a.id, a.media))
      ),
      tool(
        "discover",
        "Discover well-rated movies or TV shows by TMDB genre ids (comma-separated) and/or date range (YYYY-MM-DD). Set media:'tv' for shows.",
        {
          media: z.enum(["movie", "tv"]).optional(),
          with_genres: z.string().optional(),
          date_gte: z.string().optional(),
          date_lte: z.string().optional(),
          sort_by: z.string().optional(),
        },
        async (a) => ok(await discover(a))
      ),
    ],
  });

  const tmdbTools = [
    "mcp__tmdb__search_movie",
    "mcp__tmdb__movie_details",
    "mcp__tmdb__similar_movies",
    "mcp__tmdb__discover",
  ];

  const q = query({
    prompt: promptStream(),
    options: {
      cwd: VAULT, // lock scripts + resume transcripts live in the vault
      model: "claude-sonnet-4-6",
      // default effort is "high" — minutes-long thinking after big wiki reads.
      // Medium keeps conversational interpretation sharp; deep analysis lives
      // in the pattern-miner, which runs at high effort below.
      effort: "medium",
      resume: sessionId,
      systemPrompt: MOVIE_EXPERT_PROMPT,
      permissionMode: "bypassPermissions", // unattended vault writes
      settingSources: ["project"], // vault hooks work; user-level skills not double-loaded
      includePartialMessages: true,
      // The SDK's Agent tool now defaults to run_in_background: true — it returns
      // an agentId immediately and notifies later. This app runs each turn as a
      // one-shot request that ends on the result message, which kills the
      // background subagent before it produces anything (the model then narrates
      // "results in a moment" and ends with no cards). We need subagents
      // SYNCHRONOUS: dispatch → block → results in the same turn → present.
      // Force it deterministically here so it never depends on the model
      // remembering to pass the flag. Covers researcher, pattern-miner, page-writer.
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (input) => {
                const i = input as { tool_name?: string; tool_input?: Record<string, unknown> };
                if (i.tool_name === "Agent") {
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      updatedInput: { ...(i.tool_input ?? {}), run_in_background: false },
                    },
                  };
                }
                return { continue: true };
              },
            ],
          },
        ],
      },
      mcpServers: { ui, tmdb },
      allowedTools: [
        "Read", "Grep", "Glob", "Bash", "Edit", "Write", "Task",
        "mcp__ui__present_options", "mcp__ui__show_recommendations", "mcp__ui__movie_checklist",
        ...tmdbTools,
      ],
      agents: {
        "movie-researcher": {
          description:
            "Background research: finds candidate movies and TV shows matching criteria + taste digest, with year/genres/runtime/premise/consensus/streaming/poster_path. Returns a compact list. Never writes files.",
          prompt:
            "You research movies and TV shows and return a compact candidate list. Unless the criteria specify one medium, include both movies and shows (use media:'tv' on mcp__tmdb__* tools for shows). Prefer mcp__tmdb__* tools for structured data (year, genres, runtime, seasons, top cast, US streaming providers, poster_path); use WebSearch only for critical consensus or leaving-streaming news. Weight candidates toward the taste digest you were given - UNLESS the dispatch says it is an exploration round, in which case ignore taste-similarity and honor only the stated criteria and dealbreakers. You have no file tools. Return data only — your final message is consumed by another agent, not a human.",
          tools: ["WebSearch", "WebFetch", ...tmdbTools],
          model: "claude-haiku-4-5",
        },
        "pattern-miner": {
          description:
            "Reads the whole movie/TV wiki graph (hub + title + category pages) and returns cross-dimension taste trends, rating deltas, gaps, category-merge suggestions, and 2-3 refined taste-profile bullets. Never writes.",
          prompt:
            "Read wiki/entities/Movies.md, wiki/movies/taste/Taste Profile.md (the deep profile), and everything under wiki/movies/ (title pages link to category pages, one subdirectory per dimension: genres/ people/ themes/ style/ platforms/ eras/ settings/, each with its own _index.md). Hunt CROSS-DIMENSION trends, not single-category counts: era x genre x place combos, person x tone conditions, rating deltas between adjacent categories. Also return: gaps adjacent to loved categories, near-duplicate category pages to merge, one-off categories that never developed, and 2-3 taste-profile bullets that REFINE existing ones (sharper, conditional) rather than just append. Write every finding in PLAIN language using only standard film/TV terms — never coin analytical labels (no 'mechanism', 'register', or other invented shorthand); describe the pattern in ordinary words instead. Entries noted as exploration picks are a separate signal - flag a loved one as a possible new branch. Do not write files. Return data only.",
          tools: ["Read", "Grep", "Glob"],
          model: "claude-haiku-4-5",
          effort: "high", // deep cross-dimension analysis is this agent's whole job
        },
        "page-writer": {
          description:
            "Bulk-creates brand-new movie/TV wiki pages from complete facts and pre-allocated addresses supplied in the dispatch. Writes only the exact paths listed. Never edits existing pages.",
          prompt:
            "You write new wiki pages for movies and TV shows. The dispatch lists pages to create; each entry gives the exact file path, a pre-allocated address (c-NNNNNN), and complete facts: title, year, director (seasons for tv), verdict, rating, watched date, created/updated dates, the user's take, and the full category wikilink list. Render each page with EXACTLY this frontmatter structure:\n\n" +
            MOVIE_PAGE_TEMPLATE +
            "\n\n(tv pages use entity_type: tv and add seasons: N; tags become [entity, tv]. genres: holds ALL category links given.) Body: the user's take, then the category wikilinks in context. Fill in ONLY the facts you were given — never invent facts, never allocate or change addresses, and never write any path you were not given (no category/dimension dirs, _index.md files, taste/, hub, log.md, or manifest). No emojis. Your final message is one line per file: \"<path> written\".",
          tools: ["Write"],
          model: "claude-haiku-4-5",
        },
      },
    },
  });
  return { q, finish };
}
