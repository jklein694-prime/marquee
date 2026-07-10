"use client";

// Marquee help / user guide.
//
// MAINTENANCE: this page documents real app behavior. When you change how the
// chat, watchlist, taste graph, or booth work, update the matching SECTION
// below in the same change so the guide never drifts from the app.

import { Markdown } from "./ChatPane";

type Section = { id: string; title: string; body: string };

const SECTIONS: Section[] = [
  {
    id: "welcome",
    title: "Welcome",
    body: `**Marquee** is your personal movie & TV expert, named **Louie**. You talk to
Louie in the chat on the left; the tabs on the right (Taste Graph, Watchlist,
Projection Booth, Help) open panels alongside it. **Close** returns the chat to
full width.

Louie has no conversational memory between sessions — instead it keeps a linked
wiki of your taste that grows every time you talk. It handles **movies and TV
shows** together unless you narrow it ("a movie tonight", "a series to binge").`,
  },
  {
    id: "chatting",
    title: "Chatting",
    body: `Louie is built around **clicking, not typing** — nearly every reply ends with one
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
    body: `Ask for a recommendation and Louie first offers a fork:

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
    body: `Tell Louie **"I watched X"** (or use **Watched it** on the Watchlist) and it records:

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
    title: "The Watchlist tab",
    body: `Two lists plus a filter:

- **My services** (top) — uncheck the streaming services you don't pay for to hide
  picks available *only* there. It's a view filter, saved in your browser; nothing is
  deleted and titles with no streaming info always stay visible.
- **My watchlist** — titles you've saved, ranked. **Drag** a card or use the **#
  picker** to reorder. **Show more** expands the note, the full **synopsis**, and
  **Louie's projected rating and why**. Each card has **Trailer**, **Watched it**, and
  a **⋮** menu with **Remove** and **Not interested** (each with an optional reason).
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
    body: `A live map of your taste that grows as you talk. Node colors:

- **amber** — a title you loved or liked
- **rust red** — a title you disliked
- **taupe** — a title you felt "meh" about
- **orange** — a category page (genre, person, theme, style, platform, era, setting).
  These are the bigger nodes.
- **faded amber** — something on your watchlist
- **cream** — a taste note (a distilled preference). These are the smallest nodes.

**Click a node** to open its wiki page and light up its connections; click it again,
or the background, to deselect.

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
"sub" lines are background research assistants; the rest is Louie itself.`,
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
];

export default function HelpPanel() {
  // scope the lookup to this panel (ids are unique to it while mounted, but be
  // explicit) and scroll to the section header
  const jump = (id: string) =>
    document
      .getElementById(`help-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-card-border bg-background/95 px-4 py-2 backdrop-blur-sm">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jump(s.id)}
            className="rounded-md px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-glow/10 hover:text-glow"
          >
            {s.title}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-glow">Marquee — how it works</h1>
          <p className="mt-1 text-sm text-muted">
            A quick guide to Louie, the tabs, and your taste graph. Jump to any
            section using the bar above.
          </p>
        </div>
        {SECTIONS.map((s) => (
          <section key={s.id} id={`help-${s.id}`} className="mb-6 scroll-mt-2">
            <h2 className="mb-1.5 border-b border-card-border/60 pb-1 text-sm font-semibold text-glow">
              {s.title}
            </h2>
            <div className="text-sm leading-relaxed">
              <Markdown text={s.body} />
            </div>
          </section>
        ))}
        <div className="mt-2 border-t border-card-border pt-3 text-xs text-muted">
          This guide is kept in sync with the app as features change.
        </div>
      </div>
    </div>
  );
}
