"use client";

import { MutableRefObject, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WIKILINK } from "@/lib/wikilink";
import { OptionPicker, MovieCards, MovieChecklist, OptionsData, RecsData, ChecklistData } from "./Widgets";

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: (p) => <p className="my-1.5 first:mt-0 last:mb-0" {...p} />,
        strong: (p) => <strong className="font-semibold text-glow" {...p} />,
        h1: (p) => <div className="mt-2 font-semibold text-glow" {...p} />,
        h2: (p) => <div className="mt-2 font-semibold text-glow" {...p} />,
        h3: (p) => <div className="mt-2 font-semibold text-glow" {...p} />,
        h4: (p) => <div className="mt-2 font-semibold text-glow" {...p} />,
        hr: () => <hr className="my-2 border-card-border" />,
        ul: (p) => <ul className="my-1.5 list-disc space-y-1 pl-5" {...p} />,
        ol: (p) => <ol className="my-1.5 list-decimal space-y-1 pl-5" {...p} />,
        a: (p) => <a className="text-glow underline" target="_blank" {...p} />,
        code: (p) => <code className="rounded bg-background px-1 font-mono text-[0.9em]" {...p} />,
        pre: (p) => (
          <pre
            className="my-1.5 overflow-x-auto rounded-lg border border-card-border bg-background p-2.5 text-xs [&_code]:bg-transparent [&_code]:p-0"
            {...p}
          />
        ),
        img: (p) => <img className="my-1.5 max-w-full rounded-lg" {...p} />,
        blockquote: (p) => <blockquote className="border-l-2 border-glow/40 pl-3 text-muted" {...p} />,
        table: (p) => (
          <div className="my-1.5 overflow-x-auto">
            <table className="w-full border-collapse text-xs" {...p} />
          </div>
        ),
        th: (p) => (
          <th className="border-b border-card-border px-2 py-1 text-left font-semibold text-glow" {...p} />
        ),
        td: (p) => <td className="border-b border-card-border/50 px-2 py-1 align-top" {...p} />,
      }}
    >
      {text.replace(WIKILINK, "$1")}
    </ReactMarkdown>
  );
}

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
  kind: "init" | "tool" | "error" | "result";
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

