"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphNode, GraphLink } from "@/lib/vault";
import {
  useHeatEngine,
  SpotCard,
  nodeColor,
  rgb,
  norm,
  endId,
  pinNodes,
} from "./useHeatEngine";
import { TitleSearch, type SearchResult } from "./QuickRate";

const Graph3D = dynamic(() => import("./Graph3D"), { ssr: false });

type GhostSet = { nodes: GraphNode[]; links: GraphLink[] };
const EMPTY_GHOSTS: GhostSet = { nodes: [], links: [] };

// one evidence edge per considered node, deduped — the screened title's web
function addEvidence(g: GhostSet, screenId: string, targetId: string): GhostSet {
  if (screenId === targetId) return g;
  const dup = g.links.some(
    (l) =>
      (endId(l.source) === screenId && endId(l.target) === targetId) ||
      (endId(l.source) === targetId && endId(l.target) === screenId)
  );
  if (dup) return g;
  return {
    nodes: g.nodes,
    links: [...g.links, { source: screenId, target: targetId, ghost: true } as GraphLink],
  };
}

type Phase = "search" | "thinking" | "done" | "error";

interface Verdict {
  predicted: string;
  why: string;
  seen?: boolean;
  actual?: number;
}

type PredictEvent =
  | { type: "start"; onList?: boolean }
  | { type: "status"; label?: string }
  | { type: "node"; id: string }
  | { type: "consider"; node: string; thought: string }
  | ({ type: "verdict" } & Verdict)
  | { type: "error"; message?: string }
  | { type: "done" };

