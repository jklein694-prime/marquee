"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphNode, GraphLink } from "@/lib/vault";
import { Markdown } from "./ChatPane";
import {
  useHeatEngine,
  SpotCard,
  nodeColor,
  endId,
  withAlpha,
  norm,
  heatColor,
  pinNodes,
} from "./useHeatEngine";
import { onThinking, type ThinkingEvent } from "@/lib/liveThinking";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});
const Graph3D = dynamic(() => import("./Graph3D"), { ssr: false });

type WikiState = "loading" | "missing" | { title: string; content: string };

const VERB_TEXT: Record<ThinkingEvent["verb"], string> = {
  read: "reading the wiki…",
  write: "updating the wiki…",
  scan: "scanning the wiki…",
  dispatch: "dispatching a research agent…",
  research: "researching on TMDB…",
};

// --- live ghosts: things the stream touches that aren't graph nodes yet ---
// (TMDB candidates, pages mid-write). They materialize, attach, and at turn
// end either resolve into real nodes (refetch) or dissolve.

type GhostSet = { nodes: GraphNode[]; links: GraphLink[] };
const EMPTY_GHOSTS: GhostSet = { nodes: [], links: [] };
const GHOST_CAP = 40; // full storm — oldest evicted as new arrive
const GHOST_TTL = 45_000;

interface GhostOp {
  newGhost?: string; // create a ghost with this id (resolve missed)
  birthAnchor?: string; // last real spotlight at event time — attachment edge
  anchor: string; // node id (real or ghost) the event centers on
  connect: string[]; // resolved wikilink target ids → anchor connects to each
}

// pure: applies buffered ops in one pass; returns the SAME object when nothing
// changed so the graphData identity (and the d3 sim) stays untouched
function growGhosts(
  g: GhostSet,
  ops: GhostOp[],
  realIds: Set<string>,
  realEdges: Set<string>,
  now: number
): GhostSet {
  let changed = false;
  let nodes = g.nodes.slice() as (GraphNode & { bornAt?: number })[];
  let links = g.links.slice();
  const drop = (dead: Set<string>) => {
    nodes = nodes.filter((n) => !dead.has(n.id));
    links = links.filter(
      (l) => !dead.has(endId(l.source)) && !dead.has(endId(l.target))
    );
    changed = true;
  };
  const stale = new Set(
    nodes.filter((n) => (n.bornAt ?? now) < now - GHOST_TTL).map((n) => n.id)
  );
  if (stale.size) drop(stale);
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const have = new Set(links.map((l) => edgeKey(endId(l.source), endId(l.target))));
  const exists = (id: string) => realIds.has(id) || nodes.some((n) => n.id === id);
  const addEdge = (a: string, b: string) => {
    if (a === b || !exists(a) || !exists(b)) return;
    const k = edgeKey(a, b);
    if (realEdges.has(k) || have.has(k)) return;
    have.add(k);
    links.push({ source: a, target: b, ghost: true } as GraphLink);
    changed = true;
  };
  for (const op of ops) {
    if (op.newGhost && !nodes.some((n) => norm(n.id) === norm(op.newGhost!))) {
      if (nodes.length >= GHOST_CAP) {
        const oldest = [...nodes].sort((a, b) => (a.bornAt ?? 0) - (b.bornAt ?? 0))[0];
        drop(new Set([oldest.id]));
      }
      nodes.push({ id: op.newGhost, label: op.newGhost, kind: "ghost", bornAt: now } as GraphNode);
      changed = true;
      if (op.birthAnchor) addEdge(op.newGhost, op.birthAnchor);
    }
    for (const t of op.connect) addEdge(op.anchor, t);
  }
  return changed ? { nodes, links } : g;
}

