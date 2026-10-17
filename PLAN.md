# Marquee: performance, mobile UI, and color system plan

**BLUF.** The architecture is sound and should not be rebuilt. What makes the phone feel clunky is a handful of concrete, measurable defects: two render loops that never idle, a rating control that is physically too narrow, tap targets half the recommended size, panels that throw away their state on every tab switch, and one amber color doing seven different jobs. Fix those in the order below. Measure first, tokens second, UI third, render performance fourth, data layer last.

Everything in this document was measured on the current `main` (commit `832157e`) with a production build, a seeded 18-title vault, and a headless iPhone 13 viewport. Typecheck, 46 unit tests, and `next build` all pass today. The audit script and seed vault live in the session scratchpad and are described in Phase 0 so they can be checked in.

---

## 1. What was found

### 1.1 Performance (measured)

| Measurement | Value | Verdict |
|---|---|---|
| Initial client JS, first paint (7 module scripts, polyfill excluded) | 208 KB gzip | Heavier than it looks: the page chunk (65 KB gzip) bundles the markdown stack (micromark + react-markdown) with the shell. Measured by `npm run budget`; an earlier figure of 132 KB counted only the framework chunks. |
| Taste Graph tab, 2D | +2 chunks (force-graph) | Lazy, good |
| Taste Graph tab, 3D | +1.3 MB raw / 340 KB gzip (three.js) | Lazy, good; still heavy for a phone |
| 2D graph idle redraw | 119 frames in 2 s (60 fps, nothing moving) | **Defect.** `autoPauseRedraw={false}` plus `shadowBlur: 12` on every node every frame |
| 3D graph idle render | 66 frames in 2 s | Expected for three.js, but it never pauses when the tab is hidden or the app is backgrounded |
| `/api/graph`, 63 nodes | 18 ms | Fine; ETag/304 already in place |
| `/api/watchlist` cold | 38 ms (TMDB disabled) | Will be seconds on a cold cache with TMDB on, and the GET writes to disk |

Code-level findings that the numbers do not show:

- **Chat streaming is O(n²).** Every token delta re-renders every message bubble, and each bubble re-runs the full markdown parse. On a long reply on a phone this is visible as input lag.
- **Trace events fan out to the whole tree.** `Home` keeps the Booth trace in `useState` and passes new closures to `ChatPane` on every render, so each trace line re-renders the chat, the open panel, and the graph accessors. The array is unbounded.
- **Panels remount on every tab switch.** `GraphView` and `Watchlist` refetch and re-simulate each time they open. The 2D graph never calls `zoomToFit`, so on a phone the layout spills off-canvas (see screenshot `m4-graph-2d`). `PredictPanel` is permanently mounted as a workaround and therefore fetches the graph and runs a 10 Hz interval from app start for every user.
- **Posters are served at w342 into 64 px slots** with no `loading="lazy"`, `decoding`, or intrinsic size.
- **The vignette overlay** is a fixed full-screen radial gradient at `z-50` on every device.

### 1.2 Mobile UI (iPhone 13 viewport, 390 × 844)

| Screen | Finding |
|---|---|
| Quick Rate review | **Rating buttons squeezed to 19 px wide** (the 10-button row is inside the narrow column beside the poster). Unusable. |
| Watchlist review | Rating buttons 27 px wide; action row wraps with the `⋮` orphaned on its own line |
| Watchlist cards | 22 of 22 interactive elements under 44 px: Trailer / Watched it / + My watchlist are 23 px tall, Show more is 17 px |
| Panel title bar | Close is 31 × 16 px; `‹ More` is 35 × 16 px |
| Graph 2D | 63 labels drawn at once: unreadable label soup; nodes cut off at top and bottom; node detail panel is a floating 85%-width card over the nodes |
| Help | Section nav wraps to four rows of 25 px chips before any content |
| Header | Three lines of text (title, tagline, model id) on a phone; the model id is developer noise |
| Chat busy bar | Tip text truncated to 157 px |
| Home | Hero plus copy overflows the first screen; the "or just type" hint sits under the input bar |
| Typography | 30 uses of 11 px text, 3 of 10 px, 1 of 9 px |
| Touch | HTML5 drag-to-reorder does not work on iOS touch; outside-click dismissal uses `mousedown`, which iOS does not synthesize on non-interactive elements; no `active:` pressed states anywhere; no `overscroll-behavior`, so pull-to-refresh and rubber-banding fight the fixed layout in the installed app |
| Keyboard | Bottom nav stays visible above the keyboard and takes ~50 px from an already short chat area |

