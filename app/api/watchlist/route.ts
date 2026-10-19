import { NextRequest, NextResponse } from "next/server";
import { sameTitle } from "@/lib/titles";
import {
  readUserList,
  writeUserList,
  hubSuggestions,
  enrich,
  peekSuggestion,
  refreshStale,
  snoozeTitle,
  notInterestedItems,
  tmdbEnabled,
  warmSuggestions,
  WatchItem,
} from "@/lib/watchlist";

export const dynamic = "force-dynamic";

// Stale-while-revalidate: a GET answers from what is on disk and in the memo
// right away, and kicks the TMDB re-verification off in the background. The
// first open after a cold start used to wait on one TMDB round-trip per
// suggestion; now it paints immediately and the client re-reads once the
// `pending` count says the refresh landed.
let userRefresh: Promise<void> | null = null;

export async function GET() {
  const hub = hubSuggestions();
  // a title saved before its save carried Louie's why or score borrows them
  // from the hub bullet of the same title, when there is one
  const stored = readUserList().map((i) => {
    if (i.note && i.predicted) return i;
    const h = hub.find((s) => sameTitle(s.title, i.title));
    return h ? { ...i, note: i.note || h.note, predicted: i.predicted || h.predicted } : i;
  });
  let pending = 0;
  if (tmdbEnabled()) {
    // self-healing: anything never verified or past the TTL gets re-checked
    // against TMDB so a bad match (wrong provider, stale trailer) fixes itself
    const stale = stored.filter((i) => !i.verifiedAt || Date.now() - i.verifiedAt > 24 * 60 * 60 * 1000).length;
    if (stale && !userRefresh) {
      userRefresh = refreshStale(readUserList())
        .then(({ items, changed }) => {
          if (changed) writeUserList(items);
        })
        .catch(() => {})
        .finally(() => {
          userRefresh = null;
        });
    }
    if (userRefresh) pending += stale;
  }
  // rule: nothing on the user's own list is ever suggested back to them. The
  // hub may spell it "Thief" with the year apart, or "Thief (1981)" — match
  // on the loose key, never on the raw string.
  const peeked = hub
    .filter((s) => !stored.some((i) => sameTitle(i.title, s.title)))
    .map(peekSuggestion);
  const suggestions = peeked.map((p) => p.item);
  const cold = peeked.filter((p) => !p.hit).map((p) => p.item);
  if (cold.length && tmdbEnabled()) {
    pending += cold.length;
    warmSuggestions(cold);
  }
  return NextResponse.json({ user: stored, suggestions, notInterested: notInterestedItems(), pending });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const items = readUserList();
  const idx = (title: string) => items.findIndex((i) => sameTitle(i.title, String(title)));

  if (body.action === "add") {
    if (!body.title) return NextResponse.json({ error: "missing title" }, { status: 400 });
    // invariant: every watchlist entry carries Louie's projected score
    if (typeof body.predicted !== "string" || !/^\d+(?:-\d+)?$/.test(body.predicted))
      return NextResponse.json(
        { error: 'missing predicted — every add needs Louie\'s projected score, e.g. "8" or "7-8"' },
        { status: 400 }
      );
    if (idx(body.title) === -1) {
      const item: WatchItem = await enrich({
        title: body.title,
        year: body.year,
        media: body.media ?? "movie",
        note: body.note,
        predicted: body.predicted,
      });
      items.push(item);
      writeUserList(items);
    }
  } else if (body.action === "remove") {
    const i = idx(body.title);
    if (i !== -1) {
      items.splice(i, 1);
      writeUserList(items);
    }
  } else if (body.action === "snooze") {
    if (!body.title) return NextResponse.json({ error: "missing title" }, { status: 400 });
    snoozeTitle(String(body.title));
  } else if (body.action === "move") {
    const i = idx(body.title);
    const to = Math.max(0, Math.min(items.length - 1, Number(body.to)));
    if (i !== -1 && i !== to) {
      const [item] = items.splice(i, 1);
      items.splice(to, 0, item);
      writeUserList(items);
    }
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
