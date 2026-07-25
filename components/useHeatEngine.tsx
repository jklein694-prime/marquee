"use client";

// Shared 3D taste-graph animation engine: heat map with decay, pulsing
// spotlight node, particle emission along edges, camera gravitation.
// Consumers: PredictPanel (Screen Test — drip-paced considers) and
// GraphView's 3D mode (live chat activity — realtime bursts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ForceGraphMethods,
  LinkObject,
  NodeObject,
} from "react-force-graph-3d";
import type { GraphNode, GraphLink } from "@/lib/vault";

// mirror of lib/agent.ts norm() — that module is server-only (pulls the agent SDK)
export const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const COLORS: Record<string, string> = {
  loved: "#f5b942",
  liked: "#f5b942",
  disliked: "#b3402e",
  meh: "#8a8178",
};
export const KIND_COLORS: Record<string, string> = {
  genre: "#e07b39",
  watchlist: "#f5b94266",
  taste: "#e8dcc8",
  movie: "#8a8178",
  // translucent when cold (nodeOpacity is 1, so color alpha alone reads
  // ghostly); the heat lerp takes a hot ghost to full-opacity glow — "forming"
  ghost: "#e8dcc855",
};

export function nodeColor(n: GraphNode): string {
  if (n.kind === "movie" && n.verdict) return COLORS[n.verdict] ?? "#8a8178";
  return KIND_COLORS[n.kind] ?? "#8a8178";
}

// force-graph replaces link endpoint strings with node objects after layout
export function endId(end: GraphLink["source"]): string {
  return typeof end === "object" ? (end as unknown as GraphNode).id : end;
}

// "#rrggbb" (8-digit alpha suffix ignored) → [r, g, b]
export const rgb = (c: string): number[] => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

export function withAlpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const GLOW = [245, 185, 66]; // #f5b942
const BASE_VAL: Record<string, number> = { genre: 7, taste: 3.5, ghost: 3.5 };

// pin every settled node in place so ghost arrivals can't jiggle the
// constellation — only the new nodes move. A refetch creates fresh (unpinned)
// node objects, so normal layout resumes each turn.
export function pinNodes(nodes: GraphNode[]) {
  for (const n of nodes as (GraphNode & {
    x?: number; y?: number; z?: number; fx?: number; fy?: number; fz?: number;
  })[]) {
    if (n.x !== undefined) {
      n.fx = n.x;
      n.fy = n.y;
      n.fz = n.z;
    }
  }
}

// lerp any base color toward the glow by heat — shared by the 3D accessors
// and GraphView's 2D canvas paint
export function heatColor(base: string, h: number): string {
  const [r, g, b] = rgb(base);
  const t = Math.min(1, h);
  return `rgb(${Math.round(r + (GLOW[0] - r) * t)},${Math.round(
    g + (GLOW[1] - g) * t
  )},${Math.round(b + (GLOW[2] - b) * t)})`;
}

export interface Spot {
  id: string;
  label: string;
  thought: string;
}

interface HeatOpts {
  autoRotate?: boolean;
  // keep ticking (ambient shimmer / re-renders) even with zero heat; a
  // function form lets the caller decide per-tick (e.g. "stream active lately")
  tickWhenIdle?: boolean | (() => boolean);
  // auto-release the spotlight after this long without a new one, so the
  // live show winds down between turns. ponytail: fixed TTL, tune if it lingers
  spotTtlMs?: number;
  // cold styling belongs to the caller (dim / ambient / selection highlight)
  coldNode?: (n: GraphNode) => string;
  coldLink?: (l: LinkObject) => string;
  coldLinkWidth?: (l: LinkObject) => number;
}

