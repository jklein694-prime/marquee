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
  overview?: string;
  predicted?: string; // Louie's projected score from the hub bullet, e.g. "8-9" or "9"
  verifiedAt?: number;
}

const FILE = path.join(process.cwd(), "data/watchlist.json");
const SNOOZE_FILE = path.join(process.cwd(), "data/snoozed.json");
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

// snoozed suggestions: lowercased title → expiry epoch-ms; expired entries are
// pruned on read so a snooze quietly lapses and the suggestion resurfaces
function readSnoozes(): Record<string, number> {
  if (!fs.existsSync(SNOOZE_FILE)) return {};
  try {
    const all = JSON.parse(fs.readFileSync(SNOOZE_FILE, "utf8")) as Record<string, number>;
    const now = Date.now();
    const live = Object.fromEntries(Object.entries(all).filter(([, t]) => t > now));
    if (Object.keys(live).length !== Object.keys(all).length)
      fs.writeFileSync(SNOOZE_FILE, JSON.stringify(live, null, 2));
    return live;
  } catch {
    return {};
  }
}

// lowercased titles currently snoozed — the chat pipeline uses this to keep
// "not now" picks out of recommendations, not just out of the watchlist tab
export function activeSnoozes(): string[] {
  return Object.keys(readSnoozes());
}

export interface VetoItem {
  title: string;
  note?: string;
}

// the hub's "## Not interested" section: permanent per-title vetoes ("spoiled
// for me", "never suggest this") — unlike snoozes these never lapse
export function notInterestedItems(): VetoItem[] {
  if (!fs.existsSync(HUB)) return [];
  const { content } = matter(fs.readFileSync(HUB, "utf8"));
  const section = content
    .split(/^## /m)
    .find((s) => s.split("\n", 1)[0].toLowerCase().startsWith("not interested"));
  if (!section) return [];
  const items: VetoItem[] = [];
  for (const line of section.split("\n")) {
    if (!/^\s*-\s+\S/.test(line) || line.includes("(empty")) continue;
    const bullet = line.replace(/^\s*-\s+/, "").trim();
    const title = wikilinks(bullet)[0] ?? bullet.split(" — ")[0].trim();
    if (!title) continue;
    const clean = bullet.replace(WIKILINK, "$1");
    const note = clean.startsWith(title)
      ? clean.slice(title.length).replace(/^\s*[—–-]\s*/, "")
      : clean;
    items.push({ title, note });
  }
  return items;
}

export function notInterested(): string[] {
  return notInterestedItems().map((i) => i.title);
}

export function snoozeTitle(title: string) {
  const snoozes = readSnoozes();
  snoozes[title.toLowerCase()] = Date.now() + SNOOZE_MS;
  fs.mkdirSync(path.dirname(SNOOZE_FILE), { recursive: true });
  fs.writeFileSync(SNOOZE_FILE, JSON.stringify(snoozes, null, 2));
}

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
  const snoozed = readSnoozes();
  const items: WatchItem[] = [];
  // bold "**Tier N — predicted 8-9**" headers set a running prediction that each
  // following bullet inherits; an inline "predicted X" in a bullet overrides it
  const PRED = /predicted\s+(\d+(?:-\d+)?)/i;
  let tierPredicted: string | undefined;
  for (const line of section.split("\n")) {
    const header = line.match(/^\s*\*\*.*?\*\*\s*$/) ? line.match(PRED) : null;
    if (header) {
      tierPredicted = header[1];
      continue;
    }
    if (!/^\s*-\s+\S/.test(line) || line.includes("(empty")) continue;
    const bullet = line.replace(/^\s*-\s+/, "").trim();
    const title = wikilinks(bullet)[0] ?? bullet.split(" — ")[0].trim();
    if (!title || snoozed[title.toLowerCase()]) continue;
    const clean = bullet.replace(WIKILINK, "$1");
    const note = clean.startsWith(title)
      ? clean.slice(title.length).replace(/^\s*[—–-]\s*/, "")
      : clean;
    const predicted = bullet.match(PRED)?.[1] ?? tierPredicted;
    items.push({ title, media: "movie", note, predicted });
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
    overview: d.overview,
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
        overview: d.overview,
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

// ponytail: per-process memo — hub suggestions are re-parsed from markdown on
// every GET with no stored verifiedAt, so enrich() fired one TMDB call per
// suggestion per request. A restart just re-warms the cache.
const suggestionCache = new Map<string, { item: WatchItem; at: number }>();

export async function enrichCached(item: WatchItem): Promise<WatchItem> {
  const key = item.title.toLowerCase();
  const hit = suggestionCache.get(key);
  if (hit && Date.now() - hit.at < VERIFY_TTL_MS)
    return { ...hit.item, note: item.note, predicted: item.predicted }; // note + predicted come fresh from the hub
  const out = await enrich(item);
  if (out.verifiedAt) suggestionCache.set(key, { item: out, at: Date.now() });
  return out;
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
