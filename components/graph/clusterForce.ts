"use client";

// d3 force shared by the 2D and 3D layouts: members drift toward their
// cluster's running centroid, and centroids shoulder each other apart so
// clusters read as separate bodies. Pinned nodes (fx set) are left alone, so
// the frozen constellation holds while ghosts stream in. Works in 2 or 3
// dimensions (z/vz simply absent in 2D).
import type { GraphNode } from "@/lib/vault";

type Pos = GraphNode & {
  x?: number; y?: number; z?: number;
  vx?: number; vy?: number; vz?: number;
  fx?: number;
};
interface Cent { x: number; y: number; z: number; n: number }

export function clusterForce(pull = 0.1, separate = 0.6) {
  let nodes: Pos[] = [];
  const cents = new Map<number, Cent>();
  const force = (alpha: number) => {
    cents.clear();
    for (const n of nodes) {
      if (n.cluster === undefined || n.cluster < 0 || n.x === undefined) continue;
      const c = cents.get(n.cluster) ?? { x: 0, y: 0, z: 0, n: 0 };
      c.x += n.x; c.y += n.y ?? 0; c.z += n.z ?? 0; c.n++;
      cents.set(n.cluster, c);
    }
    for (const c of cents.values()) { c.x /= c.n; c.y /= c.n; c.z /= c.n; }
    // pairwise centroid separation, applied to members as a shove
    const shove = new Map<number, { x: number; y: number; z: number }>();
    const ids = [...cents.keys()];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = cents.get(ids[i])!;
        const b = cents.get(ids[j])!;
        const want = 22 * (Math.sqrt(a.n) + Math.sqrt(b.n)); // breathing room scales with size
        const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        if (d >= want) continue;
        const k = ((want - d) / d) * separate * alpha;
        const sa = shove.get(ids[i]) ?? { x: 0, y: 0, z: 0 };
        const sb = shove.get(ids[j]) ?? { x: 0, y: 0, z: 0 };
        sa.x += dx * k; sa.y += dy * k; sa.z += dz * k;
        sb.x -= dx * k; sb.y -= dy * k; sb.z -= dz * k;
        shove.set(ids[i], sa);
        shove.set(ids[j], sb);
      }
    for (const n of nodes) {
      if (n.cluster === undefined || n.cluster < 0 || n.x === undefined || n.fx !== undefined) continue;
      const c = cents.get(n.cluster)!;
      if (c.n < 2) continue;
      const k = pull * alpha;
      const s = shove.get(n.cluster);
      n.vx = (n.vx ?? 0) + (c.x - n.x) * k + (s?.x ?? 0);
      n.vy = (n.vy ?? 0) + (c.y - (n.y ?? 0)) * k + (s?.y ?? 0);
      if (n.z !== undefined) n.vz = (n.vz ?? 0) + (c.z - n.z) * k + (s?.z ?? 0);
    }
  };
  force.initialize = (ns: Pos[]) => { nodes = ns; };
  return force;
}

// live centroid + spread per cluster, for fields and labels
export function clusterCentroids(nodes: GraphNode[]) {
  const out = new Map<number, { x: number; y: number; z: number; n: number; spread: number }>();
  for (const n of nodes as Pos[]) {
    if (n.cluster === undefined || n.cluster < 0 || n.x === undefined) continue;
    const c = out.get(n.cluster) ?? { x: 0, y: 0, z: 0, n: 0, spread: 0 };
    c.x += n.x; c.y += n.y ?? 0; c.z += n.z ?? 0; c.n++;
    out.set(n.cluster, c);
  }
  for (const c of out.values()) { c.x /= c.n; c.y /= c.n; c.z /= c.n; }
  for (const n of nodes as Pos[]) {
    const c = n.cluster !== undefined ? out.get(n.cluster) : undefined;
    if (!c || n.x === undefined) continue;
    c.spread += (n.x - c.x) ** 2 + ((n.y ?? 0) - c.y) ** 2 + ((n.z ?? 0) - c.z) ** 2;
  }
  for (const c of out.values()) c.spread = Math.sqrt(c.spread / c.n); // RMS radius
  return out;
}

// Install the cluster layout on a force-graph instance (2D or 3D): the
// centroid force above, plus link forces that bind within a cluster and go
// slack across one — that slack is what lets clusters pull apart into
// separate bodies instead of one interlinked blob.
interface LinkForce {
  strength(fn: (l: LinkEnds, i: number, links: LinkEnds[]) => number): LinkForce;
  distance(fn: (l: LinkEnds) => number): LinkForce;
}
type LinkEnds = { source: string | Pos; target: string | Pos };
interface ForceHost {
  d3Force(name: string): unknown;
  d3Force(name: string, force: unknown): unknown;
}
const clusterOfEnd = (e: string | Pos) => (typeof e === "object" ? e.cluster : undefined);
const idOfEnd = (e: string | Pos) => (typeof e === "object" ? e.id : e);
const sameCluster = (l: LinkEnds) => {
  const a = clusterOfEnd(l.source);
  return a !== undefined && a >= 0 && a === clusterOfEnd(l.target);
};

export function installClusterLayout(fg: ForceHost) {
  fg.d3Force("cluster", clusterForce());
  const link = fg.d3Force("link") as LinkForce | undefined;
  if (!link) return;
  // d3's default strength is 1/min(degree) — recreate it from the links
  // array d3 hands us, then slacken cross-cluster edges
  let cached: { links: LinkEnds[]; deg: Map<string, number> } | null = null;
  const degrees = (links: LinkEnds[]) => {
    if (cached?.links === links) return cached.deg;
    const deg = new Map<string, number>();
    for (const l of links)
      for (const id of [idOfEnd(l.source), idOfEnd(l.target)]) deg.set(id, (deg.get(id) ?? 0) + 1);
    cached = { links, deg };
    return deg;
  };
  link.strength((l, _i, links) => {
    const deg = degrees(links);
    const base = 1 / Math.max(1, Math.min(deg.get(idOfEnd(l.source)) ?? 1, deg.get(idOfEnd(l.target)) ?? 1));
    return sameCluster(l) ? base : base * 0.15;
  });
  link.distance((l) => (sameCluster(l) ? 30 : 70));
}

export function removeClusterLayout(fg: ForceHost) {
  fg.d3Force("cluster", null);
}
