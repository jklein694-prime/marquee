import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { HUB, WIKILINK, wikilinks } from "./vault";
import { details, searchMulti, Media } from "./tmdb";

export interface WatchItem {
  title: string;
  year?: number;
  media: Media;
  tmdbId?: number;
  poster_path?: string | null;
  streaming?: string[];
  trailer?: string;
  genres?: string[];
  note?: string;
  verifiedAt?: number;
}

const FILE = path.join(process.cwd(), "data/watchlist.json");

export function readUserList(): WatchItem[] {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}

export function writeUserList(items: WatchItem[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}

// the hub's "## Watchlist" section is the agent-managed suggestion list
export function hubSuggestions(): WatchItem[] {
  if (!fs.existsSync(HUB)) return [];
  const { content } = matter(fs.readFileSync(HUB, "utf8"));
  const section = content
    .split(/^## /m)
    .find((s) => s.split("\n", 1)[0].toLowerCase().startsWith("watchlist"));
  if (!section) return [];
  const items: WatchItem[] = [];
  for (const line of section.split("\n")) {
    if (!/^\s*-\s+\S/.test(line) || line.includes("(empty")) continue;
    const bullet = line.replace(/^\s*-\s+/, "").trim();
    const title = wikilinks(bullet)[0] ?? bullet.split(" — ")[0].trim();
    if (!title) continue;
    const clean = bullet.replace(WIKILINK, "$1");
    const note = clean.startsWith(title)
      ? clean.slice(title.length).replace(/^\s*[—–-]\s*/, "")
      : clean;
    items.push({ title, media: "movie", note });
  }
  return items;
}

// ponytail: 24h TTL, re-verification piggybacks on the next GET rather than a
// real scheduler — good enough for a single-user local app; add a cron/queue
// if this ever needs to run without the tab open
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

function titleOf(name: string, year?: number): string {
  return year ? `${name} (${year})` : name;
}

// resolves a title to the right TMDB entry: search matches movies and tv
// together and are relevance-ranked, not identity-ranked, so an unrelated
// title can outrank the real one (e.g. a "Silo" query surfacing a same-year
// movie that isn't Silo at all) — exact title match first, then prefer the
// exact release year, then fall back to whichever is most popular
async function resolve(name: string, year?: number): Promise<Partial<WatchItem> | null> {
  const hits = await searchMulti(name);
  const exact = hits.filter((h) => h.title.toLowerCase() === name.toLowerCase());
  const pool = exact.length ? exact : hits;
  if (!pool.length) return null;
  const hit =
    (year && pool.find((h) => h.year === String(year))) ||
    [...pool].sort((a, b) => b.popularity - a.popularity)[0];
  const d = await details(hit.id, hit.media);
  return {
    media: hit.media,
    year: d.year ? Number(d.year) : undefined,
    tmdbId: d.id,
    poster_path: d.poster_path,
    streaming: d.streaming,
    trailer: d.trailer,
    genres: d.genres,
  };
}

export async function enrich(item: WatchItem): Promise<WatchItem> {
  try {
    // known id — just refresh volatile fields (streaming/trailer change; the
    // title/media identity doesn't), no search ambiguity to worry about
    if (item.tmdbId) {
      const d = await details(item.tmdbId, item.media);
      return {
        ...item,
        poster_path: d.poster_path,
        streaming: d.streaming,
        trailer: d.trailer,
        genres: d.genres,
        verifiedAt: Date.now(),
      };
    }
    const m = item.title.match(/^(.*?)\s*\((\d{4})\)\s*$/);
    const name = m ? m[1] : item.title;
    const year = item.year ?? (m ? Number(m[2]) : undefined);
    const found = await resolve(name, year);
    return found
      ? { ...item, ...found, verifiedAt: Date.now() }
      : { ...item, verifiedAt: Date.now() };
  } catch {
    return item; // TMDB down — render bare, try again next load (no verifiedAt stamp)
  }
}

// re-enriches anything never verified or older than the TTL; returns the
// possibly-updated list plus whether anything changed (caller persists then)
export async function refreshStale(
  items: WatchItem[]
): Promise<{ items: WatchItem[]; changed: boolean }> {
  let changed = false;
  const next = await Promise.all(
    items.map(async (item) => {
      if (item.verifiedAt && Date.now() - item.verifiedAt < VERIFY_TTL_MS) return item;
      changed = true;
      return enrich(item);
    })
  );
  return { items: next, changed };
}
