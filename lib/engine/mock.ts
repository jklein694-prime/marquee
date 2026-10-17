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