### 1.3 Color (current state)

Eight tokens in `globals.css`, but 40 hard-coded hex/rgba literals across `ChatPane`, `GraphView`, `PredictPanel`, `useHeatEngine`, `Widgets`, and the manifest. Role overloading is the real problem, not the palette itself:

| Token | Jobs it currently does |
|---|---|
| `glow` #f5b942 (129 uses) | brand title, primary button border, loved verdict, liked verdict, links, markdown headings, active tab, selection ring, watchlist nodes (at 40% alpha), particles |
| `candle` #e07b39 | category nodes, "Louie predicts" badge, suggestions heading, trailer link |
| `ember` #b3402e | disliked verdict, danger actions, error titles |
| `muted` #a89d90 | secondary text, disabled text, placeholders, 10 px model id at 70% |
| `#8a8178` (no token) | meh verdict **and** unrated movies: two meanings, one color |

Contrast (WCAG, measured):

| Pair | Ratio | Status |
|---|---|---|
| ember text on card | 3.27 | Fails AA for body text (danger labels, error title) |
| muted at 70% on background | 4.11 | Fails AA at 10 px |
| card vs background | 1.06 | Surfaces are indistinguishable; every edge needs a border |
| loved vs liked | 1.00 | Identical colors; information lost |
| foreground, glow, candle, muted | 6.6 to 14.6 | Pass |

Alpha usage: `glow/10 /15 /20 /25 /40 /50 /60 /90` are all in use (58 occurrences). That is eight tints of one color chosen ad hoc per component.

### 1.4 System design (short)

Keep: background turns with resumable SSE, the engine abstraction, the silent logging lane, the ETag'd graph, the vault-as-markdown model. These are the best parts of the codebase and none of the felt problems come from them.

Fix:
- `Home` is the single owner of all cross-panel state with inline closures (re-render fan-out).
- Data fetching is per-panel `fetch` in `useEffect`, no cache, no dedupe, no retained state.
- No error boundary: one render error in a panel blanks the whole app (the Louie-growl commits in history were this failure mode).
- `writeUserList` writes JSON non-atomically; `lib/push.ts` already has the tmp-and-rename pattern to reuse.
- `GET /api/watchlist` has write side effects (refreshStale persists) and does TMDB round-trips inline.
- `/api/search` returns 500 when `TMDB_API_KEY` is unset; the UI renders that as "No results."
- `package.json` has no `lint` script (the `.loop` goal file assumes one exists).

---

## 2. Target color system

Principle: one role per token, hue for category, lightness for ordinal. The warm theater identity stays; it just stops being used for data.

### 2.1 Tokens (`app/globals.css`, Tailwind v4 `@theme`)

