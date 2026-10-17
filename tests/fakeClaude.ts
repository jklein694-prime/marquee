// A scripted stand-in for the Anthropic client: each call to
// beta.messages.stream() pops the next scripted reply, records the request
// (messages deep-copied at call time), and streams text/thinking deltas the
// way the real SDK stream does.
import type Anthropic from "@anthropic-ai/sdk";

type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface Reply {
  content: Block[];
  stop_reason?: string;
  model?: string;
  /** throw this instead of answering */
  error?: Error;
  usage?: Partial<{ input_tokens: number; output_tokens: number; cache_read_input_tokens: number }>;
}

export interface Recorded {
  params: Record<string, unknown> & { messages: unknown[] };
}

export function fakeClient(script: Reply[] | ((req: Recorded, n: number) => Reply)) {
  const calls: Recorded[] = [];
  const next = (req: Recorded): Reply => {
    const n = calls.length - 1;
    if (typeof script === "function") return script(req, n);
    const r = script.shift();
    if (!r) throw new Error("fake client: script exhausted");
    return r;
  };
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown> & { messages: unknown[] }) {
          const rec: Recorded = { params: JSON.parse(JSON.stringify(params)) };
          calls.push(rec);
          const reply = next(rec);
          const message = {
            id: `msg_${calls.length}`,
            type: "message",
            role: "assistant",
            model: reply.model ?? "claude-sonnet-5-5",
            content: reply.content,
            stop_reason: reply.stop_reason ?? (reply.content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
            usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...reply.usage },
          };
          async function* events() {
            if (reply.error) throw reply.error;
            yield { type: "message_start", message: { ...message, content: [] } };
            for (const [i, b] of reply.content.entries()) {
              yield { type: "content_block_start", index: i, content_block: b.type === "tool_use" ? { ...b, input: {} } : { ...b, text: "", thinking: "" } };
              if (b.type === "text") yield { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } };
              if (b.type === "thinking") yield { type: "content_block_delta", index: i, delta: { type: "thinking_delta", thinking: b.thinking } };
              yield { type: "content_block_stop", index: i };
            }
            yield { type: "message_stop" };
          }
          const it = events();
          let finished: Promise<unknown> | null = null;
          const drain = async () => {
            for await (const _ of it) void _;
          };
          return {
            [Symbol.asyncIterator]: () => it,
            finalMessage: async () => {
              finished ??= drain();
              await finished;
              if (reply.error) throw reply.error;
              return message;
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

export const text = (t: string): Block => ({ type: "text", text: t });
export const tool = (id: string, name: string, input: unknown): Block => ({ type: "tool_use", id, name, input });
