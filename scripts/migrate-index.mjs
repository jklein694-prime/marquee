#!/usr/bin/env node
// One-time migration: flat wiki/movies/_index.md + monolithic hub taste profile
// → grand index + per-dimension sub-indexes + on-demand taste deep file.
// Usage: node scripts/migrate-index.mjs /path/to/vault
// Idempotent: refuses to run twice (checks for dimension dirs).
import fs from "fs";
import path from "path";

const VAULT = process.argv[2];
if (!VAULT || !fs.existsSync(path.join(VAULT, "wiki/movies/genres"))) {
  console.error("usage: node scripts/migrate-index.mjs <vault-path>");
  process.exit(1);
}
const MOVIES = path.join(VAULT, "wiki/movies");
const GENRES = path.join(MOVIES, "genres");
const HUB = path.join(VAULT, "wiki/entities/Movies.md");
const MANIFEST = path.join(VAULT, ".raw/.manifest.json");
const TODAY = "2026-07-08";

// ---------------------------------------------------------------- dimensions
const DIMENSIONS = {
  genres: {
    scope: "genre & subgenre affinities — mechanism beats genre",
    pages: [
      "Action Thriller", "Animation", "Art House Fantasy", "Corporate Horror",
      "Crime Drama", "Cyberpunk", "Dark Comedy", "Dark Fantasy", "Documentary",
      "Dystopia", "Ensemble Comedy", "Epic Fantasy", "Fantasy", "Heist",
      "High Fantasy", "Historical Drama", "Historical Epic", "Horror",
      "Legal Drama", "MCU", "Medical Drama", "Musical", "Mystery", "Neo-noir",
      "Prestige Drama", "Procedural", "Psychological Thriller", "Real Crime",
      "Rom-com", "Sci-Fi Epic", "Science Fiction", "Sitcom", "Southern Gothic",
      "Sports Drama", "Spy Thriller", "Superhero", "Survival Thriller",
      "Teen Comedy", "War Film", "Western", "Workplace Comedy",
    ],
  },
  people: {
    scope: "directors & creators as predictors",
    pages: [
      "Alex Garland", "Ari Aster", "Benioff and Weiss", "Bong Joon Ho",
      "Charlie Brooker", "Christopher Nolan", "Coen Brothers",
      "Damien Chazelle", "Dan Erickson", "David Fincher", "Denis Villeneuve",
      "George R.R. Martin", "Jordan Peele", "Michael Mann", "Noah Hawley",
      "Peter Jackson", "Rian Johnson", "Robert Eggers", "Sam Mendes", "Scorsese",
      "Spike Jonze", "Steve McQueen", "Steven Spielberg", "Tarantino",
      "The Wachowskis", "Wes Anderson",
    ],
  },
  themes: {
    scope: "thematic engines that explain reactions",
    pages: [
      "AI and Consciousness", "Class Warfare", "Criminal Profiling",
      "Determinism", "Identity and Memory", "Multiverse", "Obsession",
      "Philosophical Antagonist", "Political Intrigue", "Power and Corruption",
      "Reality vs Simulation", "Sacrifice", "Satire", "Social Commentary",
      "Time Travel",
    ],
  },
  style: {
    scope: "format, structure, register + viewing context",
    pages: [
      "English Language Only", "Ensemble", "Korean Cinema", "Mockumentary",
      "Non-linear", "Prestige Animation", "Prestige TV", "Puzzle Structure",
      "Watches with Partner",
    ],
  },
  platforms: {
    scope: "studio / network priors",
    pages: ["A24", "Amazon Prime Video", "Apple TV+", "CBS", "HBO", "Netflix", "Pixar"],
  },
  eras: {
    scope: "release-era patterns",
    pages: ["1970s Period Piece", "2000s Thrillers", "2010s Thrillers"],
  },
  settings: {
    scope: "period & place",
    pages: ["Alt-History", "LA Crime", "Medieval Fantasy", "Near-future", "Space Exploration"],
  },
};
// one-line routing signal per dimension, shown in the grand index
const SIGNALS = {
  genres:
    "prestige drama / mystery / epic fantasy / superhero-with-mechanism loved; procedural, western, teen comedy, art-house register avoided",
  people:
    "Fincher, Benioff & Weiss, Bong Joon Ho zero-miss; Coens' own register, Aster, Eggers = avoid",
  themes:
    "systemic power, determinism, political intrigue = loved; stated-not-embedded commentary caps at 6",
  style:
    "Puzzle Structure is the single strongest predictor; Prestige TV ~95% hit rate; includes viewing constraints",
  platforms: "Apple TV+ > HBO > Netflix; CBS is a confirmed negative signal",
  eras: "thin dimension so far — thrillers by decade",
  settings: "near-future loves; LA crime untested but predicted high",
};

// ------------------------------------------------------------------- helpers
const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const targets = (text) =>
  [...text.matchAll(WIKILINK)].map((m) => m[1].trim());
const mdBasenames = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3))
    : [];

