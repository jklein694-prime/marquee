import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { CATEGORY_DIRS, HUB, MOVIES_DIR, TASTE_DIR, mdFiles, wikilinks } from "./vault";

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
  const pageFiles = [...mdFiles(MOVIES_DIR), ...CATEGORY_DIRS.flatMap(mdFiles)];
  const pages = new Set(pageFiles.map((f) => path.basename(f, ".md")));
  // taste/ pages (deep profile) resolve links but aren't category/movie pages
  for (const f of mdFiles(TASTE_DIR)) pages.add(path.basename(f, ".md"));
  const hub = matter(fs.readFileSync(HUB, "utf8")).content;

  // watchlist and not-interested bullet titles legitimately have no page yet —
  // exclude from the dead-link check
  const pageless = new Set<string>();
  const sections = hub.split(/^## /m);
  for (const section of sections) {
    const heading = section.split("\n", 1)[0].toLowerCase();
    const bullets = section
      .split("\n")
      .filter((l) => /^\s*-\s+\S/.test(l) && !l.includes("(empty"))
      .map((l) => l.replace(/^\s*-\s+/, "").trim());
    if (heading.startsWith("watchlist") || heading.startsWith("not interested")) {
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

  issues.push(...lintIndexes());

  // dedupe (same dead link can appear in many files) and cap the report
  return [...new Set(issues)].slice(0, 20);
}

// hierarchical-index invariants: each dimension _index.md mirrors its directory,
// a page is indexed in exactly one dimension, sub-indexes stay a sane size, and
// the grand index routes to every dimension (container rule)
function lintIndexes(): string[] {
  const issues: string[] = [];
  const grandFile = path.join(MOVIES_DIR, "_index.md");
  const grand = fs.existsSync(grandFile) ? fs.readFileSync(grandFile, "utf8") : "";
  const seen = new Map<string, string>(); // page -> dimension it's indexed under

  for (const dir of CATEGORY_DIRS) {
    const dim = path.basename(dir);
    const indexFile = path.join(dir, "_index.md");
    if (!fs.existsSync(dir)) continue;
    if (!fs.existsSync(indexFile)) {
      issues.push(`missing sub-index: wiki/movies/${dim}/_index.md`);
      continue;
    }
    const onDisk = new Set(mdFiles(dir).map((f) => path.basename(f, ".md")));
    // one entry per "- [[Page]] — ..." bullet; first wikilink names the page
    const indexed = new Set(
      fs
        .readFileSync(indexFile, "utf8")
        .split("\n")
        .filter((l) => /^-\s+\[\[/.test(l))
        .map((l) => wikilinks(l)[0])
        .filter(Boolean)
    );
    for (const p of onDisk)
      if (!indexed.has(p)) issues.push(`${dim}/_index.md is missing its page [[${p}]]`);
    for (const p of indexed) {
      if (!onDisk.has(p)) issues.push(`${dim}/_index.md lists [[${p}]] but ${dim}/${p}.md does not exist`);
      else if (seen.has(p)) issues.push(`[[${p}]] indexed in both ${seen.get(p)}/ and ${dim}/ (must be exactly one)`);
      else seen.set(p, dim);
    }
    // hard ceiling only — the ~40-entry split judgment belongs to the Flow 3
    // consolidation pass, not a per-turn nag
    if (indexed.size > 50)
      issues.push(`${dim}/_index.md has ${indexed.size} entries (>50) — needs a dimension split at next consolidation`);
    if (grand && !grand.includes(`movies/${dim}/_index`))
      issues.push(`grand index wiki/movies/_index.md has no row for dimension ${dim}/`);
  }
  return issues;
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
