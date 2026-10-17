import { NextRequest, NextResponse } from "next/server";
import { searchMulti } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json([]);
  // a missing key is a setup problem, and the UI should say so rather than
  // render a generic failure as "No results"
  if (!process.env.TMDB_API_KEY)
    return NextResponse.json({ error: "TMDB_API_KEY is not set — add it to .env.local (see README)" }, { status: 503 });
  try {
    return NextResponse.json(await searchMulti(q));
  } catch (err) {
    return NextResponse.json({ error: `TMDB search failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 });
  }
}
