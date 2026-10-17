import { NextResponse } from "next/server";
import { startChatTurn } from "@/lib/turns";

export const dynamic = "force-dynamic";

// Start a chat turn in the background and return its id right away; the
// client follows it with GET /api/turns/<id> and can drop and resume that
// stream at will — the turn itself keeps running on the server.
// a client retrying a POST whose response it never saw must not start a
// second turn: remember clientId -> turnId for a while
const g = globalThis as unknown as { __marqueeClientIds?: Map<string, { turnId: string; at: number }> };
const seen = (g.__marqueeClientIds ??= new Map());

export async function POST(req: Request) {
  const { message, sessionId, silent, clientId } = (await req.json()) as {
    message?: string;
    sessionId?: string;
    silent?: boolean;
    clientId?: string;
  };
  if (!message?.trim()) return NextResponse.json({ error: "message required" }, { status: 400 });
  const now = Date.now();
  for (const [k, v] of seen) if (now - v.at > 10 * 60 * 1000) seen.delete(k);
  const prior = clientId ? seen.get(clientId) : undefined;
  if (prior) return NextResponse.json({ turnId: prior.turnId });
  const turn = startChatTurn({ message, sessionId: sessionId || undefined, silent });
  if (clientId) seen.set(clientId, { turnId: turn.id, at: now });
  return NextResponse.json({ turnId: turn.id });
}
