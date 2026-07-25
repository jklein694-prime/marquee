// Client-side pub/sub for Louie's live activity: page.tsx maps chat trace
// events (both lanes, main + subagents) into ThinkingEvents; GraphView's 3D
// mode subscribes while mounted. Purely observational — the agent never
// knows this exists. Events stay flat key-value pairs by design.

import { wikilinks } from "./wikilink";

export interface ThinkingEvent {
  key?: string; // wiki page basename (no .md), or "Title (Year)" for TMDB searches
  verb: "read" | "write" | "scan" | "dispatch" | "research";
  sub: boolean;
  links?: string[]; // [[wikilink]] names seen in the tool-input detail
}

type Cb = (ev: ThinkingEvent) => void;
const subs = new Set<Cb>();

export function onThinking(cb: Cb): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function emitThinking(ev: ThinkingEvent) {
  for (const cb of subs) cb(ev);
}

const FILE_PATH = /"file_path"\s*:\s*"([^"]+)"/;
const TMDB_QUERY = /"query"\s*:\s*"([^"]+)"/;
const TMDB_YEAR = /"year"\s*:\s*(\d{4})/;
// wiki pages that are real files but NOT graph nodes — their events stay
// keyless (pill + shimmer + any wikilinks they carry), never ghosts
const META_PAGES = new Set(["Movies", "Movies-archive", "Taste Profile", "log"]);

// trace detail is JSON.stringify(tool input) truncated at 220 chars — parse
// defensively: JSON.parse when intact, regex when cut mid-object. Wikilink
// extraction is truncation-safe by construction: the regex needs a closing ]],
// so a link cut mid-name simply doesn't match.
export function traceToThinking(t: {
  kind: string;
  label: string;
  detail?: string;
  sub?: boolean;
}): ThinkingEvent | null {
  if (t.kind !== "tool") return null;
  const sub = !!t.sub;
  if (t.label === "Read" || t.label === "Edit" || t.label === "Write") {
    let path: string | undefined;
    try {
      path = (JSON.parse(t.detail ?? "") as { file_path?: string }).file_path;
    } catch {
      path = t.detail?.match(FILE_PATH)?.[1];
    }
    // the agent runs with the vault as cwd, so paths are usually RELATIVE
    // ("wiki/entities/Movies.md") — match wiki/ at start or after any slash
    if (!path || !/(^|\/)wiki\//.test(path) || !path.endsWith(".md")) return null;
    const key = path.slice(path.lastIndexOf("/") + 1, -3);
    const verb = t.label === "Read" ? ("read" as const) : ("write" as const);
    if (key.startsWith("_")) return { verb: "scan", sub }; // index sweep
    const links = wikilinks(t.detail ?? "")
      .filter((l) => !l.startsWith("_") && l !== key)
      .slice(0, 8);
    // hub / taste profile / archive: keyless, but their wikilinks still light
    // (a hub watchlist bullet's [[Category]] links are real graph signal)
    if (META_PAGES.has(key))
      return links.length ? { verb, sub, links } : { verb, sub };
    return links.length ? { key, verb, sub, links } : { key, verb, sub };
  }
  if (t.label === "mcp__tmdb__search_movie") {
    let q: string | undefined;
    let y: number | undefined;
    try {
      const i = JSON.parse(t.detail ?? "") as { query?: string; year?: number };
      q = i.query;
      y = i.year;
    } catch {
      q = t.detail?.match(TMDB_QUERY)?.[1];
      y = Number(t.detail?.match(TMDB_YEAR)?.[1]) || undefined;
    }
    // "Query (Year)" matches vault page naming, so known titles resolve to
    // their real node; unknown candidates miss and materialize as ghosts
    return q ? { key: y ? `${q} (${y})` : q, verb: "research", sub } : { verb: "research", sub };
  }
  if (t.label.startsWith("mcp__tmdb__") || t.label === "WebSearch" || t.label === "WebFetch")
    return { verb: "research", sub }; // no title in the input — status only
  if (t.label === "Grep" || t.label === "Glob") return { verb: "scan", sub };
  if (t.label === "Task") return { verb: "dispatch", sub };
  return null; // Bash, other MCP, ui widgets…
}
