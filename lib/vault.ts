import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { WIKILINK, wikilinks } from "./wikilink";

// Vault location is configurable: set VAULT_PATH in .env.local (install.sh does this).
// Falls back to a ./vault folder in the project so the app still boots with an empty graph.
export const VAULT = process.env.VAULT_PATH || path.join(process.cwd(), "vault");
export const MOVIES_DIR = path.join(VAULT, "wiki/movies");
// category pages live in one subdirectory per taste dimension, each with its
// own _index.md; wiki/movies/_index.md is the grand index routing to them
export const DIMENSIONS = [
  "genres", "people", "themes", "style", "platforms", "eras", "settings",
] as const;
export const CATEGORY_DIRS = DIMENSIONS.map((d) => path.join(MOVIES_DIR, d));
export const TASTE_DIR = path.join(MOVIES_DIR, "taste"); // deep taste profile, not category pages
export const HUB = path.join(VAULT, "wiki/entities/Movies.md");

export type NodeKind = "movie" | "genre" | "watchlist" | "taste";
export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  verdict?: string;
  rating?: number;
  text?: string; // taste nodes are synthesized from a bullet; this IS their content
}
export interface GraphLink {
  source: string;
  target: string;
}

export { WIKILINK, wikilinks };

// TMDB hands back its own genre vocabulary on watchlist entries, which does not
// match the category pages the wiki actually keeps. Unmapped names used to mint
// a permanent pageless node ("Drama", "Sci-Fi & Fantasy") sitting beside the
// real page for the same idea.
const TMDB_GENRES: Record<string, string> = {
  "Sci-Fi & Fantasy": "Science Fiction",
  "War & Politics": "Political Intrigue",
};

export interface Page {
  title: string; // frontmatter title — keeps the punctuation the filename dropped
  file: string;
}

/** Every wiki page keyed by a punctuation-insensitive form of its name. */
export function pageIndex(): Map<string, Page> {
  const index = new Map<string, Page>();
  const bare = new Map<string, Page | null>(); // null once ambiguous
  for (const dir of [MOVIES_DIR, ...CATEGORY_DIRS, TASTE_DIR])
    for (const file of mdFiles(dir)) {
      const name = path.basename(file, ".md");
      const title =
        (matter(fs.readFileSync(file, "utf8")).data.title as string) || name;
      const page = { title, file };
      // both spellings resolve here; first writer wins so a real page never
      // loses to a later near-collision
      for (const key of [slug(name), slug(title)])
        if (!index.has(key)) index.set(key, page);
      // "Conclave" should find "Conclave (2024)" — but only while one page
      // claims that title; two Dunes make the bare name meaningless
      const key = slug(title.replace(YEAR, ""));
      bare.set(key, bare.has(key) && bare.get(key)?.file !== file ? null : page);
    }
  for (const [key, page] of bare)
    if (page && !index.has(key)) index.set(key, page);
  return index;
}

// Page writers strip characters that read badly in a filename ("Avengers:
// Infinity War" -> "Avengers - Infinity War.md") but wikilinks keep the
// original punctuation, so an exact filename match misses the page that exists.
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
const YEAR = /\s*\(\d{4}\)\s*$/;

/** The page a wikilink target names, or null if no page exists. */
export function resolvePage(
  name: string,
  index: Map<string, Page> = pageIndex()
): Page | null {
  // bare "Conclave" and "Conclave (2024)" are the same title written two ways
  return index.get(slug(name)) ?? index.get(slug(name.replace(YEAR, ""))) ?? null;
}

export function mdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((f) => path.join(dir, f));
}

export function readWikiPage(
  id: string
): { title: string; content: string } | null {
  const page = resolvePage(path.basename(id)); // no traversal via the query param
  if (!page) return null;
  const { content } = matter(fs.readFileSync(page.file, "utf8"));
  return { title: page.title, content: content.replace(WIKILINK, "$1") };
}

