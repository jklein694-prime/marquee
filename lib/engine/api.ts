// Claude API chat engine: the movie expert as an in-process tool loop on
// claude-sonnet-5-5. No Claude Code process per turn, tools run in parallel in
// this process, the system prompt + tools are prompt-cached, and subagents are
// parallel API loops instead of child processes.
import { randomUUID } from "crypto";
import type { BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { MOVIE_EXPERT_PROMPT, PREDICT_PROMPT } from "../prompt";
import { SUBAGENTS, type SubagentType } from "../subagents";
import {
  allocateTool,
  editTool,
  globTool,
  grepTool,
  newPageWriteTool,
  readTool,
  tmdbTools,
  uiTools,
  writeTool,
} from "./tools";
import { costUSD, defineTool, emptyUsage, runLoop, type LoopHooks, type ToolDef, type UsageTotals } from "./loop";
import { appendUserText, loadSession, repairTail, saveSession } from "./sessions";
import type { ChatEngine, Emit } from "./types";

// --- prompt adaptation ------------------------------------------------------------
// The movie-expert prompt is shared with the Agent SDK engine; only the bits
// that name Claude Code specifics change. Every swap must still match — a
// prompt edit that breaks one fails loudly here (and in the tests).
function swap(text: string, pairs: [string, string][]): string {
  let out = text;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) throw new Error(`api prompt adaptation drifted: "${from.slice(0, 60)}" not found`);
    out = out.split(from).join(to);
  }
  return out;
}

const VAULT_NOTE =
  "- Vault: all file paths are relative to the vault root (e.g. wiki/entities/Movies.md); the file tools (Read, Glob, Grep, Edit, Write) only see the vault";

export const API_CHAT_PROMPT = swap(MOVIE_EXPERT_PROMPT, [
  ["- Vault: your current working directory (the app runs you with the wiki folder as cwd)", VAULT_NOTE],
  [
    "2. Allocate every address in ONE Bash call:\n   for i in $(seq N); do bash scripts/allocate-address.sh; done",
    "2. Allocate every address in ONE allocate_addresses call (count: N).",
  ],
  [
    "every new movie/category page gets ADDR=$(bash scripts/allocate-address.sh)",
    "every new movie/category page gets an address from the allocate_addresses tool",
  ],
]) +
  `
## Tools in this app

Tool calls you put in one message run in parallel, so batching is the fastest
path. Before a long stretch of tool calls, say in one short line what you are
doing; the user sees it live.
`;

export const API_PREDICT_PROMPT = swap(PREDICT_PROMPT, [["- Vault: your current working directory", VAULT_NOTE]]);

const subagentPrompt = (t: SubagentType) =>
  t === "movie-researcher"
    ? swap(SUBAGENTS[t].prompt, [["use WebSearch only", "use web_search only"]])
    : t === "pattern-miner"
      ? SUBAGENTS[t].prompt + "\n\nAll paths are relative to the vault root."
      : SUBAGENTS[t].prompt;

// --- subagents (the Task tool) ------------------------------------------------------
const RESEARCH_SERVER_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
] as unknown as BetaToolUnion[];

const SUBAGENT_SPECS: Record<
  SubagentType,
  { tools: ToolDef[]; server?: BetaToolUnion[]; effort: "low" | "medium" | "high"; maxTokens: number }
> = {
  "movie-researcher": { tools: tmdbTools, server: RESEARCH_SERVER_TOOLS, effort: "low", maxTokens: 16000 },
  "pattern-miner": { tools: [readTool, grepTool, globTool], effort: "high", maxTokens: 32000 },
  "page-writer": { tools: [newPageWriteTool], effort: "low", maxTokens: 32000 },
};

// at most 2 subagents at a time (the prompt's cost rule, enforced). A freed
// slot is handed straight to the next waiter, so a newcomer can't sneak in;
// a waiter whose turn is stopped leaves the queue at once.
let running = 0;
const waiting: (() => void)[] = [];
export class StoppedError extends Error {}
async function slot<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new StoppedError("stopped");
  if (running >= 2) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const i = waiting.indexOf(wake);
        if (i >= 0) waiting.splice(i, 1);
        reject(new StoppedError("stopped"));
      };
      waiting.push(wake);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  } else running++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); // the slot passes on; running stays the same
    else running--;
  }
}

