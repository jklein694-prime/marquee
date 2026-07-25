import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { norm, runPredictTurn } from "@/lib/agent";
import { MOVIES_DIR, mdFiles } from "@/lib/vault";
import { readUserList } from "@/lib/watchlist";
import { details } from "@/lib/tmdb";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Screen Test: run a focused read-only agent turn that predicts Louie's score
// for one TMDB title, streaming its reasoning as SSE events the 3D graph
// animates: status | node (wiki page read) | consider (weighed node + thought)
// | verdict (final score) | error | done.
export async function POST(req: Request) {
  const { id, media, title, year } = (await req.json()) as {
    id: number;
    media: "movie" | "tv";
    title: string;
    year?: string;
  };
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let currentQ: { interrupt: () => Promise<void> } | undefined;
      req.signal.addEventListener("abort", () => currentQ?.interrupt().catch(() => {}));
      let sawVerdict = false;
      const emit = (ev: object) => {
        if ((ev as { type?: string }).type === "verdict") sawVerdict = true;
        if (req.signal.aborted) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {}
      };
      const close = () => {
        emit({ type: "done" });
        try {
          controller.close();
        } catch {}
      };

      const wanted = new Set([norm(title), ...(year ? [norm(`${title} (${year})`)] : [])]);

      // a wiki/movies/ page means SEEN — return the actual rating, no show.
      // A page without a rating falls through to the agent (prompt handles it).
      const seenFile = mdFiles(MOVIES_DIR).find((f) => wanted.has(norm(path.basename(f, ".md"))));
      if (seenFile) {
        const { data } = matter(fs.readFileSync(seenFile, "utf8"));
        if (typeof data.rating === "number") {
          emit({
            type: "verdict",
            seen: true,
            actual: data.rating,
            predicted: String(data.rating),
            why: `You've seen this — you called it ${data.verdict ?? "watched"} and rated it ${data.rating}/10.`,
          });
          close();
          return;
        }
      }

      // onList only relabels the final card — the show still runs for watchlist titles
      let onList = false;
      try {
        onList = readUserList().some((i) => wanted.has(norm(i.title)));
      } catch {}
      emit({ type: "start", onList });

      try {
        // TMDB facts up front give the agent immediate hooks into category names
        const info = await details(id, media).catch(() => null);
        const facts = info
          ? ` Director/creator: ${info.director ?? "unknown"}. Genres: ${(info.genres ?? []).join(", ")}. Overview: ${info.overview}`
          : "";
        const message = `Predict the user's score for: ${title}${year ? ` (${year})` : ""} [${media}, TMDB id ${id}].${facts}`;

        let lastThinkEmit = 0;
        const { q, finish } = runPredictTurn(message, emit);
        currentQ = q;
        try {
          for await (const m of q) {
            if (m.type === "stream_event" && !m.parent_tool_use_id) {
              const e = m.event;
              if (
                e.type === "content_block_delta" &&
                e.delta.type === "thinking_delta" &&
                Date.now() - lastThinkEmit > 2000
              ) {
                lastThinkEmit = Date.now();
                emit({ type: "status", label: "thinking…" });
              }
            }
            if (m.type === "assistant") {
              for (const block of m.message.content) {
                if (block.type !== "tool_use") continue;
                // mcp__predict__* and mcp__tmdb__* emit from their own handlers —
                // re-emitting them here would double every consider event
                if (block.name === "Read") {
                  const f = (block.input as { file_path?: string })?.file_path;
                  if (f?.endsWith(".md"))
                    emit({ type: "node", id: path.basename(f, ".md"), source: "read" });
                } else if (block.name === "Grep" || block.name === "Glob") {
                  emit({ type: "status", label: "scanning the wiki…" });
                }
              }
            }
            if (m.type === "result") {
              if (!sawVerdict) {
                // model ended without calling verdict — salvage a score from its
                // final text ("\b" can't split a digit run, so years never match)
                const text = m.subtype === "success" ? String(m.result ?? "") : "";
                const score = text.match(/\b(10|[1-9])(?:-(10|[1-9]))?\b/);
                if (score) {
                  emit({
                    type: "verdict",
                    predicted: score[2] ? `${score[1]}-${score[2]}` : score[1],
                    why: text.slice(0, 400),
                  });
                } else {
                  emit({
                    type: "error",
                    message: m.subtype === "success" ? "no verdict produced" : m.subtype,
                  });
                }
              }
              break; // streaming input mode: the query idles after a result
            }
          }
        } finally {
          finish(); // release the held-open input stream
        }
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        close();
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
