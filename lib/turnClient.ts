// Browser side of background turns. startTurn() hands a message to the server
// and gets a turn id back; followTurn() streams that turn's events and keeps
// coming back for the rest — after iOS suspends the app, after the network
// blips, after a reload — resuming from the last event it saw, until "done".

export interface ClientTurnEvent {
  type: string;
  [key: string]: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

function waitVisible(): Promise<void> {
  if (!hidden()) return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (!hidden()) {
        document.removeEventListener("visibilitychange", on);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", on);
  });
}

export async function startTurn(body: { message: string; sessionId?: string; silent?: boolean }): Promise<string> {
  // a lost response would make a retry start a second turn, so retry only
  // when the request never got an answer and it's safe: the server dedupes
  // on clientId
  const clientId = crypto.randomUUID();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch("/api/turns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, clientId }),
      });
      if (!res.ok) throw new Error(`start failed: ${res.status}`);
      return ((await res.json()) as { turnId: string }).turnId;
    } catch (err) {
      lastErr = err;
      await waitVisible();
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export function stopTurn(turnId: string) {
  return fetch(`/api/turns/${turnId}`, { method: "DELETE" }).catch(() => {});
}

function setDetached(turnId: string, detached: boolean) {
  const url = `/api/turns/${turnId}/detach`;
  const body = JSON.stringify({ detached });
  // sendBeacon survives the page being frozen right after visibilitychange
  if (detached && navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
  void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(
    () => {}
  );
}

const STALL_MS = 40_000; // the server heartbeats every 15s

/** Resolves once the turn's "done" event has been delivered. */
export async function followTurn(turnId: string, onEvent: (ev: ClientTurnEvent) => void): Promise<void> {
  let next = 0; // events delivered so far == ?after for the next connection
  let done = false;
  let failures = 0;

  const onVisibility = () => setDetached(turnId, hidden());
  document.addEventListener("visibilitychange", onVisibility);
  try {
    while (!done) {
      await waitVisible(); // no point dialing out from a suspended page
      const ac = new AbortController();
      let lastData = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastData > STALL_MS) ac.abort();
      }, 5000);
      // back from the background: the old socket is often dead without
      // knowing it — reconnect now instead of waiting out the watchdog
      const onBack = () => {
        if (!hidden() && Date.now() - lastData > 3000) ac.abort();
      };
      document.addEventListener("visibilitychange", onBack);
      window.addEventListener("online", onBack);
      try {
        const res = await fetch(`/api/turns/${turnId}?after=${next}`, { signal: ac.signal, cache: "no-store" });
        if (res.status === 404) {
          onEvent({ type: "text", delta: "_(this reply is no longer available)_" });
          onEvent({ type: "done" });
          return;
        }
        if (!res.ok || !res.body) throw new Error(`stream failed: ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done: eof, value } = await reader.read();
          if (eof) break;
          lastData = Date.now();
          failures = 0;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop()!;
          for (const block of blocks) {
            let id = -1;
            let data = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("id: ")) id = Number(line.slice(4));
              else if (line.startsWith("data: ")) data += line.slice(6);
            }
            if (!data) continue; // heartbeat
            if (id >= 0 && id < next) continue; // already have it
            next = id >= 0 ? id + 1 : next + 1;
            const ev = JSON.parse(data) as ClientTurnEvent;
            onEvent(ev);
            if (ev.type === "done") done = true;
          }
        }
      } catch {
        // dropped / suspended / stalled — reconnect below
      } finally {
        clearInterval(watchdog);
        document.removeEventListener("visibilitychange", onBack);
        window.removeEventListener("online", onBack);
      }
      if (!done) await sleep(Math.min(500 * 2 ** failures++, 8000));
    }
  } finally {
    document.removeEventListener("visibilitychange", onVisibility);
  }
}

// --- chat transcript persistence (the chat lane only) ---------------------------------
// iOS may throw away a backgrounded page entirely; this is what lets the app
// rebuild the conversation from the server on the next launch.
const KEY = "marquee.chat.v1";
const MAX_TURNS = 40;

export interface SavedChat {
  sessionId?: string;
  turns: { id: string; text: string }[];
}

export function loadChat(): SavedChat {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as SavedChat;
      if (Array.isArray(v.turns)) return v;
    }
  } catch {}
  return { turns: [] };
}

export function saveChat(c: SavedChat) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...c, turns: c.turns.slice(-MAX_TURNS) }));
  } catch {}
}

export function clearChat() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
