// Background turn manager. A chat turn is a server-side job: it runs to the
// end whether or not anyone is connected, and every event it emits is kept
// (in memory while live, in data/turns/<id>.jsonl for good) so a client can
// reconnect from the last event it saw. This is what lets the phone app go to
// the background — iOS suspends it and drops the connection — without killing
// the turn. Only an explicit Stop (stopTurn) aborts one.
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { autofixVault, consumeLintReport, lintVault, writeLintReport } from "./lint";
import { activeSnoozes } from "./watchlist";
import { chatEngine } from "./engine";
import type { TurnEvent } from "./engine/types";
import { TURNS_DIR as DIR } from "./paths";
const KEEP_LIVE_MS = 30 * 60 * 1000; // done turns stay in memory this long
const KEEP_DISK_MS = 7 * 24 * 60 * 60 * 1000;

type Listener = (ev: TurnEvent, seq: number) => void;

export interface Turn {
  id: string;
  events: TurnEvent[];
  done: boolean;
  startedAt: number;
  listeners: Set<Listener>;
  abort: AbortController;
  /** set when the client said it went to the background — push on finish */
  detached: boolean;
  silent: boolean;
}

type FinishHook = (turn: Turn) => void;

interface Registry {
  live: Map<string, Turn>;
  chains: Map<string, Promise<unknown>>; // per-session serialization
  finishHooks: FinishHook[];
  pruned: boolean;
}

// globalThis so dev-mode module reloads don't orphan running turns
const g = globalThis as unknown as { __marqueeTurns?: Registry };
const reg: Registry = (g.__marqueeTurns ??= {
  live: new Map(),
  chains: new Map(),
  finishHooks: [],
  pruned: false,
});

export function onTurnFinished(hook: FinishHook) {
  reg.finishHooks.push(hook);
}

function pruneDisk() {
  if (reg.pruned) return;
  reg.pruned = true;
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(DIR)) {
      const p = path.join(DIR, f);
      if (now - fs.statSync(p).mtimeMs > KEEP_DISK_MS) fs.rmSync(p, { force: true });
    }
  } catch {}
}

const ID = /^[0-9a-f-]{36}$/;
const fileFor = (id: string) => path.join(DIR, `${id}.jsonl`);

/** Context the chat engines always see: pending lint fixes and active snoozes. */
function decorate(message: string): string {
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
  return (
    message +
    (lint ? `\n\n<wiki-lint>\n${lint}\n</wiki-lint>` : "") +
    (snoozed.length ? `\n\n<snoozed>${snoozed.join("; ")}</snoozed>` : "")
  );
}

export function startChatTurn(opts: { message: string; sessionId?: string; silent?: boolean }): Turn {
  pruneDisk();
  fs.mkdirSync(DIR, { recursive: true });
  const turn: Turn = {
    id: randomUUID(),
    events: [],
    done: false,
    startedAt: Date.now(),
    listeners: new Set(),
    abort: new AbortController(),
    detached: false,
    silent: !!opts.silent,
  };
  reg.live.set(turn.id, turn);
  const out = fs.createWriteStream(fileFor(turn.id), { flags: "a" });
  out.on("error", () => {}); // a full disk must not take the turn down

  const emit = (ev: TurnEvent) => {
    if (turn.done) return;
    const seq = turn.events.length;
    turn.events.push(ev);
    out.write(JSON.stringify(ev) + "\n");
    for (const l of turn.listeners) {
      try {
        l(ev, seq);
      } catch {}
    }
  };

  // one turn at a time per conversation: a resend while a turn is running
  // waits for it instead of forking the session
  const key = opts.sessionId ? `s:${opts.sessionId}` : `t:${turn.id}`;
  const prev = reg.chains.get(key) ?? Promise.resolve();
  const run = prev
    .catch(() => {})
    .then(async () => {
      let sessionId = opts.sessionId;
      try {
        // stopped while still queued behind another turn: never reaches the model
        if (turn.abort.signal.aborted) throw new Error("stopped");
        const res = await chatEngine()(
          { message: decorate(opts.message), sessionId, signal: turn.abort.signal },
          emit
        );
        sessionId = res.sessionId ?? sessionId;
      } catch (err) {
        if (!turn.abort.signal.aborted)
          emit({ type: "text", delta: `\n\n_(error: ${err instanceof Error ? err.message : String(err)})_` });
      }
      if (turn.abort.signal.aborted) emit({ type: "text", delta: "\n\n_(stopped)_" });
      emit({ type: "done", sessionId });
      turn.done = true;
      out.end();
      for (const hook of reg.finishHooks) {
        try {
          hook(turn);
        } catch {}
      }
      // intermittent wiki lint: mechanical fixes now, judgment calls queued
      // for the agent's next turn — off the critical path, after "done"
      setImmediate(() => {
        try {
          autofixVault();
          writeLintReport(lintVault());
        } catch {}
      });
      setTimeout(() => reg.live.delete(turn.id), KEEP_LIVE_MS).unref?.();
    });
  reg.chains.set(key, run);
  void run.finally(() => {
    if (reg.chains.get(key) === run) reg.chains.delete(key);
  });
  return turn;
}

/** Events of a turn from seq `after` on, plus whether more can still come. */
export function readTurn(id: string): { events: TurnEvent[]; live?: Turn } | null {
  if (!ID.test(id)) return null;
  const live = reg.live.get(id);
  if (live) return { events: live.events, live: live.done ? undefined : live };
  let raw: string;
  try {
    raw = fs.readFileSync(fileFor(id), "utf8");
  } catch {
    return null;
  }
  const events: TurnEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {}
  }
  // a turn on disk with no "done" died with the server — close it out so a
  // reconnecting client never waits forever
  if (events[events.length - 1]?.type !== "done") {
    events.push({ type: "text", delta: "\n\n_(interrupted — the server restarted mid-turn)_" });
    events.push({ type: "done" });
  }
  return { events };
}

export function stopTurn(id: string): boolean {
  const t = reg.live.get(id);
  if (!t || t.done) return false;
  t.abort.abort();
  return true;
}

export function detachTurn(id: string, detached: boolean): boolean {
  const t = reg.live.get(id);
  if (!t) return false;
  t.detached = detached;
  return true;
}

/** test hook: wait for every running turn to finish */
export async function settleAll() {
  await Promise.allSettled([...reg.chains.values()]);
}
