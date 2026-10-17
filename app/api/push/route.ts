import { NextResponse } from "next/server";
import type { PushSubscription } from "web-push";
import { addSubscription, notifyAll, removeSubscription, vapidKeys } from "@/lib/push";

export const dynamic = "force-dynamic";

// GET: the VAPID public key the browser subscribes with (generated on the
// server at first use, so nothing has to be baked in at build time)
export async function GET() {
  return NextResponse.json({ publicKey: vapidKeys().publicKey });
}

// POST {subscription}: remember this device. POST {test: true}: send a test.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { subscription?: PushSubscription; test?: boolean };
  if (body.test) {
    const sent = await notifyAll({ title: "Marquee", body: "Notifications are on.", tag: "marquee-test" });
    return NextResponse.json({ sent });
  }
  try {
    addSubscription(body.subscription as PushSubscription);
  } catch {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (endpoint) removeSubscription(endpoint);
  return NextResponse.json({ ok: true });
}
