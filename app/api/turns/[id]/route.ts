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

  let closeStream = () => {};
  const stream = new ReadableStream({
    cancel() {
      closeStream();
    },
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          close();
        }
      };
      function close() {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {}
      }
      closeStream = close;
      const event = (ev: object, seq: number) => send(`id: ${seq}\ndata: ${JSON.stringify(ev)}\n\n`);

      // replay what the client missed, then go live
      const { events, live } = found;
      const backlog = events.slice(after);
      backlog.forEach((ev, i) => event(ev, after + i));
      let next = after + backlog.length;

      let unsubscribe = () => {};
      // eslint-disable-next-line prefer-const
      let beat: ReturnType<typeof setInterval> | undefined;
      // heartbeat: keeps proxies (Tailscale serve) from idling the stream out,
      // and lets the client's stall watchdog tell "quiet" from "dead"
      function cleanup() {
        if (beat) clearInterval(beat);
        unsubscribe();
      }
      beat = setInterval(() => send(`: hb\n\n`), 15000);
      req.signal.addEventListener("abort", close);

      if (!live) {
        // a finished turn whose tail the client already has — or, after a
        // crash, a disk log shorter than what the client saw: always end
        // with "done" so the client never waits on a turn that is over
        if (!backlog.some((ev) => ev.type === "done")) event({ type: "done" }, Math.max(after, events.length));
        return close();
      }
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
