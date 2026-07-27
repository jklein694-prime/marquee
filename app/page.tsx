"use client";

import { useEffect, useRef, useState } from "react";
import ChatPane, { ChatSend, TraceEntry } from "@/components/ChatPane";
import GraphView from "@/components/GraphView";
import Watchlist from "@/components/Watchlist";
import QuickRate from "@/components/QuickRate";
import PredictPanel from "@/components/PredictPanel";
import HelpPanel from "@/components/HelpPanel";
import { emitThinking, traceToThinking } from "@/lib/liveThinking";

// Louie greets you with a growl on page open. Synthesized (no audio asset):
// a low sawtooth with a ~24Hz tremble through a lowpass, fading over ~0.8s.
// Browsers block autoplay, so if the context starts suspended we growl on the
// first tap/click instead — the policy allows nothing earlier than that.
function useLouieGrowl() {
  useEffect(() => {
    let done = false;
    const growl = () => {
      if (done) return;
      done = true;
      const ctx = new AudioContext();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(82, t);
      osc.frequency.exponentialRampToValueAtTime(58, t + 0.8);
      const tremble = ctx.createOscillator();
      tremble.frequency.value = 24;
      const trembleDepth = ctx.createGain();
      trembleDepth.gain.value = 0.35;
      const vol = ctx.createGain();
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      const muffle = ctx.createBiquadFilter();
      muffle.type = "lowpass";
      muffle.frequency.value = 340;
      tremble.connect(trembleDepth).connect(vol.gain);
      osc.connect(muffle).connect(vol).connect(ctx.destination);
      osc.start(t);
      tremble.start(t);
      osc.stop(t + 0.9);
      tremble.stop(t + 0.9);
      osc.onended = () => ctx.close();
    };
    const probe = new AudioContext();
    const canAutoplay = probe.state === "running";
    probe.close();
    if (canAutoplay) {
      growl();
      return;
    }
    window.addEventListener("pointerdown", growl, { once: true });
    return () => window.removeEventListener("pointerdown", growl);
  }, []);
}

const KIND_STYLE: Record<TraceEntry["kind"], string> = {
  init: "text-muted",
  tool: "text-foreground",
  error: "text-ember",
  result: "text-glow",
};