function allPageNames() {
  const names = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name.endsWith(".md")) names.add(e.name.slice(0, -3));
    }
  };
  walk(path.join(VAULT, "wiki"));
  return names;
}
function deadLinks() {
  const names = allPageNames();
  const dead = new Set();
  const scanDirs = [MOVIES, GENRES, ...Object.keys(DIMENSIONS).map((d) => path.join(MOVIES, d))];
  const files = scanDirs
    .filter(fs.existsSync)
    .flatMap((d) =>
      fs.readdirSync(d).filter((f) => f.endsWith(".md")).map((f) => path.join(d, f))
    )
    .concat(fs.existsSync(HUB) ? [HUB] : []);
  for (const f of files)
    for (const t of targets(fs.readFileSync(f, "utf8")))
      // Obsidian resolves [[path/to/Name]] by basename
      if (!names.has(t.split("/").pop())) dead.add(t);
  return dead;
}
const patternOf = (file) => {
  const m = fs.readFileSync(file, "utf8").match(/\*\*Pattern:\s*([\s\S]*?)\*\*/);
  return m ? m[1].trim().replace(/\s+/g, " ") : "(pattern pending consolidation)";
};

// ------------------------------------------------------------------ preflight
if (Object.keys(DIMENSIONS).some((d) => d !== "genres" && fs.existsSync(path.join(MOVIES, d)))) {
  console.error("dimension dirs already exist — migration already ran");
  process.exit(1);
}
const onDisk = new Set(mdBasenames(GENRES).filter((n) => n !== "_index"));
const classified = new Set(Object.values(DIMENSIONS).flatMap((d) => d.pages));
const unclassified = [...onDisk].filter((n) => !classified.has(n));
const missing = [...classified].filter((n) => !onDisk.has(n));
if (unclassified.length || missing.length) {
  console.error("classification mismatch", { unclassified, missing });
  process.exit(1);
}
const deadBefore = deadLinks();

// -------------------------------------------------- 1. move pages + sub-indexes
for (const [dim, { scope, pages }] of Object.entries(DIMENSIONS)) {
  const dir = path.join(MOVIES, dim);
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const name of [...pages].sort((a, b) => a.localeCompare(b))) {
    const from = path.join(GENRES, `${name}.md`);
    const to = path.join(dir, `${name}.md`);
    if (dim !== "genres") fs.renameSync(from, to);
    entries.push(`- [[${name}]] — ${patternOf(to)}`);
  }
  fs.writeFileSync(
    path.join(dir, "_index.md"),
    `---
type: meta
title: "${dim} — dimension index"
updated: ${TODAY}
tags: [meta, index, movies, ${dim}]
status: growing
related:
  - "[[movies/_index]]"
---

# ${dim[0].toUpperCase() + dim.slice(1)} — dimension index

Scope: ${scope}. One entry per page in \`wiki/movies/${dim}/\`, mirroring the
directory exactly (lint enforces parity). Entry format: wikilink — pattern line.
Updated inline whenever a page in this dimension is created or its Pattern changes.

${entries.join("\n")}
`
  );
}

// -------------------------------------------------------- 2. grand index
const grandRows = Object.entries(DIMENSIONS)
  .map(
    ([dim, { scope, pages }]) =>
      `- [[movies/${dim}/_index|${dim[0].toUpperCase() + dim.slice(1)}]] — ${pages.length} pages — ${scope}. ${SIGNALS[dim]}.`
  )
  .join("\n");
fs.writeFileSync(
  path.join(MOVIES, "_index.md"),
  `---
type: meta
title: "Movie Database Index"
aliases: ["movies/_index"]
updated: ${TODAY}
tags: [meta, index, movies]
status: evergreen
related:
  - "[[Movies]]"
  - "[[index]]"
---

# Movie Database Index

Navigation: [[Movies|Hub (taste digest / watchlist / seen)]] | [[Taste Profile|Deep taste profile]] | [[index|Wiki Index]]

Grand index of the movie database. This file is a ROUTING TABLE (container rule):
it lists the dimension sub-indexes only — never individual category or movie pages.
Open a dimension's \`_index.md\` for its category list + pattern lines; open category
pages for evidence. Movie pages are reached via the [[Movies]] hub Seen table or
category pages. Rewritten only during consolidation passes; day-to-day writes go
to dimension sub-indexes.

## Dimensions

${grandRows}
`
);

// ------------------------------------------------- 3. hub taste-profile split
const hub = fs.readFileSync(HUB, "utf8");
const tasteStart = hub.indexOf("## Taste profile");
const tasteEnd = hub.indexOf("## Watchlist");
if (tasteStart < 0 || tasteEnd < 0) {
  console.error("hub sections not found");
  process.exit(1);
}
const tasteBody = hub.slice(tasteStart + "## Taste profile".length, tasteEnd).trim();