function taskTool(emit: Emit, signal: AbortSignal, usage: UsageTotals): ToolDef {
  return defineTool({
    name: "Task",
    description:
      "Dispatch a subagent and get its final report back. Types: " +
      (Object.keys(SUBAGENTS) as SubagentType[]).map((k) => `${k} — ${SUBAGENTS[k].description}`).join(" | ") +
      " Two Task calls in one message run in parallel.",
    schema: z.object({
      subagent_type: z.enum(Object.keys(SUBAGENTS) as [SubagentType, ...SubagentType[]]),
      description: z.string().describe("3-5 word label"),
      prompt: z.string().describe("the complete brief — the subagent sees nothing else"),
    }),
    run: (a) =>
      slot(async () => {
        const spec = SUBAGENT_SPECS[a.subagent_type];
        const res = await runLoop({
          system: subagentPrompt(a.subagent_type),
          tools: spec.tools,
          serverTools: spec.server,
          messages: [{ role: "user", content: a.prompt }],
          effort: spec.effort,
          maxTokens: spec.maxTokens,
          signal,
          usage,
          maxSteps: 30,
          hooks: { onToolUse: (b) => traceTool(emit, b.name, b.input, true) },
        });
        if (res.end === "aborted") return "(stopped)";
        return res.finalText || `(subagent ended: ${res.end})`;
      }, signal).catch((err) => {
        if (err instanceof StoppedError) return "(stopped)";
        throw err;
      }),
  });
}

function traceTool(emit: Emit, name: string, input: unknown, sub: boolean) {
  const detail = JSON.stringify(input ?? {});
  emit({
    type: "trace",
    kind: "tool",
    sub,
    label: name,
    detail: detail.length > 220 ? detail.slice(0, 220) + "…" : detail,
  });
}

/** stream hooks shared by chat turns: text, live status, model, trace */
function chatHooks(emit: Emit, onFirstToken: () => void): LoopHooks {
  let note = "";
  let lastStatus = 0;
  let servedModel: string | undefined;
  const status = (label: string, detail?: string) => emit({ type: "status", label, detail });
  return {
    onFirstToken,
    onText: (d) => {
      if (note) {
        note = "";
        status("");
      }
      emit({ type: "text", delta: d });
    },
    onThinking: (d) => {
      // progress updates (display: "updates") arrive as thinking text — show
      // the latest line in the activity strip; plain thinking is just "thinking…"
      note = (note + d).slice(-400);
      if (Date.now() - lastStatus > 1000) {
        lastStatus = Date.now();
        const line = note.trim().split("\n").pop()?.trim();
        status(line ? line.slice(0, 120) : "thinking…");
      }
    },
    onToolStart: (name) => status(`preparing ${name}…`),
    onToolUse: (b) => traceTool(emit, b.name, b.input, false),
    onModel: (m) => {
      if (m !== servedModel) {
        servedModel = m;
        emit({ type: "trace", kind: "model", label: m });
      }
    },
  };
}

// a session this large re-sends a lot every turn; the wiki is the real memory,
// so start fresh instead of carrying an ever-growing transcript
const ROTATE_AT_TOKENS = 200_000;

