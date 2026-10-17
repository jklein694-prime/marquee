// The Claude API agent loop: stream one model response, run every tool call
// it made in parallel in-process, append the results, repeat. Shared by the
// main chat agent, its subagents, and the Screen Test predictor.
//
// History rules (Claude Sonnet 5.5 binds thinking blocks to the conversation):
// `messages` is append-only — assistant content goes back exactly as returned,
// and every tool_use gets a tool_result, even ones we refuse to run, so the
// next request is always valid.
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUnion,
  BetaToolUseBlock,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { ToolError } from "./vaultFs";

export const MODEL = "claude-sonnet-5-5";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodObject;
  run: (input: never) => Promise<string> | string;
  /** a widget that waits for the user: the turn ends after this batch */
  blocking?: boolean;
}

/** typed constructor: infers the handler's input from the schema */
export function defineTool<S extends z.ZodObject>(t: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<string> | string;
  blocking?: boolean;
}): ToolDef {
  return t as unknown as ToolDef;
}

function toApiTool(t: ToolDef): BetaToolUnion {
  const schema = z.toJSONSchema(t.schema) as Record<string, unknown>;
  delete schema.$schema;
  return {
    name: t.name,
    description: t.description,
    input_schema: schema as { type: "object" },
  } as BetaToolUnion;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
}

// $ per million tokens — Claude Sonnet 5.5 (server-side fallbacks bill at
// their own rates, so treat the figure as an estimate)
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
export function costUSD(u: UsageTotals): number {
  return (
    (u.input * PRICE.input + u.output * PRICE.output + u.cacheRead * PRICE.cacheRead + u.cacheWrite * PRICE.cacheWrite) /
    1e6
  );
}
export const emptyUsage = (): UsageTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 });
function addUsage(t: UsageTotals, u: BetaUsage | undefined) {
  if (!u) return;
  t.input += u.input_tokens ?? 0;
  t.output += u.output_tokens ?? 0;
  t.cacheRead += u.cache_read_input_tokens ?? 0;
  t.cacheWrite += u.cache_creation_input_tokens ?? 0;
  t.calls += 1;
}

export interface LoopHooks {
  onText?: (delta: string) => void;
  /** progress-update / thinking text as it streams (may be empty) */
  onThinking?: (delta: string) => void;
  onToolStart?: (name: string) => void;
  onToolUse?: (block: BetaToolUseBlock) => void;
  onModel?: (model: string) => void;
  onFirstToken?: () => void;
  /** after every appended message — persist here */
  onStep?: () => void;
}

export interface LoopOpts {
  system: string;
  tools: ToolDef[];
  serverTools?: BetaToolUnion[];
  messages: BetaMessageParam[];
  effort: Effort;
  maxTokens: number;
  signal: AbortSignal;
  hooks?: LoopHooks;
  maxSteps?: number;
  model?: string;
  usage?: UsageTotals;
}

export type LoopEnd = "end_turn" | "blocked" | "refusal" | "aborted" | "max_steps" | "max_tokens";

export interface LoopResult {
  end: LoopEnd;
  finalText: string;
  usage: UsageTotals;
  lastInputTokens: number;
}

// --- client ----------------------------------------------------------------------
let client: Anthropic | null = null;
export function apiClient(): Anthropic {
  return (client ??= new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 }));
}
/** test hook: swap the client for a fake */
export function setApiClient(c: Anthropic | null) {
  client = c;
}

// Beta extras: server-side refusal fallback and progress-update thinking. If
// the API ever rejects them (400), drop to a plain request for the rest of the
// process instead of failing every turn.
const BETAS = ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"];
let plainMode = false;
// a 400 that rejects the extras themselves — not any 400 that mentions thinking
const BETA_REJECTED = /server-side-fallback|thinking-display-updates|anthropic-beta|\bfallbacks?\b|thinking\.display|display.*updates/i;
export function resetPlainMode() {
  plainMode = false;
}

function requestParams(o: LoopOpts, apiTools: BetaToolUnion[]) {
  const base = {
    model: o.model ?? MODEL,
    max_tokens: o.maxTokens,
    // the system prompt (and the tools before it) never change within a
    // session: one cache breakpoint there, plus automatic caching of the tail
    system: [{ type: "text" as const, text: o.system, cache_control: { type: "ephemeral" as const } }],
    cache_control: { type: "ephemeral" as const },
    tools: apiTools,
    messages: o.messages,
    output_config: { effort: o.effort },
  };
  return plainMode
    ? { ...base, thinking: { type: "adaptive" as const } }
    : {
        ...base,
        thinking: { type: "adaptive" as const, display: "updates" as const },
        betas: BETAS,
        fallbacks: "default" as const,
      };
}

const textOf = (content: BetaContentBlock[]) =>
  content.map((b) => (b.type === "text" ? b.text : "")).join("");

/** error results for tool_use blocks that will not run, so history stays valid */
function unrunResults(blocks: BetaToolUseBlock[], why: string): BetaToolResultBlockParam[] {
  return blocks.map((b) => ({ type: "tool_result", tool_use_id: b.id, is_error: true, content: why }));
}

