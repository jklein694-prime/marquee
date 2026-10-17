"use client";

// Marquee help / user guide.
//
// MAINTENANCE: this page documents real app behavior. When you change how the
// chat, watchlist, taste graph, or booth work, update the matching SECTION
// below in the same change so the guide never drifts from the app.

import { memo } from "react";
import { Markdown } from "./Markdown";
import PushToggle from "./PushToggle";
import { Chip } from "./ui";

type Section = { id: string; title: string; body: string };

const SECTIONS: Section[] = [
  {
    id: "welcome",
    title: "Welcome",
    body: `**Marquee** is your personal movie & TV expert, named **Louie**. You talk to
Louie in the chat; the other sections (Taste Graph, Watchlist, Quick Rate, Screen
Test, Projection Booth, Help) open beside it on a desktop, or from the bottom bar
on a phone.

Louie has no conversational memory between sessions — instead it keeps a linked
wiki of your taste that grows every time you talk. It handles **movies and TV
shows** together unless you narrow it ("a movie tonight", "a series to binge").

**Start here if your wiki is new:** log a batch of titles you've already seen,
with a rating for each, *before* asking for a recommendation — see "Building
your profile" below. On an empty graph Louie has no favorite directors, genres,
or patterns of yours to work from, so a pick request just gets a generic guess.
Ten or fifteen logged titles is enough for real patterns to show up. Be patient
after that too — the graph keeps sharpening the more you use it, and picks
noticeably improve between your 5th and your 20th logged title.`,
  },
  {
    id: "chatting",
    title: "Chatting",
    body: `Louie is built around **tapping, not typing** — nearly every reply ends with one
interactive widget, and you can always type instead if your answer isn't listed.

- **Choice chips** — a question with tappable options. In single-choice questions,
  tapping an option sends it immediately. In multi-choice, tap several then press
  **Confirm**.
- **Movie checklist** — a list of titles. Tick the ones you've seen; ticking
  reveals a **1–10** rating you can optionally set. Press **Confirm** to send.
- **Recommendation cards** — poster cards with a one-line "why it fits" and a
  **+ Watchlist** button.
- **"Steer me…" box** — the text box on chips and checklists takes a free-text
  nudge ("go older", "less crime") alongside your taps.

While Louie is still working, an unanswered widget is locked and shows
"unlocks when the expert finishes…".`,
  },
  {
    id: "finding",
    title: "Finding a pick",
    body: `*New wiki? Log some watched titles first (see "Building your profile") — a
recommendation is only as good as the taste graph behind it.*

Ask for a recommendation and Louie first offers a fork:

- **Guided survey** — one quick round of questions covering up to four of: **mood**
  (laugh / edge-of-seat / think / comfort), **genre or era**, **time commitment**,
  and **solo or with someone**. The "Find me something to watch" button on the home
  screen starts this.
- **Just describe it** — say what you want in your own words; Louie asks at most one
  clarifying question.

Either way, a research assistant gathers candidates in the background while you keep
chatting, then Louie shows **2–3 picks** as cards, each with a reason tying it to
your taste and where it's streaming.`,
  },
  {
    id: "three-ways",
    title: "Three ways to search",
    body: `- **Cast a wide net** — take the guided survey with broad moods/genres, or use a
  checklist to reveal a lot of your history at once. This gives the researcher a
  wider brief and blends movies and TV.
- **Go deep on one title** — after a pick or a question ("who directed Heat?"), take
  the follow-up options like "explore Michael Mann films" or "more like this" to
  drill into one title's neighborhood.
- **Find one thing fast** — choose **Describe** and state it exactly: "a 90-minute
  thriller on Netflix tonight." Louie keeps this path short and goes straight to
  picks.`,
  },
  {
    id: "profile",
    title: "Building your profile",
    body: `**This is where to start on a new wiki.** Tell Louie **"I watched X"** (or use
**Watched it** on the Watchlist, or the **Quick Rate** section) and it records:

- a row in your **Seen** ledger — your verdict (loved / liked / meh / disliked), a
  1–10 rating, and a short note;
- a **page for the title** with the facts (director, cast, year);
- **category pages** for every angle it touches — genre, style, people, studio, era,
  setting, theme.

One title teaches several preferences at once — loving *Heat* links it to Michael
Mann, LA crime, 90s thrillers, and slow-burn pacing. Say **"analyze my taste"** any
time and Louie runs a deeper pass: cross-cutting trends, gaps worth exploring, and
sharper profile notes you approve or reject.`,
  },
  {
    id: "gravity",
    title: "Usual vs. something new",
    body: `By default Louie leans toward what you've loved before and tells you **why** each
pick connects to your taste.

Say **"something different"** (or "not my usual") and it deliberately breaks out of
your patterns — keeping only your quality bar and any hard dealbreakers. Those picks
are tagged as exploration, so one adventurous night never distorts your profile; a
new favorite becomes a fresh branch of your taste instead.`,
  },
  {
    id: "watchlist",
    title: "The Watchlist",
    body: `Two lists plus a filter:

- **My services** (top) — unselect the streaming services you don't pay for to hide
  picks available *only* there. It's a view filter, saved in your browser; nothing is
  deleted and titles with no streaming info always stay visible.
- **My watchlist** — titles you've saved, ranked. Use the **arrows** to reorder (on a
  desktop you can also drag a card). **More** expands the note, the full **synopsis**,
  and **Louie's projected rating and why**. Each card has **Watched it**, **Trailer**,
  and a **⋮** menu with **Remove** and **Not interested** (each with an optional reason).
- **Louie's suggestions** — Louie's ranked queue, reordered best-fit-first as your
  taste sharpens. Cards carry a **"Louie predicts"** score, a **+ My watchlist**
  button, and a **⋮** menu with **Not now** and **Not interested**.
- **Not interested** (collapsible, at the bottom) — your permanent vetoes, each with a
  **Remove** button to lift it.

*Projected scores come from Louie's ranked suggestions. A title you save purely out
of curiosity (typed, or straight from a chat card) may not show a prediction — that's
expected.*`,
  },
  {
    id: "snooze-veto",
    title: "Snooze vs. veto",
    body: `- **Not now** (snooze) — hides a suggestion for **14 days**, then it comes back on its
  own. Nothing is deleted.
- **Not interested** (veto) — **permanent**: the title is never suggested again and is
  pulled off your watchlist. It outranks taste fit, so Louie won't re-pitch it even if
  it matches you well. It only lifts if you **Remove** it from the Not-interested list,
  change your mind in chat, or log it as watched.

Both actions offer an optional reason. A reason that reveals a real preference ("too
slow-paced") nudges your profile; a circumstantial one ("already saw the ending")
doesn't.`,
  },
  {
    id: "graph",
    title: "The Taste Graph",
    body: `A live map of your taste that grows as you talk. Warm colors are your verdicts;
the cool color is structure:

- **gold** — a title you loved
- **amber** — a title you liked
- **taupe** — a title you felt "meh" about
- **rust** — a title you disliked
- **dim grey** — a title with a page but no verdict yet
- **steel blue** — a category page (genre, person, theme, style, platform, era,
  setting). These are the bigger nodes.
- **faded gold** — something on your watchlist
- **cream** — a taste note (a distilled preference). These are the smallest nodes.

**Tap a node** to open its wiki page and light up its connections; tap it again,
or the background, to deselect. The **i** button shows this legend in the graph.
**3D** is a choice, not the default, on a phone — it costs battery.

**A node with no page** doesn't mean it's broken or reserved — it means the app knows
about it (something links to it) but no page has been written *yet*. For categories,
Louie fills it in as the topic comes up; for watchlist items it's by design, because
full pages exist only for things you've actually **seen**.`,
  },
  {
    id: "booth",
    title: "Projection Booth",
    body: `A live feed of everything Louie does behind the scenes — reading your wiki, writing
updates, dispatching research assistants, and "thinking…" status while it reasons. If
a reply takes a while, open the Booth to confirm it's working, not frozen. Blue-tinted
"sub" lines are background research assistants; the rest is Louie itself. The model
that served the last reply is shown at the top.`,
  },
  {
    id: "good-to-know",
    title: "Good to know",
    body: `- **Nothing locks the chat.** Logging a watch and updating your watchlist run in the
  background — you can keep chatting the whole time.
- **Curiosity isn't a taste signal.** Adding a title to your watchlist doesn't move
  your taste graph; only watching and rating it does.
- **Plain language only.** Louie sticks to standard film/TV terms, and if it ever uses
  shorthand from your profile it will say so plainly rather than pass it off as a real
  term. Just ask "what do you mean?" any time.
- **No emojis**, anywhere.`,
  },
  {
    id: "phone",
    title: "On your phone",
    body: `- **Install it.** Open Marquee at its HTTPS address (the Nano's Tailscale name,
  e.g. \`https://wikigardener.<your-tailnet>.ts.net\`), then Share -> **Add to Home
  Screen**. It opens full screen like a regular app.
- **Leave any time.** Replies are worked out on the Nano, not in the app — switch
  apps, lock the phone, or lose signal mid-reply and it keeps going. Come back and
  the rest of the answer is there; even after the phone reloads the app, the
  conversation is rebuilt from the Nano.
- **Notifications.** Turn them on below (iPhone: only from the home-screen app) and
  you get a notification when a reply finishes while Marquee is in the background.
- **New chat** (top of the conversation) starts a fresh session; your taste wiki is
  unaffected — it is the memory either way.`,
  },
];