export default function PredictPanel() {
  const [phase, setPhase] = useState<Phase>("search");
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
    nodes: [],
    links: [],
  });
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [onList, setOnList] = useState(false);
  const [status, setStatus] = useState("");
  const [added, setAdded] = useState<"no" | "saving" | "yes">("no");
  const [errorMsg, setErrorMsg] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<{ id: string; label: string; thought: string }[]>([]);
  const lastPopRef = useRef(0);
  const heatEmptyRef = useRef(true);
  // the screened title materializes as a ghost (only when it isn't already a
  // node) and streams evidence edges to each considered node
  const [ghost, setGhost] = useState<GhostSet>(EMPTY_GHOSTS);
  const screenIdRef = useRef<string | null>(null);

  const liveData = useMemo(
    () =>
      ghost.nodes.length
        ? { nodes: [...graph.nodes, ...ghost.nodes], links: [...graph.links, ...ghost.links] }
        : graph,
    [graph, ghost]
  );

  const engine = useHeatEngine(liveData, {
    autoRotate: true,
    tickWhenIdle: phase === "thinking", // ambient shimmer needs ticks pre-first-hit
    coldNode: (n) => {
      const [r, g, b] = rgb(nodeColor(n));
      if (phase !== "thinking") return `rgb(${r},${g},${b})`;
      // cold nodes recede while the engine thinks; before the first hit the
      // whole graph shimmers gently — "indexing"
      const a = heatEmptyRef.current ? 0.3 + 0.12 * Math.sin(Date.now() / 250) : 0.35;
      return `rgba(${r},${g},${b},${a})`;
    },
    coldLink: (l) =>
      (l as { ghost?: boolean }).ghost ? "rgba(232,220,200,0.3)" : "#2a221a",
  });
  heatEmptyRef.current = engine.heatRef.current.size === 0;

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setGraph)
      .catch(() => {});
  }, []);

  // the graph container only exists past the search phase, so re-attach on
  // change; ignore the 0x0 readings while the panel is hidden (display: none)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0)
        setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  // full page unload aborts so the server interrupts the agent
  useEffect(() => () => abortRef.current?.abort(), []);

  // one queued activation per ~600ms so batched consider calls play as a
  // sequence instead of a single flash; each pop also streams an evidence
  // edge from the screened ghost and keeps its web warm
  useEffect(() => {
    if (phase !== "thinking") return;
    const iv = window.setInterval(() => {
      if (queueRef.current.length && Date.now() - lastPopRef.current > 600) {
        lastPopRef.current = Date.now();
        const next = queueRef.current.shift()!;
        engine.activate([next], { spotlight: true });
        const sid = screenIdRef.current;
        if (sid && next.id !== sid) {
          setGhost((g) => addEvidence(g, sid, next.id));
          engine.activate([{ id: sid, label: sid, thought: "" }]);
        }
      }
    }, 100);
    return () => window.clearInterval(iv);
  }, [phase, engine.activate]); // eslint-disable-line react-hooks/exhaustive-deps

  // fresh closure each render, called through a ref by the long-lived SSE loop
  const handleEvent = (ev: PredictEvent) => {
    switch (ev.type) {
      case "start":
        setOnList(!!ev.onList);
        break;
      case "status":
        if (ev.label) setStatus(ev.label);
        break;
      case "node":
      case "consider": {
        const raw = ev.type === "node" ? ev.id : ev.node;
        const hit = engine.resolve(raw);
        if (hit) {
          queueRef.current.push({
            ...hit,
            thought: ev.type === "consider" ? ev.thought : "reading the wiki page…",
          });
        } else {
          // hub, _index files, Taste Profile — real reads with no graph node
          setStatus(ev.type === "consider" ? ev.thought : "consulting the index…");
        }
        break;
      }
      case "verdict": {
        const { type: _drop, ...v } = ev;
        void _drop;
        // let the queued activations drip out and the last glide land first
        const delay = v.seen
          ? 0
          : Math.min(12000, Math.max(1800, queueRef.current.length * 650 + 1200));
        window.setTimeout(() => {
          setVerdict(v);
          setPhase("done");
          engine.releaseSpot(); // heat fades out behind the card
        }, delay);
        break;
      }
      case "error":
        setErrorMsg(ev.message || "something went wrong");
        setPhase("error");
        break;
    }
  };
  const handleRef = useRef(handleEvent);
  handleRef.current = handleEvent;

  function start(r: SearchResult) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPicked(r);
    setPhase("thinking");
    setVerdict(null);
    setAdded("no");
    setOnList(false);
    setErrorMsg("");
    setStatus("pulling the reel…");
    queueRef.current = [];
    engine.clear();
    // the screened title forms as a ghost — if and only if it isn't already a
    // node (seen titles short-circuit server-side anyway)
    const screenId = r.year ? `${r.title} (${r.year})` : r.title;
    const known = graph.nodes.some(
      (n) => norm(n.id) === norm(screenId) || norm(n.id) === norm(r.title)
    );
    if (known) {
      screenIdRef.current = null;
      setGhost(EMPTY_GHOSTS);
    } else {
      screenIdRef.current = screenId;
      pinNodes(graph.nodes); // only the forming title moves — no jiggle
      setGhost({
        nodes: [{ id: screenId, label: screenId, kind: "ghost" } as GraphNode],
        links: [],
      });
      engine.activate(
        [{ id: screenId, label: screenId, thought: "screening this against your taste…" }],
        { spotlight: true }
      );
    }
    (async () => {
      try {
        const res = await fetch("/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: r.id, media: r.media, title: r.title, year: r.year }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) throw new Error(`predict → ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += dec.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            if (!part.startsWith("data: ")) continue;
            try {
              handleRef.current(JSON.parse(part.slice(6)) as PredictEvent);
            } catch {}
          }
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
          setPhase("error");
        }
      }
    })();
  }

  function reset() {
    abortRef.current?.abort();
    setPhase("search");
    setPicked(null);
    setVerdict(null);
    queueRef.current = [];
    screenIdRef.current = null;
    setGhost(EMPTY_GHOSTS);
    engine.clear();
  }

  async function addToWatchlist() {
    if (!picked || !verdict) return;
    setAdded("saving");
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          title: picked.title,
          year: picked.year ? Number(picked.year) : undefined,
          media: picked.media,
          predicted: verdict.predicted,
        }),
      });
      setAdded(res.ok ? "yes" : "no");
    } catch {
      setAdded("no");
    }
  }

  if (phase === "search") {
    return (
      <div className="h-full space-y-4 overflow-y-auto px-5 py-4">
        <div>
          <div className="mb-1.5 text-sm font-medium text-glow">Screen Test</div>
          <div className="mb-2 text-xs text-muted">
            Search any movie or show and Louie screens it against your taste
            graph — watch the reasoning light up, then get his projected rating.
          </div>
        </div>
        <TitleSearch autoFocus onPick={start} />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {graph.nodes.length > 0 && (
        <Graph3D
          fgRef={engine.fgRef}
          width={size.width}
          height={size.height}
          graphData={liveData}
          backgroundColor="#0c0a08"
          controlType="orbit"
          showNavInfo={false}
          enableNodeDrag={false}
          {...engine.graphProps}
        />
      )}

      {picked && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-3 rounded-lg border border-card-border bg-card/90 p-2 pr-3 backdrop-blur-sm">
          {picked.poster_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://image.tmdb.org/t/p/w92${picked.poster_path}`}
              alt={picked.title}
              className="h-12 w-8 rounded object-cover"
            />
          )}
          <div className="min-w-0">
            <div className="text-xs font-medium">
              {phase === "thinking" && "Screening "}
              {picked.title}
              {picked.year && <span className="text-muted"> ({picked.year})</span>}
            </div>
            {phase === "thinking" && (
              <div className="text-[11px] text-muted">
                <span className="animate-pulse text-glow">●</span> {status}
              </div>
            )}
          </div>
          {phase === "thinking" && (
            <button
              onClick={reset}
              className="ml-1 text-xs text-muted hover:text-foreground"
            >
              cancel
            </button>
          )}
        </div>
      )}

      {phase === "thinking" && <SpotCard spot={engine.spot} />}

      {phase === "done" && verdict && picked && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="max-h-full w-96 max-w-full overflow-y-auto rounded-lg border border-card-border bg-card/95 p-5 backdrop-blur-sm">
            <div className="flex gap-4">
              {picked.poster_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`https://image.tmdb.org/t/p/w185${picked.poster_path}`}
                  alt={picked.title}
                  className="h-36 w-24 shrink-0 rounded object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium leading-tight">
                  {picked.title}
                  {picked.year && <span className="text-muted"> ({picked.year})</span>}
                </div>
                <div className="mt-2 text-2xl font-semibold text-glow">
                  {verdict.seen
                    ? `You rated it ${verdict.actual}/10`
                    : `Louie predicts ${verdict.predicted.replace("-", "–")}`}
                </div>
              </div>
            </div>
            <div className="mt-3 text-sm">{verdict.why}</div>
            <div className="mt-4 flex items-center gap-2">
              {!verdict.seen && !onList && (
                <button
                  onClick={addToWatchlist}
                  disabled={added !== "no"}
                  className="rounded-md bg-glow/15 px-3 py-1.5 text-xs text-glow hover:bg-glow/25 disabled:opacity-60"
                >
                  {added === "yes" ? "Added." : added === "saving" ? "Adding…" : "+ My watchlist"}
                </button>
              )}
              {!verdict.seen && onList && (
                <span className="text-xs text-muted">Already on your watchlist</span>
              )}
              <button
                onClick={reset}
                className="rounded-md px-3 py-1.5 text-xs text-muted hover:text-glow"
              >
                Search another
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === "error" && picked && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="w-96 max-w-full rounded-lg border border-card-border bg-card/95 p-5 backdrop-blur-sm">
            <div className="text-sm font-medium text-ember">The screening broke down</div>
            <div className="mt-1 break-words text-xs text-muted">{errorMsg}</div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => start(picked)}
                className="rounded-md bg-glow/15 px-3 py-1.5 text-xs text-glow hover:bg-glow/25"
              >
                Try again
              </button>
              <button
                onClick={reset}
                className="rounded-md px-3 py-1.5 text-xs text-muted hover:text-glow"
              >
                Search another
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
