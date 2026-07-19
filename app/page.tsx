"use client";

import { useEffect, useRef, useState } from "react";
import ChatPane, { ChatSend, TraceEntry } from "@/components/ChatPane";
import GraphView from "@/components/GraphView";
import Watchlist from "@/components/Watchlist";
import QuickRate from "@/components/QuickRate";
import HelpPanel from "@/components/HelpPanel";

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
// (Booth, Help) reached from the bottom-nav "More" tab. Desktop never sets it.
type Panel = "graph" | "watchlist" | "rate" | "booth" | "help" | "more" | null;

const TABS = [
  ["graph", "Taste Graph"],
  ["watchlist", "Watchlist"],
  ["rate", "Quick Rate"],
  ["booth", "Projection Booth"],
  ["help", "Help"],
] as const;

const PANEL_TITLE: Record<Exclude<Panel, null>, string> = {
  graph: "Taste Graph",
  watchlist: "Watchlist",
  rate: "Quick Rate",
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
  const [graphVersion, setGraphVersion] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
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
            onTrace={(t) => setTrace((prev) => [...prev, t])}
            onOpenHelp={() => setPanel("help")}
            sendRef={chatSend}
          />
        </section>
        {panel && (
          <section className="relative flex min-w-0 flex-1 flex-col">
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
                {PANEL_TITLE[panel]}
              </span>
              {panel === "booth" || panel === "help" ? (
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
              {panel === "graph" ? (
                <GraphView version={graphVersion} />
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
              ) : (
                <Booth entries={trace} />
              )}
            </div>
          </section>
        )}
      </div>
      {/* mobile-only bottom navigation; pads around the home-indicator safe area */}
      <nav className="flex border-t border-card-border pb-[env(safe-area-inset-bottom)] md:hidden">
        {BOTTOM_TABS.map(([id, label]) => {
          const active =
            id === "more"
              ? panel === "more" || panel === "booth" || panel === "help"
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
