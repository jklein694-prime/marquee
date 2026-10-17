import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, resetPlainMode, runLoop, setApiClient } from "@/lib/engine/loop";
import type { BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { fakeClient, text, tool } from "./fakeClaude";

afterEach(() => {
  setApiClient(null);
  resetPlainMode();
});

const base = () => ({
  system: "sys",
  effort: "medium" as const,
  maxTokens: 1000,
  signal: new AbortController().signal,
});

describe("runLoop", () => {
  it("runs a message's tool calls in parallel and appends every result", async () => {
    const { client, calls } = fakeClient([
      { content: [text("checking"), tool("t1", "slow", { n: 1 }), tool("t2", "slow", { n: 2 })] },
      { content: [text("done")] },
    ]);
    setApiClient(client);
    let inFlight = 0;
    let peak = 0;
    const slow = defineTool({
      name: "slow",
      description: "",
      schema: z.object({ n: z.number() }),
      run: async ({ n }) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight--;
        return `ok ${n}`;
      },
    });
    const messages: BetaMessageParam[] = [{ role: "user", content: "go" }];
    const res = await runLoop({ ...base(), tools: [slow], messages });
    expect(res.end).toBe("end_turn");
    expect(res.finalText).toBe("done");
    expect(peak).toBe(2);
    // second request carried the assistant turn untouched + both results, in order
    const sent = calls[1].params.messages as BetaMessageParam[];
    expect(sent[1]).toEqual({ role: "assistant", content: expect.any(Array) });
    expect((sent[2].content as { tool_use_id: string; content: string }[]).map((b) => [b.tool_use_id, b.content])).toEqual([
      ["t1", "ok 1"],
      ["t2", "ok 2"],
    ]);
    expect(messages).toHaveLength(4);
  });

  it("sends the cache breakpoint, adaptive thinking, effort and beta extras", async () => {
    const { client, calls } = fakeClient([{ content: [text("hi")] }]);
    setApiClient(client);
    await runLoop({ ...base(), tools: [], messages: [{ role: "user", content: "x" }] });
    const p = calls[0].params as Record<string, unknown>;
    expect(p.model).toBe("claude-sonnet-5-5");
    expect(p.thinking).toEqual({ type: "adaptive", display: "updates" });
    expect(p.output_config).toEqual({ effort: "medium" });
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toContain("server-side-fallback-2026-07-01");
    expect((p.system as { cache_control: unknown }[])[0].cache_control).toEqual({ type: "ephemeral" });
    expect(p.tool_choice).toBeUndefined(); // forced tool choice 400s on Sonnet 5.5
  });

  it("drops the beta extras for good after a 400 about them", async () => {
    const err = new Anthropic.BadRequestError(400, { error: { message: "unsupported beta" } }, "unsupported beta header", new Headers());
    const { client, calls } = fakeClient([{ content: [], error: err }, { content: [text("plain")] }, { content: [text("again")] }]);
    setApiClient(client);
    const res = await runLoop({ ...base(), tools: [], messages: [{ role: "user", content: "x" }] });
    expect(res.finalText).toBe("plain");
    expect(calls[1].params.betas).toBeUndefined();
    expect(calls[1].params.thinking).toEqual({ type: "adaptive" });
    await runLoop({ ...base(), tools: [], messages: [{ role: "user", content: "y" }] });
    expect(calls[2].params.betas).toBeUndefined();
  });

  it("ends the turn after a blocking widget without another model call", async () => {
    const { client, calls } = fakeClient([{ content: [tool("w1", "ask", {})] }]);
    setApiClient(client);
    const ask = defineTool({ name: "ask", description: "", schema: z.object({}), blocking: true, run: () => "shown" });
    const messages: BetaMessageParam[] = [{ role: "user", content: "x" }];
    const res = await runLoop({ ...base(), tools: [ask], messages });
    expect(res.end).toBe("blocked");
    expect(calls).toHaveLength(1);
    expect(messages[messages.length - 1].role).toBe("user"); // tool_result present
  });

  it("answers unknown tools and bad input with errors, and forgives case slips", async () => {
    const { client, calls } = fakeClient([
      { content: [tool("a", "Nope", {}), tool("b", "echo", { s: 5 }), tool("c", "ECHO", { s: "hi" })] },
      { content: [text("ok")] },
    ]);
    setApiClient(client);
    const echo = defineTool({ name: "echo", description: "", schema: z.object({ s: z.string() }), run: ({ s }) => s });
    await runLoop({ ...base(), tools: [echo], messages: [{ role: "user", content: "x" }] });
    const results = (calls[1].params.messages as BetaMessageParam[])[2].content as {
      is_error?: boolean;
      content: string;
    }[];
    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toMatch(/Unknown tool "Nope"/);
    expect(results[1].is_error).toBe(true);
    expect(results[1].content).toMatch(/Invalid input/);
    expect(results[2]).toMatchObject({ content: "hi" });
  });

  it("keeps history valid when a refusal arrives with a tool call in it", async () => {
    const { client } = fakeClient([{ content: [tool("t1", "echo", { s: "x" })], stop_reason: "refusal" }]);
    setApiClient(client);
    let ran = false;
    const echo = defineTool({ name: "echo", description: "", schema: z.object({ s: z.string() }), run: () => ((ran = true), "x") });
    const messages: BetaMessageParam[] = [{ role: "user", content: "x" }];
    const res = await runLoop({ ...base(), tools: [echo], messages });
    expect(res.end).toBe("refusal");
    expect(ran).toBe(false);
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect((last.content as { tool_use_id: string; is_error: boolean }[])[0]).toMatchObject({ tool_use_id: "t1", is_error: true });
  });

  it("resumes pause_turn and passes thinking blocks back unchanged", async () => {
    const thinking = { type: "thinking" as const, thinking: "note", signature: "sig123" };
    const { client, calls } = fakeClient([
      { content: [thinking, text("part")], stop_reason: "pause_turn" },
      { content: [text("rest")] },
    ]);
    setApiClient(client);
    const res = await runLoop({ ...base(), tools: [], messages: [{ role: "user", content: "x" }] });
    expect(res.finalText).toBe("rest");
    expect((calls[1].params.messages as BetaMessageParam[])[1]).toEqual({
      role: "assistant",
      content: [thinking, { type: "text", text: "part" }],
    });
  });

  it("stops cleanly when aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const { client, calls } = fakeClient([{ content: [text("never")] }]);
    setApiClient(client);
    const res = await runLoop({ ...base(), signal: ac.signal, tools: [], messages: [{ role: "user", content: "x" }] });
    expect(res.end).toBe("aborted");
    expect(calls).toHaveLength(0);
  });
});
