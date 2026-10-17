import { describe, expect, it } from "vitest";
import { assignClusters, UNCLUSTERED } from "@/lib/clusters";
import type { GraphLink, GraphNode } from "@/lib/vault";

const movie = (id: string): GraphNode => ({ id, label: id, kind: "movie", verdict: "loved" });
const genre = (id: string): GraphNode => ({ id, label: id, kind: "genre" });
const link = (source: string, target: string): GraphLink => ({ source, target });

// two dense neighborhoods around a category hub each, one bridge between them
function twoTowns() {
  const nodes: GraphNode[] = [genre("Neo-noir"), genre("Space Opera")];
  const links: GraphLink[] = [];
  for (let i = 0; i < 6; i++) {
    nodes.push(movie(`noir ${i}`), movie(`space ${i}`));
    links.push(link(`noir ${i}`, "Neo-noir"), link(`space ${i}`, "Space Opera"));
    if (i) links.push(link(`noir ${i}`, `noir ${i - 1}`), link(`space ${i}`, `space ${i - 1}`));
  }
  links.push(link("noir 0", "space 0")); // the bridge
  return { nodes, links };
}

describe("assignClusters", () => {
  it("splits two towns joined by a bridge, named after their category hub", () => {
    const { nodes, links } = twoTowns();
    const { nodes: out, clusters } = assignClusters(nodes, links);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.label).sort()).toEqual(["Neo-noir", "Space Opera"]);
    const by = new Map(out.map((n) => [n.id, n.cluster]));
    const noir = by.get("Neo-noir");
    for (let i = 0; i < 6; i++) {
      expect(by.get(`noir ${i}`)).toBe(noir);
      expect(by.get(`space ${i}`)).not.toBe(noir);
    }
    expect(clusters.find((c) => c.label === "Neo-noir")!.size).toBe(7);
    expect(clusters.find((c) => c.label === "Neo-noir")!.top[0]).toBe("Neo-noir");
  });

  it("is deterministic and numbers clusters largest-first", () => {
    const { nodes, links } = twoTowns();
    nodes.push(movie("noir extra"));
    links.push(link("noir extra", "Neo-noir"), link("noir extra", "noir 3"));
    const a = assignClusters(nodes, links);
    const b = assignClusters([...nodes].reverse(), links);
    expect(a.nodes.map((n) => [n.id, n.cluster])).toEqual(
      [...b.nodes].reverse().map((n) => [n.id, n.cluster])
    );
    expect(a.clusters[0].size).toBeGreaterThan(a.clusters[1].size);
    expect(a.clusters.map((c) => c.id)).toEqual([0, 1]);
  });

  it("leaves isolated nodes unclustered and folds tiny communities", () => {
    const { nodes, links } = twoTowns();
    nodes.push(movie("loner"), movie("pair a"), movie("pair b"));
    links.push(link("pair a", "pair b"), link("pair b", "noir 5")); // a 2-node appendix
    const { nodes: out, clusters } = assignClusters(nodes, links);
    const by = new Map(out.map((n) => [n.id, n.cluster]));
    expect(by.get("loner")).toBe(UNCLUSTERED);
    expect(clusters).toHaveLength(2);
    expect(by.get("pair a")).toBe(by.get("noir 5"));
  });

  it("caps the number of clusters", () => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    for (let t = 0; t < 20; t++) {
      nodes.push(genre(`hub ${t}`));
      for (let i = 0; i < 4; i++) {
        nodes.push(movie(`m ${t}.${i}`));
        links.push(link(`m ${t}.${i}`, `hub ${t}`));
      }
      if (t) links.push(link(`hub ${t}`, `hub ${t - 1}`)); // chain of towns
    }
    const { clusters } = assignClusters(nodes, links, { maxClusters: 6 });
    expect(clusters.length).toBeLessThanOrEqual(6);
    expect(clusters.reduce((s, c) => s + c.size, 0)).toBe(nodes.length);
  });

  it("handles an empty graph", () => {
    expect(assignClusters([], [])).toEqual({ nodes: [], clusters: [] });
  });
});
