import { beforeAll, describe, expect, it, vi } from "vitest";

const sent: { endpoint: string; payload: { body: string } }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => {
  const api = {
    generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (failWith) throw Object.assign(new Error("gone"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  };
  return { default: api, ...api };
});

const { addSubscription, subscriptions, summarize, vapidKeys } = await import("@/lib/push");
const { startChatTurn, detachTurn, settleAll } = await import("@/lib/turns");

beforeAll(() => {
  process.env.MARQUEE_ENGINE = "mock";
  process.env.MOCK_STEP_MS = "5";
});

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "p", auth: "a" } });
const flush = () => new Promise((r) => setTimeout(r, 30));

describe("push notifications", () => {
  it("keeps one VAPID key pair", () => {
    expect(vapidKeys()).toEqual(vapidKeys());
  });

  it("notifies only for chat turns that finished in the background", async () => {
    addSubscription(sub("https://push.example/a"));
    addSubscription(sub("https://push.example/a")); // deduped
    expect(subscriptions()).toHaveLength(1);

    const attached = startChatTurn({ message: "watched" });
    await settleAll();
    await flush();
    expect(sent).toHaveLength(0);

    const silent = startChatTurn({ message: "<watchlist-log>x</watchlist-log>", silent: true });
    detachTurn(silent.id, true);
    await settleAll();
    await flush();
    expect(sent).toHaveLength(0);

    const away = startChatTurn({ message: "while away" });
    detachTurn(away.id, true);
    await settleAll();
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.body).toMatch(/^Mock reply to: while away/);
    void attached;
  });

  it("forgets devices the push service says are gone", async () => {
    failWith = 410;
    const t = startChatTurn({ message: "again" });
    detachTurn(t.id, true);
    await settleAll();
    await flush();
    expect(subscriptions()).toHaveLength(0);
    failWith = null;
  });

  it("summarizes the reply as plain text", () => {
    const s = summarize({
      events: [
        { type: "text", delta: "You'd **love** [[Thief (1981)]] and [[Neo-noir|noir]]." },
      ],
    });
    expect(s).toBe("You'd love Thief (1981) and Neo-noir.");
    expect(summarize({ events: [{ type: "widget", widget: "recs" }] })).toBe("Your picks are ready.");
  });
});
