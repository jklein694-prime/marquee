import { NextResponse } from "next/server";
import { detachTurn } from "@/lib/turns";

export const dynamic = "force-dynamic";

// The app went to the background (sendBeacon on visibilitychange) — or came
// back. A turn that finishes while detached sends a push notification.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let detached = true;
  try {
    const body = await req.json();
    if (body && body.detached === false) detached = false;
  } catch {}
  return NextResponse.json({ ok: detachTurn(id, detached) });
}