function Booth({ entries }: { entries: TraceEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [entries]);

  return (
    <div className="h-full overflow-y-auto px-5 py-4 font-mono text-xs leading-relaxed">
      {entries.length === 0 && (
        <div className="mt-16 text-center text-muted">
          Nothing on the reel yet — every tool call, vault write, and subagent
          dispatch shows up here as the expert works.
        </div>
      )}
      {entries.map((t, i) => (
        <div key={i} className="flex gap-2 border-b border-card-border/50 py-1.5">
          <span className="shrink-0 text-muted">{t.at}</span>
          <span
            className={`shrink-0 rounded px-1 ${
              t.sub ? "bg-candle/20 text-candle" : "bg-glow/15 text-glow"
            }`}
          >
            {t.sub ? "sub" : "main"}
          </span>
          <span className={`shrink-0 font-semibold ${KIND_STYLE[t.kind]}`}>{t.label}</span>
          {t.detail && <span className="break-all text-muted">{t.detail}</span>}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// "more" is a mobile-only view: a full-screen list of the secondary panels
// (Screen Test, Booth, Help) reached from the bottom-nav "More" tab. Desktop never sets it.
type Panel = "graph" | "watchlist" | "rate" | "predict" | "booth" | "help" | "more" | null;

const TABS = [
  ["graph", "Taste Graph"],
  ["watchlist", "Watchlist"],
  ["rate", "Quick Rate"],
  ["predict", "Screen Test"],
  ["booth", "Projection Booth"],
  ["help", "Help"],
] as const;

const PANEL_TITLE: Record<Exclude<Panel, null>, string> = {
  graph: "Taste Graph",
  watchlist: "Watchlist",
  rate: "Quick Rate",
  predict: "Screen Test",
  booth: "Projection Booth",
  help: "Help",
  more: "More",
};

// mobile bottom bar — four primary destinations plus More (Booth/Help behind it)
const BOTTOM_TABS = [
  [null, "Chat"],
  ["graph", "Graph"],
  ["watchlist", "List"],
  ["rate", "Rate"],
  ["more", "More"],
] as const;

// the mobile "More" view: secondary panels as big tappable rows — no popover /
// outside-click machinery, it's just another full-screen panel.
function MorePanel({ onPick }: { onPick: (p: Panel) => void }) {
  const items: [Panel, string, string][] = [
    ["predict", "Screen Test", "Predict how you'd rate a title before you watch it."],
    ["booth", "Projection Booth", "Live activity log — every tool call, vault write, and subagent dispatch as the expert works."],
    ["help", "Help", "How Marquee works and how to get the best out of it."],
  ];
  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {items.map(([id, label, desc]) => (
        <button
          key={label}
          onClick={() => onPick(id)}
          className="w-full rounded-lg border border-card-border bg-card p-4 text-left transition-colors hover:border-glow/50"
        >
          <div className="text-sm font-medium text-glow">{label}</div>
          <div className="mt-1 text-xs text-muted">{desc}</div>
        </button>
      ))}
    </div>
  );
}

export default function Home() {
  useLouieGrowl();
  const [graphVersion, setGraphVersion] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [graphMode, setGraphMode] = useState<"2d" | "3d">("2d");
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const chatSend = useRef<ChatSend>(() => false);

  return (
    // h-dvh (not h-screen) tracks the dynamic viewport so the mobile URL bar
    // never hides the chat input. Column: content row on top, bottom nav below.
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <section
          // desktop: chat is full-width, or a 46% left pane when a panel is open.
          // mobile: chat is full-screen, and hidden entirely while a panel shows.
          // min-w-0: without it a flex item won't shrink below its content's
          // intrinsic width, so the pane overflows the phone viewport.
          className={`min-w-0 flex-col ${
            panel
              ? "hidden md:flex md:w-[46%] md:min-w-[380px] md:border-r md:border-card-border"
              : "flex flex-1"
          }`}
        >
          <header className="flex items-center gap-3 border-b border-card-border px-5 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="Louie" className="h-8 w-8" />
            <h1 className="text-lg font-semibold tracking-wide text-glow">
              Marquee
            </h1>
            <span className="text-xs text-muted">your movie & TV expert</span>
            {!panel && (
              <span className="ml-auto hidden gap-1 md:flex">
                {TABS.map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setPanel(id)}
                    className="rounded-md px-3 py-1 text-xs text-muted transition-colors hover:bg-glow/10 hover:text-glow"
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
          </header>
          <ChatPane
            onTurnEnd={() => setGraphVersion((v) => v + 1)}
            onTrace={(t) => {
              setTrace((prev) => [...prev, t]);
              // live 3D show: map wiki-touching tool calls to graph activations
              const ev = traceToThinking(t);
              if (ev) emitThinking(ev);
            }}
            onOpenHelp={() => setPanel("help")}
            onWatchGraph={() => {
              setPanel("graph");
              setGraphMode("3d");
            }}
            sendRef={chatSend}
          />
        </section>
        {/* stays mounted even when closed so Screen Test's panel — and any
            screening it is running — survives tab switches and Close */}
        <section
          className={`relative min-w-0 flex-1 flex-col ${panel ? "flex" : "hidden"}`}
        >
            {/* desktop tab strip */}
            <div className="hidden items-center gap-1 border-b border-card-border px-4 py-2 md:flex">
              {TABS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setPanel(id)}
                  className={`rounded-md px-3 py-1 text-xs transition-colors ${
                    panel === id
                      ? "bg-glow/15 text-glow"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
              {panel === "graph" && (
                <span className="ml-auto text-xs text-muted">
                  <span className="text-glow">liked</span> ·{" "}
                  <span className="text-ember">disliked</span> ·{" "}
                  <span className="text-candle">genres</span> ·{" "}
                  <span className="opacity-50 text-glow">watchlist</span>
                </span>
              )}
              <button
                onClick={() => setPanel(null)}
                className={`rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-glow/10 hover:text-glow ${
                  panel === "graph" ? "" : "ml-auto"
                }`}
                title="Close panel"
              >
                Close
              </button>
            </div>
            {/* mobile slim title bar — bottom nav handles switching */}
            <div className="flex items-center justify-between border-b border-card-border px-4 py-3 md:hidden">
              <span className="text-sm font-medium text-glow">
                {panel && PANEL_TITLE[panel]}
              </span>
              {panel === "predict" || panel === "booth" || panel === "help" ? (
                <button
                  onClick={() => setPanel("more")}
                  className="text-xs text-muted transition-colors hover:text-glow"
                >
                  ‹ More
                </button>
              ) : (
                <button
                  onClick={() => setPanel(null)}
                  className="text-xs text-muted transition-colors hover:text-glow"
                >
                  Close
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <div className={panel === "predict" ? "h-full" : "hidden"}>
                <PredictPanel />
              </div>
              {panel === "graph" ? (
                <GraphView version={graphVersion} mode={graphMode} onModeChange={setGraphMode} />
              ) : panel === "watchlist" ? (
                <Watchlist
                  version={graphVersion}
                  onChat={(t, onDone, opts) => chatSend.current(t, onDone, opts)}
                />
              ) : panel === "rate" ? (
                <QuickRate onChat={(t, onDone, opts) => chatSend.current(t, onDone, opts)} />
              ) : panel === "help" ? (
                <HelpPanel />
              ) : panel === "more" ? (
                <MorePanel onPick={setPanel} />
              ) : panel === "booth" ? (
                <Booth entries={trace} />
              ) : null}
            </div>
          </section>
      </div>
      {/* mobile-only bottom navigation; pads around the home-indicator safe area */}
      <nav className="flex border-t border-card-border pb-[env(safe-area-inset-bottom)] md:hidden">
        {BOTTOM_TABS.map(([id, label]) => {
          const active =
            id === "more"
              ? panel === "more" || panel === "predict" || panel === "booth" || panel === "help"
              : panel === id;
          return (
            <button
              key={label}
              onClick={() => setPanel(id)}
              className={`flex flex-1 items-center justify-center py-3.5 text-xs transition-colors ${
                active ? "text-glow" : "text-muted"
              }`}
            >
              {label}
            </button>
          );
        })}
      </nav>
    </main>
  );
}
