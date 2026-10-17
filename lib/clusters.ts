// Community clusters for the taste graph. Pure and deterministic: the same
// nodes + links always give the same cluster ids, so the client can key
// colors and labels on them across refetches.
//
// Clusters are structural (who shares category pages with whom), never
// positional — layout positions come FROM links, so clustering on them would
// be circular and would flicker every tick. The client then pulls each
// cluster's members toward a shared centroid so the picture honors the math.
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { GraphLink, GraphNode } from "./vault";

export interface GraphCluster {
  id: number;
  label: string; // dominant category page, as written on disk (client truncates to fit)
  size: number;
  top: string[]; // up to 3 highest-degree member ids, for the legend
}

export interface ClusterOpts {
  resolution?: number; // Louvain resolution; higher → more, smaller clusters
  minSize?: number; // smaller communities fold into their best-connected neighbor
  maxClusters?: number; // cap, merging the smallest into neighbors
}

export const UNCLUSTERED = -1;

// mulberry32 — tiny seeded PRNG so Louvain's random node order is repeatable
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Louvain settles into a local optimum that depends on visit order; a
// strictly sequential walk traps bridge nodes in a community of their own.
// Random walks avoid that, so run a few seeded walks and keep the best
// modularity — still fully deterministic.
const SEEDS = [7, 23, 101, 419];
function runLouvain(g: Graph, resolution: number): Map<string, number> {
  if (g.order === 0) return new Map();
  if (g.size === 0) return new Map(g.nodes().map((n, i) => [n, i]));
  let best: { modularity: number; communities: Record<string, number> } | null = null;
  for (const seed of SEEDS) {
    const d = louvain.detailed(g, { resolution, rng: seeded(seed), randomWalk: true });
    if (!best || d.modularity > best.modularity + 1e-9) best = d;
  }
  return new Map(Object.entries(best!.communities));
}

