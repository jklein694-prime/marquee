import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildGraph, cachedGraph } from "@/lib/vault";
import { GET } from "@/app/api/graph/route";

const page = (rel: string, body: string) => {
  const f = path.join(process.env.VAULT_PATH!, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
};

describe("graph cache", () => {
  it("rebuilds exactly when a page changes, and matches a fresh build", async () => {
    page("wiki/movies/genres/Neo-noir.md", "---\ntitle: Neo-noir\n---\n");
    page("wiki/movies/Heat (1995).md", '---\ntitle: "Heat (1995)"\nverdict: loved\ngenres: ["[[Neo-noir]]"]\n---\n');
    const a = cachedGraph();
    expect(cachedGraph().graph).toBe(a.graph); // memoized
    expect(a.graph).toEqual(buildGraph());
    await new Promise((r) => setTimeout(r, 20));
    page("wiki/movies/Thief (1981).md", '---\ntitle: "Thief (1981)"\nverdict: liked\ngenres: ["[[Neo-noir]]"]\n---\n');
    const b = cachedGraph();
    expect(b.sig).not.toBe(a.sig);
    expect(b.graph.nodes.map((n) => n.id)).toContain("Thief (1981)");
    expect(b.graph).toEqual(buildGraph());
  });

  it("answers 304 for an unchanged graph", async () => {
    const first = await GET(new Request("http://x/api/graph"));
    const etag = first.headers.get("etag")!;
    expect(first.status).toBe(200);
    const again = await GET(new Request("http://x/api/graph", { headers: { "if-none-match": etag } }));
    expect(again.status).toBe(304);
  });
});