export function useHeatEngine(
  graph: { nodes: GraphNode[]; links: GraphLink[] },
  opts: HeatOpts = {}
) {
  const [heatVersion, setHeatVersion] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const heatRef = useRef<Map<string, number>>(new Map());
  const spotIdRef = useRef<string | null>(null);
  const spotAtRef = useRef(0);
  const glideTargetRef = useRef<string | null>(null);
  const lastGlideRef = useRef(0);
  const lastParticleRef = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const byNorm = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) m.set(norm(n.id), n.id);
    return m;
  }, [graph]);
  const adj = useMemo(() => {
    const m = new Map<string, GraphLink[]>();
    for (const l of graph.links) {
      for (const id of [endId(l.source), endId(l.target)]) {
        const arr = m.get(id);
        if (arr) arr.push(l);
        else m.set(id, [l]);
      }
    }
    return m;
  }, [graph]);
  // methods stay identity-stable across renders (safe effect deps) by reading
  // the latest maps through a ref
  const mapsRef = useRef({ nodeById, byNorm, adj });
  mapsRef.current = { nodeById, byNorm, adj };

  const resolve = useCallback((raw: string): { id: string; label: string } | undefined => {
    const { nodeById, byNorm } = mapsRef.current;
    const id = nodeById.has(raw) ? raw : byNorm.get(norm(raw));
    return id ? { id, label: nodeById.get(id)?.label ?? id } : undefined;
  }, []);

  // burst-friendly: every entry lights and sparks at once; only entries[0]
  // takes the spotlight (subtitle + camera), and only when asked
  const activate = useCallback((entries: Spot[], o?: { spotlight?: boolean }) => {
    const fg = fgRef.current;
    for (const e of entries) {
      heatRef.current.set(e.id, 1);
      if (fg)
        for (const l of (mapsRef.current.adj.get(e.id) ?? []).slice(0, 8)) fg.emitParticle(l);
    }
    if (o?.spotlight && entries.length) {
      spotIdRef.current = entries[0].id;
      spotAtRef.current = Date.now();
      setSpot(entries[0]);
    }
  }, []);

  const releaseSpot = useCallback(() => {
    spotIdRef.current = null;
    setSpot(null);
  }, []);

  const clear = useCallback(() => {
    heatRef.current.clear();
    glideTargetRef.current = null;
    spotIdRef.current = null;
    setSpot(null);
  }, []);

  useEffect(() => {
    const iv = window.setInterval(() => {
      const now = Date.now();
      const heat = heatRef.current;
      const fg = fgRef.current;
      const o = optsRef.current;
      if (o.autoRotate) {
        // idempotent — OrbitControls exists once the canvas mounts
        const controls = fg?.controls() as
          | { autoRotate?: boolean; autoRotateSpeed?: number }
          | undefined;
        if (controls) {
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.6;
        }
      }
      // idle: nothing hot, no spotlight, caller doesn't want ambient ticks —
      // skip the version bump so an idle graph doesn't re-render at 10Hz
      const wantIdle =
        typeof o.tickWhenIdle === "function" ? o.tickWhenIdle() : !!o.tickWhenIdle;
      if (!heat.size && !spotIdRef.current && !wantIdle) return;
      // ~3.5s half-life at 10Hz
      for (const [id, h] of heat) {
        const nh = h * 0.98;
        if (nh < 0.02) heat.delete(id);
        else heat.set(id, nh);
      }
      if (o.spotTtlMs && spotIdRef.current && now - spotAtRef.current > o.spotTtlMs) {
        spotIdRef.current = null;
        setSpot(null);
      }
      // the spotlight node stays warm and keeps streaming particles down its
      // edges through long thinking stretches
      if (spotIdRef.current) {
        heat.set(spotIdRef.current, Math.max(heat.get(spotIdRef.current) ?? 0, 0.75));
        if (fg && now - lastParticleRef.current > 700) {
          lastParticleRef.current = now;
          for (const l of (mapsRef.current.adj.get(spotIdRef.current) ?? []).slice(0, 8))
            fg.emitParticle(l);
        }
      }
      // gravitate the camera toward the spotlight (else the hottest node),
      // at most every ~2.8s
      if (now - lastGlideRef.current > 2800) {
        type Pos = GraphNode & { x?: number; y?: number; z?: number };
        const withCoords = (id: string | null): Pos | null => {
          if (!id) return null;
          const n = mapsRef.current.nodeById.get(id) as Pos | undefined;
          return n?.x !== undefined ? n : null; // layout warmup: no coords yet
        };
        let best = withCoords(spotIdRef.current);
        if (!best) {
          let bestHeat = 0.3;
          for (const [id, h] of heat) {
            if (h <= bestHeat) continue;
            const n = withCoords(id);
            if (n) {
              best = n;
              bestHeat = h;
            }
          }
        }
        if (best && best.id !== glideTargetRef.current && fg) {
          lastGlideRef.current = now;
          glideTargetRef.current = best.id;
          const r = Math.hypot(best.x!, best.y!, best.z!) || 1;
          const k = 1 + 220 / r;
          fg.cameraPosition(
            { x: best.x! * k, y: best.y! * k, z: best.z! * k },
            { x: best.x!, y: best.y!, z: best.z! },
            2500
          );
        }
      }
      setHeatVersion((v) => v + 1);
    }, 100);
    return () => window.clearInterval(iv);
  }, []);

  // accessors are recreated every render — the tick's version bump re-renders
  // at 10Hz while hot, so force-graph re-reads styles exactly when heat or
  // caller state (selection, phase) changes
  void heatVersion;
  const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 140);
  const linkHeat = (l: LinkObject) => {
    const gl = l as unknown as GraphLink;
    return Math.max(
      heatRef.current.get(endId(gl.source)) ?? 0,
      heatRef.current.get(endId(gl.target)) ?? 0
    );
  };
  const graphProps = {
    nodeColor: (node: NodeObject) => {
      const n = node as unknown as GraphNode;
      const h = heatRef.current.get(n.id) ?? 0;
      if (h > 0.05) return heatColor(nodeColor(n), h);
      return optsRef.current.coldNode?.(n) ?? nodeColor(n);
    },
    nodeVal: (node: NodeObject) => {
      const n = node as unknown as GraphNode;
      const h = heatRef.current.get(n.id) ?? 0;
      return (BASE_VAL[n.kind] ?? 5) + h * 5 * (h > 0.05 ? pulse : 1);
    },
    // an edge lights when EITHER endpoint is hot — a considered node shows
    // all its connections, not just links between two simultaneously-hot nodes
    linkColor: (l: LinkObject) => {
      const h = Math.min(1, linkHeat(l));
      if (h < 0.15) return optsRef.current.coldLink?.(l) ?? "#2a221a";
      // lerp card-border → glow by heat
      return `rgb(${Math.round(42 + (GLOW[0] - 42) * h)},${Math.round(
        34 + (GLOW[1] - 34) * h
      )},${Math.round(26 + (GLOW[2] - 26) * h)})`;
    },
    linkWidth: (l: LinkObject) =>
      linkHeat(l) > 0.15 ? 1 + 2 * linkHeat(l) * pulse : optsRef.current.coldLinkWidth?.(l) ?? 1,
    linkDirectionalParticleWidth: 1.8,
    linkDirectionalParticleColor: () => "#f5b942",
    linkDirectionalParticleSpeed: 0.02,
  };

  return { fgRef, spot, heatRef, resolve, activate, releaseSpot, clear, graphProps };
}

// bottom-center subtitle: current node + thought; the changing key remounts
// the card so the rise animation replays per thought
export function SpotCard({ spot }: { spot: Spot | null }) {
  if (!spot) return null;
  return (
    <div
      key={spot.id + spot.thought}
      className="pointer-events-none absolute bottom-6 left-0 right-0 z-10 flex justify-center"
    >
      <div className="subtitle-rise max-w-[80%] rounded-lg border border-card-border bg-card/90 px-4 py-2 text-center backdrop-blur-sm">
        <div className="text-sm font-medium text-glow">{spot.label}</div>
        <div className="text-xs text-muted">{spot.thought}</div>
      </div>
    </div>
  );
}
