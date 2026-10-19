"use client";

import { MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { Markdown, ThrottledMarkdown } from "./Markdown";
import { OptionPicker, MovieCards, MovieChecklist, OptionsData, RecsData, ChecklistData } from "./Widgets";
import { clearChat, followTurn, loadChat, saveChat, startTurn, stopTurn, type ClientTurnEvent } from "@/lib/turnClient";
import { Button } from "./ui";
import { ArrowUpIcon } from "./icons";

type Msg =
  | { role: "user" | "assistant"; text: string }
  | { role: "widget"; widget: "options"; data: OptionsData; answered: boolean }
  | { role: "widget"; widget: "checklist"; data: ChecklistData; answered: boolean }
  | { role: "widget"; widget: "recs"; data: RecsData };

// onDone fires after the message's turn actually completes (queued or not).
// silent: the turn runs on a SEPARATE background session — nothing in the
// transcript, no busy state, fully concurrent with the chat (booth traces
// still show it). tag picks which prompt carve-out handles it — see
// lib/prompt.ts's "Silent app-triggered turns".
export type ChatSend = (
  text: string,
  onDone?: () => void,
  opts?: { silent?: boolean; tag?: string }
) => "sent" | "queued" | false;

export interface TraceEntry {
  kind: "init" | "tool" | "error" | "result" | "model";
  sub?: boolean;
  label: string;
  detail?: string;
  at: string;
}

// friendly one-liner for the live activity strip, derived from trace events
function activityLabel(t: { kind: string; sub?: boolean; label: string }): string | null {
  if (t.kind === "init") return "warming up…";
  if (t.kind !== "tool") return null;
  const n = t.label;
  if (n === "Task") return "research agent is out hunting…";
  if (n.startsWith("mcp__tmdb")) return t.sub ? "researcher is pulling TMDB data…" : "pulling TMDB data…";
  if (n === "WebSearch" || n === "WebFetch") return "scanning the web…";
  if (n === "Edit" || n === "Write" || n === "Bash") return "updating your taste wiki…";
  if (n === "Read" || n === "Grep" || n === "Glob") return "reading your taste wiki…";
  if (n.startsWith("mcp__ui")) return "preparing options…";
  return "working…";
}

// rotated in the busy bar while the expert thinks (desktop only — a phone
// has no room for it)
const TIPS = [
  "log what you watched from the Watchlist tab — even mid-chat, it queues up",
  "hit Not now on a suggestion to shelve it for a couple of weeks",
  "tell Louie which streaming services you have — picks will respect them",
  "widgets have a note box — rate movies AND steer (“go older”) in one reply",
  "say “something different” to break out of your usual taste gravity",
  "ask “analyze my taste” every few logs to sharpen your profile",
  "the Taste Graph tab shows why picks connect to what you loved",
  "the Projection Booth tab shows every move the expert makes, live",
];

// inline SVG hero with a cursor-proximity glimmer: triangles near the pointer
// brighten a touch above their own shade, fading back to normal ~2 triangles out
function LouieHero() {
  const [svg, setSvg] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/louie.svg")
      .then((r) => r.text())
      .then(setSvg)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const host = ref.current;
    const svgEl = host?.querySelector("svg");
    if (!host || !svgEl) return;

    const polys = [...svgEl.querySelectorAll("polygon")].map((p) => {
      const nums = (p.getAttribute("points") ?? "").split(/[ ,]/).map(Number);
      let cx = 0,
        cy = 0;
      for (let i = 0; i < 6; i += 2) {
        cx += nums[i];
        cy += nums[i + 1];
      }
      const base = Number((p.getAttribute("fill") ?? "").match(/\d+/)?.[0] ?? 0);
      return { el: p, cx: cx / 3, cy: cy / 3, base };
    });

    const RADIUS = 95; // viewBox px — roughly two triangles before full falloff
    let lit = new Set<number>();
    let raf = 0;
    let mouse: { x: number; y: number } | null = null;

    const paint = () => {
      raf = 0;
      const next = new Set<number>();
      if (mouse) {
        for (let i = 0; i < polys.length; i++) {
          const t = polys[i];
          const d = Math.hypot(t.cx - mouse.x, t.cy - mouse.y);
          if (d < RADIUS) {
            const boost = 1 - d / RADIUS; // linear falloff to original color
            const s = Math.min(255, Math.round(t.base + (30 + 0.18 * t.base) * boost));
            t.el.setAttribute("fill", `rgb(${s},${s},${s})`);
            next.add(i);
          }
        }
      }
      for (const i of lit) {
        if (!next.has(i)) {
          const t = polys[i];
          t.el.setAttribute("fill", `rgb(${t.base},${t.base},${t.base})`);
        }
      }
      lit = next;
    };

    const onMove = (e: MouseEvent) => {
      const r = svgEl.getBoundingClientRect();
      mouse = {
        x: ((e.clientX - r.left) / r.width) * 840,
        y: ((e.clientY - r.top) / r.height) * 840,
      };
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      mouse = null;
      if (!raf) raf = requestAnimationFrame(paint);
    };

    host.addEventListener("mousemove", onMove);
    host.addEventListener("mouseleave", onLeave);
    return () => {
      host.removeEventListener("mousemove", onMove);
      host.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [svg]);

  return (
    // capped by viewport height so the welcome card and input stay on the
    // first screen of a phone
    <div
      ref={ref}
      className="mx-auto mb-3 w-[min(16rem,28dvh)] [&>svg]:h-auto [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function ChatPane({
  onTurnEnd,
  onTrace,
  onOpenHelp,
  onWatchGraph,
  onInputFocusChange,
  onConversationChange,
  sendRef,
  newChatRef,
}: {
  onTurnEnd: () => void;
  onTrace: (t: TraceEntry) => void;
  onOpenHelp?: () => void;
  onWatchGraph?: () => void;
  onInputFocusChange?: (focused: boolean) => void;
  /** true while there is a transcript to clear: the header shows New chat */
  onConversationChange?: (hasMessages: boolean) => void;
  sendRef?: MutableRefObject<ChatSend>;
  /** the header's New chat button calls this */
  newChatRef?: MutableRefObject<() => void>;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("thinking…");
  const [tipIdx, setTipIdx] = useState(0);
  const sessionRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  // busy mirrored in a ref (state is stale inside sendRef closures) + a FIFO of
  // messages that arrived mid-turn — nothing sent while busy is ever dropped
  const busyRef = useRef(false);
  const queueRef = useRef<{ text: string; onDone?: () => void }[]>([]);
  // the chat lane's running turn, for the Stop button
  const currentTurnRef = useRef<string | null>(null);
  // background lane: silent turns (watchlist logging, veto edits) run on their
  // OWN session with their own queue, fully concurrent with the chat lane —
  // logging never locks the chat and the chat never delays a log. Cross-lane
  // vault-write races are fenced server-side: the Edit tool rejects stale
  // writes (file modified since read), the prompt mandates re-read-and-retry,
  // and the lint loop repairs any missed cross-reference.
  const logSessionRef = useRef<string | undefined>(undefined);
  const logBusyRef = useRef(false);
  const logQueueRef = useRef<{ text: string; onDone?: () => void; tag?: string }[]>([]);
  // streamed text is appended once per animation frame, not once per token:
  // a long reply arrives as hundreds of deltas and each setMessages used to
  // re-render (and re-parse) the whole transcript
  const deltaBufRef = useRef("");
  const deltaRafRef = useRef(0);
  const flushDeltas = useCallback(() => {
    if (deltaRafRef.current) cancelAnimationFrame(deltaRafRef.current);
    deltaRafRef.current = 0;
    const delta = deltaBufRef.current;
    if (!delta) return;
    deltaBufRef.current = "";
    setMessages((m) => {
      const next = [...m];
      // append to the last assistant bubble, or open a new one after a widget
      const last = next[next.length - 1];
      if (last?.role === "assistant") next[next.length - 1] = { role: "assistant", text: last.text + delta };
      else next.push({ role: "assistant", text: delta });
      return next;
    });
  }, []);
  const queueDelta = useCallback(
    (delta: string) => {
      deltaBufRef.current += delta;
      if (!deltaRafRef.current) deltaRafRef.current = requestAnimationFrame(flushDeltas);
    },
    [flushDeltas]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages]);

  // rebuild the conversation after a reload — iOS often discards a
  // backgrounded home-screen app — by replaying each saved turn from the
  // server; a turn that is still running is picked up live
  const restoredRef = useRef(false);
  // true while saved turns are replayed: new sends queue until it's over
  const restoringRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const saved = loadChat();
    if (!saved.turns.length) return;
    sessionRef.current = saved.sessionId;
    restoringRef.current = true;
    void (async () => {
      try {
        for (let i = 0; i < saved.turns.length; i++) {
          const t = saved.turns[i];
          await run(t.text, undefined, false, undefined, { turnId: t.id, replay: i < saved.turns.length - 1 });
        }
      } finally {
        restoringRef.current = false;
        // anything typed during the restore goes out now, in order
        const next = queueRef.current.shift();
        if (next) void run(next.text, next.onDone);
        else {
          busyRef.current = false;
          setBusy(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newChat() {
    clearChat();
    sessionRef.current = undefined;
    setMessages([]);
  }

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(id);
  }, [busy]);

  // existing: attach to a turn that is already running/finished (restoring the
  // transcript after a reload) instead of starting one. replay: an earlier,
  // finished turn — rebuild its messages without re-animating the booth.
  async function run(
    text: string,
    onDone?: () => void,
    silent?: boolean,
    tag = "watchlist-log",
    existing?: { turnId: string; replay?: boolean }
  ) {
    const replay = !!existing?.replay;
    if (silent) {
      logBusyRef.current = true;
    } else {
      busyRef.current = true;
      setBusy(true);
      setActivity("thinking…");
      setMessages((m) => [
        // any pending option widgets are now answered (silent turns don't
        // answer them — they stay clickable)
        ...m.map((msg) =>
          msg.role === "widget" && (msg.widget === "options" || msg.widget === "checklist")
            ? { ...msg, answered: true }
            : msg
        ),
        { role: "user", text },
        { role: "assistant", text: "" },
      ]);
    }

    try {
      const turnId =
        existing?.turnId ??
        (await startTurn({
          // tagged here (single place) so the prompt's silent-turn carve-outs
          // and the flag can't drift apart
          message: silent ? `<${tag}>\n${text}\n</${tag}>` : text,
          sessionId: silent ? logSessionRef.current : sessionRef.current,
          silent,
        }));
      if (!silent) {
        currentTurnRef.current = turnId;
        if (!existing) {
          const saved = loadChat();
          saveChat({ ...saved, turns: [...saved.turns, { id: turnId, text }] });
        }
      }
      // the turn runs on the server whether or not we're connected;
      // followTurn reconnects (after the app was backgrounded, a network
      // blip, a reload) and resumes from the last event it saw
      await followTurn(turnId, (ev: ClientTurnEvent) => {
        if (ev.type === "text" && silent) {
          // silent turns render nothing in the transcript
        } else if (ev.type === "widget" && silent) {
          // prompt forbids widgets in silent turns; if one slips through,
          // dropping it is safest — the next message resumes the session
        } else if (ev.type === "status") {
          // live generation status (thinking…, preparing Edit…) — fills the
          // long silent stretches between trace lines. Chat lane only: the
          // busy strip belongs to the chat; background logs stay invisible.
          if (!silent) setActivity(ev.label ? `${ev.label}${ev.detail ? ` ${ev.detail}` : ""}` : "working…");
        } else if (ev.type === "text") {
          queueDelta(String(ev.delta ?? ""));
        } else if (ev.type === "widget") {
          flushDeltas(); // keep text before the widget it precedes
          setMessages((m) => {
            // drop duplicate widget re-calls within the same turn
            const dup = m.some(
              (msg) =>
                msg.role === "widget" && msg.widget === ev.widget && JSON.stringify(msg.data) === JSON.stringify(ev.data)
            );
            if (dup) return m;
            const w: Msg =
              ev.widget === "options"
                ? { role: "widget", widget: "options", data: ev.data as OptionsData, answered: false }
                : ev.widget === "checklist"
                  ? { role: "widget", widget: "checklist", data: ev.data as ChecklistData, answered: false }
                  : { role: "widget", widget: "recs", data: ev.data as RecsData };
            return [...m, w];
          });
        } else if (ev.type === "trace") {
          const t = ev as unknown as Omit<TraceEntry, "at">;
          if (!replay) onTrace({ ...t, at: new Date().toLocaleTimeString() });
          if (!silent) {
            const label = activityLabel(t);
            if (label) setActivity(label);
          }
        } else if (ev.type === "done") {
          flushDeltas();
          const sid = ev.sessionId as string | undefined;
          if (silent) logSessionRef.current = sid ?? logSessionRef.current;
          else {
            sessionRef.current = sid ?? sessionRef.current;
            saveChat({ ...loadChat(), sessionId: sessionRef.current });
          }
        }
      });
    } catch (err) {
      if (silent) {
        // no UI surface for a background failure — the turn-end refetch
        // reconciles state and the item simply stays put for a retry
        console.error("background turn failed:", err);
      } else {
        // the turn could not even be started (server unreachable for a while)
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          const note = "_(couldn't reach Marquee — check the connection and send again)_";
          if (last?.role === "assistant") next[next.length - 1] = { role: "assistant", text: last.text + note };
          return next;
        });
      }
    } finally {
      flushDeltas();
      onDone?.();
      if (!replay) onTurnEnd();
      if (silent) {
        const next = logQueueRef.current.shift();
        if (next) {
          void run(next.text, next.onDone, true, next.tag);
        } else {
          logBusyRef.current = false;
        }
      } else {
        currentTurnRef.current = null;
        // drop empty assistant bubbles (e.g. turn ended on a widget)
        setMessages((m) => m.filter((msg) => !(msg.role === "assistant" && !msg.text.trim())));
        // mid-restore the restore loop owns the queue and the busy flag
        if (existing && restoringRef.current) return;
        const next = queueRef.current.shift();
        if (next) {
          void run(next.text, next.onDone); // drain — busy stays up across the queue
        } else {
          busyRef.current = false;
          setBusy(false);
        }
      }
    }
  }

  const send: ChatSend = (text, onDone, opts) => {
    if (!text.trim()) return false;
    if (opts?.silent) {
      if (logBusyRef.current) {
        logQueueRef.current.push({ text, onDone, tag: opts.tag });
        return "queued";
      }
      void run(text, onDone, true, opts.tag);
      return "sent";
    }
    if (busyRef.current || restoringRef.current) {
      queueRef.current.push({ text, onDone });
      return "queued";
    }
    void run(text, onDone);
    return "sent";
  };
  // published after commit so a parent never calls a stale closure mid-render
  useEffect(() => {
    if (sendRef) sendRef.current = send;
    if (newChatRef) newChatRef.current = newChat;
  });
  const hasMessages = messages.length > 0;
  useEffect(() => {
    onConversationChange?.(hasMessages);
  }, [hasMessages, onConversationChange]);

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5">
        {messages.length === 0 && (
          <div className="mx-auto mt-4 max-w-sm text-center md:mt-10">
            <LouieHero />
            <div className="text-sm text-muted">Ask for a recommendation, or tell me what you watched.</div>
            <button
              onClick={() => send("Take me through a guided session to find something to watch.")}
              className="mt-5 w-full rounded-lg border border-accent-border bg-surface-1 px-5 py-4 text-left transition-colors hover:border-accent hover:bg-accent-subtle"
            >
              <div className="text-base font-medium text-accent md:text-sm">Find me something to watch</div>
              <div className="mt-1 text-sm text-muted md:text-xs">A few quick questions, then picks tuned to your taste</div>
            </button>
            <div className="mt-3 text-xs text-muted">or just type — &ldquo;I watched Heat, loved it&rdquo;</div>
            {onOpenHelp && (
              <Button variant="ghost" size="sm" className="mt-2 underline decoration-dotted underline-offset-4" onClick={onOpenHelp}>
                New here? Start with Help
              </Button>
            )}
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.role === "widget")
            return msg.widget === "options" ? (
              <OptionPicker key={i} data={msg.data} answered={msg.answered} locked={busy} onSelect={send} />
            ) : msg.widget === "checklist" ? (
              <MovieChecklist key={i} data={msg.data} answered={msg.answered} locked={busy} onSubmit={send} />
            ) : (
              <MovieCards key={i} data={msg.data} />
            );
          if (msg.role === "user")
            return (
              <div
                key={i}
                className="ml-10 break-words rounded-2xl rounded-br-md border border-accent-border bg-accent-muted px-4 py-3 text-[15px] leading-relaxed md:ml-16 md:text-sm"
              >
                {msg.text}
              </div>
            );
          // the bubble still streaming re-parses on a throttle; finished ones are memoized
          const live = busy && i === messages.length - 1;
          return (
            <div
              key={i}
              className="mr-4 break-words rounded-2xl rounded-bl-md border border-border bg-surface-1 px-4 py-3 text-[15px] leading-relaxed md:mr-10 md:text-sm"
            >
              {msg.text ? (
                live ? (
                  <ThrottledMarkdown text={msg.text} />
                ) : (
                  <Markdown text={msg.text} />
                )
              ) : (
                <span className="animate-pulse text-muted">thinking…</span>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {busy && (
        <div className="mx-3 mb-2 flex items-center gap-2.5 rounded-xl border border-border bg-surface-1 py-1.5 pl-3.5 pr-1.5 md:mx-5">
          <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent shadow-[0_0_10px_var(--accent)]" />
          <span className="min-w-0 flex-1 truncate text-sm text-fg md:text-xs">{activity}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (currentTurnRef.current) void stopTurn(currentTurnRef.current);
            }}
          >
            Stop
          </Button>
          {onWatchGraph && (
            <Button variant="secondary" size="sm" onClick={onWatchGraph}>
              Watch the graph
            </Button>
          )}
          <span className="hidden min-w-0 max-w-[40%] truncate pl-3 text-xs text-muted lg:inline">tip: {TIPS[tipIdx]}</span>
        </div>
      )}
      <form
        className="flex items-center gap-2 border-t border-border bg-surface-0 px-3 py-2.5 md:px-4 md:py-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = input;
          setInput("");
          send(t);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => onInputFocusChange?.(true)}
          onBlur={() => onInputFocusChange?.(false)}
          placeholder={busy ? "the expert is working — messages queue up…" : "Talk movies & shows…"}
          aria-label="Message"
          // text-base (16px) on mobile stops iOS from auto-zooming on focus; desktop keeps 14px
          className="min-h-12 min-w-0 flex-1 rounded-full border border-border-strong bg-surface-2 px-4 text-base outline-none placeholder:text-muted focus:border-accent-border md:min-h-10 md:text-sm"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!input.trim()}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-text transition-colors disabled:bg-surface-3 disabled:text-muted md:h-10 md:w-10"
        >
          <ArrowUpIcon size={20} />
        </button>
      </form>
    </>
  );
}