async function runTool(t: ToolDef | undefined, block: BetaToolUseBlock, names: string[]): Promise<BetaToolResultBlockParam> {
  if (!t) {
    // tolerate a case-only slip ("read" for "Read") per the model's known habit
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: `Unknown tool "${block.name}". Available tools: ${names.join(", ")}`,
    };
  }
  const parsed = t.schema.safeParse(block.input ?? {});
  if (!parsed.success) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: `Invalid input for ${t.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`,
    };
  }
  try {
    const out = await t.run(parsed.data as never);
    return { type: "tool_result", tool_use_id: block.id, content: out || "(empty)" };
  } catch (err) {
    const msg = err instanceof ToolError ? err.message : `${t.name} failed: ${err instanceof Error ? err.message : String(err)}`;
    return { type: "tool_result", tool_use_id: block.id, is_error: true, content: msg };
  }
}

export async function runLoop(o: LoopOpts): Promise<LoopResult> {
  const api = apiClient();
  const byName = new Map(o.tools.map((t) => [t.name, t]));
  const lower = new Map(o.tools.map((t) => [t.name.toLowerCase(), t]));
  const names = o.tools.map((t) => t.name);
  const apiTools = [...o.tools.map(toApiTool), ...(o.serverTools ?? [])];
  const usage = o.usage ?? emptyUsage();
  const hooks = o.hooks ?? {};
  let lastInputTokens = 0;
  let finalText = "";
  let firstToken = false;
  const maxSteps = o.maxSteps ?? 40;

  for (let step = 0; step < maxSteps; step++) {
    if (o.signal.aborted) return { end: "aborted", finalText, usage, lastInputTokens };
    let message: BetaMessage;
    try {
      message = await streamOnce(api, o, apiTools, hooks, () => {
        if (!firstToken) {
          firstToken = true;
          hooks.onFirstToken?.();
        }
      });
    } catch (err) {
      if (o.signal.aborted || err instanceof Anthropic.APIUserAbortError)
        return { end: "aborted", finalText, usage, lastInputTokens };
      if (!plainMode && err instanceof Anthropic.BadRequestError && BETA_REJECTED.test(err.message)) {
        plainMode = true; // retry this step without the beta extras
        step--;
        continue;
      }
      throw err;
    }
    addUsage(usage, message.usage);
    lastInputTokens =
      (message.usage?.input_tokens ?? 0) +
      (message.usage?.cache_read_input_tokens ?? 0) +
      (message.usage?.cache_creation_input_tokens ?? 0);
    if (message.model) hooks.onModel?.(message.model);

    o.messages.push({ role: "assistant", content: message.content as BetaContentBlockParam[] });
    const toolUses = message.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    for (const b of toolUses) hooks.onToolUse?.(b);
    const text = textOf(message.content);
    if (text) finalText = text;

    const stop = message.stop_reason;
    if (stop === "pause_turn") {
      hooks.onStep?.();
      continue; // a server tool paused; resend to let it continue
    }
    if (stop === "refusal" || stop === "max_tokens" || o.signal.aborted) {
      if (toolUses.length) o.messages.push({ role: "user", content: unrunResults(toolUses, `not run (${stop ?? "stopped"})`) });
      hooks.onStep?.();
      return { end: o.signal.aborted ? "aborted" : (stop as LoopEnd), finalText, usage, lastInputTokens };
    }
    if (!toolUses.length) {
      hooks.onStep?.();
      return { end: "end_turn", finalText, usage, lastInputTokens };
    }

    // every call in this message runs concurrently — the model batches
    // independent reads/writes into one message for exactly this
    const results = await Promise.all(
      toolUses.map((b) => runTool(byName.get(b.name) ?? lower.get(b.name.toLowerCase()), b, names))
    );
    o.messages.push({ role: "user", content: results });
    hooks.onStep?.();
    const blocked = toolUses.some((b) => (byName.get(b.name) ?? lower.get(b.name.toLowerCase()))?.blocking);
    if (blocked) return { end: "blocked", finalText, usage, lastInputTokens };
  }
  return { end: "max_steps", finalText, usage, lastInputTokens };
}

async function streamOnce(
  api: Anthropic,
  o: LoopOpts,
  apiTools: BetaToolUnion[],
  hooks: LoopHooks,
  onAnyToken: () => void
): Promise<BetaMessage> {
  const stream = api.beta.messages.stream(requestParams(o, apiTools) as never, { signal: o.signal });
  for await (const ev of stream) {
    if (ev.type === "message_start") {
      if (ev.message.model) hooks.onModel?.(ev.message.model);
    } else if (ev.type === "content_block_start") {
      if (ev.content_block.type === "tool_use") {
        onAnyToken();
        hooks.onToolStart?.(ev.content_block.name);
      }
    } else if (ev.type === "content_block_delta") {
      if (ev.delta.type === "text_delta") {
        onAnyToken();
        hooks.onText?.(ev.delta.text);
      } else if (ev.delta.type === "thinking_delta") {
        onAnyToken();
        hooks.onThinking?.(ev.delta.thinking);
      }
    }
  }
  return (await stream.finalMessage()) as BetaMessage;
}
