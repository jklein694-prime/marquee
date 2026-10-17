// Design tokens for code that paints outside the DOM (the 2D canvas, the
// three.js graph, the PWA manifest). app/globals.css is the source of truth;
// this reads the custom properties once per page load. The fallback table is
// only for environments with no document (SSR of a client component's first
// pass, tests) and mirrors the CSS so a missing token never paints black.

const FALLBACK: Record<string, string> = {
  "--surface-0": "#0c0a08",
  "--surface-1": "#14110e",
  "--fg": "#e8dcc8",
  "--muted": "#a89d90",
  "--accent": "#f5b942",
  "--verdict-loved": "#f5b942",
  "--verdict-liked": "#d19a4a",
  "--verdict-meh": "#8a8178",
  "--verdict-disliked": "#c0452f",
  "--node-unrated": "#5a5048",
  "--node-category": "#7fa3b8",
  "--node-taste": "#e8dcc8",
  "--node-watchlist": "#f5b94266",
  "--node-ghost": "#e8dcc855",
  "--edge": "#2a221a",
  "--edge-ghost": "#e8dcc840",
  "--edge-active": "#f5b942",
};

/** The page background, for server-rendered metadata (theme-color, manifest). */
export const PAGE_BACKGROUND = FALLBACK["--surface-0"];

let cache: Record<string, string> | null = null;

/** Read one token ("--accent") as the browser resolved it. */
export function token(name: string): string {
  if (cache?.[name]) return cache[name];
  let value = "";
  if (typeof document !== "undefined") {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache ??= {};
    if (value) cache[name] = value;
  }
  return value || FALLBACK[name] || "#ff00ff";
}

export interface GraphPalette {
  background: string;
  label: string;
  accent: string;
  loved: string;
  liked: string;
  meh: string;
  disliked: string;
  unrated: string;
  category: string;
  taste: string;
  watchlist: string;
  ghost: string;
  edge: string;
  edgeGhost: string;
  edgeActive: string;
}

let palette: GraphPalette | null = null;

/** Every color the taste graph paints with, resolved once. */
export function graphPalette(): GraphPalette {
  if (palette) return palette;
  const p: GraphPalette = {
    background: token("--surface-0"),
    label: token("--fg"),
    accent: token("--accent"),
    loved: token("--verdict-loved"),
    liked: token("--verdict-liked"),
    meh: token("--verdict-meh"),
    disliked: token("--verdict-disliked"),
    unrated: token("--node-unrated"),
    category: token("--node-category"),
    taste: token("--node-taste"),
    watchlist: token("--node-watchlist"),
    ghost: token("--node-ghost"),
    edge: token("--edge"),
    edgeGhost: token("--edge-ghost"),
    edgeActive: token("--edge-active"),
  };
  // only memoize a real DOM read; the fallback stays re-readable
  if (typeof document !== "undefined") palette = p;
  return p;
}
