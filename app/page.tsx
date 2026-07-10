"use client";

import { useEffect, useRef, useState } from "react";
import ChatPane, { ChatSend, TraceEntry } from "@/components/ChatPane";
import GraphView from "@/components/GraphView";
import Watchlist from "@/components/Watchlist";
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

type Panel = "graph" | "watchlist" | "booth" | "help" | null;

const TABS = [
  ["graph", "Taste Graph"],
  ["watchlist", "Watchlist"],
  ["booth", "Projection Booth"],
  ["help", "Help"],
] as const;

export default function Home() {
  const [graphVersion, setGraphVersion] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const chatSend = useRef<ChatSend>(() => false);

  return (
    <main className="flex h-screen overflow-hidden">
      <section
        className={`flex min-w-[380px] flex-col ${
          panel ? "w-[46%] border-r border-card-border" : "flex-1"
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
            <span className="ml-auto flex gap-1">
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
        <section className="relative flex flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-card-border px-4 py-2">
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
          <div className="min-h-0 flex-1">
            {panel === "graph" ? (
              <GraphView version={graphVersion} />
            ) : panel === "watchlist" ? (
              <Watchlist
                version={graphVersion}
                onChat={(t, onDone, opts) => chatSend.current(t, onDone, opts)}
              />
            ) : panel === "help" ? (
              <HelpPanel />
            ) : (
              <Booth entries={trace} />
            )}
          </div>
        </section>
      )}
    </main>
  );
}