function HelpPanel() {
  // scope the lookup to this panel (ids are unique to it while mounted, but be
  // explicit) and scroll to the section header
  const jump = (id: string) => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex h-full flex-col">
      {/* one scrolling row of chips: on a phone a wrapped nav took four rows */}
      <nav
        aria-label="Help sections"
        className="scrollbar-none flex shrink-0 snap-x gap-2 overflow-x-auto border-b border-border bg-surface-0/95 px-4 py-2 backdrop-blur-sm"
      >
        {SECTIONS.map((s) => (
          <Chip key={s.id} className="snap-start" onClick={() => jump(s.id)}>
            {s.title}
          </Chip>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-fg">Marquee — how it works</h1>
          <p className="mt-1 text-sm text-muted">
            A quick guide to Louie, the sections, and your taste graph. Jump to any section using the bar above.
          </p>
        </div>
        {SECTIONS.map((s) => (
          <section key={s.id} id={`help-${s.id}`} className="mb-6 scroll-mt-2">
            <h2 className="mb-1.5 border-b border-border/60 pb-1 text-base font-semibold text-fg md:text-sm">{s.title}</h2>
            <div className="text-[15px] leading-relaxed md:text-sm">
              <Markdown text={s.body} />
            </div>
          </section>
        ))}
        <div className="mb-6">
          <PushToggle />
        </div>
        <div className="mt-2 border-t border-border pt-3 text-xs text-muted">This guide is kept in sync with the app as features change.</div>
      </div>
    </div>
  );
}

export default memo(HelpPanel);