export const runApiChatTurn: ChatEngine = async ({ message, sessionId, signal }, emit) => {
  const t0 = Date.now();
  let ttft = 0;
  const prior = loadSession(sessionId);
  let sid = prior && sessionId ? sessionId : randomUUID();
  let messages = prior?.messages ?? [];
  if (prior && prior.lastInputTokens > ROTATE_AT_TOKENS) {
    emit({ type: "trace", kind: "init", label: "fresh session", detail: "previous one grew too large" });
    sid = randomUUID();
    messages = [];
  }
  emit({ type: "trace", kind: "init", label: `session ${sid.slice(0, 8)} · api` });
  repairTail(messages);
  appendUserText(messages, message);

  const usage = emptyUsage();
  let lastInputTokens = prior?.lastInputTokens ?? 0;
  const persist = () => saveSession(sid, { messages, lastInputTokens, updatedAt: "" });
  persist();

  const tools: ToolDef[] = [
    readTool,
    globTool,
    grepTool,
    editTool,
    writeTool,
    allocateTool,
    taskTool(emit, signal, usage),
    ...uiTools(emit),
    ...tmdbTools,
  ];

  const res = await runLoop({
    system: API_CHAT_PROMPT,
    tools,
    messages,
    effort: "medium",
    maxTokens: 32000,
    signal,
    usage,
    hooks: {
      ...chatHooks(emit, () => (ttft = Date.now() - t0)),
      onStep: persist,
    },
  });
  lastInputTokens = res.lastInputTokens || lastInputTokens;
  persist();

  emit({ type: "status", label: "" });
  if (res.end === "refusal")
    emit({ type: "text", delta: "\n\n_(Claude declined this one — try rephrasing)_" });
  else if (res.end === "max_tokens") emit({ type: "text", delta: "\n\n_(reply cut off — ask me to continue)_" });
  else if (res.end === "max_steps") emit({ type: "text", delta: "\n\n_(stopped after too many steps)_" });
  emit({
    type: "trace",
    kind: "result",
    label: res.end === "blocked" ? "awaiting selection" : res.end === "end_turn" ? "success" : res.end,
    detail: `${((Date.now() - t0) / 1000).toFixed(1)}s · first token ${(ttft / 1000).toFixed(1)}s · ${usage.calls} calls · ~$${costUSD(usage).toFixed(4)}`,
  });
  return { sessionId: sid };
};

// --- Screen Test predictor -----------------------------------------------------------
export async function runApiPredictTurn(
  userText: string,
  emit: Emit,
  signal: AbortSignal
): Promise<{ finalText: string; ok: boolean }> {
  const tools: ToolDef[] = [
    readTool,
    globTool,
    grepTool,
    defineTool({
      name: "mcp__predict__consider",
      description:
        "Report a taste-graph node you are weighing RIGHT NOW. Call once per node, typically 8-20 times per prediction; batching several calls in one message is fine.",
      schema: z.object({
        node: z.string().describe('The wiki page title exactly as written, e.g. "Neo-noir" or "Heat (1995)"'),
        thought: z.string().describe("One plain clause under 12 words — shown to the user verbatim"),
      }),
      run: (a) => {
        emit({ type: "consider", node: a.node, thought: a.thought });
        return "noted";
      },
    }),
    defineTool({
      name: "mcp__predict__verdict",
      description: "Deliver the final projected score. Call EXACTLY ONCE, then end your turn.",
      schema: z.object({
        predicted: z
          .string()
          .regex(/^\d+(?:-\d+)?$/)
          .describe('"8" or a range "8-9" — same format the watchlist requires'),
        why: z.string().describe("2-3 plain sentences citing named categories and comparable rated titles"),
        seen: z.boolean().optional().describe("true when a wiki page shows the user already saw it"),
        actual: z.number().optional().describe("their actual /10 rating when seen"),
      }),
      run: (a) => {
        emit({ type: "verdict", ...a });
        return "Recorded. End your turn now.";
      },
    }),
    ...tmdbTools.filter((t) => t.name === "mcp__tmdb__search_movie" || t.name === "mcp__tmdb__movie_details"),
  ];
  let lastStatus = 0;
  const res = await runLoop({
    system: API_PREDICT_PROMPT,
    tools,
    messages: [{ role: "user", content: userText }],
    effort: "medium",
    maxTokens: 16000,
    signal,
    maxSteps: 25,
    hooks: {
      onThinking: () => {
        if (Date.now() - lastStatus > 2000) {
          lastStatus = Date.now();
          emit({ type: "status", label: "thinking…" });
        }
      },
      onToolUse: (b) => {
        if (b.name === "Read") {
          const f = (b.input as { file_path?: string })?.file_path;
          if (f?.endsWith(".md")) emit({ type: "node", id: f.split("/").pop()!.replace(/\.md$/, ""), source: "read" });
        } else if (b.name === "Grep" || b.name === "Glob") {
          emit({ type: "status", label: "scanning the wiki…" });
        }
      },
    },
  });
  return { finalText: res.finalText, ok: res.end === "end_turn" };
}
