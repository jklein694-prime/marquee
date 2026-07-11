# Reflections Log

## Turn 1 (prep)
- Gaps: none new — GOAL.md's "Key context" section already captured
  everything the codebase read surfaced, so this turn's plan draft folded
  straight into the initial write rather than needing a second pass.
- Wrong turns: none yet (nothing built).
- Assumptions: the big one is GOAL.md's "load-bearing assumption" — that
  `<watchlist-log>`'s prompt-text carve-out handles an untracked title the
  same as a tracked one, since it's gated on message *shape* ("I watched
  X ...") not on the item existing in data/watchlist.json. Kill condition:
  if step (a)'s live test shows no Seen row/movie page for an untracked
  title, the assumption is false and the plan needs a real replan (possibly
  touching lib/prompt.ts, which GOAL.md explicitly gates behind
  user confirmation).
- Rule: verify the riskiest/least-certain assumption with a live system
  probe before writing any UI code for it — cheap to check, expensive to
  discover wrong after building the whole page on top of it.

## Turn 2 (live verification)
- Gaps: none — the sandbox recipe from project memory worked exactly as
  documented, no adaptation needed.
- Wrong turns: none.
- Assumptions resolved: the load-bearing assumption is CONFIRMED true.
  Sent `<watchlist-log>\nI watched Paprika (2006) — 8/10. ...` (a title
  absent from both data/watchlist.json and the hub's Watchlist section)
  against a sandboxed server (VAULT_PATH=scratchpad clone, port 3999).
  179.2s / 34 turns / success. Verified on disk (not just trace): new
  `wiki/movies/Paprika (2006).md` with full frontmatter (rating: 8,
  verdict: loved, genres, director), a new `wiki/movies/people/Satoshi
  Kon.md` page, hub Seen row inserted, 3 genre pages + 2 theme pages + 1
  era page cross-linked, sub-indexes updated, log.md updated. Identical
  shape to a normal tracked "Watched it" entry. No widgets emitted (silent
  turn respected). This retires the biggest risk in GOAL.md — remaining
  work is now standard plumbing (search route, form, wiring), not a
  behavioral unknown.
- New assumption surfacing for later turns: full click-through UI testing
  (search → pick → submit → pending → graph update) cannot safely run
  against the real dev server (`preview_start`'s "dev" config on port 3001
  uses the real VAULT_PATH from .env.local) without writing a fake rating
  into the user's actual taste wiki. Kill condition / plan: verify UI
  rendering (search results, form appearing, button enable/disable) live
  via preview_start WITHOUT clicking final submit; rely on this turn's
  sandboxed proof for the write-path; disclose this scope boundary
  explicitly in the final report rather than silently skipping it.
- Rule: never point `preview_start`'s dev server or any live click-through
  test at the real VAULT_PATH for anything that fires a silent watchlist-log
  turn — the real vault has no test/sandbox flag distinguishing fake data
  from real.

## Turn 3 (search route + shared form)
- Gaps: `preview_start` couldn't launch — the user already has their own
  `next dev` running on port 3000 (PID 43991) and this Next.js build
  refuses a second dev server for the same project dir regardless of port
  (confirms the prior project-memory note). Not something the plan
  anticipated; adapted by curling the user's own running server directly
  for the read-only /api/search check instead of a browser preview.
- Wrong turns: none — build was clean on first attempt for both the new
  route and the ReviewForm prop rename.
- Assumptions: did NOT get a live DOM/browser confirmation that
  Watchlist's "Watched it" form still renders identically post-rename.
  Substituted a weaker but still solid check: the prop rename touches
  exactly one call site (grepped, confirmed), is a pure rename with no
  logic change, and `next build`'s TypeScript pass would have failed loudly
  on any missed/mismatched call site. Kill condition: if turn 5/6's full
  UI pass (once it's safe to use a preview server) shows anything off in
  the Watchlist rating form, revisit this turn's change first.
- Rule: `next dev` in this project is single-instance per directory
  regardless of port — never assume `preview_start` can spin up a second
  server; check for `pgrep -f "next dev"` and treat an existing one as the
  user's own session (do not kill it), fall back to curl-only verification
  against it for read-only endpoints.

## Turn 4 (QuickRate component + page wiring)
- Gaps: none in the build itself (clean `next build` first try). Real gap
  found during testing (see Turn 5): a component-lifecycle issue where
  in-flight pending/logged state lives in QuickRate's own local state, so
  navigating to another tab unmounts it and silently drops that state —
  discovered live, not anticipated at design time. Confirmed this exactly
  mirrors an existing, accepted limitation in `Watchlist.tsx` (its own
  `pending` Set is equally lost on unmount) — not a new defect class, a
  consistent tradeoff. Left as-is rather than "fixing" it beyond what the
  rest of the app already does (would be unrequested scope creep).
- Wrong turns: none.
- Assumptions: none new.
- Rule: the actual background turn (fetch in ChatPane) is NOT tied to
  which tab/panel is visible — it's owned by the always-mounted ChatPane,
  so switching tabs never cancels an in-flight silent log. Only the local
  UI reflecting its progress can be lost. Don't confuse "component
  unmounted" with "turn cancelled."

## Turn 5 (live end-to-end verification, real vault, user-approved)
- Gaps: `preview_start` couldn't launch while the user's own `next dev`
  occupied the project-wide dev lock (same single-instance issue as turn
  3, but this time genuinely blocking, since a live click-through needs
  DOM tools). Asked the user via AskUserQuestion; they approved briefly
  stopping/restarting their server. The auto-mode permission classifier
  separately and correctly blocked the actual "Log it" click on the first
  attempt, since my earlier dev-server question hadn't explicitly covered
  consenting to write fake data into the real vault — asked a second,
  narrower AskUserQuestion specifically about that, got explicit approval,
  then proceeded.
- Wrong turns: initially miscalled the test as "stopped early / possibly
  broken" because a poll (grep for the hub row appearing) fired on an
  EARLY intermediate write, not completion — the real vault has far more
  existing cross-references than the turn-2 sandbox clone, so the agent
  took ~7 minutes end-to-end (vs. ~3 min in the smaller sandbox), well
  within documented rate-limit-backoff norms. Correctly diagnosed by
  reading the full Projection Booth trace (not the truncated a11y
  snapshot) and rechecking disk state after more time passed, before
  concluding anything was actually wrong.
- Assumptions resolved: FULL end-to-end chain confirmed live — search
  (real TMDB results) → pick → ReviewForm renders → submit → onChat fires
  silent turn → UI immediately returns to search with a "logging…" pill
  (proves concurrent-search-while-pending works) → backend writes hub Seen
  row + movie page + person page + 3 genre/theme/style pages + index,
  exactly matching turn 2's proof → `/api/graph` returns the new
  `Paprika (2006)` node (kind: movie, verdict: loved, rating: 8) and
  `Satoshi Kon` node. This closes GOAL.md criteria 1-5 and 7 with live
  evidence, not just code-level reasoning.
- Did NOT visually confirm the "Logged X" confirmation pill rendering
  (see Turn 4 gap — navigated away before it could render). Confirmed via
  code read instead: `onDone` unconditionally calls `setLogged`, the only
  way it fails to render is the known/accepted unmount case.
- Cleanup: reverted every file the live test touched
  (`git checkout <parent-commit> -- ...` for the two files caught in the
  vault's auto-commit, `git checkout HEAD --` for the rest, `rm` for the
  two new pages), committed the revert (`3852d21`, matching this repo's
  existing "remove test entry" convention), and restored the user's dev
  server to its original plain `next dev` (port 3000) — NOT the
  `-H 0.0.0.0 -p 3001` launch.json variant, which was a different config
  than what was actually running. Net effect on the user's real data and
  environment: zero.
- Rule: an "auto-commit" hook can commit a write mid-turn — checking
  `git status` alone right after a turn "completes" (per SSE `done`) is
  not sufficient to know what actually landed; check `git log` for new
  commits AND working-tree diffs, and when reverting, target the specific
  files touched rather than a blanket `git reset --hard` (which would
  also stomp unrelated pre-existing dirty files in the same repo).
