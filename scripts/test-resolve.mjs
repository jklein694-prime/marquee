// Wikilink resolution: page writers strip punctuation from filenames but links
// keep it, so an exact-name match invents a pageless twin of a page that exists.
// Run: npx tsx scripts/test-resolve.mjs
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";

const vault = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
const movies = path.join(vault, "wiki/movies");
const genres = path.join(movies, "genres");
fs.mkdirSync(genres, { recursive: true });

const page = (dir, file, title, body = "") =>
  fs.writeFileSync(
    path.join(dir, `${file}.md`),
    `---\ntitle: "${title}"\n---\n\n${body}\n`
  );

// filename drops the colon, frontmatter keeps it — the real-world shape
page(movies, "Avengers - Infinity War (2018)", "Avengers: Infinity War (2018)");
page(movies, "House MD (2004)", "House M.D. (2004)");
page(movies, "Conclave (2024)", "Conclave (2024)");
page(genres, "Science Fiction", "Science Fiction");
// a straight apostrophe on disk; links elsewhere use the curly one
page(movies, "Schindler's List (1993)", "Schindler's List (1993)");
// two pages share a bare name, so the bare name must stay ambiguous
page(movies, "Dune (2021)", "Dune (2021)");
page(movies, "Dune - Part Two (2024)", "Dune: Part Two (2024)");
page(movies, "Nosferatu (1922)", "Nosferatu (1922)");
page(movies, "Nosferatu (2024)", "Nosferatu (2024)");

process.env.VAULT_PATH = vault;
const { resolvePage, readWikiPage, buildGraph } = await import("../lib/vault.ts");

// the punctuated link finds the sanitized file, and reports the real title
assert.strictEqual(
  resolvePage("Avengers: Infinity War (2018)")?.title,
  "Avengers: Infinity War (2018)"
);
assert.strictEqual(resolvePage("House M.D. (2004)")?.title, "House M.D. (2004)");
// the filename spelling resolves to the same page, so both collapse to one node
assert.strictEqual(
  resolvePage("Avengers - Infinity War (2018)")?.title,
  "Avengers: Infinity War (2018)"
);
// punctuation the index never saw in either spelling still resolves
assert.strictEqual(
  resolvePage("Schindler’s List (1993)")?.title,
  "Schindler's List (1993)"
);
// a bare title matches its year-suffixed page
assert.strictEqual(resolvePage("Conclave")?.title, "Conclave (2024)");
// two Nosferatus mean the bare name picks neither, but each exact year still works
assert.strictEqual(resolvePage("Nosferatu"), null);
assert.strictEqual(resolvePage("Nosferatu (2024)")?.title, "Nosferatu (2024)");
// "Dune" is unambiguous — "Dune: Part Two" is a different bare name, not a rival
assert.strictEqual(resolvePage("Dune")?.title, "Dune (2021)");
// categories resolve too, and a genuine absence stays absent
assert.strictEqual(resolvePage("Science Fiction")?.title, "Science Fiction");
assert.strictEqual(resolvePage("Drama"), null);
assert.strictEqual(resolvePage("Heat (1995)"), null);

// the API path reads through the same resolver
assert.strictEqual(
  readWikiPage("Avengers: Infinity War (2018)")?.title,
  "Avengers: Infinity War (2018)"
);
assert.strictEqual(readWikiPage("Drama"), null);
// a traversal attempt resolves against the index, never the filesystem
assert.strictEqual(readWikiPage("../../../etc/passwd"), null);

// --- graph: pageless spellings collapse, distinct films do not ---
// a category page links three titles that have no page of their own
page(
  genres,
  "Mystery",
  "Mystery",
  "- [[Coherence]]\n- [[Nosferatu (1922)]]\n- [[Nosferatu (2024)]]\n"
);
// the hub names one of them with a year the category page omitted
fs.mkdirSync(path.join(vault, "wiki/entities"), { recursive: true });
fs.writeFileSync(
  path.join(vault, "wiki/entities/Movies.md"),
  `---\ntitle: "Movies"\n---\n\n## Taste\n\n- [[Science Fiction]] rewards a hard premise\n\n## Watchlist\n\n- [[Coherence (2013)]] — one night, many houses\n`
);

const { nodes } = buildGraph();
const ids = nodes.map((n) => n.id);
const count = (s) => ids.filter((i) => i === s).length;

// "Coherence" and "Coherence (2013)" are one pageless title written two ways
assert.strictEqual(count("Coherence"), 0, "bare spelling should fold in");
assert.strictEqual(count("Coherence (2013)"), 1, "dated spelling survives");
// two Nosferatus are two films — neither may absorb the other
assert.strictEqual(count("Nosferatu (1922)"), 1);
assert.strictEqual(count("Nosferatu (2024)"), 1);

// the taste bullet carries its text, since it will never have a page
const taste = nodes.find((n) => n.kind === "taste");
assert.strictEqual(taste.text, "Science Fiction rewards a hard premise");
assert.strictEqual(readWikiPage(taste.id), null, "taste nodes have no page");

fs.rmSync(vault, { recursive: true, force: true });
console.log("resolve: ok");