const DIGEST = `## Taste profile

Digest only — full evidence and history live in [[Taste Profile]] (read it for
taste analysis, pattern mining, or before revising any bullet below).

- **The formula**: philosophical ideas embedded as plot mechanics with forward drive — [[Puzzle Structure]] where the ideas ARE the mechanism; ideas-as-atmosphere caps at 6-7 ([[Taste Profile]])
- **System vs individual is the deepest filter**: institution-as-antagonist = floor 8 in any genre ([[Power and Corruption]], [[Political Intrigue]]); individual genius-operator = cap 6-7 and structurally fragile
- [[Puzzle Structure]] is the strongest predictor (12/12 at 7+) — but resolution integrity is the ceiling: soft reveal = 7, broken resolution = 4 (Lost)
- **Structural repetition penalty**: a proven mechanism redeployed without reinvention caps at 6 ([[Rian Johnson]] arc: 9 → 6 → 6)
- **Anxiety-as-atmosphere is the hard floor at 4** regardless of acclaim ([[The Bear (2022)]], [[Industry (2021)]], Midsommar, The Revenant) — register check comes before genre or premise
- **Episodic [[Procedural]] is a hard avoid** regardless of premise (Person of Interest 3): the puzzle must accumulate across the arc, not reset weekly
- **Art-house register = avoid** ([[A24]] house style, [[Ari Aster]], [[Robert Eggers]]): atmosphere-over-narrative collapses engagement
- **Emotional load lifts 8 → 9-10 only when it shares the mechanism's structure** ([[Arrival (2016)]], [[Interstellar (2014)]], Endgame); separable emotion stays 7-8
- **Comedy/musical register softens stakes** (caps ~6-7) unless the craft IS the mechanism ([[Ensemble Comedy]] 8-9) or comedy is delivery not ceiling (Thor L&T 8)
- Platform priors: [[Apple TV+]] > [[HBO]] > [[Netflix]]; [[CBS]] negative. Zero-miss creators: [[David Fincher]], [[Benioff and Weiss]], [[Bong Joon Ho]]
- [[Prestige TV]] ~95% hit rate; two failure modes: no load-bearing concept (6), anxiety-as-atmosphere (4)
- [[Animation]] amplifies rather than softens — highest-average category (five 10s); [[Pixar]] near-perfect
- [[Mystery]] stronghold at 8+ for fresh structures; retreads break it ([[Superhero]]/[[MCU]] follow a 4-tier mechanism spectrum, 6-10)
- Viewing constraints: [[Watches with Partner]]; [[English Language Only]] (no subtitles); post-1990 only except all-time peaks; avoids pure nihilism / torture-adjacent; hype-fatigued titles lose appeal
- Taste-drift convention: bullets here are superseded in [[Taste Profile]] with date stamps, never silently deleted

`;
fs.writeFileSync(
  HUB,
  hub.slice(0, tasteStart) + DIGEST + hub.slice(tasteEnd)
);

fs.mkdirSync(path.join(MOVIES, "taste"), { recursive: true });
fs.writeFileSync(
  path.join(MOVIES, "taste/Taste Profile.md"),
  `---
type: meta
title: "Taste Profile"
updated: ${TODAY}
tags: [meta, movies, taste]
status: growing
related:
  - "[[Movies]]"
  - "[[movies/_index]]"
---

# Taste Profile

The full, evidence-cited taste profile — moved out of the [[Movies]] hub
(${TODAY}) so every chat turn reads only the hub's digest. Read this page for
taste analysis, pattern mining (Flow 3), or before revising a digest bullet.

Conventions: claims are date-stamped as they are added or revised. A contradicted
claim is never deleted — mark it \`(superseded YYYY-MM-DD: reason)\` and add the
replacement. Taste drift is data.

## Full profile (moved from hub ${TODAY})

${tasteBody}
`
);

// ------------------------------------------------- 4. manifest path updates
if (fs.existsSync(MANIFEST)) {
  let manifest = fs.readFileSync(MANIFEST, "utf8");
  for (const [dim, { pages }] of Object.entries(DIMENSIONS)) {
    if (dim === "genres") continue;
    for (const name of pages)
      manifest = manifest.replaceAll(
        `wiki/movies/genres/${name}.md`,
        `wiki/movies/${dim}/${name}.md`
      );
  }
  fs.writeFileSync(MANIFEST, manifest);
}

// ------------------------------------------------------------ 5. verification
const deadAfter = deadLinks();
const newDead = [...deadAfter].filter((t) => !deadBefore.has(t));
const movedCount = Object.entries(DIMENSIONS)
  .filter(([d]) => d !== "genres")
  .reduce((n, [, { pages }]) => n + pages.length, 0);
const stillInGenres = mdBasenames(GENRES).filter((n) => n !== "_index").length;
console.log(`moved ${movedCount} pages out of genres/; ${stillInGenres} remain (expected ${DIMENSIONS.genres.pages.length})`);
console.log(`dead links before: ${deadBefore.size}, after: ${deadAfter.size}, NEW: ${newDead.length}`);
if (newDead.length) {
  console.error("NEW dead links:", newDead);
  process.exit(1);
}
if (stillInGenres !== DIMENSIONS.genres.pages.length) {
  console.error("genres/ count mismatch");
  process.exit(1);
}
console.log("migration OK");
