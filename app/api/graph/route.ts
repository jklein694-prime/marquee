import { NextResponse } from "next/server";
import { cachedGraph } from "@/lib/vault";

export const dynamic = "force-dynamic";

// The graph only changes when vault files do: serve the memoized build, and a
// 304 when the client already has this version.
export async function GET(req: Request) {
  const { sig, graph } = cachedGraph();
  const etag = `"${sig}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return NextResponse.json(graph, { headers: { ETag: etag, "Cache-Control": "no-cache" } });
}