export default function GraphView({
  version,
  mode,
  onModeChange,
}: {
  version: number;
  mode: "2d" | "3d";
  onModeChange: (m: "2d" | "3d") => void;
}) {
  const [data, setData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
    nodes: [],
    links: [],
  });
  const [ghosts, setGhosts] = useState<GhostSet>(EMPTY_GHOSTS);
  const ghostsRef = useRef(ghosts);
  ghostsRef.current = ghosts;
  const pendingOpsRef = useRef<GhostOp[]>([]);
  const lastRealSpotRef = useRef<string | null>(null);
  const lastEventAtRef = useRef(0); // any stream activity → the graph breathes
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [wiki, setWiki] = useState<WikiState | null>(null);

  // turn end: refetch and clear ghosts in ONE render — candidates that became
  // real pages reappear as permanent nodes, the rest dissolve
  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((d) => {
        pendingOpsRef.current = [];
        lastRealSpotRef.current = null;
        setGhosts(EMPTY_GHOSTS);
        setData(d);
      })
      .catch(() => {});
  }, [version]);

  // cached lookup sets for the flush (rebuilt only when the real graph changes)
  const realIds = useMemo(() => new Set(data.nodes.map((n) => n.id)), [data]);
  const realEdges = useMemo(() => {
    const s = new Set<string>();
    for (const l of data.links) {
      const a = endId(l.source);
      const b = endId(l.target);
      s.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    return s;
  }, [data]);
  const realRef = useRef({ realIds, realEdges });
  realRef.current = { realIds, realEdges };
  const dataRef = useRef(data);
  dataRef.current = data;

  // merged view the 3D graph + engine consume; identity changes only when a
  // flush lands (load-bearing: per-render churn would keep the d3 sim boiling)
  const liveData = useMemo(
    () =>
      ghosts.nodes.length || ghosts.links.length
        ? { nodes: [...data.nodes, ...ghosts.nodes], links: [...data.links, ...ghosts.links] }
        : data,
    [data, ghosts]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!selected) {
      setWiki(null);
      return;
    }
    let stale = false;
    setWiki("loading");
    fetch(`/api/wiki?id=${encodeURIComponent(selected.id)}`)
      .then((r) => (r.ok ? r.json() : "missing"))
      .then((w) => !stale && setWiki(w))
      .catch(() => !stale && setWiki("missing"));
    return () => {
      stale = true;
    };
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    function handleClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setSelected(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selected]);

  const neighborIds = useMemo(() => {
    if (!selected) return null;
    const ids = new Set([selected.id]);
    for (const l of data.links) {
      const s = endId(l.source);
      const t = endId(l.target);
      if (s === selected.id) ids.add(t);
      if (t === selected.id) ids.add(s);
    }
    return ids;
  }, [selected, data]);

  const linkActive = (l: GraphLink) =>
    !!selected &&
    (endId(l.source) === selected.id || endId(l.target) === selected.id);

  // heat overrides toward glow; the cold rest keeps selection dim/highlight,
  // and recedes while a live show is running so the hot nodes read clearly
  const liveHeatRef = useRef(false);
  const engine = useHeatEngine(liveData, {
    spotTtlMs: 8000,
    // shimmer needs render ticks while the stream is active but nothing is hot
    tickWhenIdle: () => Date.now() - lastEventAtRef.current < 6000,
    coldNode: (n) => {
      if (neighborIds)
        return neighborIds.has(n.id) ? nodeColor(n) : withAlpha(nodeColor(n), 0.12);
      if (liveHeatRef.current) return withAlpha(nodeColor(n), 0.3);
      // stream active, nothing hot yet — the whole graph breathes ("indexing")
      if (Date.now() - lastEventAtRef.current < 6000)
        return withAlpha(nodeColor(n), 0.38 + 0.12 * Math.sin(Date.now() / 250));
      return nodeColor(n);
    },
    coldLink: (l) =>
      (l as { ghost?: boolean }).ghost
        ? "rgba(232,220,200,0.25)"
        : linkActive(l as unknown as GraphLink)
          ? "#f5b942"
          : "#2a221a",
    coldLinkWidth: (l) => (linkActive(l as unknown as GraphLink) ? 2 : 1),
  });
  liveHeatRef.current = engine.heatRef.current.size > 0;

  // flush buffered ghost ops ≤2×/s: one sim re-heat per flush, not per event;
  // pinning first means only the NEW nodes move — the constellation holds still
  useEffect(() => {
    const iv = window.setInterval(() => {
      const now = Date.now();
      const hasStale = ghostsRef.current.nodes.some(
        (n) => ((n as GraphNode & { bornAt?: number }).bornAt ?? now) < now - GHOST_TTL
      );
      if (!pendingOpsRef.current.length && !hasStale) return;
      const ops = pendingOpsRef.current.splice(0);
      const { realIds, realEdges } = realRef.current;
      pinNodes(dataRef.current.nodes);
      setGhosts((g) => growGhosts(g, ops, realIds, realEdges, now));
    }, 500);
    return () => window.clearInterval(iv);
  }, []);

  // live show: Louie's chat/silent-turn activity lights the graph while this
  // tab is open in 3D — purely observational, dropped when unmounted
  const [liveLabel, setLiveLabel] = useState("");
  const liveTimerRef = useRef(0);
  const lastSpotRef = useRef(0);
  useEffect(() => {
    return onThinking((ev) => {
      lastEventAtRef.current = Date.now();
      setLiveLabel(VERB_TEXT[ev.verb]);
      window.clearTimeout(liveTimerRef.current);
      liveTimerRef.current = window.setTimeout(() => setLiveLabel(""), 4000);
      // wikilinks seen in the write/read payload → background burst on the
      // linked existing nodes (no spotlight steal)
      const linked = (ev.links ?? [])
        .map((l) => engine.resolve(l))
        .filter((h): h is { id: string; label: string } => !!h);
      if (linked.length) engine.activate(linked.map((h) => ({ ...h, thought: "" })));
      if (!ev.key) return;
      const hit = engine.resolve(ev.key);
      const anchorId = hit?.id ?? ev.key; // miss → a ghost forms under this id
      const isGhost = !hit || ghostsRef.current.nodes.some((n) => n.id === hit.id);
      // burst rule: everything lights, only the first anchor per ~3s window
      // takes the camera and subtitle
      const first = Date.now() - lastSpotRef.current > 3000;
      if (first) lastSpotRef.current = Date.now();
      if (hit && !isGhost) lastRealSpotRef.current = hit.id;
      const thought =
        ev.verb === "research"
          ? "checking this candidate…"
          : ev.verb === "write"
            ? isGhost
              ? "writing a new page…"
              : "updating this page…"
            : "reading the wiki page…";
      engine.activate([{ id: anchorId, label: hit?.label ?? ev.key, thought }], {
        spotlight: first,
      });
      // ghost creation + connections are buffered; the 500ms flush applies them
      if (!hit || linked.length) {
        pendingOpsRef.current.push({
          newGhost: hit ? undefined : ev.key,
          birthAnchor: hit ? undefined : lastRealSpotRef.current ?? undefined,
          anchor: anchorId,
          connect: linked.map((h) => h.id),
        });
      }
    });
    // resolve/activate are identity-stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {data.nodes.length > 0 && (
        <div className="absolute left-3 top-3 z-10 flex gap-1 rounded-md border border-card-border bg-card/80 p-1 text-xs backdrop-blur-sm">
          {(["2d", "3d"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`rounded px-2 py-0.5 ${
                mode === m ? "bg-glow/15 text-glow" : "text-muted hover:text-foreground"
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}
          {liveLabel && (
            <span className="flex items-center gap-1.5 px-2 text-muted">
              <span className="animate-pulse text-glow">●</span> {liveLabel}
            </span>
          )}
        </div>
      )}
      {data.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-muted text-sm">
          The taste graph is empty — talk movies and watch it grow.
        </div>
      ) : mode === "3d" ? (
        <Graph3D
          fgRef={engine.fgRef}
          width={size.width}
          height={size.height}
          graphData={liveData}
          backgroundColor="#0c0a08"
          showNavInfo={false}
          enableNodeDrag={false}
          nodeLabel={(n) => (n as unknown as GraphNode).label}
          onNodeClick={(node) => {
            const n = node as unknown as GraphNode;
            setSelected((cur) => (cur?.id === n.id ? null : n));
          }}
          onBackgroundClick={() => setSelected(null)}
          {...engine.graphProps}
        />
      ) : (
        <ForceGraph2D
          width={size.width}
          height={size.height}
          graphData={liveData}
          backgroundColor="#0c0a08"
          autoPauseRedraw={false}
          d3AlphaDecay={0.05}
          d3VelocityDecay={0.5}
          linkColor={engine.graphProps.linkColor}
          linkWidth={engine.graphProps.linkWidth}
          onNodeClick={(node) => {
            const n = node as unknown as GraphNode;
            setSelected((cur) => (cur?.id === n.id ? null : n));
          }}
          onBackgroundClick={() => setSelected(null)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as unknown as GraphNode & { x: number; y: number };
            // the canvas repaints at 60fps, so reading heat through refs makes
            // the 2D view exactly as live as the 3D one
            const h = engine.heatRef.current.get(n.id) ?? 0;
            const color = h > 0.05 ? heatColor(nodeColor(n), h) : nodeColor(n);
            const r =
              (n.kind === "genre" ? 7 : n.kind === "taste" || n.kind === "ghost" ? 3.5 : 5) +
              h * 4;
            const dimmed = neighborIds ? !neighborIds.has(n.id) : false;
            ctx.save();
            if (dimmed) ctx.globalAlpha = 0.15;
            else if (h <= 0.05) {
              if (liveHeatRef.current) ctx.globalAlpha = 0.35;
              else if (Date.now() - lastEventAtRef.current < 6000)
                ctx.globalAlpha = 0.42 + 0.12 * Math.sin(Date.now() / 250);
            }
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
            ctx.fill();
            if (selected?.id === n.id) {
              ctx.shadowBlur = 0;
              ctx.strokeStyle = "#f5b942";
              ctx.lineWidth = 1.5 / globalScale;
              ctx.beginPath();
              ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI);
              ctx.stroke();
            }
            if (globalScale > 0.8 || (!dimmed && neighborIds) || h > 0.5) {
              ctx.shadowBlur = 0;
              ctx.font = `${11 / globalScale}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = "#e8dcc8cc";
              ctx.fillText(n.label, n.x, n.y + r + 2);
            }
            ctx.restore();
          }}
        />
      )}
      <SpotCard spot={engine.spot} />
      {selected && (
        <div className="absolute right-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-80 max-w-[85%] overflow-y-auto rounded-lg border border-card-border bg-card/95 backdrop-blur-sm">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-2 rounded-t-lg bg-card/95 p-4 pb-2 backdrop-blur-sm">
            <div className="text-sm font-medium text-glow">
              {typeof wiki === "object" && wiki ? wiki.title : selected.label}
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-muted hover:text-foreground"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="break-words px-4 pb-4 text-sm">
            {wiki === "loading" && <div className="text-muted">Loading…</div>}
            {wiki === "missing" && (
              <div className="text-muted">No wiki page for this node.</div>
            )}
            {typeof wiki === "object" && wiki && <Markdown text={wiki.content} />}
          </div>
        </div>
      )}
    </div>
  );
}
