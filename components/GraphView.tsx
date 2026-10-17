"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphNode, GraphLink } from "@/lib/vault";
import type { ForceGraphMethods as Graph2DMethods } from "react-force-graph-2d";
import { Markdown } from "./Markdown";
import { useHeatEngine, SpotCard, nodeColor, endId, withAlpha, norm, heatColor, pinNodes } from "./useHeatEngine";
import { onThinking, type ThinkingEvent } from "@/lib/liveThinking";
import { graphPalette } from "@/lib/theme";
import { useGraph, type GraphData } from "@/lib/graphClient";
import { Chip, IconButton, Sheet } from "./ui";
import { InfoIcon } from "./icons";

const Graph2D = dynamic(() => import("./Graph2D"), { ssr: false });
const Graph3D = dynamic(() => import("./Graph3D"), { ssr: false });

// base draw radius; the 2D canvas adds a heat bump on top of this
function nodeRadius(n: GraphNode): number {
  return n.kind === "genre" ? 7 : n.kind === "taste" || n.kind === "ghost" ? 3.5 : 5;
}

// --- glow sprites -----------------------------------------------------------
// ctx.shadowBlur on every node every frame was the single most expensive
// thing the 2D canvas did (a blur pass per node per repaint). A radial
// gradient rendered once per palette color and drawn with drawImage costs
// one texture blit. Hot nodes glow in the accent color so the cache stays
// bounded by the palette instead of growing with every lerp step.
const SPRITE = 64;
const sprites = new Map<string, HTMLCanvasElement>();
function glowSprite(hex: string): HTMLCanvasElement {
  let c = sprites.get(hex);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = SPRITE;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
  grad.addColorStop(0, withAlpha(hex, 0.5));
  grad.addColorStop(0.45, withAlpha(hex, 0.14));
  grad.addColorStop(1, withAlpha(hex, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE, SPRITE);
  sprites.set(hex, c);
  return c;
}

type WikiPage = { title: string; content: string };
// keyed by the node it was fetched for: a selection whose page has not landed
// yet is "loading" by derivation, with no state write inside an effect
type WikiState = { forId: string; page: WikiPage | "missing" };

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
function growGhosts(g: GhostSet, ops: GhostOp[], realIds: Set<string>, realEdges: Set<string>, now: number): GhostSet {
  let changed = false;
  let nodes = g.nodes.slice() as (GraphNode & { bornAt?: number })[];
  let links = g.links.slice();
  const drop = (dead: Set<string>) => {
    nodes = nodes.filter((n) => !dead.has(n.id));
    links = links.filter((l) => !dead.has(endId(l.source)) && !dead.has(endId(l.target)));
    changed = true;
  };
  const stale = new Set(nodes.filter((n) => (n.bornAt ?? now) < now - GHOST_TTL).map((n) => n.id));
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

function GraphView({
  version,
  mode,
  onModeChange,
  active = true,
}: {
  version: number;
  mode: "2d" | "3d";
  onModeChange: (m: "2d" | "3d") => void;
  /** false while the panel is mounted but hidden: no fetches, no render loop */
  active?: boolean;
}) {
  // one shared copy of the graph; a turn end (version bump) refetches once
  // for every panel that draws it, and stale data stays up until it lands
  const data = useGraph(version, active);
  // ghosts belong to the data they were grown on: a refetch makes candidates
  // that became real pages reappear as permanent nodes and the rest dissolve,
  // in the same render, by derivation rather than an effect
  const [ghostState, setGhostState] = useState<{ for: GraphData; ghosts: GhostSet }>({ for: data, ghosts: EMPTY_GHOSTS });
  const ghosts = ghostState.for === data ? ghostState.ghosts : EMPTY_GHOSTS;
  const ghostsRef = useRef(ghosts);
  useEffect(() => {
    ghostsRef.current = ghosts;
  }, [ghosts]);
  const pendingOpsRef = useRef<GhostOp[]>([]);
  const lastRealSpotRef = useRef<string | null>(null);
  const lastEventAtRef = useRef(0); // any stream activity → the graph breathes
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [wiki, setWiki] = useState<WikiState | null>(null);
  const fg2dRef = useRef<Graph2DMethods | undefined>(undefined);

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
  const dataRef = useRef(data);
  useEffect(() => {
    realRef.current = { realIds, realEdges };
    dataRef.current = data;
  }, [realIds, realEdges, data]);

  // merged view the graphs + engine consume; identity changes only when a
  // flush lands (load-bearing: per-render churn would keep the d3 sim boiling)
  const liveData = useMemo(
    () =>
      ghosts.nodes.length || ghosts.links.length
        ? { nodes: [...data.nodes, ...ghosts.nodes], links: [...data.links, ...ghosts.links] }
        : data,
    [data, ghosts]
  );

  // ignore the 0x0 readings while the panel is hidden (display: none)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 2D: frame the whole constellation once the layout settles for a given
  // data set (and again when the canvas changes size); a user's own zoom is
  // never overridden mid-session
  const fittedForRef = useRef<GraphData | null>(null);
  const fit2d = useCallback(() => fg2dRef.current?.zoomToFit(400, 28), []);
  const onEngineStop = useCallback(() => {
    if (fittedForRef.current === dataRef.current) return;
    fittedForRef.current = dataRef.current;
    fit2d();
  }, [fit2d]);
  useEffect(() => {
    if (mode === "2d" && fittedForRef.current === data) fit2d();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(() => {
    if (!selected) return;
    let stale = false;
    const forId = selected.id;
    fetch(`/api/wiki?id=${encodeURIComponent(forId)}`)
      .then((r) => (r.ok ? r.json() : "missing"))
      .then((page: WikiPage | "missing") => !stale && setWiki({ forId, page }))
      .catch(() => !stale && setWiki({ forId, page: "missing" }));
    return () => {
      stale = true;
    };
  }, [selected]);
  // the page for the current selection, "loading" until it lands
  const wikiPage: WikiPage | "missing" | "loading" | null = !selected
    ? null
    : wiki?.forId === selected.id
      ? wiki.page
      : "loading";

  // desktop: a click anywhere outside the graph closes the detail card.
  // pointerdown, not mousedown — iOS never synthesizes mouse events on plain
  // elements. On phones the Sheet's own backdrop handles closing.
  useEffect(() => {
    if (!selected) return;
    function handleOutside(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setSelected(null);
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [selected]);
  const [legendOpen, setLegendOpen] = useState(false);
  const closeSelected = useCallback(() => setSelected(null), []);

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

  const linkActive = (l: GraphLink) => !!selected && (endId(l.source) === selected.id || endId(l.target) === selected.id);

  // heat overrides toward glow; the cold rest keeps selection dim/highlight,
  // and recedes while a live show is running so the hot nodes read clearly.
  // "live heat" is read from the engine inside the paint callbacks (they run
  // at draw time, not render time).
  const engine = useHeatEngine(liveData, {
    spotTtlMs: 8000,
    // shimmer needs render ticks while the stream is active but nothing is hot
    tickWhenIdle: () => Date.now() - lastEventAtRef.current < 6000,
    coldNode: (n) => {
      if (neighborIds) return neighborIds.has(n.id) ? nodeColor(n) : withAlpha(nodeColor(n), 0.12);
      if (engine.heatRef.current.size > 0) return withAlpha(nodeColor(n), 0.3);
      // stream active, nothing hot yet — the whole graph breathes ("indexing")
      if (Date.now() - lastEventAtRef.current < 6000) return withAlpha(nodeColor(n), 0.38 + 0.12 * Math.sin(Date.now() / 250));
      return nodeColor(n);
    },
    coldLink: (l) =>
      (l as { ghost?: boolean }).ghost
        ? graphPalette().edgeGhost
        : linkActive(l as unknown as GraphLink)
          ? graphPalette().edgeActive
          : graphPalette().edge,
    coldLinkWidth: (l) => (linkActive(l as unknown as GraphLink) ? 2 : 1),
  });

  // flush buffered ghost ops ≤2×/s: one sim re-heat per flush, not per event;
  // pinning first means only the NEW nodes move — the constellation holds still
  useEffect(() => {
    let lastData = dataRef.current;
    const iv = window.setInterval(() => {
      const now = Date.now();
      if (dataRef.current !== lastData) {
        // a refetch landed: ops buffered against the old graph are void
        lastData = dataRef.current;
        pendingOpsRef.current = [];
        lastRealSpotRef.current = null;
      }
      const hasStale = ghostsRef.current.nodes.some(
        (n) => ((n as GraphNode & { bornAt?: number }).bornAt ?? now) < now - GHOST_TTL
      );
      if (!pendingOpsRef.current.length && !hasStale) return;
      const ops = pendingOpsRef.current.splice(0);
      const { realIds, realEdges } = realRef.current;
      const base = dataRef.current;
      pinNodes(base.nodes);
      setGhostState((s) => {
        const cur = s.for === base ? s.ghosts : EMPTY_GHOSTS;
        const next = growGhosts(cur, ops, realIds, realEdges, now);
        return next === cur && s.for === base ? s : { for: base, ghosts: next };
      });
    }, 500);
    return () => window.clearInterval(iv);
  }, []);

  // live show: Louie's chat/silent-turn activity lights the graph while this
  // tab is open — purely observational, dropped when unmounted
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
      const linked = (ev.links ?? []).map((l) => engine.resolve(l)).filter((h): h is { id: string; label: string } => !!h);
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
      engine.activate([{ id: anchorId, label: hit?.label ?? ev.key, thought }], { spotlight: first });
      // ghost creation + connections are buffered; the 500ms flush applies them
      if (!hit || linked.length) {
        pendingOpsRef.current.push({
          newGhost: hit ? undefined : ev.key,
          birthAnchor: hit ? undefined : (lastRealSpotRef.current ?? undefined),
          anchor: anchorId,
          connect: linked.map((h) => h.id),
        });
      }
    });
    // resolve/activate are identity-stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickNode = (node: object) => {
    const n = node as unknown as GraphNode;
    setSelected((cur) => (cur?.id === n.id ? null : n));
  };

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {data.nodes.length > 0 && (
        <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border bg-surface-1/90 p-1 backdrop-blur-sm md:left-3 md:top-3">
          {(["2d", "3d"] as const).map((m) => (
            <Chip key={m} selected={mode === m} onClick={() => onModeChange(m)} className="px-3">
              {m.toUpperCase()}
            </Chip>
          ))}
          <IconButton label="Legend" aria-expanded={legendOpen} onClick={() => setLegendOpen((v) => !v)}>
            <InfoIcon />
          </IconButton>
          {liveLabel && (
            <span className="hidden items-center gap-1.5 px-2 text-xs text-muted sm:flex">
              <span className="animate-pulse text-accent">●</span> {liveLabel}
            </span>
          )}
        </div>
      )}
      {legendOpen && (
        <div className="absolute left-2 top-16 z-10 w-56 rounded-lg border border-border bg-surface-1/95 p-3 text-sm backdrop-blur-sm md:left-3 md:text-xs">
          <div className="mb-1.5 font-medium text-fg">What the colors mean</div>
          {(
            [
              ["loved", "loved"],
              ["liked", "liked"],
              ["meh", "meh"],
              ["disliked", "disliked"],
              ["unrated", "seen, no verdict yet"],
              ["category", "genre, person, theme…"],
              ["watchlist", "on your watchlist"],
              ["taste", "a taste note"],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="flex items-center gap-2 py-0.5 text-muted">
              <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: graphPalette()[k] }} />
              {label}
            </div>
          ))}
          <div className="mt-1.5 text-muted">Pinch or scroll to zoom — labels appear as you get closer.</div>
          {liveLabel && (
            <div className="mt-1.5 flex items-center gap-1.5 text-muted sm:hidden">
              <span className="animate-pulse text-accent">●</span> {liveLabel}
            </div>
          )}
        </div>
      )}
      {data.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted">
          The taste graph is empty — talk movies and watch it grow.
        </div>
      ) : mode === "3d" ? (
        <Graph3D
          fgRef={engine.fgRef}
          paused={!active}
          width={size.width}
          height={size.height}
          graphData={liveData}
          backgroundColor={graphPalette().background}
          showNavInfo={false}
          enableNodeDrag={false}
          nodeLabel={(n) => (n as unknown as GraphNode).label}
          onNodeClick={pickNode}
          onBackgroundClick={() => setSelected(null)}
          {...engine.graphProps}
        />
      ) : (
        <Graph2D
          fgRef={fg2dRef}
          paused={!active}
          width={size.width}
          height={size.height}
          graphData={liveData}
          backgroundColor={graphPalette().background}
          d3AlphaDecay={0.05}
          d3VelocityDecay={0.5}
          onEngineStop={onEngineStop}
          // pad each node's clickable area beyond its drawn radius so taps land on
          // touch screens (drawn radii are only 3.5–7px); also helps mouse aim
          nodePointerAreaPaint={(node, color, ctx) => {
            const n = node as unknown as GraphNode & { x: number; y: number };
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, nodeRadius(n) + 8, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkColor={engine.graphProps.linkColor}
          linkWidth={engine.graphProps.linkWidth}
          onNodeClick={pickNode}
          onBackgroundClick={() => setSelected(null)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as unknown as GraphNode & { x: number; y: number };
            // heat is read through refs at paint time, so the 2D view is
            // exactly as live as the 3D one whenever a repaint happens
            const h = engine.heatRef.current.get(n.id) ?? 0;
            const base = nodeColor(n);
            const color = h > 0.05 ? heatColor(base, h) : base;
            const r = nodeRadius(n) + h * 4;
            const dimmed = neighborIds ? !neighborIds.has(n.id) : false;
            ctx.save();
            if (dimmed) ctx.globalAlpha = 0.15;
            else if (h <= 0.05) {
              if (engine.heatRef.current.size > 0) ctx.globalAlpha = 0.35;
              else if (Date.now() - lastEventAtRef.current < 6000) ctx.globalAlpha = 0.42 + 0.12 * Math.sin(Date.now() / 250);
            }
            // glow: one cached sprite per palette color (accent when hot)
            const gr = r * 2.4;
            ctx.drawImage(glowSprite(h > 0.05 ? graphPalette().accent : base), n.x - gr, n.y - gr, gr * 2, gr * 2);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
            ctx.fill();
            if (selected?.id === n.id) {
              ctx.strokeStyle = graphPalette().edgeActive;
              ctx.lineWidth = 1.5 / globalScale;
              ctx.beginPath();
              ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI);
              ctx.stroke();
            }
            // labels only where they can be read: a node at least ~6 screen px
            // across (categories first as you zoom in, then titles, then
            // notes), plus anything selected, neighbouring, or hot. Zoomed
            // out on a phone that means a clean constellation, not label soup.
            const screenR = r * globalScale;
            const show = (neighborIds && !dimmed) || h > 0.5 || selected?.id === n.id || screenR >= 6;
            if (show) {
              ctx.font = `${11 / globalScale}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = withAlpha(graphPalette().label, 0.8);
              ctx.fillText(n.label, n.x, n.y + r + 2);
            }
            ctx.restore();
          }}
        />
      )}
      <SpotCard spot={engine.spot} />
      <Sheet
        open={!!selected}
        onClose={closeSelected}
        title={selected ? (typeof wikiPage === "object" && wikiPage ? wikiPage.title : selected.label) : ""}
      >
        {selected && (
          <div className="break-words pb-2">
            {wikiPage === "loading" && <div className="text-muted">Loading…</div>}
            {wikiPage === "missing" &&
              // taste nodes are synthesized from a hub bullet, so the bullet is
              // the content — reporting it "missing" read like a broken page
              (selected.text ? (
                <Markdown text={selected.text} />
              ) : (
                <div className="text-muted">Not written up yet — this title is linked from other pages but has no page of its own.</div>
              ))}
            {typeof wikiPage === "object" && wikiPage && <Markdown text={wikiPage.content} />}
          </div>
        )}
      </Sheet>
    </div>
  );
}

export default memo(GraphView);
