import { NextRequest, NextResponse } from "next/server";
import { readWikiPage } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const page = readWikiPage(id);
  if (!page) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(page);
}