```css
:root {
  /* surfaces: a real 4-step scale instead of bg + card */
  --surface-0: #0c0a08;   /* page */
  --surface-1: #14110e;   /* panels, cards */
  --surface-2: #1c1713;   /* inputs, nested cards, chat bar (already used ad hoc) */
  --surface-3: #241e18;   /* hover/pressed, menus */
  --border:    #2a221a;
  --border-strong: #3a2f22;

  /* text */
  --text:        #e8dcc8;
  --text-muted:  #a89d90;   /* 7.0 on card: AA at 12px+; never below 12px */
  --text-faint:  #6f665c;   /* decorative only, never for information */

  /* brand and interaction: the ONLY uses of amber outside the graph */
  --accent:        #f5b942;
  --accent-text:   #0c0a08;   /* text on a filled accent button */
  --accent-subtle: rgb(245 185 66 / 0.10);  /* hover wash */
  --accent-muted:  rgb(245 185 66 / 0.18);  /* selected chip, active tab */
  --accent-border: rgb(245 185 66 / 0.55);  /* outlined primary button */
  --focus:         #f5b942;   /* focus ring, 2px, offset 2px */

  /* status */
  --danger:      #d4563f;   /* 4.6 on card: passes AA; replaces ember for TEXT */
  --danger-deep: #b3402e;   /* fills, graph "disliked" node */
  --success:     #8fae6b;   /* "logged", "on your watchlist" */
  --info:        #7fa3b8;   /* badges that are facts, e.g. "Louie predicts" */

  /* taste graph: verdict is ordinal (lightness), kind is categorical (hue) */
  --verdict-loved:    #f5b942;
  --verdict-liked:    #d19a4a;
  --verdict-meh:      #8a8178;
  --verdict-disliked: #c0452f;
  --node-unrated:     #5a5048;   /* movie page without a verdict: visibly "not data" */
  --node-category:    #7fa3b8;   /* cool steel: structure, not taste */
  --node-taste:       #e8dcc8;
  --node-watchlist:   transparent;  /* hollow ring in --verdict-loved */
  --node-ghost:       rgb(232 220 200 / 0.33);
  --edge:             #2a221a;
  --edge-active:      #f5b942;
}
```

Rules:
- Only `--accent*` may use amber in UI chrome. Headings in chat markdown become `--text` at 600 weight, not amber; amber was carrying no meaning there.
- `candle` is retired. "Louie predicts" becomes `--info`; the suggestions heading becomes `--text`; Trailer becomes a normal secondary button.
- `ember` text uses become `--danger`; fills keep `--danger-deep`.
- Three named tints replace the eight ad hoc `glow/NN` alphas.
- Add `color-scheme: dark` on `:root` so native `<select>` and scrollbars render dark.
- Canvas and three.js read tokens at mount via `getComputedStyle(document.documentElement)` through one helper (`lib/theme.ts: token("--verdict-loved")`), so CSS stays the single source of truth and the 40 literals disappear.
- The Help page color legend and the desktop legend strip are regenerated from the same token names (categories are now blue-gray; update the copy).

### 2.2 Why cool category nodes

In the current graph, category orange and loved gold are 1.4:1 apart at 5 to 7 px radius; on the phone screenshot they read as the same thing. Your verdicts are the data; categories are scaffolding. A cool, desaturated hue for scaffolding makes the warm verdict ramp pop and lets "unrated" recede. This is the one visible brand change in the plan; everything else is consolidation.

---

## 3. Target mobile UI

Primitives first (four components, no library): `Button` (sizes `md` 44 px / `sm` 36 px desktop-only, variants primary / secondary / ghost / danger), `IconButton` (44 px hit area, visual 28 px), `Chip` (selectable, 36 px tall), `Sheet` (bottom sheet for mobile detail views). Every existing button maps onto one of these; no bespoke class strings in panels.

Per screen:

