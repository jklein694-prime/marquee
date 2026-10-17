import { NextResponse } from "next/server";
import { readTurn, stopTurn } from "@/lib/turns";

export const dynamic = "force-dynamic";

// Stream a turn's events as SSE starting after ?after=N (the number of events
// the client already has). Disconnecting only stops this stream, never the
// turn. Each event carries its sequence number as the SSE id.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const after = Math.max(0, Number(new URL(req.url).searchParams.get("after") ?? 0) || 0);
  const found = readTurn(id);
  if (!found) return NextResponse.json({ error: "unknown turn" }, { status: 404 });
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {}
      };
      const event = (ev: object, seq: number) => send(`id: ${seq}\ndata: ${JSON.stringify(ev)}\n\n`);

      // replay what the client missed, then go live
      const { events, live } = found;
      const backlog = events.slice(after);
      backlog.forEach((ev, i) => event(ev, after + i));
      let next = after + backlog.length;

      let unsubscribe = () => {};
      // heartbeat: keeps proxies (Tailscale serve) from idling the stream out,
      // and lets the client's stall watchdog tell "quiet" from "dead"
      const beat = setInterval(() => send(`: hb\n\n`), 15000);
      const cleanup = () => {
        clearInterval(beat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", close);

      if (!live) return close();
      // events emitted between the slice above and subscribing are caught up
      // here; listeners then deliver everything in order
      const listener = (ev: { type: string }, seq: number) => {
        if (seq < next) return;
        next = seq + 1;
        event(ev, seq);
        if (ev.type === "done") close();
      };
      live.listeners.add(listener);
      unsubscribe = () => live.listeners.delete(listener);
      for (; next < live.events.length; ) {
        const seq = next;
        listener(live.events[seq] as { type: string }, seq);
      }
      if (live.done) close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Stop button: the only thing that ends a turn early.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ stopped: stopTurn(id) });
}
