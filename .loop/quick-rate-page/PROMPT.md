# Goal
Add a "Quick Rate" tab: search TMDB, rate 1-10 + comment, log via the
existing silent-background-turn mechanism so it updates the taste graph
without requiring the title to be on the watchlist. See GOAL.md.
Restarts used: 0 of 2

# Done so far
- Read app architecture end to end: `app/page.tsx` (tabs/panels + chatSend
  ref), `components/ChatPane.tsx` (ChatSend type, silent-turn lane, trace/
  onTurnEnd wiring), `components/Watchlist.tsx` (`markWatched`/`ReviewForm`
  — the exact pattern to replicate), `lib/watchlist.ts` (`enrich`/`resolve`),
  `lib/tmdb.ts` (`searchMulti`, no existing client search route), `lib/prompt.ts`,
  `lib/vault.ts` (`buildGraph` reads purely from wiki files + watchlist.json —
  a movie page with `rating`/`verdict` frontmatter shows up regardless of
  watchlist membership, confirms criterion 4 is satisfied once criterion 5's
  write happens).
- Confirmed no debounce utility and no existing `/api/search`-style route
  exist in the codebase.
- Wrote GOAL.md with success criteria and context (still accurate, don't
  re-read those source files again — facts captured here and there).
- **TURN 2: live-verified the load-bearing assumption — CONFIRMED TRUE.**
  Cloned vault essentials to
  `<scratchpad>/vault-sandbox` (per project memory recipe), built the app,
  ran `VAULT_PATH=<scratchpad>/vault-sandbox nohup npm start -- -p 3999 &
  disown`, POSTed a `<watchlist-log>` silent turn for "Paprika (2006)" (a
  title in neither `data/watchlist.json` nor the hub's Watchlist section).
  179.2s/34 turns/success. Verified on disk: new movie page with full
  frontmatter (rating, verdict, genres), new person page, hub Seen row,
  3 genre + 2 theme + 1 era category pages linked, indexes + log updated —
  identical shape to a tracked-title log. Server on :3999 has been stopped;
  the cloned vault dir still exists at `<scratchpad>/vault-sandbox` if
  another sandboxed run is ever needed (rebuild: `npm run build` in repo
  root, then `VAULT_PATH=<clone> nohup npm start -- -p 3999 & disown`).
- Established that `preview_start`'s "dev" launch.json config (port 3001)
  uses the REAL `.env.local` `VAULT_PATH` — full click-through UI testing
  there must stop short of clicking the final submit button (see Lessons).

# Lessons
- This app's silent-turn background mechanism (`onChat(text, onDone,
  {silent:true})` in ChatPane) is the ONE way things get logged into the
  taste graph from app UI — never invent a second path.
- AGENTS.md warns this Next.js build has custom conventions vs. training
  data — mirror `app/api/watchlist/route.ts`'s existing working pattern for
  any new route instead of writing one from memory.
- **NEVER run test chat turns (or full click-through UI tests that could
  trigger one) against the real vault** — it writes fake ratings into the
  user's actual taste wiki. `preview_start`'s "dev" config (port 3001) uses
  the real VAULT_PATH — safe for verifying UI rendering, NOT safe for
  clicking a final "log it" submit button. Use the scratchpad vault-sandbox
  clone (see Done so far) for anything that actually fires a watchlist-log
  turn.
- A plain backgrounded Bash task gets SIGTERM'd at a 10-min cap, killing the
  SDK subprocess mid-turn (exit 143) — a real agent turn can run long
  (up to ~180s observed, rate-limit backoff can push it further). Use
  detached `nohup ... & disown` for sandbox server processes; use
  `run_in_background` on the Bash tool (not shell backgrounding) for the
  curl/SSE call itself so the harness notifies on completion instead of
  polling.
- `ReviewForm` in Watchlist.tsx only reads `item.title` — safe to generalize
  its prop to `title: string` and export it for reuse in the new page.

# Status: DONE (Completion Review passed)
All 7 GOAL.md criteria re-verified with fresh evidence in turn 5 (live,
real vault, user-approved) + this build check:
1. Quick Rate tab + live TMDB search — verified live.
2. Rating form (reused ReviewForm) — verified live.
3. Silent background submit + pending state, non-blocking — verified live
   (searched a second title while first was still pending).
4. Graph reflects new node post-completion — verified via /api/graph.
5. Works for a title never on the watchlist — verified twice (sandbox +
   real vault, both confirmed absent beforehand).
6. `next build` clean — verified (no lint script in this project; build's
   TypeScript pass is the gate).
7. Manual end-to-end browser verification — done via preview tools, with
   real-vault test data reverted and committed as a cleanup commit
   afterward (net zero change to user data).

Final diff footprint: `app/api/search/route.ts` (new), `components/QuickRate.tsx`
(new), `app/page.tsx` (+tab wiring), `components/Watchlist.tsx` (`ReviewForm`
generalized + exported for reuse). No changes to `lib/prompt.ts` — the
existing `<watchlist-log>` carve-out handled the untracked-title case with
zero modification, so the stop condition around touching agent prompt logic
never triggered.

# Current step (historical — turn 4 record, superseded by Status above)
Turn 4 — build `components/QuickRate.tsx` (Remaining plan item (d)), with
one deliberate upgrade over the original sketch: allow submitting a rating
and immediately returning to search for the next title, rather than
blocking on that one background turn — the silent lane in ChatPane already
queues concurrent silent sends (logQueueRef), and the user's ask was
explicitly to do this "quickly" / repeatedly. Design:
1. `"use client"` component taking `{ onChat: ChatSend }` as its only prop
   (same shape Watchlist receives from page.tsx).
2. Debounced search (inline `useEffect` + `setTimeout(300ms)`, cleanup
   clears the timer) against `/api/search?q=`, skipped while a result is
   picked or query is blank.
3. Results list: poster/title/year/media badge, click → `setPicked`.
4. Picked state: poster + title + the (now-exported) `ReviewForm` from
   `./Watchlist`, `onSubmit={(rating, review) => ...}`.
5. Submit builds `I watched {title}{year} — {rating}/10.{review}`, calls
   `onChat(text, onDone, {silent:true})`, tracks the call in a `pending:
   {id, label}[]` array (id = stable per-call key, e.g. media-id-counter,
   NOT Date.now() — keep it deterministic/simple, a incrementing ref is
   fine), IMMEDIATELY clears `picked`/`query` so the user can search again
   while it's still running, and moves the id from `pending` to a capped
   `logged` list (last 5) in `onDone`.
6. Render a small pending/logged strip below the search area: "logging
   {label}…" (pulsing) for each in-flight item, "Logged {label}." for
   recently finished ones.
7. Do NOT touch `app/page.tsx` yet — that's the next step.

# Verify this step
`next build` passes (TypeScript catches prop/type mistakes since there's no
browser check yet — component isn't wired into a page). Read the file back
once written and confirm it only imports `ReviewForm`/types that actually
exist (`ChatSend` from `./ChatPane`, `ReviewForm` from `./Watchlist`).

# Remaining plan
(a) [MOST UNCERTAIN] Live-verify the load-bearing assumption: start the dev
    server, send a silent turn for a title that is NOT in data/watchlist.json
    and not on the hub's Watchlist section (e.g. via a temporary test button
    or directly POSTing the shape ChatPane would send to /api/chat with the
    watchlist-log tag), and confirm data/wiki actually gets a Seen row/movie
    page/category links for it, exactly like a normal "Watched it" click
    would. If it does NOT work untracked, escalate/confirm with the user
    before touching lib/prompt.ts (GOAL.md stop condition).
(b) Build `app/api/search/route.ts`: GET ?q=, wraps `searchMulti` from
    lib/tmdb.ts, returns trimmed JSON array (id/title/year/media/poster_path).
    Mirror app/api/watchlist/route.ts's NextRequest/NextResponse pattern.
    Verify: curl the route while dev server runs, confirm JSON shape.
(c) Generalize `Watchlist.tsx`'s `ReviewForm` to take `title: string` instead
    of `item: WatchItem`, export it, update its two call sites in
    Watchlist.tsx. Verify: `npm run lint` clean, Watchlist tab still renders
    and its existing "Watched it" flow still works via preview.
(d) Build `components/QuickRate.tsx`: debounced search input → results list
    (poster/title/year/media badge) → click result → exported ReviewForm →
    submit calls `onChat(\`I watched ${title}${year} — ${rating}/10.${comment}\`,
    onDone, {silent:true})` with a pending/logging state, success confirmation,
    and ability to search again immediately after. Verify: component renders,
    typecheck passes.
(e) Wire into `app/page.tsx`: add `"rate"` to the `Panel` type and `TABS`
    array, pass `onChat` the same way Watchlist gets it, render `QuickRate`.
    Verify: tab appears and switches correctly via preview_snapshot.
(f) Full end-to-end browser verification with preview tools: search a real
    title, submit a rating+comment, watch the pending state, confirm the
    Projection Booth shows trace activity, confirm the Taste Graph tab
    updates after completion, confirm data/wiki diff matches expectations.
    Covers GOAL.md criteria 1-5, 7.
(g) `npm run lint` (and build if it exists as a script) clean run — no new
    errors/warnings introduced. Covers GOAL.md criterion 6.
(h) Completion Review: re-check all 7 GOAL.md criteria with fresh evidence
    (not recalled), summarize, report.