1. **Rating control.** Replace the 10-across row with a 5 × 2 grid of 44 px cells on mobile (single row of 36 px on `md+`). In Quick Rate, move `ReviewForm` below the poster row at full card width. Same component serves Watchlist, Quick Rate, and the chat checklist widget.
2. **Cards (Watchlist, suggestions).** Poster 56 × 84 at `w185`, title row with `⋮` pinned top-right, one primary action (Watched it / + My watchlist) and one secondary (Trailer) at 40 px, metadata chips at 12 px. Reorder: up/down `IconButton`s plus the # select; drop HTML5 drag on touch (keep it on `md+` if wanted).
3. **Bottom nav.** 56 px plus safe area, icon over 11 px label (icons make 11 px labels acceptable), 2 px active indicator, `aria-current`. Hide while the chat input is focused (listen to `visualViewport`), so the keyboard does not stack on the nav.
4. **Panel title bar.** 48 px; back/close as 44 px `IconButton`s; title at 16 px.
5. **Header on mobile.** Icon + "Marquee" only. The served model id moves to the Booth header and Help.
6. **Graph.** `zoomToFit(400, 24)` on engine stop and on resize; labels only for category nodes when zoomed out, movie labels when screen radius > 6 px or node is selected/hot; node detail opens as a `Sheet` on mobile (half-height, drag to expand) and stays a side card on desktop; mode toggle and legend behind one 44 px "i" button on mobile.
7. **Help.** Section nav as a single horizontally scrolling row with scroll-snap, or a `<select>`; sections collapsible with the first open.
8. **Chat.** Hero capped at `max-h-[30dvh]`; busy bar drops tips on mobile and shows only activity + Stop; message text 15 px on mobile; assistant bubbles `mr-2`, user bubbles `ml-8`.
9. **Global.** `overscroll-behavior: none` on `body` and panels; `touch-action: manipulation` on buttons; `-webkit-tap-highlight-color: transparent`; `active:` states on every primitive; `pointerdown` for outside-click dismissal (MoreMenu, GraphView); vignette removed below `md`; minimum text size 12 px, 10 px and 9 px removed; `env(safe-area-inset-left/right)` on the shell for landscape.

Acceptance (automated in Phase 0, run on every PR): no horizontal document overflow on any screen; zero interactive elements under 44 × 44 CSS px on mobile; zero text under 12 px; every screen passes axe color-contrast.

---

## 4. Performance plan

Ordered by felt impact per hour.

1. **2D graph render loop.** `autoPauseRedraw` back to default; drive explicit redraws from the heat tick only while heat or ghosts exist (`fgRef.current?.refresh()` is not needed: setting a state that changes an accessor is enough, or use `d3ReheatSimulation` sparingly). Replace per-node `shadowBlur` with a pre-rendered radial-gradient sprite drawn with `drawImage` (one allocation per color). Expected: idle 0 fps, hot ≤ 10 fps, no GPU shadow pass.
2. **3D graph lifecycle.** `pauseAnimation()` when the panel is hidden, `document.hidden`, or mode is 2D; `resumeAnimation()` on return. `nodeResolution` 8 on mobile. Default to 2D on phones; 3D is opt-in per session. Keep three.js lazy (it already is).
3. **Streaming chat.** Buffer text deltas and flush once per animation frame; render the in-progress bubble as plain text with a 150 ms throttled markdown pass; `React.memo` the `Markdown` component so finished bubbles never re-parse.
4. **Re-render fan-out.** Move trace into a small external store (`useSyncExternalStore`, ring buffer of 500) subscribed only by Booth and the live-thinking bridge; `useCallback` the handlers passed to `ChatPane`; `React.memo` the panels.
5. **Panel persistence.** Mount every panel once on first visit and toggle with `hidden` (what `PredictPanel` already does), so graph layout, scroll position, and watchlist data survive tab switches. Lift `/api/graph` and `/api/watchlist` into one fetch store keyed by `graphVersion` with request dedupe, so two panels never double-fetch and `PredictPanel` does not fetch at app start.
6. **Images.** `srcset` with `w185 1x, w342 2x` for 56 to 64 px slots, `w342` for recommendation cards; `loading="lazy"`, `decoding="async"`, explicit `width/height`. Do **not** turn on `next/image` optimization: it would spend Nano CPU re-encoding TMDB posters; plain `img` with `srcset` is the right call for this host.
7. **Server.** `/api/watchlist` GET returns cached data immediately and refreshes TMDB in the background (stale-while-revalidate) with the atomic write helper; search returns `503 {error:"TMDB_API_KEY missing"}` and the UI shows that.
8. **Bundle.** Run the Turbopack bundle analyzer (`next build` with the experimental analyzer flag documented in `node_modules/next/dist/docs/01-app/02-guides/package-bundling.md`) once; lazy-load the markdown stack on first assistant message if it stays above 60 KB gzip. Budget: initial ≤ 200 KB gzip (enforced by `npm run budget`), graph tab ≤ +100 KB, 3D ≤ +350 KB.
9. **Service worker.** Keep current strategy; add a one-line `clients.claim` + reload prompt on new build so an offline open after a deploy does not reference missing chunk names. Low priority.

