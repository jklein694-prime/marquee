import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { GENRES_DIR, HUB, MOVIES_DIR, mdFiles, wikilinks } from "./vault";

const REPORT = path.join(process.cwd(), "data/lint-pending.txt");

// mechanical, deterministic fixes applied in place; returns what was fixed
// ponytail: hub-only, wikilink syntax only — widen scope when the report shows
// recurring patterns elsewhere
export function autofixVault(): string[] {
  if (!fs.existsSync(HUB)) return [];
  const before = fs.readFileSync(HUB, "utf8");
  const after = before
    // markdown formatting inside a wikilink target: [[**Foo**]] → [[Foo]]
    .replace(/\[\[\s*[*_`]+([^\]|#]*?)[*_`]+\s*\]\]/g, (_, t) => `[[${t.trim()}]]`)
    // unclosed wikilink: [[Foo] → [[Foo]]
    .replace(/\[\[([^\][\n]+)\](?!\])/g, "[[$1]]");
  if (after === before) return [];
  fs.writeFileSync(HUB, after);
  return ["hub: normalized malformed wikilink syntax"];
}

// judgment calls for the agent: dead links, orphan pages, unlinked taste bullets
export function lintVault(): string[] {
  if (!fs.existsSync(HUB)) return [];
  const issues: string[] = [];
  const pageFiles = [...mdFiles(MOVIES_DIR), ...mdFiles(GENRES_DIR)];
  const pages = new Set(pageFiles.map((f) => path.basename(f, ".md")));
  const hub = matter(fs.readFileSync(HUB, "utf8")).content;

  // watchlist bullet titles legitimately have no page yet — exclude from dead-link check
  const pageless = new Set<string>();
  const sections = hub.split(/^## /m);
  for (const section of sections) {
    const heading = section.split("\n", 1)[0].toLowerCase();
    const bullets = section
      .split("\n")
      .filter((l) => /^\s*-\s+\S/.test(l) && !l.includes("(empty"))
      .map((l) => l.replace(/^\s*-\s+/, "").trim());
    if (heading.startsWith("watchlist")) {
      for (const b of bullets) {
        const first = wikilinks(b)[0];
        if (first) pageless.add(first);
      }
    } else if (heading.startsWith("taste")) {
      for (const b of bullets) {
        if (wikilinks(b).length === 0)
          issues.push(`taste bullet has no [[Category]] links: "${b.slice(0, 80)}"`);
      }
    }
  }

  const linked = new Set<string>();
  const scan = (text: string, where: string) => {
    for (const target of wikilinks(text)) {
      linked.add(target);
      if (!pages.has(target) && !pageless.has(target))
        issues.push(`dead wikilink [[${target}]] in ${where}`);
    }
  };
  scan(hub, "hub");
  for (const f of pageFiles) scan(fs.readFileSync(f, "utf8"), path.basename(f));

  for (const p of pages) {
    if (!linked.has(p)) issues.push(`orphan page (no inbound links): ${p}.md`);
  }

  // dedupe (same dead link can appear in many files) and cap the report
  return [...new Set(issues)].slice(0, 20);
}

export function writeLintReport(issues: string[]) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  if (issues.length) fs.writeFileSync(REPORT, issues.join("\n"));
  else fs.rmSync(REPORT, { force: true });
}

export function consumeLintReport(): string {
  if (!fs.existsSync(REPORT)) return "";
  const text = fs.readFileSync(REPORT, "utf8").trim();
  fs.rmSync(REPORT, { force: true });
  return text;
}
