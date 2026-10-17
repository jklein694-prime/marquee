// Client bundle budget gate — run after `next build`. Reads the build manifest,
// gzips every chunk the root page loads on first paint, and fails when the
// total crosses the budget. Lazy chunks (force-graph, three.js) are reported
// but only the initial set is gated: they load on demand by design.
//
//   node scripts/check-bundle-budget.mjs            # gate
//   node scripts/check-bundle-budget.mjs --report   # just print sizes
import fs from "fs";
import path from "path";
import zlib from "zlib";

const ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const NEXT = path.join(ROOT, ".next");
const INITIAL_BUDGET_KB = Number(process.env.BUDGET_INITIAL_KB ?? 200); // gzip
const report = process.argv.includes("--report");

// the prerendered root page lists exactly the scripts the browser fetches on
// first paint (framework + the page's own client chunks); the build manifest
// alone only knows the framework ones
const html = fs.readFileSync(path.join(NEXT, "server/app/index.html"), "utf8");
const initial = [...new Set(html.match(/<script[^>]*src="\/_next\/(static\/chunks\/[A-Za-z0-9_-]+\.js)"[^>]*>/g) ?? [])]
  .filter((tag) => !/nomodule/i.test(tag)) // legacy-browser polyfills: modern browsers skip them
  .map((tag) => tag.match(/src="\/_next\/([^"]+)"/)[1]);
const gz = (file) => zlib.gzipSync(fs.readFileSync(path.join(NEXT, file))).length;

let total = 0;
console.log("initial client JS (gzip):");
for (const f of initial) {
  const kb = gz(f) / 1024;
  total += kb;
  console.log(`  ${kb.toFixed(1).padStart(7)} KB  ${path.basename(f)}`);
}
console.log(`  ${total.toFixed(1).padStart(7)} KB  total  (budget ${INITIAL_BUDGET_KB} KB)`);

const chunkDir = path.join(NEXT, "static/chunks");
const lazy = fs
  .readdirSync(chunkDir)
  .filter((f) => f.endsWith(".js") && !initial.some((i) => i.endsWith(f)))
  .map((f) => ({ f, kb: gz(path.join("static/chunks", f)) / 1024 }))
  .sort((a, b) => b.kb - a.kb);
console.log("lazy chunks (gzip):");
for (const { f, kb } of lazy) console.log(`  ${kb.toFixed(1).padStart(7)} KB  ${f}`);

if (!report && total > INITIAL_BUDGET_KB) {
  console.error(`\nFAIL: initial JS ${total.toFixed(1)} KB gzip exceeds budget ${INITIAL_BUDGET_KB} KB`);
  process.exit(1);
}
