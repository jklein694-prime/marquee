"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ForceGraphMethods as FG2D } from "react-force-graph-2d";
import type { GraphCluster, GraphNode, GraphLink } from "@/lib/vault";
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
import {
  CLUSTER_LABEL_MAX_PX,
  LABEL_COLOR,
  NODE_LABEL_MAX_PX,
  clusterColor,
  clusterLinkColor,
  fitLabel,
  uiFont,
} from "./graph/labels";
import { clusterCentroids } from "./graph/clusterForce";
import { onThinking, type ThinkingEvent } from "@/lib/liveThinking";

const Graph2D = dynamic(() => import("./Graph2D"), { ssr: false });
const Graph3D = dynamic(() => import("./Graph3D"), { ssr: false });

type GraphData = { nodes: GraphNode[]; links: GraphLink[]; clusters: GraphCluster[] };
const EMPTY_GRAPH: GraphData = { nodes: [], links: [], clusters: [] };
type XY = GraphNode & { x: number; y: number };

// base draw radius; the 2D canvas adds a heat bump on top of this
function nodeRadius(n: GraphNode): number {
  return n.kind === "genre" ? 7 : n.kind === "taste" || n.kind === "ghost" ? 3.5 : 5;
}

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
  cluster?: number; // the anchor's cluster — the ghost forms inside it, not at the origin
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
      nodes.push({
        id: op.newGhost,
        label: op.newGhost,
        kind: "ghost",
        cluster: op.cluster,
        bornAt: now,
      } as GraphNode);
      changed = true;
      if (op.birthAnchor) addEdge(op.newGhost, op.birthAnchor);
    }
    for (const t of op.connect) addEdge(op.anchor, t);
  }
  return changed ? { nodes, links } : g;
}

