import { NextRequest, NextResponse } from "next/server";
import {
  readUserList,
  writeUserList,
  hubSuggestions,
  enrich,
  refreshStale,
  snoozeTitle,
  WatchItem,
} from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export async function GET() {
  // self-healing: anything never verified or past the TTL gets re-checked
  // against TMDB here, so a bad match (wrong provider, stale trailer) fixes
  // itself the next time the tab loads instead of staying wrong forever
  const { items: user, changed } = await refreshStale(readUserList());
  if (changed) writeUserList(user);
  const have = new Set(user.map((i) => i.title.toLowerCase()));
  const suggestions = await Promise.all(
    hubSuggestions()
      .filter((s) => !have.has(s.title.toLowerCase()))
      .map(enrich)
  );
  return NextResponse.json({ user, suggestions });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const items = readUserList();
  const idx = (title: string) =>
    items.findIndex((i) => i.title.toLowerCase() === String(title).toLowerCase());

  if (body.action === "add") {
    if (!body.title)
      return NextResponse.json({ error: "missing title" }, { status: 400 });
    if (idx(body.title) === -1) {
      const item: WatchItem = await enrich({
        title: body.title,
        year: body.year,
        media: body.media ?? "movie",
        note: body.note,
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
    if (!body.title)
      return NextResponse.json({ error: "missing title" }, { status: 400 });
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