// rotated in the busy bar while the expert thinks
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
    fetch("/louie.svg").then((r) => r.text()).then(setSvg).catch(() => {});
  }, []);

  useEffect(() => {
    const host = ref.current;
    const svgEl = host?.querySelector("svg");
    if (!host || !svgEl) return;

    const polys = [...svgEl.querySelectorAll("polygon")].map((p) => {
      const nums = (p.getAttribute("points") ?? "").split(/[ ,]/).map(Number);
      let cx = 0, cy = 0;
      for (let i = 0; i < 6; i += 2) { cx += nums[i]; cy += nums[i + 1]; }
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
    <div
      ref={ref}
      className="mx-auto mb-4 w-64"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default function ChatPane({
  onTurnEnd,
  onTrace,
  onOpenHelp,
  sendRef,
}: {
  onTurnEnd: () => void;
  onTrace: (t: TraceEntry) => void;
  onOpenHelp?: () => void;
  sendRef?: MutableRefObject<ChatSend>;
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
  const abortRef = useRef<AbortController | null>(null);
  // background lane: silent turns (watchlist logging, veto edits) run on their
  // OWN session with their own queue, fully concurrent with the chat lane —
  // logging never locks the chat and the chat never delays a log. Cross-lane
  // vault-write races are fenced server-side: the Edit tool rejects stale
  // writes (file modified since read), the prompt mandates re-read-and-retry,
  // and the lint loop repairs any missed cross-reference.
  const logSessionRef = useRef<string | undefined>(undefined);
  const logBusyRef = useRef(false);
  const logQueueRef = useRef<{ text: string; onDone?: () => void; tag?: string }[]>([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages]);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 6000);
    return () => clearInterval(id);
  }, [busy]);

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
    if (busyRef.current) {
      queueRef.current.push({ text, onDone });
      return "queued";
    }
    void run(text, onDone);
    return "sent";
  };
  if (sendRef) sendRef.current = send;

  async function run(text: string, onDone?: () => void, silent?: boolean, tag = "watchlist-log") {
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

    // Stop button aborts the chat lane only — background logs always finish
    const controller = silent ? null : new AbortController();
    if (controller) abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // tagged here (single place) so the prompt's silent-turn carve-outs
          // and the flag can't drift apart
          message: silent ? `<${tag}>\n${text}\n</${tag}>` : text,
          sessionId: silent ? logSessionRef.current : sessionRef.current,
        }),
        signal: controller?.signal,
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop()!;
        for (const raw of events) {
          if (!raw.startsWith("data: ")) continue;
          const ev = JSON.parse(raw.slice(6));
          if (ev.type === "text" && silent) {
            // silent turns render nothing in the transcript
          } else if (ev.type === "widget" && silent) {
            // prompt forbids widgets in silent turns; if one slips through,
            // dropping it is safest — the next message resumes the session
          } else if (ev.type === "status") {
            // live generation status (thinking…, preparing Edit…) — fills the
            // long silent stretches between trace lines. Chat lane only: the
            // busy strip belongs to the chat; background logs stay invisible.
            if (!silent)
              setActivity(ev.label ? `${ev.label}${ev.detail ? ` ${ev.detail}` : ""}` : "working…");
          } else if (ev.type === "text") {
            setMessages((m) => {
              const next = [...m];
              // append to the last assistant bubble, or open a new one after a widget
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { role: "assistant", text: last.text + ev.delta };
              } else {
                next.push({ role: "assistant", text: ev.delta });
              }
              return next;
            });
          } else if (ev.type === "widget") {
            setMessages((m) => {
              // drop duplicate widget re-calls within the same turn
              const dup = m.some(
                (msg) =>
                  msg.role === "widget" &&
                  msg.widget === ev.widget &&
                  JSON.stringify(msg.data) === JSON.stringify(ev.data)
              );
              if (dup) return m;
              const w: Msg =
                ev.widget === "options"
                  ? { role: "widget", widget: "options", data: ev.data, answered: false }
                  : ev.widget === "checklist"
                    ? { role: "widget", widget: "checklist", data: ev.data, answered: false }
                    : { role: "widget", widget: "recs", data: ev.data };
              return [...m, w];
            });
          } else if (ev.type === "trace") {
            onTrace({ ...ev, at: new Date().toLocaleTimeString() });
            if (!silent) {
              const label = activityLabel(ev);
              if (label) setActivity(label);
            }
          } else if (ev.type === "done") {
            if (silent) logSessionRef.current = ev.sessionId ?? logSessionRef.current;
            else sessionRef.current = ev.sessionId ?? sessionRef.current;
          }
        }
      }
    } catch (err) {
      if (silent) {
        // no UI surface for a background failure — the turn-end refetch
        // reconciles state and the item simply stays put for a retry
        console.error("background turn failed:", err);
      } else if (err instanceof DOMException && err.name === "AbortError") {
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { role: "assistant", text: last.text + "\n\n_(stopped)_" };
          return next;
        });
      } else {
        throw err;
      }
    } finally {
      onDone?.();
      onTurnEnd();
      if (silent) {
        const next = logQueueRef.current.shift();
        if (next) {
          void run(next.text, next.onDone, true, next.tag);
        } else {
          logBusyRef.current = false;
        }
      } else {
        abortRef.current = null;
        // drop empty assistant bubbles (e.g. turn ended on a widget)
        setMessages((m) => m.filter((msg) => !(msg.role === "assistant" && !msg.text.trim())));
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

  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-10 max-w-sm text-center">
            <LouieHero />
            <div className="text-sm text-muted">
              Ask for a recommendation, or tell me what you watched.
            </div>
            <button
              onClick={() =>
                send("Take me through a guided session to find something to watch.")
              }
              className="mt-6 w-full cursor-pointer rounded-lg border border-glow/40 bg-card px-5 py-4 text-left transition-colors hover:border-glow hover:bg-glow/10"
            >
              <div className="text-sm font-medium text-glow">Find me something to watch</div>
              <div className="mt-1 text-xs text-muted">
                A few quick questions, then picks tuned to your taste
              </div>
            </button>
            <div className="mt-4 text-xs text-muted opacity-70">
              or just type — &ldquo;I watched Heat, loved it&rdquo;
            </div>
            {onOpenHelp && (
              <button
                onClick={onOpenHelp}
                className="mt-5 text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-glow"
              >
                New here? Start with Help
              </button>
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
              <div key={i} className="ml-12 break-words rounded-lg border border-glow/25 bg-glow/10 px-3.5 py-2.5 text-sm">
                {msg.text}
              </div>
            );
          return (
            <div key={i} className="mr-6 break-words rounded-lg border border-card-border bg-card px-3.5 py-2.5 text-sm leading-relaxed">
              {msg.text ? <Markdown text={msg.text} /> : <span className="animate-pulse text-muted">thinking…</span>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {busy && (
        <div className="flex items-center gap-2.5 border-t border-card-border bg-[#12100d] px-5 py-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-glow opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-glow" />
          </span>
          <span className="text-xs text-glow/90">{activity}</span>
          <button
            onClick={() => abortRef.current?.abort()}
            className="cursor-pointer rounded border border-card-border px-2 py-0.5 text-[11px] text-muted hover:border-glow/60 hover:text-glow"
          >
            Stop
          </button>
          <span className="ml-auto min-w-0 truncate pl-3 text-[11px] text-muted">
            tip: {TIPS[tipIdx]}
          </span>
        </div>
      )}
      <form
        className="flex gap-2 border-t border-card-border bg-[#12100d] p-4"
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
          placeholder={busy ? "the expert is working — messages queue up…" : "Talk movies & shows…"}
          className="flex-1 rounded-md border border-[#3a2f22] bg-[#1c1713] px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-glow/60 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="rounded-md border border-glow/60 px-4 py-2 text-sm text-glow hover:bg-glow/10 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </>
  );
}
