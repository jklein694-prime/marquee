# Goal

Add a "Quick Rate" page/tab to the movie-engine app: search TMDB for any
movie or TV show, submit a rating (1-10) and an optional comment, and have
that logged the same way "Watched it" in the Watchlist tab works today —
a silent background chat turn that writes the hub Seen row, movie page, and
category pages, and grows the taste graph — WITHOUT requiring the title to
already be on the watchlist.

## Success criteria (all must hold at Completion Review)

1. A new tab exists (alongside Taste Graph / Watchlist / Projection Booth /
   Help) that lets the user type a query and see live TMDB search results
   (poster, title, year, movie/TV badge) for both movies and TV.
2. Picking a result shows a 1-10 rating control + optional comment textarea,
   matching the existing Watchlist "Watched it" form's look and feel.
3. Submitting fires a **silent** background turn (same mechanism as
   `Watchlist.tsx`'s `markWatched`: `onChat(text, onDone, { silent: true })`)
   with a message of the shape `I watched {title} ({year}) — {rating}/10. {comment}`.
   The UI shows a pending/logging state and does not block other app usage
   while it runs.
4. After the turn completes: `data/wiki` gains/updates a Seen row + movie
   page + category-page links for that title (verified by inspecting the
   vault files before/after), and the Taste Graph tab (GraphView, keyed by
   `graphVersion`) reflects the new node after `onTurnEnd` fires — exactly
   like it does today after a Watchlist "Watched it" submission.
5. Works for a title that was never added to the watchlist (the whole point
   of "quickly" rating something) — not just titles already enriched as
   `WatchItem`s.
6. `npm run lint` (or the project's existing type-check/build command) passes
   with no new errors.
7. Manually verified end-to-end in the running dev server via the browser
   preview tools: search → pick → rate → pending → graph updates.

## Verification method

- `npm run lint` / `next build` for static correctness.
- Live browser check via `preview_*` tools against the dev server: perform a
  real search + rate flow, inspect network calls, inspect `data/wiki` /
  `data/watchlist.json` diffs, confirm the Taste Graph panel updates.
- Read `git diff` for the final change set before calling it done.

## Stop / failure conditions

- Max 6 turns before forcing a Completion Review.
- Max 2 restarts (per loop-engineer default).
- No destructive git operations, no editing `lib/prompt.ts`'s agent
  instructions unless the existing "watched X" flow turns out not to handle
  untracked titles (escalate/confirm with the user before touching prompt
  logic, since that changes agent behavior broadly).
- Don't invent a new "silent tag" carve-out in the prompt unless the existing
  `watchlist-log` tag demonstrably doesn't cover this case — reuse first.

## Key context already established (do not re-derive)

- Architecture: `app/page.tsx` hosts `ChatPane` (owns the real chat + a
  `chatSend` ref exposing `ChatSend`) and tab panels (`GraphView`,
  `Watchlist`, `HelpPanel`, booth). Panels get `onChat` wired as
  `(t, onDone, opts) => chatSend.current(t, onDone, opts)`.
- `ChatSend` type (`components/ChatPane.tsx`): `(text, onDone?, opts?: {silent?, tag?}) => "sent"|"queued"|false`.
  Silent turns run on a separate background session/queue, never touch the
  visible transcript, and still emit `trace` events (visible in the
  Projection Booth) and call `onTurnEnd` (bumps `graphVersion`) when done.
- `Watchlist.tsx`'s `markWatched()` is the exact existing analog: builds
  `I watched {title}{year} — {rating}/10.{review}` and calls
  `onChat(text, onDone, { silent: true })` (default tag `watchlist-log`).
- `lib/prompt.ts` line ~139: the `<watchlist-log>` tag carve-out already says
  "Run Flow 2 logging in full ... exactly as for a typed 'I watched X'" —
  this is prompt text, not code gated on the item being a tracked
  `WatchItem`, so an untracked title should already work through this same
  tag. This is the load-bearing assumption for criterion 5 — verify it live.
- No existing client-facing search endpoint. `lib/tmdb.ts` has
  `searchMulti(query)` (server-only, needs `TMDB_API_KEY`) returning
  `{id, title, year, media, overview, vote_average, poster_path, popularity}[]`
  for movies+TV combined — this is what a new `/api/search` route should wrap.
- No debounce utility exists in the codebase; a small inline
  `useEffect`+`setTimeout` debounce is the lazy correct choice.
- `Watchlist.tsx`'s `ReviewForm` component (rating buttons 1-10 + textarea)
  is styled exactly as needed for step 2's rating control; it currently
  takes `item: WatchItem` but only reads `item.title` — worth generalizing
  its prop to `title: string` and exporting it for reuse, rather than
  duplicating the JSX.
- Existing API routes (`app/api/watchlist/route.ts`) are the pattern to
  mirror for a new route: `NextRequest`/`NextResponse`, `export const
  dynamic = "force-dynamic"`.
