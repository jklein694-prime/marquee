import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { MOVIE_EXPERT_PROMPT, PREDICT_PROMPT } from "./prompt";
import { SUBAGENTS } from "./subagents";
import { VAULT } from "./vault";
import { recFilter } from "./recFilter";
import { search, details, similar, discover } from "./tmdb";

export { norm } from "./recFilter";

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
              predicted: z
                .string()
                .regex(/^\d+(?:-\d+)?$/)
                .describe('Your projected score for the user, e.g. "8" or "8-9" — the watchlist rejects adds without one'),
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

  const tmdb = makeTmdbServer();

  const q = query({
    prompt: promptStream(),
    options: {
      cwd: VAULT, // lock scripts + resume transcripts live in the vault
      model: "claude-sonnet-5-5",
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
          ...SUBAGENTS["movie-researcher"],
          tools: ["WebSearch", "WebFetch", ...tmdbTools],
          model: "claude-sonnet-5-5",
        },
        "pattern-miner": {
          ...SUBAGENTS["pattern-miner"],
          tools: ["Read", "Grep", "Glob"],
          model: "claude-sonnet-5-5",
          effort: "high", // deep cross-dimension analysis is this agent's whole job
        },
        "page-writer": {
          ...SUBAGENTS["page-writer"],
          tools: ["Write"],
          model: "claude-sonnet-5-5",
        },
      },
    },
  });
  return { q, finish };
}

// shared by the chat turn (runTurn) and the predict turn (runPredictTurn); a
// fresh server instance per turn matches the SDK's per-query lifecycle
function makeTmdbServer() {
  return createSdkMcpServer({
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

}

const tmdbTools = [
  "mcp__tmdb__search_movie",
  "mcp__tmdb__movie_details",
  "mcp__tmdb__similar_movies",
  "mcp__tmdb__discover",
];

// Focused one-shot turn behind POST /api/predict (the Screen Test tab). Emits
// consider/verdict events through its MCP tool handlers; the caller streams
// them to the client. Deliberately smaller than runTurn: no resume, no
// settingSources (vault hooks are write-oriented), no subagents, no hooks.
export function runPredictTurn(userText: string, emit: (ev: object) => void) {
  // same held-open input stream as runTurn — SDK MCP servers require streaming
  // input mode or in-process tool calls die with "Stream closed"
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

  const predict = createSdkMcpServer({
    name: "predict",
    tools: [
      tool(
        "consider",
        "Report a taste-graph node you are weighing RIGHT NOW. Call once per node, typically 8-20 times per prediction; batching several calls in one message is fine.",
        {
          node: z.string().describe('The wiki page title exactly as written, e.g. "Neo-noir" or "Heat (1995)"'),
          thought: z.string().describe("One plain clause under 12 words — shown to the user verbatim"),
        },
        async (a) => {
          emit({ type: "consider", node: a.node, thought: a.thought });
          return ok("noted");
        }
      ),
      tool(
        "verdict",
        "Deliver the final projected score. Call EXACTLY ONCE, then end your turn.",
        {
          predicted: z
            .string()
            .regex(/^\d+(?:-\d+)?$/)
            .describe('"8" or a range "8-9" — same format the watchlist requires'),
          why: z.string().describe("2-3 plain sentences citing named categories and comparable rated titles"),
          seen: z.boolean().optional().describe("true when a wiki page shows the user already saw it"),
          actual: z.number().optional().describe("their actual /10 rating when seen"),
        },
        async (a) => {
          emit({ type: "verdict", ...a });
          return ok("Recorded. End your turn now.");
        }
      ),
    ],
  });

  const q = query({
    prompt: promptStream(),
    options: {
      cwd: VAULT,
      model: "claude-sonnet-5-5",
      effort: "medium",
      systemPrompt: PREDICT_PROMPT,
      permissionMode: "bypassPermissions",
      includePartialMessages: true,
      mcpServers: { predict, tmdb: makeTmdbServer() },
      // this whitelist IS the read-only guarantee: no Write/Edit/Bash/Task exists
      // in the turn, so the vault and watchlist cannot be touched
      allowedTools: [
        "Read", "Grep", "Glob",
        "mcp__predict__consider", "mcp__predict__verdict",
        "mcp__tmdb__search_movie", "mcp__tmdb__movie_details",
      ],
    },
  });
  return { q, finish };
}
