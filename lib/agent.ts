import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { MOVIE_EXPERT_PROMPT } from "./prompt";
import { VAULT } from "./vault";
import { search, details, similar, discover } from "./tmdb";

const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
});

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
          emit({ type: "widget", widget: "recs", data: args });
          return ok("Cards displayed.");
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
      resume: sessionId,
      systemPrompt: MOVIE_EXPERT_PROMPT,
      permissionMode: "bypassPermissions", // unattended vault writes
      settingSources: ["project"], // vault hooks work; user-level skills not double-loaded
      includePartialMessages: true,
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
            "Read wiki/entities/Movies.md and everything under wiki/movies/ (title pages link to category pages across dimensions: genre, style, people, studio, release era, setting, theme). Hunt CROSS-DIMENSION trends, not single-category counts: era x genre x place combos, person x tone conditions, rating deltas between adjacent categories. Also return: gaps adjacent to loved categories, near-duplicate category pages to merge, one-off categories that never developed, and 2-3 taste-profile bullets that REFINE existing ones (sharper, conditional) rather than just append. Entries noted as exploration picks are a separate signal - flag a loved one as a possible new branch. Do not write files. Return data only.",
          tools: ["Read", "Grep", "Glob"],
          model: "claude-haiku-4-5",
        },
      },
    },
  });
  return { q, finish };
}