Not doing: a global state library, a UI kit, `next/image`, or an engine/turn rewrite. None of them pay for themselves at this app's size.

---

## 5. Functionality test plan

Current coverage: 46 unit tests over the server side (engines, turns, push, vault, graph cache). Zero UI or integration coverage, no lint.

1. **Lint.** Add `eslint` + `eslint-config-next` (flat config) and `npm run lint`; Next 16 no longer ships `next lint`.
2. **Playwright e2e against the mock engine** (`MARQUEE_ENGINE=mock`, seeded vault, `/api/search` stubbed; the Phase 0 audit script already does this). Flows:
   - send message → streamed reply → options widget → answer → second turn on the same session
   - Watchlist "Watched it" → silent turn → item removed → graph refetch (`graphVersion` bump) shows the new node
   - Quick Rate → pending pill → logged pill; two rapid logs queue in order
   - Screen Test SSE: status → considers → verdict card; cancel mid-run aborts the request
   - reload mid-turn restores the transcript and resumes the stream (server side is tested; the client restore path is not)
   - New chat clears local transcript and session
   - manifest and service worker register on `localhost`
3. **Mobile layout gate** (from the audit script): iPhone 13 and a 360-wide Android profile; assert no overflow, tap targets ≥ 44, text ≥ 12 px, axe contrast clean, on every panel including open review forms and menus.
4. **Performance gates** in CI: bundle budgets from §4.8; idle canvas repaints on the graph tab ≤ 5 per 2 s (force-graph keeps its frame loop alive for input, so repaints are the honest measure); chat with a 2,000-word mock reply keeps input latency under 50 ms (measure with `performance.now()` around keypress in the test).
5. **Manual device pass** (installed PWA over Tailscale HTTPS, one checklist, run before each release): keyboard + bottom nav, outside-tap dismiss, 3D pauses when backgrounded, push arrives for a detached turn, battery drain over a 10-minute graph session before vs after.

---

## 6. Phases and order

| Phase | Scope | Size | Exit criterion |
|---|---|---|---|
| 0. Measure | Check in the seed vault, the Playwright audit, lint, bundle budgets; wire into CI | 0.5 day | Red/green gates exist for everything in §3 acceptance and §4.8 |
| 1. Tokens | §2 tokens, `lib/theme.ts`, replace all 40 literals, primitives (`Button`, `IconButton`, `Chip`, `Sheet`) | 1 to 1.5 days | Zero hex literals outside `globals.css`; contrast gate green |
| 2. Mobile UI | §3 items 1 to 9, in that order (rating control first) | 2 to 3 days | Layout gate green on both profiles; manual pass on the phone |
| 3. Render perf | §4 items 1 to 6 | 2 days | Idle rAF gate green; streaming latency gate green |
| 4. Data layer | §4 items 7 to 8, error boundaries, atomic writes, search 503 | 1 day | e2e flows green |
| 5. Tests | Remaining §5 e2e flows, device checklist doc | 1 day | CI runs e2e on PRs |

Tokens come before UI because every mobile fix rewrites class strings; doing UI first means touching each component twice. Measurement comes first because "optimize performance" without a gate regresses within a month.

## 7. Open decisions (your call, defaults in bold)

1. Category node hue: **cool steel-blue** vs stay warm (loses verdict separation).
2. 3D on phones: **opt-in per session** vs default (costs battery and a 340 KB download).
3. Markdown headings in chat: **plain bold** vs keep amber (amber then means nothing).
4. Reorder on mobile: **up/down buttons + # select** vs long-press drag (more code, less discoverable).
