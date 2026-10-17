"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChatPane, { ChatSend, TraceEntry } from "@/components/ChatPane";
import PushToggle from "@/components/PushToggle";
import GraphView from "@/components/GraphView";
import Watchlist from "@/components/Watchlist";
import QuickRate from "@/components/QuickRate";
import PredictPanel from "@/components/PredictPanel";
import HelpPanel from "@/components/HelpPanel";
import { Button, IconButton } from "@/components/ui";
import { ChatIcon, ChevronLeftIcon, CloseIcon, DotsIcon, GraphIcon, ListIcon, StarIcon } from "@/components/icons";
import { emitThinking, traceToThinking } from "@/lib/liveThinking";
import { pushTrace, useTrace } from "@/lib/traceStore";

const KIND_STYLE: Record<TraceEntry["kind"], string> = {
  init: "text-muted",
  tool: "text-fg",
  error: "text-danger",
  result: "text-accent",
  model: "text-muted",
};

// subscribes to the trace store itself: trace lines arrive several times a
// second during a turn and nothing else in the app needs to re-render for them
function Booth() {
  const { entries, model } = useTrace();
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [entries]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted">
        <span>Live activity log</span>
        {model && (
          <span className="truncate font-mono" title="model the API served for the last reply">
            {model}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed">
        {entries.length === 0 && (
          <div className="mt-16 text-center text-muted">
            Nothing on the reel yet — every tool call, vault write, and subagent dispatch shows up here as the
            expert works.
          </div>
        )}
        {entries.map((t, i) => (
          <div key={i} className="flex gap-2 border-b border-border/60 py-1.5">
            <span className="shrink-0 text-muted">{t.at}</span>
            <span className={`shrink-0 rounded px-1 ${t.sub ? "bg-info-subtle text-info" : "bg-accent-muted text-accent"}`}>
              {t.sub ? "sub" : "main"}
            </span>
            <span className={`shrink-0 font-semibold ${KIND_STYLE[t.kind]}`}>{t.label}</span>
            {t.detail && <span className="break-all text-muted">{t.detail}</span>}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
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

// panels reached through More: their title bar goes back to More, not Close
const SECONDARY = new Set<Panel>(["predict", "booth", "help"]);

// mobile bottom bar — four primary destinations plus More (Booth/Help behind it)
const BOTTOM_TABS: [Panel, string, (p: { size?: number }) => React.ReactNode][] = [
  [null, "Chat", ChatIcon],
  ["graph", "Graph", GraphIcon],
  ["watchlist", "List", ListIcon],
  ["rate", "Rate", StarIcon],
  ["more", "More", DotsIcon],
];

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
          className="w-full rounded-lg border border-border bg-surface-1 p-4 text-left transition-colors hover:border-accent-border"
        >
          <div className="text-base font-medium text-fg">{label}</div>
          <div className="mt-1 text-sm text-muted">{desc}</div>
        </button>
      ))}
      <PushToggle />
    </div>
  );
}

export default function Home() {
  const [graphVersion, setGraphVersion] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [graphMode, setGraphMode] = useState<"2d" | "3d">("2d");
  // panels mount on first visit and then stay mounted (hidden) so the graph
  // layout, scroll position, and a running screening survive tab switches;
  // nothing is fetched for a panel that was never opened
  const [visited, setVisited] = useState<Set<Panel>>(() => new Set());
  // the phone keyboard is up: hide the bottom nav so it doesn't stack on it
  const [chatFocused, setChatFocused] = useState(false);
  const chatSend = useRef<ChatSend>(() => false);

  const open = useCallback((p: Panel) => {
    setPanel(p);
    if (p) setVisited((v) => (v.has(p) ? v : new Set(v).add(p)));
  }, []);
  const onTurnEnd = useCallback(() => setGraphVersion((v) => v + 1), []);
  const onTrace = useCallback((t: TraceEntry) => {
    pushTrace(t);
    // live show: map wiki-touching tool calls to graph activations
    const ev = traceToThinking(t);
    if (ev) emitThinking(ev);
  }, []);
  const onOpenHelp = useCallback(() => open("help"), [open]);
  const onWatchGraph = useCallback(() => {
    open("graph");
    // 3D is a battery cost on a phone: the live show runs in 2D there
    if (window.matchMedia("(min-width: 768px)").matches) setGraphMode("3d");
  }, [open]);
  const chat = useCallback<ChatSend>((t, onDone, opts) => chatSend.current(t, onDone, opts), []);

  const showNav = !(panel === null && chatFocused);

  return (
    // h-dvh (not h-screen) tracks the dynamic viewport so the mobile URL bar
    // never hides the chat input. Column: content row on top, bottom nav below.
    <main className="flex h-dvh flex-col overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <div className="flex min-h-0 flex-1">
        <section
          // desktop: chat is full-width, or a 46% left pane when a panel is open.
          // mobile: chat is full-screen, and hidden entirely while a panel shows.
          // min-w-0: without it a flex item won't shrink below its content's
          // intrinsic width, so the pane overflows the phone viewport.
          className={`min-w-0 flex-col ${
            panel ? "hidden md:flex md:w-[46%] md:min-w-[380px] md:border-r md:border-border" : "flex flex-1"
          }`}
        >
          <header className="flex h-12 items-center gap-3 border-b border-border px-4 md:h-auto md:py-3">
            <img src="/icon.png" alt="" className="h-8 w-8 louie-growl" />
            <h1 className="text-lg font-semibold tracking-wide text-accent">Marquee</h1>
            <span className="hidden text-xs text-muted md:inline">your movie &amp; TV expert</span>
            {!panel && (
              <span className="ml-auto hidden gap-1 md:flex">
                {TABS.map(([id, label]) => (
                  <Button key={id} variant="ghost" size="sm" onClick={() => open(id)}>
                    {label}
                  </Button>
                ))}
              </span>
            )}
          </header>
          <ChatPane
            onTurnEnd={onTurnEnd}
            onTrace={onTrace}
            onOpenHelp={onOpenHelp}
            onWatchGraph={onWatchGraph}
            onInputFocusChange={setChatFocused}
            sendRef={chatSend}
          />
        </section>
        {/* stays mounted even when closed so Screen Test's panel — and any
            screening it is running — survives tab switches and Close */}
        <section className={`relative min-w-0 flex-1 flex-col ${panel ? "flex" : "hidden"}`}>
          {/* desktop tab strip */}
          <div className="hidden items-center gap-1 border-b border-border px-3 py-1.5 md:flex">
            {TABS.map(([id, label]) => (
              <Button
                key={id}
                variant="ghost"
                size="sm"
                aria-current={panel === id ? "page" : undefined}
                className={panel === id ? "bg-accent-muted text-accent hover:text-accent" : ""}
                onClick={() => open(id)}
              >
                {label}
              </Button>
            ))}
            <IconButton label="Close panel" className="ml-auto" onClick={() => open(null)}>
              <CloseIcon size={18} />
            </IconButton>
          </div>
          {/* mobile title bar — bottom nav handles switching */}
          <div className="flex h-12 items-center gap-1 border-b border-border px-1 md:hidden">
            {SECONDARY.has(panel) ? (
              <IconButton label="Back to More" onClick={() => open("more")}>
                <ChevronLeftIcon />
              </IconButton>
            ) : (
              <span className="w-2" />
            )}
            <span className="min-w-0 flex-1 truncate px-1 text-base font-medium text-fg">
              {panel && PANEL_TITLE[panel]}
            </span>
            <IconButton label="Close panel" onClick={() => open(null)}>
              <CloseIcon size={18} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1">
            {visited.has("graph") && (
              <div className={panel === "graph" ? "h-full" : "hidden"}>
                <GraphView version={graphVersion} mode={graphMode} onModeChange={setGraphMode} active={panel === "graph"} />
              </div>
            )}
            {visited.has("watchlist") && (
              <div className={panel === "watchlist" ? "h-full" : "hidden"}>
                <Watchlist version={graphVersion} onChat={chat} active={panel === "watchlist"} />
              </div>
            )}
            {visited.has("rate") && (
              <div className={panel === "rate" ? "h-full" : "hidden"}>
                <QuickRate onChat={chat} />
              </div>
            )}
            {visited.has("predict") && (
              <div className={panel === "predict" ? "h-full" : "hidden"}>
                <PredictPanel version={graphVersion} active={panel === "predict"} />
              </div>
            )}
            {visited.has("help") && (
              <div className={panel === "help" ? "h-full" : "hidden"}>
                <HelpPanel />
              </div>
            )}
            {visited.has("booth") && (
              <div className={panel === "booth" ? "h-full" : "hidden"}>
                <Booth />
              </div>
            )}
            {panel === "more" && <MorePanel onPick={open} />}
          </div>
        </section>
      </div>
      {/* mobile-only bottom navigation; pads around the home-indicator safe area */}
      <nav
        aria-label="Sections"
        className={`border-t border-border bg-surface-0 pb-[env(safe-area-inset-bottom)] md:hidden ${showNav ? "flex" : "hidden"}`}
      >
        {BOTTOM_TABS.map(([id, label, Icon]) => {
          const active = id === "more" ? panel === "more" || SECONDARY.has(panel) : panel === id;
          return (
            <button
              key={label}
              onClick={() => open(id)}
              aria-current={active ? "page" : undefined}
              className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              {active && <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 rounded-b bg-accent" />}
              <Icon size={22} />
              {label}
            </button>
          );
        })}
      </nav>
    </main>
  );
}
