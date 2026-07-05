import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { WIKILINK, wikilinks } from "./wikilink";

// Vault location is configurable: set VAULT_PATH in .env.local (install.sh does this).
// Falls back to a ./vault folder in the project so the app still boots with an empty graph.
export const VAULT = process.env.VAULT_PATH || path.join(process.cwd(), "vault");
const MOVIES_DIR = path.join(VAULT, "wiki/movies");
const GENRES_DIR = path.join(MOVIES_DIR, "genres");
export const HUB = path.join(VAULT, "wiki/entities/Movies.md");

export type NodeKind = "movie" | "genre" | "watchlist" | "taste";
export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  verdict?: string;
  rating?: number;
}
export interface GraphLink {
  source: string;
  target: string;
}

export { WIKILINK, wikilinks };

function mdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((f) => path.join(dir, f));
}

export function readWikiPage(
  id: string
): { title: string; content: string } | null {
  const name = path.basename(id); // no traversal via the query param
  for (const dir of [MOVIES_DIR, GENRES_DIR]) {
    const file = path.join(dir, `${name}.md`);
    if (!fs.existsSync(file)) continue;
    const { data, content } = matter(fs.readFileSync(file, "utf8"));
    return {
      title: (data.title as string) || name,
      content: content.replace(WIKILINK, "$1"),
    };
  }
  return null;
}

export function buildGraph(): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes = new Map<string, GraphNode>();
  const linkKeys = new Set<string>();
  const links: GraphLink[] = [];
  const genreNames = new Set(
    mdFiles(GENRES_DIR).map((f) => path.basename(f, ".md"))
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
  // any wikilink target becomes a node so no edge dangles
  const ensureTarget = (name: string, hint?: NodeKind) => {
    if (!nodes.has(name))
      addNode({
        id: name,
        label: name,
        kind: genreNames.has(name) ? "genre" : (hint ?? "movie"),
      });
  };

  // genre pages
  for (const file of mdFiles(GENRES_DIR)) {
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
    for (const target of genreLinks) {
      ensureTarget(target, "genre"); // frontmatter genres: are categories even before their page exists
      addLink(title, target);
    }
    for (const target of wikilinks(content)) {
      ensureTarget(target);
      addLink(title, target);
    }
  }

  // genre page bodies (links back to movies; dedupe handles both directions)
  for (const file of mdFiles(GENRES_DIR)) {
    const name = path.basename(file, ".md");
    const { content } = matter(fs.readFileSync(file, "utf8"));
    for (const target of wikilinks(content)) {
      ensureTarget(target);
      addLink(name, target);
    }
  }

  // hub: taste profile + watchlist sections
  if (fs.existsSync(HUB)) {
    const { content } = matter(fs.readFileSync(HUB, "utf8"));
    const sections = content.split(/^## /m);
    for (const section of sections) {
      const heading = section.split("\n", 1)[0].toLowerCase();
      const bullets = section
        .split("\n")
        .filter((l) => /^\s*-\s+\S/.test(l) && !l.includes("(empty"))
        .map((l) => l.replace(/^\s*-\s+/, "").trim());
      if (heading.startsWith("taste")) {
        for (const b of bullets) {
          const clean = b.replace(WIKILINK, "$1"); // display without [[ ]] syntax
          const id = `taste: ${clean.slice(0, 40)}`;
          addNode({ id, label: clean.slice(0, 40), kind: "taste" });
          for (const target of wikilinks(b)) {
            ensureTarget(target, "genre"); // taste bullets link categories
            addLink(id, target);
          }
        }
      } else if (heading.startsWith("watchlist")) {
        for (const b of bullets) {
          const wl = wikilinks(b);
          const title = wl[0] ?? b.split(" — ")[0].split(" - ")[0].trim();
          if (!title) continue;
          if (!nodes.has(title))
            addNode({ id: title, label: title, kind: "watchlist" });
          for (const target of wl.slice(1)) {
            ensureTarget(target, "genre"); // watchlist trailing links are categories
            addLink(title, target);
          }
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
      addNode({ id: item.title, label: item.title, kind: "watchlist" });
      for (const g of item.genres ?? []) {
        ensureTarget(g, "genre");
        addLink(item.title, g);
      }
    }
  }

  return { nodes: [...nodes.values()], links };
}