// --- 2D label placement: greedy, priority-ordered, no overlaps ---------------
interface LabelCandidate {
  x: number; // canvas coords (pre-scale)
  y: number;
  r: number; // node radius the label sits under
  text: string;
  priority: number;
  color: string;
  weight: number;
}
interface Rect { x0: number; y0: number; x1: number; y1: number }
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function GraphView({
  version,
  mode,
  onModeChange,
}: {
  version: number;
  mode: "2d" | "3d";
  onModeChange: (m: "2d" | "3d") => void;
}) {
  const [data, setData] = useState<GraphData>(EMPTY_GRAPH);
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
  const [legendOpen, setLegendOpen] = useState(false);
  const [clusterFilter, setClusterFilter] = useState<number | null>(null);
  const fg2dRef = useRef<FG2D | undefined>(undefined);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // turn end: refetch and clear ghosts in ONE render — candidates that became
  // real pages reappear as permanent nodes, the rest dissolve
  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((d: Partial<GraphData>) => {
        pendingOpsRef.current = [];
        lastRealSpotRef.current = null;
        setGhosts(EMPTY_GHOSTS);
        setData({ nodes: d.nodes ?? [], links: d.links ?? [], clusters: d.clusters ?? [] });
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
  const clusterById = useMemo(() => new Map(data.clusters.map((c) => [c.id, c])), [data]);

  // merged view the graphs + engine consume; identity changes only when a
  // flush lands (load-bearing: per-render churn would keep the d3 sim boiling)
  const liveData = useMemo(
    () =>
      ghosts.nodes.length || ghosts.links.length
        ? { nodes: [...data.nodes, ...ghosts.nodes], links: [...data.links, ...ghosts.links] }
        : data,
    [data, ghosts]
  );
  const degree = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of liveData.links) {
      for (const id of [endId(l.source), endId(l.target)]) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [liveData]);

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

  // focus = what stays bright while the rest dims: a selection with its
  // neighbors, else a cluster picked from the legend
  const focusIds = useMemo(() => {
    if (selected) {
      const ids = new Set([selected.id]);
      for (const l of data.links) {
        const s = endId(l.source);
        const t = endId(l.target);
        if (s === selected.id) ids.add(t);
        if (t === selected.id) ids.add(s);
      }
      return ids;
    }
    if (clusterFilter !== null)
      return new Set(data.nodes.filter((n) => n.cluster === clusterFilter).map((n) => n.id));
    return null;
  }, [selected, clusterFilter, data]);
  const focusRef = useRef(focusIds);
  focusRef.current = focusIds;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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
      if (focusIds)
        return focusIds.has(n.id) ? nodeColor(n) : withAlpha(nodeColor(n), 0.12);
      if (liveHeatRef.current) return withAlpha(nodeColor(n), 0.3);
      // stream active, nothing hot yet — the whole graph breathes ("indexing")
      if (Date.now() - lastEventAtRef.current < 6000)
        return withAlpha(nodeColor(n), 0.38 + 0.12 * Math.sin(Date.now() / 250));
      return nodeColor(n);
    },
    coldLink: (l) => {
      const gl = l as unknown as GraphLink;
      if ((l as { ghost?: boolean }).ghost) return "rgba(232,220,200,0.25)";
      if (linkActive(gl)) return "#f5b942";
      if (focusIds) {
        const inFocus = focusIds.has(endId(gl.source)) && focusIds.has(endId(gl.target));
        return inFocus ? clusterLinkColor(gl, 0.6) : "rgba(42,34,26,0.3)";
      }
      return clusterLinkColor(gl);
    },
    // 3D: cold edges are 1px GL lines (width 0), tubes only when hot/active —
    // cleaner and far cheaper than a tube per edge. 2D needs a real width.
    coldLinkWidth: (l) =>
      linkActive(l as unknown as GraphLink) ? 1.6 : modeRef.current === "3d" ? 0 : 1,
    hotLinkWidth: (hp) => (modeRef.current === "3d" ? 0.3 + 0.7 * hp : 1 + 2 * hp),
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
  // tab is open — purely observational, dropped when unmounted
  const [liveLabel, setLiveLabel] = useState("");
  const liveTimerRef = useRef(0);
  const lastSpotRef = useRef(0);
  useEffect(() => {
    const clusterOf = (id: string | null | undefined) => {
      if (!id) return undefined;
      return (
        dataRef.current.nodes.find((n) => n.id === id)?.cluster ??
        ghostsRef.current.nodes.find((n) => n.id === id)?.cluster
      );
    };
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
          cluster: hit ? undefined : clusterOf(lastRealSpotRef.current) ?? clusterOf(linked[0]?.id),
          anchor: anchorId,
          connect: linked.map((h) => h.id),
        });
      }
    });
    // resolve/activate are identity-stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2D camera follow: glide to each new spotlight unless the user panned
  // recently — "watching the graph" gets the live feel without a fight
  const userPanAtRef = useRef(0);
  const programmaticUntilRef = useRef(0);
  useEffect(() => {
    if (mode !== "2d" || !engine.spot) return;
    const fg = fg2dRef.current;
    const n = liveData.nodes.find((x) => x.id === engine.spot!.id) as XY | undefined;
    if (!fg || !n || n.x === undefined) return;
    if (Date.now() - userPanAtRef.current < 4000) return;
    programmaticUntilRef.current = Date.now() + 1000;
    fg.centerAt(n.x, n.y, 800);
    // liveData identity is the sim's data; the spot id is what matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.spot?.id, mode]);

  // --- 2D paint state (per frame, via refs: the canvas repaints at 60fps) ---
  const labelsRef = useRef<LabelCandidate[]>([]);
  const centroidsRef = useRef(clusterCentroids([]));
  const fontRef = useRef<string | null>(null);
  const font = () => (fontRef.current ??= uiFont());

  const isDimmed = (id: string) => {
    const f = focusRef.current;
    return f ? !f.has(id) : false;
  };

  const renderPre = (ctx: CanvasRenderingContext2D, scale: number) => {
    labelsRef.current = [];
    const cents = clusterCentroids(liveData.nodes);
    centroidsRef.current = cents;
    // soft fields under each cluster — regions, not outlines
    const f = focusRef.current;
    for (const [id, c] of cents) {
      if (c.n < 3) continue;
      const r = Math.max(40, c.spread * 1.7);
      const dim = f && clusterFilter !== null && clusterFilter !== id;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      const col = clusterColor(id);
      g.addColorStop(0, withAlpha(col, dim ? 0.03 : 0.11));
      g.addColorStop(0.7, withAlpha(col, dim ? 0.012 : 0.045));
      g.addColorStop(1, withAlpha(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    void scale;
  };

  const paintNode = (node: object, ctx: CanvasRenderingContext2D, scale: number) => {
    const n = node as XY;
    // reading heat through refs keeps the 2D view exactly as live as the 3D one
    const h = engine.heatRef.current.get(n.id) ?? 0;
    const base = nodeColor(n);
    const color = h > 0.05 ? heatColor(base, h) : base;
    const r = nodeRadius(n) + h * 4;
    const dimmed = isDimmed(n.id);
    const isSelected = selectedRef.current?.id === n.id;
    // 8-digit hex (watchlist, ghost) carries its own translucency
    let alpha = base.length === 9 ? parseInt(base.slice(7, 9), 16) / 255 : 1;
    if (dimmed) alpha = 0.15;
    else if (h <= 0.05) {
      if (liveHeatRef.current) alpha = 0.35;
      else if (Date.now() - lastEventAtRef.current < 6000)
        alpha = 0.42 + 0.12 * Math.sin(Date.now() / 250);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    // glow = two soft rings instead of shadowBlur (which costs a full-canvas blur per node)
    const [cr, cg, cb] = rgbOf(color);
    const halo = h > 0.05 ? 0.18 + 0.3 * h : n.kind === "genre" ? 0.1 : 0.07;
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${halo})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r * (1.7 + h), 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${halo * 1.5})`;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r * 1.25, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fill();
    if (n.kind === "ghost") {
      // forming: a dashed outline reads "not real yet"
      ctx.strokeStyle = "rgba(232,220,200,0.6)";
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([2 / scale, 2 / scale]);
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 1.5 / scale, 0, 2 * Math.PI);
      ctx.stroke();
    }
    if (isSelected) {
      ctx.setLineDash([]);
      ctx.strokeStyle = "#f5b942";
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 3 / scale, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
    // label candidates: zoomed in, or emphasized (selected / focused / hot)
    const focused = !dimmed && !!focusRef.current;
    const nodeLabelAlpha = clamp01((scale - 0.7) / 0.4);
    if (nodeLabelAlpha > 0 || focused || isSelected || h > 0.5) {
      labelsRef.current.push({
        x: n.x,
        y: n.y,
        r,
        text: n.label,
        priority: isSelected ? 1000 : h > 0.5 ? 500 + h : focused ? 200 + (degree.get(n.id) ?? 0) : (degree.get(n.id) ?? 0) + (n.kind === "genre" ? 50 : 0),
        color: isSelected ? "#f5b942" : dimmed ? withAlpha(LABEL_COLOR, 0.25) : n.kind === "ghost" ? "#a89d90" : LABEL_COLOR,
        weight: isSelected || n.kind === "genre" ? 600 : 400,
      });
    }
  };

  const renderPost = (ctx: CanvasRenderingContext2D, scale: number) => {
    const fam = font();
    const nodeLabelAlpha = clamp01((scale - 0.7) / 0.4);
    const clusterLabelAlpha = clamp01((1.15 - scale) / 0.45);
    const placed: Rect[] = [];
    ctx.save();
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    // cluster words first: they own the zoomed-out view and win placement
    if (clusterLabelAlpha > 0) {
      const px = 14 / scale;
      ctx.font = `600 ${px}px ${fam}`;
      ctx.textBaseline = "middle";
      for (const [id, c] of centroidsRef.current) {
        if (c.n < 3) continue;
        const label = clusterById.get(id)?.label;
        if (!label) continue;
        const text = fitLabel(label, CLUSTER_LABEL_MAX_PX / scale, ctx);
        const w = ctx.measureText(text).width;
        const rect = { x0: c.x - w / 2 - 4 / scale, y0: c.y - px * 0.7, x1: c.x + w / 2 + 4 / scale, y1: c.y + px * 0.7 };
        if (placed.some((p) => overlaps(p, rect))) continue;
        placed.push(rect);
        const dim = clusterFilter !== null && clusterFilter !== id;
        ctx.globalAlpha = clusterLabelAlpha * (dim ? 0.3 : 0.95);
        ctx.strokeStyle = "rgba(12,10,8,0.85)";
        ctx.lineWidth = 4 / scale;
        ctx.strokeText(text, c.x, c.y);
        ctx.fillStyle = clusterColor(id);
        ctx.fillText(text, c.x, c.y);
      }
    }
    // node labels: priority order, each placed only where nothing sits yet
    const cands = labelsRef.current.sort((a, b) => b.priority - a.priority).slice(0, 160);
    ctx.textBaseline = "top";
    const px = 11 / scale;
    for (const c of cands) {
      const emphasized = c.priority >= 200;
      const a = emphasized ? Math.max(0.9, nodeLabelAlpha) : nodeLabelAlpha;
      if (a <= 0.02) continue;
      ctx.font = `${c.weight} ${px}px ${fam}`;
      const text = fitLabel(c.text, NODE_LABEL_MAX_PX / scale, ctx);
      const w = ctx.measureText(text).width;
      const y = c.y + c.r + 2.5 / scale;
      const rect = { x0: c.x - w / 2 - 2 / scale, y0: y - 1 / scale, x1: c.x + w / 2 + 2 / scale, y1: y + px * 1.25 };
      if (placed.some((p) => overlaps(p, rect))) continue;
      placed.push(rect);
      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(12,10,8,0.8)";
      ctx.lineWidth = 3 / scale;
      ctx.strokeText(text, c.x, y);
      ctx.fillStyle = c.color;
      ctx.fillText(text, c.x, y);
    }
    ctx.restore();
  };

  const selectedCluster =
    selected?.cluster !== undefined && selected.cluster >= 0 ? clusterById.get(selected.cluster) : undefined;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {data.nodes.length > 0 && (
        <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
          <div className="flex gap-1 rounded-md border border-card-border bg-card/80 p-1 text-xs backdrop-blur-sm">
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
            {data.clusters.length > 0 && (
              <button
                onClick={() => setLegendOpen((o) => !o)}
                className={`rounded px-2 py-0.5 ${
                  legendOpen || clusterFilter !== null
                    ? "bg-glow/15 text-glow"
                    : "text-muted hover:text-foreground"
                }`}
                title="Clusters"
                aria-pressed={legendOpen}
              >
                Clusters
              </button>
            )}
            {liveLabel && (
              <span className="flex items-center gap-1.5 px-2 text-muted">
                <span className="animate-pulse text-glow">●</span> {liveLabel}
              </span>
            )}
          </div>
          {legendOpen && data.clusters.length > 0 && (
            <div className="max-h-[60vh] w-56 overflow-y-auto rounded-md border border-card-border bg-card/85 p-1.5 text-xs backdrop-blur-sm">
              {data.clusters.map((c) => {
                const active = clusterFilter === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setClusterFilter((cur) => (cur === c.id ? null : c.id))}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
                      active ? "bg-glow/10 text-foreground" : "text-muted hover:text-foreground"
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: clusterColor(c.id) }}
                    />
                    <span className="truncate">{c.label}</span>
                    <span className="ml-auto tabular-nums opacity-60">{c.size}</span>
                  </button>
                );
              })}
              {clusterFilter !== null && (
                <button
                  onClick={() => setClusterFilter(null)}
                  className="mt-1 w-full rounded px-2 py-1 text-left text-muted hover:text-foreground"
                >
                  Show all
                </button>
              )}
            </div>
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
          clusters={data.clusters}
          heatRef={engine.heatRef}
          focusIds={focusIds}
          selectedId={selected?.id ?? null}
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
        <Graph2D
          fgRef={fg2dRef}
          width={size.width}
          height={size.height}
          graphData={liveData}
          backgroundColor="#0c0a08"
          autoPauseRedraw={false}
          d3AlphaDecay={0.05}
          d3VelocityDecay={0.5}
          onZoom={() => {
            if (Date.now() > programmaticUntilRef.current) userPanAtRef.current = Date.now();
          }}
          // pad each node's clickable area beyond its drawn radius so taps land on
          // touch screens (drawn radii are only 3.5–7px); also helps mouse aim
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as unknown as XY;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, nodeRadius(n) + 6, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkColor={engine.graphProps.linkColor}
          linkWidth={engine.graphProps.linkWidth}
          linkDirectionalParticleWidth={engine.graphProps.linkDirectionalParticleWidth}
          linkDirectionalParticleColor={engine.graphProps.linkDirectionalParticleColor}
          linkDirectionalParticleSpeed={engine.graphProps.linkDirectionalParticleSpeed}
          onNodeClick={(node) => {
            const n = node as unknown as GraphNode;
            setSelected((cur) => (cur?.id === n.id ? null : n));
          }}
          onBackgroundClick={() => setSelected(null)}
          onRenderFramePre={renderPre}
          nodeCanvasObject={paintNode}
          onRenderFramePost={renderPost}
        />
      )}
      <SpotCard spot={engine.spot} />
      {selected && (
        <div className="absolute right-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-80 max-w-[85%] overflow-y-auto rounded-lg border border-card-border bg-card/95 backdrop-blur-sm">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-2 rounded-t-lg bg-card/95 p-4 pb-2 backdrop-blur-sm">
            <div>
              <div className="text-sm font-medium text-glow">
                {typeof wiki === "object" && wiki ? wiki.title : selected.label}
              </div>
              {selectedCluster && (
                <button
                  onClick={() => {
                    setSelected(null);
                    setClusterFilter(selectedCluster.id);
                  }}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-card-border px-2 py-0.5 text-[11px] text-muted hover:text-foreground"
                  title="Show this cluster"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: clusterColor(selectedCluster.id) }}
                  />
                  {selectedCluster.label}
                  <span className="opacity-60">· {selectedCluster.size}</span>
                </button>
              )}
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
            {wiki === "missing" &&
              // taste nodes are synthesized from a hub bullet, so the bullet is
              // the content — reporting it "missing" read like a broken page
              (selected.text ? (
                <Markdown text={selected.text} />
              ) : (
                <div className="text-muted">
                  Not written up yet — this title is linked from other pages but
                  has no page of its own.
                </div>
              ))}
            {typeof wiki === "object" && wiki && <Markdown text={wiki.content} />}
          </div>
        </div>
      )}
    </div>
  );
}

// "#rrggbb" or "rgb(a)(r,g,b[,a])" → [r,g,b]
function rgbOf(c: string): number[] {
  if (c.startsWith("#"))
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const m = c.match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : [232, 220, 200];
}
