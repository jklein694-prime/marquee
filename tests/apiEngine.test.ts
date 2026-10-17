import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { API_CHAT_PROMPT, API_PREDICT_PROMPT, runApiChatTurn, runApiPredictTurn } from "@/lib/engine/api";
import { setApiClient } from "@/lib/engine/loop";
import { loadSession } from "@/lib/engine/sessions";
import type { TurnEvent } from "@/lib/engine/types";
import { fakeClient, text, tool } from "./fakeClaude";

afterEach(() => setApiClient(null));

const collect = () => {
  const events: TurnEvent[] = [];
  return { events, emit: (ev: TurnEvent) => events.push(ev) };
};
const signal = () => new AbortController().signal;
const lastUser = (msgs: unknown[]) => (msgs as BetaMessageParam[]).filter((m) => m.role === "user").pop()!;

describe("API prompt adaptation", () => {
  it("swaps the Claude Code specifics and keeps the rest of the skill", () => {
    expect(API_CHAT_PROMPT).toContain("allocate_addresses");
    expect(API_CHAT_PROMPT).not.toContain("bash scripts/allocate-address.sh");
    expect(API_CHAT_PROMPT).not.toContain("current working directory");
    expect(API_CHAT_PROMPT).toContain("mcp__ui__present_options");
    expect(API_CHAT_PROMPT).toContain("## Flow 2 — Logging");
    expect(API_PREDICT_PROMPT).toContain("relative to the vault root");
  });
});