export function assignClusters(
  nodes: GraphNode[],
  links: GraphLink[],
  opts: ClusterOpts = {}
): { nodes: GraphNode[]; clusters: GraphCluster[] } {
  const resolution = opts.resolution ?? 1;
  const minSize = opts.minSize ?? 3;
  const maxClusters = opts.maxClusters ?? 12;

  const g = new Graph({ type: "undirected", multi: false });
  // canonical insertion order → the result can't depend on how the caller
  // happened to order its nodes
  for (const n of [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) g.addNode(n.id);
  for (const l of links) {
    const a = String(l.source);
    const b = String(l.target);
    if (a === b || !g.hasNode(a) || !g.hasNode(b) || g.hasEdge(a, b)) continue;
    g.addEdge(a, b);
  }

  // isolated nodes never cluster — they'd each be a community of one
  const connected = g.filterNodes((n) => g.degree(n) > 0);
  const sub = connected.length === g.order ? g : subgraph(g, connected);
  const community = runLouvain(sub, resolution);

  // refinement: one hub ("Drama") can glue half the graph into one community;
  // split that community on its own and relabel its members
  const sizes = countBy(community);
  const [bigId, bigSize] = largest(sizes);
  if (bigSize > connected.length * 0.5 && bigSize >= minSize * 4) {
    const members = connected.filter((n) => community.get(n) === bigId);
    const inner = runLouvain(subgraph(g, members), resolution);
    if (new Set(inner.values()).size >= 2) {
      let next = Math.max(...sizes.keys()) + 1;
      const remap = new Map<number, number>();
      for (const [n, c] of inner) {
        if (!remap.has(c)) remap.set(c, next++);
        community.set(n, remap.get(c)!);
      }
    }
  }

  // fold tiny communities, then cap the count — both merge a community into
  // the neighbor it shares the most edges with
  const mergeInto = (from: number): boolean => {
    const shared = new Map<number, number>();
    for (const n of community.keys()) {
      if (community.get(n) !== from) continue;
      for (const nb of g.neighbors(n)) {
        const c = community.get(nb);
        if (c !== undefined && c !== from) shared.set(c, (shared.get(c) ?? 0) + 1);
      }
    }
    if (!shared.size) return false;
    const to = [...shared.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
    for (const [n, c] of community) if (c === from) community.set(n, to);
    return true;
  };
  // tiny communities dissolve node by node: each member joins the neighboring
  // community it has the most edges into (a bridge pair splits back to its
  // own sides instead of landing on one as a block). Members with no outside
  // edges wait for a neighbor to move, then follow; a tiny isolated component
  // ends up unclustered.
  const tiny = new Set(
    [...countBy(community).entries()].filter(([, size]) => size < minSize).map(([c]) => c)
  );
  if (tiny.size) {
    const pending = [...community.keys()].filter((n) => tiny.has(community.get(n)!)).sort();
    for (const n of pending) community.delete(n);
    let moved = true;
    while (moved && pending.length) {
      moved = false;
      for (const n of pending.slice()) {
        const votes = new Map<number, number>();
        for (const nb of g.neighbors(n)) {
          const c = community.get(nb);
          if (c !== undefined) votes.set(c, (votes.get(c) ?? 0) + 1);
        }
        if (!votes.size) continue;
        community.set(n, [...votes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]);
        pending.splice(pending.indexOf(n), 1);
        moved = true;
      }
    }
  }
  const stuck = new Set<number>();
  for (;;) {
    const cs = [...countBy(community).entries()]
      .filter(([c]) => !stuck.has(c))
      .sort((x, y) => x[1] - y[1] || x[0] - y[0]);
    if (countBy(community).size <= maxClusters || !cs.length) break;
    if (!mergeInto(cs[0][0])) stuck.add(cs[0][0]);
  }

  // renumber by size (largest first, ties by first member) → stable 0..k-1
  const order = [...countBy(community).entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  const renum = new Map(order.map(([c], i) => [c, i]));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const members = new Map<number, string[]>();
  for (const [n, c] of community) {
    const id = renum.get(c)!;
    members.set(id, [...(members.get(id) ?? []), n]);
  }

  const clusters: GraphCluster[] = [];
  for (const [id, ids] of [...members.entries()].sort((a, b) => a[0] - b[0])) {
    const inside = new Set(ids);
    const within = (n: string) => g.neighbors(n).filter((nb) => inside.has(nb)).length;
    const ranked = ids
      .map((n) => ({ n, d: within(n), cat: byId.get(n)?.kind === "genre" ? 1 : 0 }))
      .sort((a, b) => b.cat - a.cat || b.d - a.d || a.n.localeCompare(b.n));
    const top = [...ranked].sort((a, b) => b.d - a.d || a.n.localeCompare(b.n)).slice(0, 3);
    const namer = ranked[0].cat ? ranked[0].n : top[0].n;
    clusters.push({ id, label: byId.get(namer)?.label ?? namer, size: ids.length, top: top.map((t) => t.n) });
  }

  const out = nodes.map((n) => {
    const c = community.get(n.id);
    return { ...n, cluster: c === undefined ? UNCLUSTERED : renum.get(c)! };
  });
  return { nodes: out, clusters };
}

function subgraph(g: Graph, ids: string[]): Graph {
  const s = new Graph({ type: "undirected", multi: false });
  const keep = new Set(ids);
  for (const n of ids) s.addNode(n);
  g.forEachEdge((_e, _a, a, b) => {
    if (keep.has(a) && keep.has(b) && !s.hasEdge(a, b)) s.addEdge(a, b);
  });
  return s;
}

function countBy(m: Map<string, number>): Map<number, number> {
  const c = new Map<number, number>();
  for (const v of m.values()) c.set(v, (c.get(v) ?? 0) + 1);
  return c;
}

function largest(sizes: Map<number, number>): [number, number] {
  let best: [number, number] = [-1, 0];
  for (const e of sizes) if (e[1] > best[1]) best = e;
  return best;
}