export function buildGraph(): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes = new Map<string, GraphNode>();
  const linkKeys = new Set<string>();
  const links: GraphLink[] = [];
  const categoryFiles = CATEGORY_DIRS.flatMap(mdFiles);
  const genreNames = new Set(
    categoryFiles.map((f) => path.basename(f, ".md"))
  );

  const addNode = (n: GraphNode) => {
    const existing = nodes.get(n.id);
    if (!existing) nodes.set(n.id, n);
    else Object.assign(existing, { ...n, kind: existing.kind }); // first kind wins, fill details
  };
  const addLink = (source: string, target: string) => {
    if (source === target) return;
    const key = `${source}→${target}`;
    const rev = `${target}→${source}`;
    if (linkKeys.has(key) || linkKeys.has(rev)) return;
    linkKeys.add(key);
    links.push({ source, target });
  };
  const index = pageIndex();
  // Collapse a link target onto the page it actually names, so punctuation and
  // year-suffix variance ("Avengers: Infinity War" vs the "Avengers - Infinity
  // War.md" on disk) joins the real node instead of minting a pageless twin.
  const canonical = (name: string) => resolvePage(name, index)?.title ?? name;
  // any wikilink target becomes a node so no edge dangles
  const ensureTarget = (raw: string, hint?: NodeKind) => {
    const name = canonical(raw);
    if (!nodes.has(name))
      addNode({
        id: name,
        label: name,
        kind: genreNames.has(name) ? "genre" : (hint ?? "movie"),
      });
    return name;
  };

  // category pages (all dimensions)
  for (const file of categoryFiles) {
    const name = path.basename(file, ".md");
    addNode({ id: name, label: name, kind: "genre" });
  }

  // movie pages
  for (const file of mdFiles(MOVIES_DIR)) {
    const raw = fs.readFileSync(file, "utf8");
    const { data, content } = matter(raw);
    const title = (data.title as string) || path.basename(file, ".md");
    // some movies/ pages are stubs created only to resolve a dead wikilink
    // (status: watchlist, no verdict yet) — those are watchlist nodes, not seen movies
    addNode(
      data.status === "watchlist"
        ? { id: title, label: title, kind: "watchlist" }
        : { id: title, label: title, kind: "movie", verdict: data.verdict, rating: data.rating }
    );
    const genreLinks = Array.isArray(data.genres)
      ? data.genres.flatMap((g: string) => wikilinks(String(g)))
      : [];
    for (const target of genreLinks)
      // frontmatter genres: are categories even before their page exists
      addLink(title, ensureTarget(target, "genre"));
    for (const target of wikilinks(content))
      addLink(title, ensureTarget(target));
  }

  // category page bodies (links back to movies; dedupe handles both directions)
  for (const file of categoryFiles) {
    const name = path.basename(file, ".md");
    const { content } = matter(fs.readFileSync(file, "utf8"));
    for (const target of wikilinks(content))
      addLink(name, ensureTarget(target));
  }

  // hub: taste profile + watchlist sections
  if (fs.existsSync(HUB)) {
    const { content } = matter(fs.readFileSync(HUB, "utf8"));
    const sections = content.split(/^## /m);
    for (const section of sections) {
      const heading = section.split("\n", 1)[0].toLowerCase();
      // top-level bullets only — indented sub-bullets (e.g. rating-tier
      // breakdowns nested under a parent bullet) are details of their parent,
      // not standalone taste/watchlist entries, and would otherwise become
      // garbled synthetic nodes (label = their own truncated text)
      const bullets = section
        .split("\n")
        .filter((l) => /^-\s+\S/.test(l) && !l.includes("(empty"))
        .map((l) => l.replace(/^-\s+/, "").trim());
      if (heading.startsWith("taste")) {
        for (const b of bullets) {
          // display without [[ ]] syntax or inline markdown (**bold** etc. would
          // otherwise leak into node labels)
          const clean = b.replace(WIKILINK, "$1").replace(/[*_`]/g, "").trim();
          const id = `taste: ${clean.slice(0, 40)}`;
          // a taste node has no page and never will — carry the full bullet so
          // the detail panel can show it instead of reporting it missing
          addNode({ id, label: clean.slice(0, 40), kind: "taste", text: clean });
          for (const target of wikilinks(b))
            addLink(id, ensureTarget(target, "genre")); // taste bullets link categories
        }
      } else if (heading.startsWith("watchlist")) {
        for (const b of bullets) {
          const wl = wikilinks(b);
          const raw = wl[0] ?? b.split(" — ")[0].split(" - ")[0].trim();
          if (!raw) continue;
          const title = canonical(raw);
          if (!nodes.has(title))
            addNode({ id: title, label: title, kind: "watchlist" });
          for (const target of wl.slice(1))
            addLink(title, ensureTarget(target, "genre")); // watchlist trailing links are categories
        }
      }
      // Seen table rows are covered by movie pages
    }
  }

  // personal watchlist (data/watchlist.json) — graphed directly rather than
  // via a wiki bullet, so a node always shows up even if the chat agent never
  // got around to writing one
  const userListFile = path.join(process.cwd(), "data/watchlist.json");
  if (fs.existsSync(userListFile)) {
    const items = JSON.parse(fs.readFileSync(userListFile, "utf8")) as {
      title: string;
      genres?: string[];
    }[];
    for (const item of items) {
      const title = canonical(item.title);
      if (!nodes.has(title))
        addNode({ id: title, label: title, kind: "watchlist" });
      for (const raw of item.genres ?? []) {
        const g = TMDB_GENRES[raw] ?? raw;
        // Unlike a page's curated genres:, these come from TMDB's vocabulary,
        // so an unmatched one ("Drama", "Crime") is noise rather than a
        // category the wiki has yet to write — drop it instead of ghosting.
        // The movie's own page carries the real categories.
        if (!resolvePage(g, index)) continue;
        addLink(title, ensureTarget(g, "genre"));
      }
    }
  }

  return mergeBareDuplicates([...nodes.values()], links);
}

/**
 * Two spellings of a title that has no page ("Conclave" from the hub bullet,
 * "Conclave (2024)" from the watchlist) both survive resolvePage, so they land
 * as two nodes. Page-backed names already merged via the index; this catches
 * the pageless pairs, keeping the year-suffixed spelling as the survivor.
 */
function mergeBareDuplicates(
  nodes: GraphNode[],
  links: GraphLink[]
): { nodes: GraphNode[]; links: GraphLink[] } {
  const byBare = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (n.kind === "taste") continue; // ids are bullet text, not titles
    const key = slug(n.id.replace(YEAR, ""));
    byBare.set(key, [...(byBare.get(key) ?? []), n]);
  }
  const alias = new Map<string, string>();
  for (const group of byBare.values()) {
    if (group.length < 2) continue;
    const dated = group.filter((n) => YEAR.test(n.id));
    // Nosferatu (1922) and Nosferatu (2024) are two films, not two spellings —
    // a bare name only folds in when exactly one dated node can claim it
    if (dated.length !== 1) continue;
    for (const n of group) if (n !== dated[0]) alias.set(n.id, dated[0].id);
  }
  if (!alias.size) return { nodes, links };

  const id = (n: string) => alias.get(n) ?? n;
  const seen = new Set<string>();
  const merged: GraphLink[] = [];
  for (const l of links) {
    const [source, target] = [id(l.source), id(l.target)];
    const key = [source, target].sort().join("→");
    if (source === target || seen.has(key)) continue;
    seen.add(key);
    merged.push({ source, target });
  }
  return { nodes: nodes.filter((n) => !alias.has(n.id)), links: merged };
}