describe("runApiChatTurn", () => {
  it("reads, shows a widget, ends the turn, and resumes with the selection", async () => {
    const { client, calls } = fakeClient([
      { content: [text("Let me look."), tool("r1", "Read", { file_path: "wiki/entities/Movies.md" }), tool("r2", "Read", { file_path: "wiki/movies/_index.md" })] },
      {
        content: [
          tool("w1", "mcp__ui__present_options", {
            title: "Mood?",
            mode: "single",
            options: [{ id: "a", label: "Tense" }],
          }),
        ],
      },
      { content: [text("Tense it is.")] },
    ]);
    setApiClient(client);
    const t1 = collect();
    const r1 = await runApiChatTurn({ message: "find me something", signal: signal() }, t1.emit);
    expect(r1.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toHaveLength(2); // stopped at the widget
    expect(t1.events.filter((e) => e.type === "widget")).toHaveLength(1);
    expect(t1.events.filter((e) => e.type === "trace" && e.kind === "tool").map((e) => e.label)).toEqual([
      "Read",
      "Read",
      "mcp__ui__present_options",
    ]);
    expect(t1.events.some((e) => e.type === "trace" && e.kind === "model" && e.label === "claude-sonnet-5-5")).toBe(true);
    const result = t1.events.find((e) => e.type === "trace" && e.kind === "result");
    expect(result?.label).toBe("awaiting selection");
    // the two reads went out together and both came back with the hub text
    const reads = lastUser(calls[1].params.messages).content as { content: string }[];
    expect(reads[0].content).toContain("## Watchlist");

    const t2 = collect();
    await runApiChatTurn({ message: "Tense", sessionId: r1.sessionId, signal: signal() }, t2.emit);
    // the selection joined the widget's tool_result message — after it — so
    // the history stays append-only and alternates correctly
    const sent = calls[2].params.messages as BetaMessageParam[];
    const tail = sent[sent.length - 1].content as { type: string; text?: string }[];
    expect(tail.map((b) => b.type)).toEqual(["tool_result", "text"]);
    expect(tail[1].text).toBe("Tense");
    expect(t2.events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Tense it is.");
    const saved = loadSession(r1.sessionId)!;
    expect(saved.messages[saved.messages.length - 1].role).toBe("assistant");
  });

  it("dispatches subagents in parallel through the Task tool", async () => {
    const { client, calls } = fakeClient((req) => {
      const sys = (req.params.system as { text: string }[])[0].text;
      if (sys.startsWith("You research")) return { content: [text("CANDIDATES: Heat (1995)")] };
      if (sys.startsWith("Read wiki/entities")) return { content: [text("PATTERNS: likes crime")] };
      const msgs = req.params.messages as BetaMessageParam[];
      if (msgs.length === 1)
        return {
          content: [
            tool("k1", "Task", { subagent_type: "movie-researcher", description: "find picks", prompt: "neo-noir" }),
            tool("k2", "Task", { subagent_type: "pattern-miner", description: "mine", prompt: "go" }),
          ],
        };
      return { content: [text("Here you go.")] };
    });
    setApiClient(client);
    const t = collect();
    await runApiChatTurn({ message: "recommend", signal: signal() }, t.emit);
    const researcher = calls.find((c) => (c.params.system as { text: string }[])[0].text.startsWith("You research"))!;
    const toolTypes = (researcher.params.tools as { type?: string; name: string }[]).map((x) => x.type ?? x.name);
    expect(toolTypes).toContain("web_search_20260209");
    expect(toolTypes).toContain("mcp__tmdb__search_movie");
    expect(toolTypes).not.toContain("Write"); // the researcher has no file tools
    const miner = calls.find((c) => (c.params.system as { text: string }[])[0].text.startsWith("Read wiki/entities"))!;
    expect(miner.params.output_config).toEqual({ effort: "high" });
    const final = calls[calls.length - 1].params.messages as BetaMessageParam[];
    const results = final[final.length - 1].content as { content: string }[];
    expect(results.map((r) => r.content)).toEqual(["CANDIDATES: Heat (1995)", "PATTERNS: likes crime"]);
  });

  it("hard-drops seen titles from recommendation cards", async () => {
    fs.writeFileSync(path.join(process.env.VAULT_PATH!, "wiki/movies/Heat (1995).md"), "---\ntitle: Heat (1995)\n---\n");
    const { client, calls } = fakeClient([
      {
        content: [
          tool("c1", "mcp__ui__show_recommendations", {
            movies: [
              { title: "Heat", year: 1995, why: "x", predicted: "9" },
              { title: "Thief", year: 1981, why: "y", predicted: "8" },
            ],
          }),
        ],
      },
      { content: [text("ok")] },
    ]);
    setApiClient(client);
    const t = collect();
    await runApiChatTurn({ message: "recs", signal: signal() }, t.emit);
    const card = t.events.find((e) => e.type === "widget") as unknown as { data: { movies: { title: string }[] } };
    expect(card.data.movies.map((m) => m.title)).toEqual(["Thief"]);
    const result = (lastUser(calls[1].params.messages).content as { content: string }[])[0].content;
    expect(result).toMatch(/Dropped .*Heat \(1995\)/);
  });

  it("starts a fresh session when the old one grew too large", async () => {
    const { client } = fakeClient([
      { content: [text("one")], usage: { input_tokens: 250_000 } },
      { content: [text("two")] },
    ]);
    setApiClient(client);
    const a = await runApiChatTurn({ message: "a", signal: signal() }, () => {});
    const t = collect();
    const b = await runApiChatTurn({ message: "b", sessionId: a.sessionId, signal: signal() }, t.emit);
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(t.events.some((e) => e.type === "trace" && e.label === "fresh session")).toBe(true);
  });

  it("reports a refusal instead of going silent", async () => {
    const { client } = fakeClient([{ content: [], stop_reason: "refusal" }]);
    setApiClient(client);
    const t = collect();
    await runApiChatTurn({ message: "x", signal: signal() }, t.emit);
    expect(t.events.some((e) => e.type === "text" && String(e.delta).includes("declined"))).toBe(true);
  });
});

describe("runApiPredictTurn", () => {
  it("narrates nodes and returns a verdict through tools, read-only", async () => {
    const { client, calls } = fakeClient([
      {
        content: [
          tool("p1", "Read", { file_path: "wiki/entities/Movies.md" }),
          tool("p2", "mcp__predict__consider", { node: "Neo-noir", thought: "loves it" }),
        ],
      },
      { content: [tool("p3", "mcp__predict__verdict", { predicted: "8", why: "because" })] },
      { content: [text("")] },
    ]);
    setApiClient(client);
    const t = collect();
    await runApiPredictTurn("Predict: Thief", t.emit, signal());
    expect(t.events.map((e) => e.type)).toEqual(["node", "consider", "verdict"]);
    const names = (calls[0].params.tools as { name: string }[]).map((x) => x.name);
    expect(names).not.toContain("Write");
    expect(names).not.toContain("Edit");
  });
});
