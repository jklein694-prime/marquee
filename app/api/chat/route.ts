import { runTurn } from "@/lib/agent";
import { autofixVault, consumeLintReport, lintVault, writeLintReport } from "@/lib/lint";
import { activeSnoozes } from "@/lib/watchlist";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  const { message: rawMessage, sessionId } = await req.json();
  // pending lint issues from the last turn ride along for the agent to fix
  let lint = "";
  try {
    lint = consumeLintReport();
  } catch {}
  // active snoozes ride along too — the agent can't read data/snoozed.json,
  // so without this the chat pipeline recommends titles the user just shelved
  let snoozed: string[] = [];
  try {
    snoozed = activeSnoozes();
  } catch {}
  const message =
    rawMessage +
    (lint ? `\n\n<wiki-lint>\n${lint}\n</wiki-lint>` : "") +
    (snoozed.length ? `\n\n<snoozed>${snoozed.join("; ")}</snoozed>` : "");
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // client hit Stop / disconnected — emits become no-ops and the live
      // query (set below, once runTurn has created it) gets interrupted
      let currentQ: { interrupt: () => Promise<void> } | undefined;
      req.signal.addEventListener("abort", () => currentQ?.interrupt().catch(() => {}));
      const emit = (ev: object) => {
        if (req.signal.aborted) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {}
      };
      let sid: string | undefined = sessionId;

      // live status line for the booth: long thinking stretches and big tool
      // inputs generate zero text/trace events, so without this the app looks
      // hung for minutes. Thinking updates are throttled; "" clears the line.
      let thinkChars = 0;
      let lastThinkEmit = 0;
      const status = (label: string, detail?: string) =>
        emit({ type: "status", label, detail });

      // Runs one query attempt. Returns true if the turn produced real output
      // (text, a widget, or model work) — false for a dead 0-turn resume.
      const attempt = async (resumeId: string | undefined): Promise<boolean> => {
        let intentionalStop = false;
        let produced = false;
        let pendingTasks = 0;
        const taskIds = new Set<string>();

        const { q, finish } = runTurn(message, resumeId, emit, () => {
          // A blocking widget IS the end of the turn — but never interrupt while
          // a subagent is in flight: killing it mid-run corrupts the transcript
          // and strands the next resume. With a researcher running, the turn is
          // allowed to finish naturally (client dedupes any repeat widgets).
          if (pendingTasks > 0) return;
          intentionalStop = true;
          setTimeout(() => q.interrupt().catch(() => {}), 800);
        });
        currentQ = q;

        try {
          for await (const m of q) {
            if (m.type === "system" && m.subtype === "init") {
              sid = m.session_id;
              emit({ type: "trace", kind: "init", label: `session ${m.session_id.slice(0, 8)} · ${m.model}` });
            }
            if (m.type === "stream_event" && !m.parent_tool_use_id) {
              // main thread only — mute subagent deltas
              const e = m.event;
              if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
                produced = true;
                if (thinkChars) { thinkChars = 0; status(""); }
                emit({ type: "text", delta: e.delta.text });
              } else if (e.type === "content_block_delta" && e.delta.type === "thinking_delta") {
                thinkChars += e.delta.thinking?.length ?? 0;
                if (Date.now() - lastThinkEmit > 2000) {
                  lastThinkEmit = Date.now();
                  status("thinking…", `~${Math.round(thinkChars / 4 / 100) / 10}k tokens`);
                }
              } else if (e.type === "content_block_start" && e.content_block.type === "tool_use") {
                // fires when tool-call generation STARTS — a big Edit can take
                // tens of seconds to generate before its trace line appears
                if (thinkChars) thinkChars = 0;
                status(`preparing ${e.content_block.name}…`);
              }
            }
            // trace: every tool call, main agent and subagents alike
            if (m.type === "assistant") {
              if (!m.parent_tool_use_id) { thinkChars = 0; status(""); }
              for (const block of m.message.content) {
                if (block.type === "tool_use") {
                  produced = true;
                  if (block.name === "Task" && !m.parent_tool_use_id) {
                    pendingTasks++;
                    taskIds.add(block.id);
                  }
                  const input = JSON.stringify(block.input ?? {});
                  emit({
                    type: "trace",
                    kind: "tool",
                    sub: !!m.parent_tool_use_id,
                    label: block.name,
                    detail: input.length > 220 ? input.slice(0, 220) + "…" : input,
                  });
                }
              }
            }
            if (m.type === "user" && Array.isArray(m.message.content)) {
              for (const block of m.message.content) {
                if (block.type === "tool_result") {
                  if (taskIds.has(block.tool_use_id)) {
                    taskIds.delete(block.tool_use_id);
                    pendingTasks--;
                  }
                  if (block.is_error) {
                    emit({
                      type: "trace",
                      kind: "error",
                      sub: !!m.parent_tool_use_id,
                      label: "tool error",
                      detail: String(JSON.stringify(block.content)).slice(0, 220),
                    });
                  }
                }
              }
            }
            if (m.type === "result") {
              status("");
              emit({
                type: "trace",
                kind: "result",
                label: intentionalStop && m.subtype !== "success" ? "awaiting selection" : m.subtype,
                detail: `${(m.duration_ms / 1000).toFixed(1)}s · ${m.num_turns} turns · $${m.total_cost_usd?.toFixed(4) ?? "?"}`,
              });
              if (m.num_turns > 0) produced = true;
              if (m.subtype !== "success" && !intentionalStop) {
                emit({ type: "text", delta: `\n\n_(agent error: ${m.subtype})_` });
              }
              break; // streaming input mode: the query idles after a result
            }
          }
        } finally {
          finish(); // release the held-open input stream
        }
        return produced;
      };

      try {
        const ok = await attempt(sessionId);
        if (!ok) {
          // dead resume (0 turns, no output) — usually a corrupted prior turn.
          // Retry once on a fresh session; the wiki carries the real memory.
          emit({ type: "trace", kind: "error", label: "dead resume", detail: "retrying on a fresh session" });
          await attempt(undefined);
        }
      } catch (err) {
        emit({ type: "text", delta: `\n\n_(error: ${err instanceof Error ? err.message : String(err)})_` });
      } finally {
        // intermittent wiki lint: mechanical fixes now, judgment calls queued
        // for the agent's next turn — never let lint break the stream
        try {
          autofixVault();
          writeLintReport(lintVault());
        } catch {}
        emit({ type: "done", sessionId: sid });
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
