import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { readTurn, settleAll, startChatTurn, stopTurn, onTurnFinished, detachTurn } from "@/lib/turns";
import { GET } from "@/app/api/turns/[id]/route";

beforeAll(() => {
  process.env.MARQUEE_ENGINE = "mock";
  process.env.MOCK_STEP_MS = "20";
});

const text = (events: { type: string; delta?: unknown }[]) =>
  events.filter((e) => e.type === "text").map((e) => e.delta).join("");

async function sse(id: string, after = 0, abortAfterMs?: number) {
  const ac = new AbortController();
  if (abortAfterMs) setTimeout(() => ac.abort(), abortAfterMs);
  const res = await GET(new Request(`http://x/api/turns/${id}?after=${after}`, { signal: ac.signal }), {
    params: Promise.resolve({ id }),
  });
  const body = await new Response(res.body).text().catch(() => "");
  return body
    .split("\n\n")
    .filter((b) => b.includes("data: "))
    .map((b) => ({
      id: Number(/id: (\d+)/.exec(b)![1]),
      ev: JSON.parse(b.slice(b.indexOf("data: ") + 6)),
    }));
}

describe("background turns", () => {
  it("runs to completion with nobody listening and keeps every event", async () => {
    const turn = startChatTurn({ message: "hello there" });
    await settleAll();
    const got = readTurn(turn.id)!;
    expect(got.live).toBeUndefined();
    expect(got.events[got.events.length - 1]).toMatchObject({ type: "done", sessionId: "mock-session" });
    expect(text(got.events)).toContain("Mock reply to: hello there");
    // persisted for a reconnect after a server restart (the file stream
    // flushes asynchronously after "done")
    await new Promise((r) => setTimeout(r, 50));
    const lines = fs.readFileSync(path.join(process.cwd(), "data/turns", `${turn.id}.jsonl`), "utf8").trim().split("\n");
    expect(lines.length).toBe(got.events.length);
  });

  it("a client that drops mid-turn resumes exactly where it left off", async () => {
    process.env.MOCK_STEP_MS = "40";
    const turn = startChatTurn({ message: "resume me" });
    const first = await sse(turn.id, 0, 150); // phone goes to the background
    expect(first.length).toBeGreaterThan(0);
    expect(first[first.length - 1].ev.type).not.toBe("done");
    expect(turn.done).toBe(false); // the turn kept going without a listener
    const rest = await sse(turn.id, first.length);
    expect(rest[0].id).toBe(first.length);
    const all = [...first, ...rest].map((x) => x.ev);
    expect(all[all.length - 1].type).toBe("done");
    expect(text(all)).toBe(text(readTurn(turn.id)!.events));
    process.env.MOCK_STEP_MS = "20";
  });

  it("only an explicit stop ends a turn early", async () => {
    process.env.MOCK_STEP_MS = "50";
    const turn = startChatTurn({ message: "stop me" });
    await new Promise((r) => setTimeout(r, 80));
    expect(stopTurn(turn.id)).toBe(true);
    await settleAll();
    const events = readTurn(turn.id)!.events;
    expect(text(events)).toContain("_(stopped)_");
    expect(text(events)).not.toContain("eight");
    process.env.MOCK_STEP_MS = "20";
  });

  it("serializes turns on the same session", async () => {
    const a = startChatTurn({ message: "first", sessionId: "11111111-1111-1111-1111-111111111111" });
    const b = startChatTurn({ message: "second", sessionId: "11111111-1111-1111-1111-111111111111" });
    await settleAll();
    expect(a.done && b.done).toBe(true);
    // b's first event came after a finished
    expect(b.startedAt).toBeGreaterThanOrEqual(a.startedAt);
    const order: string[] = [];
    const c = startChatTurn({ message: "c", sessionId: "22222222-2222-2222-2222-222222222222" });
    c.listeners.add((ev) => ev.type === "done" && order.push("c"));
    const d = startChatTurn({ message: "d", sessionId: "22222222-2222-2222-2222-222222222222" });
    d.listeners.add((ev) => ev.type === "text" && order.length === 1 && order.push("d-text"));
    await settleAll();
    expect(order).toEqual(["c", "d-text"]);
  });

  it("closes out a turn the server died in the middle of", () => {
    const id = "33333333-3333-3333-3333-333333333333";
    fs.mkdirSync(path.join(process.cwd(), "data/turns"), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), "data/turns", `${id}.jsonl`), JSON.stringify({ type: "text", delta: "half" }) + "\n");
    const got = readTurn(id)!;
    expect(got.events.map((e) => e.type)).toEqual(["text", "text", "done"]);
    expect(String(got.events[1].delta)).toContain("server restarted");
  });

  it("rejects bad ids and reports detach/finish to hooks", async () => {
    expect(readTurn("../../etc/passwd")).toBeNull();
    const finished: boolean[] = [];
    onTurnFinished((t) => finished.push(t.detached));
    const t = startChatTurn({ message: "bye" });
    detachTurn(t.id, true);
    await settleAll();
    expect(finished).toContain(true);
  });
});
