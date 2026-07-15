#!/usr/bin/env node
// Runnable check for the "no watchlist add without Louie's predicted score" invariant
// (app/api/watchlist/route.ts). Requires `npm run dev` already running on :3000.
// Usage: node scripts/test-watchlist-guard.mjs
import assert from "assert";

const BASE = "http://localhost:3000/api/watchlist";
const TITLE = "ZZZ Guard Test (1999)";
const post = (body) => fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let r = await post({ action: "add", title: TITLE });
assert.strictEqual(r.status, 400, "add without predicted should 400");

r = await post({ action: "add", title: TITLE, predicted: "great" });
assert.strictEqual(r.status, 400, "add with malformed predicted should 400");

r = await post({ action: "add", title: TITLE, predicted: "7-8" });
assert.strictEqual(r.status, 200, "add with valid predicted should 200");

const { user } = await (await fetch(BASE)).json();
const stored = user.find((i) => i.title === TITLE);
assert.ok(stored, "item should be stored");
assert.strictEqual(stored.predicted, "7-8", "stored predicted should round-trip");

await post({ action: "remove", title: TITLE }); // cleanup regardless of outcome above

console.log("PASS: watchlist add requires a valid predicted score");
