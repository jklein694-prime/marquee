// Conversation history for the Claude API engine, one JSON file per session
// under data/sessions/. Append-only: messages are only ever pushed, never
// edited, so earlier thinking blocks stay valid on the next request.
import fs from "fs";
import path from "path";
import type { BetaMessageParam, BetaToolUseBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";

const DIR = path.join(process.cwd(), "data/sessions");
const ID = /^[0-9a-f-]{36}$/;

export interface SessionFile {
  messages: BetaMessageParam[];
  lastInputTokens: number;
  updatedAt: string;
}

export function loadSession(id: string | undefined): SessionFile | null {
  if (!id || !ID.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function saveSession(id: string, s: SessionFile) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }));
  fs.renameSync(tmp, file);
}

/**
 * A turn that died mid-tool (server restart) leaves an assistant tool_use with
 * no result; answer those so the next request is valid — appending, never
 * removing.
 */
export function repairTail(messages: BetaMessageParam[]) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || typeof last.content === "string") return;
  const uses = last.content.filter((b) => b.type === "tool_use") as BetaToolUseBlock[];
  if (!uses.length) return;
  messages.push({
    role: "user",
    content: uses.map((b) => ({
      type: "tool_result" as const,
      tool_use_id: b.id,
      is_error: true,
      content: "interrupted before this tool ran",
    })),
  });
}

/**
 * Adds the user's text. After a blocking widget the last message is the
 * user-role tool_result batch: the text joins it, after the results, so the
 * selection reads as the user's reply rather than a separate turn.
 */
export function appendUserText(messages: BetaMessageParam[], text: string) {
  const last = messages[messages.length - 1];
  if (last && last.role === "user") {
    const content = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content;
    last.content = [...content, { type: "text", text }];
    return;
  }
  messages.push({ role: "user", content: [{ type: "text", text }] });
}
