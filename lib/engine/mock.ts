// Scripted engine for end-to-end tests (MARQUEE_ENGINE=mock): no network, no
// model. Streams a reply slowly so tests can background/reload mid-turn.
// "widget" in the message ends the turn on an options widget, like the real
// agent; MOCK_STEP_MS sets the pace.
import type { ChatEngine } from "./types";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

export const runMockChatTurn: ChatEngine = async ({ message, sessionId, signal }, emit) => {
  const step = Number(process.env.MOCK_STEP_MS ?? 150);
  emit({ type: "trace", kind: "model", label: "mock-model" });
  // "tour" in the message replays a scripted wiki/TMDB tool sequence so the
  // graph's live show (heat, ghosts, spotlight) can be exercised end to end
  if (/tour/i.test(message)) {
    const tool = (label: string, input: unknown) =>
      emit({ type: "trace", kind: "tool", sub: false, label, detail: JSON.stringify(input) });
    const steps: [string, unknown][] = [
      ["Read", { file_path: "wiki/entities/Movies.md" }],
      ["Read", { file_path: "wiki/movies/genres/Thriller.md" }],
      ["mcp__tmdb__search_movie", { query: "Heat", year: 1995 }],
      ["Read", { file_path: "wiki/movies/people/Michael Mann.md" }],
      ["mcp__tmdb__search_movie", { query: "Collateral", year: 2004 }],
      ["Write", { file_path: "wiki/movies/Heat (1995).md", content: "genres: [[Thriller]] [[Neo-noir]] [[Michael Mann]] [[Los Angeles]]" }],
      ["Read", { file_path: "wiki/movies/genres/Neo-noir.md" }],
      ["Edit", { file_path: "wiki/movies/people/Michael Mann.md", new_string: "[[Heat (1995)]] [[Collateral (2004)]]" }],
    ];
    for (const [label, input] of steps) {
      if (signal.aborted) break;
      tool(label, input);
      await sleep(step * 6, signal);
    }
  }
  const words = `Mock reply to: ${message.split("\n")[0].slice(0, 60)}. One two three four five six seven eight.`.split(" ");
  for (const w of words) {
    if (signal.aborted) break;
    emit({ type: "text", delta: w + " " });
    await sleep(step, signal);
  }
  if (!signal.aborted && /widget/i.test(message))
    emit({
      type: "widget",
      widget: "options",
      data: { title: "Pick one", mode: "single", options: [{ id: "a", label: "Option A" }] },
    });
  emit({ type: "trace", kind: "result", label: "success", detail: `${words.length} words` });
  return { sessionId: sessionId ?? "mock-session" };
};
