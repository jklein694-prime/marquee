"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WatchItem, VetoItem } from "@/lib/watchlist";
import { canonicalService, canonicalServices } from "@/lib/services";
import type { ChatSend } from "./ChatPane";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { useFinePointer } from "@/lib/useMediaQuery";
import { sameTitle } from "@/lib/titles";
import { Button, Chip, IconButton } from "./ui";
import { Card } from "./Card";
import { ReviewForm } from "./ReviewForm";
import { ChevronDownIcon, ChevronUpIcon, DotsIcon, PlusIcon } from "./icons";

const EXCLUDED_KEY = "marquee-excluded-services";

function trailerHref(item: WatchItem): string {
  return item.trailer ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${item.title} trailer`)}`;
}

/** one line of facts: where it streams (Louie's projection has its own badge) */
function Facts({ item }: { item: WatchItem }) {
  const services = item.streaming?.length ? canonicalServices(item.streaming).slice(0, 3).join(" · ") : "Not streaming";
  const kind = item.media === "tv" ? "TV" : "Movie";
  return (
    <>
      {kind} · {services}
    </>
  );
}

interface MenuItem {
  label: string;
  tone?: "danger";
  /** fires immediately with no reason step, e.g. a temporary/reversible action */
  instant?: boolean;
  onConfirm: (reason: string) => void;
}

// compact overflow menu for secondary actions. Items with a reason step open
// a small form instead of firing immediately; closes on outside tap
// (pointerdown — iOS does not synthesize mousedown on plain elements),
// Escape, or after a confirm/instant action.
function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<MenuItem | null>(null);
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setActive(null);
    setReason("");
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(item: MenuItem) {
    if (item.instant) {
      item.onConfirm("");
      close();
      return;
    }
    setActive(item);
    setReason("");
  }

  return (
    <div ref={ref} className="relative inline-block shrink-0">
      <IconButton label="More actions" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <DotsIcon />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-xl md:top-9">
          {!active ? (
            items.map((it) => (
              <button
                key={it.label}
                onClick={() => pick(it)}
                className={`block min-h-11 w-full px-4 text-left text-sm md:min-h-9 md:text-xs ${
                  it.tone === "danger" ? "text-danger hover:bg-danger-subtle" : "text-fg hover:bg-surface-3"
                }`}
              >
                {it.label}
              </button>
            ))
          ) : (
            <div className="p-3">
              <div className="mb-1.5 text-sm font-medium text-fg md:text-xs">{active.label} — reason (optional)</div>
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. too slow-paced for me"
                rows={2}
                className="w-full resize-none rounded-xl border border-border bg-surface-0 px-3 py-2 text-base outline-none placeholder:text-muted focus:border-accent-border md:text-sm"
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant={active.tone === "danger" ? "danger" : "primary"}
                  onClick={() => {
                    active.onConfirm(reason.trim());
                    close();
                  }}
                >
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setActive(null);
                    setReason("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoggingPill() {
  return (
    <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-accent-border px-3.5 text-sm text-accent md:min-h-9 md:text-xs">
      <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      logging…
    </span>
  );
}

function Watchlist({
  version,
  onChat,
  active = true,
}: {
  version: number;
  onChat: ChatSend;
  /** false while mounted but hidden: the refetch waits until the panel is shown */
  active?: boolean;
}) {
  const [user, setUser] = useState<WatchItem[]>([]);
  const [suggestions, setSuggestions] = useState<WatchItem[]>([]);
  const [notInterested, setNotInterested] = useState<VetoItem[]>([]);
  const [showVetoes, setShowVetoes] = useState(false);
  const [removingVeto, setRemovingVeto] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  // HTML5 drag-and-drop needs a mouse; touch gets the up/down buttons
  const canDrag = useFinePointer();
  // services the user unchecked — stored as exclusions so new services default on
  const [excludedRaw, setExcludedRaw] = useLocalStorage(EXCLUDED_KEY, "[]");
  const excluded = useMemo<Set<string>>(() => {
    try {
      return new Set(JSON.parse(excludedRaw));
    } catch {
      return new Set();
    }
  }, [excludedRaw]);

  function toggleService(s: string) {
    const next = new Set(excluded);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setExcludedRaw(JSON.stringify([...next]));
  }

  // the server already keeps saved titles out of the suggestions; the client
  // enforces the same rule on whatever it holds, so a save shows instantly and
  // a stale read can never put one title in both lists
  const onDeck = suggestions.filter((s) => !user.some((u) => sameTitle(u.title, s.title)));
  const services = canonicalServices([...user, ...onDeck].flatMap((i) => i.streaming ?? [])).sort();
  // view-only filter: hide items available ONLY on excluded services; items with
  // no streaming data always show, and nothing is ever removed from the data
  const visible = (i: WatchItem) => !i.streaming?.length || i.streaming.some((s) => !excluded.has(canonicalService(s)));

  // the server answers from disk and memo immediately and refreshes TMDB
  // details in the background; `pending` says how many items it is still
  // filling in, so re-read a couple of times until it reports none
  const refetch = useCallback((retries = 2) => {
    const load = (left: number) =>
      fetch("/api/watchlist")
        .then((r) => r.json())
        .then((d) => {
          setUser(d.user ?? []);
          setSuggestions(d.suggestions ?? []);
          setNotInterested(d.notInterested ?? []);
          setLoaded(true);
          if (d.pending > 0 && left > 0) setTimeout(() => load(left - 1), 2500);
        })
        .catch(() => {});
    load(retries);
  }, []);

  // the panel stays mounted across tab switches, so a turn ending while it is
  // hidden refetches once, on the next show, not every time the version moves
  const fetchedForRef = useRef(-1);
  useEffect(() => {
    if (!active || fetchedForRef.current === version) return;
    fetchedForRef.current = version;
    refetch();
  }, [active, version, refetch]);

  async function post(body: Record<string, unknown>) {
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    refetch();
  }

  // fire-and-forget — caller already applied the change locally; the turn-end
  // refetch reconciles if a write ever fails
  const save = (body: Record<string, unknown>) =>
    void fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  function move(title: string, to: number) {
    setUser((u) => {
      const i = u.findIndex((x) => x.title === title);
      if (i === -1 || i === to) return u;
      const next = [...u];
      const [it] = next.splice(i, 1);
      next.splice(Math.max(0, Math.min(to, next.length)), 0, it);
      return next;
    });
    save({ action: "move", title, to });
  }

  function markWatched(item: WatchItem, rating: number, review: string) {
    const year = item.year && !item.title.includes(`(${item.year})`) ? ` (${item.year})` : "";
    // busy chat = queued, not dropped; the item is only removed once its log
    // message actually ran (a reload mid-queue leaves it on the list — safe)
    const result = onChat(
      `I watched ${item.title}${year} — ${rating}/10.${review ? ` ${review}` : ""}`,
      () => {
        // (silent turn: nothing rendered in chat; the pill is the UI)
        void post({ action: "remove", title: item.title });
        setPending((p) => {
          const next = new Set(p);
          next.delete(item.title);
          return next;
        });
      },
      { silent: true }
    );
    if (result) {
      setReviewing(null);
      setPending((p) => new Set(p).add(item.title));
    }
  }

  // plain removal from the user's own list — no veto, they might add it back
  // later. Optimistic, same pattern as move/snooze. A reason (optional) is
  // worth a taste-profile signal even though the removal itself is free —
  // only bothers the agent when there's actually something to record.
  function removeFromMine(item: WatchItem, reason: string) {
    setUser((u) => u.filter((x) => x.title !== item.title));
    save({ action: "remove", title: item.title });
    if (reason) {
      const year = item.year && !item.title.includes(`(${item.year})`) ? ` (${item.year})` : "";
      onChat(`${item.title}${year} — ${reason}`, undefined, { silent: true, tag: "watchlist-remove" });
    }
  }

  // permanent veto: pull the card off whichever list it's on now (optimistic),
  // then a silent turn adds it to the hub's Not interested section (using the
  // reason as the bullet's note, if given) and strips any matching Watchlist
  // bullet so it can't resurface as a suggestion
  function addVeto(item: WatchItem, fromMine: boolean, reason: string) {
    const year = item.year && !item.title.includes(`(${item.year})`) ? ` (${item.year})` : "";
    if (fromMine) {
      setUser((u) => u.filter((x) => x.title !== item.title));
      save({ action: "remove", title: item.title });
    } else {
      setSuggestions((s) => s.filter((x) => x.title !== item.title));
    }
    const label = `${item.title}${year}${reason ? ` — ${reason}` : ""}`;
    onChat(label, undefined, { silent: true, tag: "not-interested-add" });
  }

  function removeVeto(title: string) {
    const result = onChat(
      title,
      () => {
        setNotInterested((v) => v.filter((x) => x.title !== title));
        setRemovingVeto((p) => {
          const next = new Set(p);
          next.delete(title);
          return next;
        });
      },
      { silent: true, tag: "not-interested-remove" }
    );
    if (result) setRemovingVeto((p) => new Set(p).add(title));
  }

  const review = (item: WatchItem) =>
    reviewing === item.title && !pending.has(item.title) ? (
      <ReviewForm
        title={item.title}
        predicted={item.predicted}
        onSubmit={(r, txt) => markWatched(item, r, txt)}
        onCancel={() => setReviewing(null)}
      />
    ) : null;

  return (
    <div className="h-full overflow-y-auto px-4 pb-6 md:px-5">
      {services.length > 0 && (
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 py-3 md:mx-0 md:px-0">
          {services.map((s) => (
            <Chip key={s} selected={!excluded.has(s)} onClick={() => toggleService(s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}

      <section data-testid="my-watchlist" className="pt-3">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold tracking-[0.08em] text-muted">MY LIST{user.length ? ` · ${user.length}` : ""}</h2>
          <span className="text-xs text-faint">ranked</span>
        </div>
        {loaded && user.length === 0 && (
          <div className="rounded-2xl border border-border bg-surface-1 p-4 text-sm text-muted md:text-xs">
            Nothing saved yet — save picks from the suggestions below or from recommendations in the chat.
          </div>
        )}
        <div className="space-y-3">
          {/* map (not filter) keeps i as the real list index for move/drag */}
          {user.map(
            (item, i) =>
              visible(item) && (
                <Card
                  key={item.title}
                  posterPath={item.poster_path}
                  title={item.title}
                  year={item.year}
                  facts={<Facts item={item} />}
                  predicted={item.predicted}
                  note={item.note}
                  synopsis={item.overview}
                  dragProps={
                    canDrag
                      ? {
                          draggable: true,
                          onDragStart: () => setDragIdx(i),
                          onDragOver: (e) => e.preventDefault(),
                          onDrop: () => {
                            if (dragIdx !== null && dragIdx !== i) move(user[dragIdx].title, i);
                            setDragIdx(null);
                          },
                        }
                      : undefined
                  }
                  menu={
                    <MoreMenu
                      items={[
                        { label: "Remove from my list", onConfirm: (reason) => removeFromMine(item, reason) },
                        { label: "Not interested", tone: "danger", onConfirm: (reason) => addVeto(item, true, reason) },
                      ]}
                    />
                  }
                  primary={
                    pending.has(item.title) ? (
                      <LoggingPill />
                    ) : (
                      <Button variant="filled" onClick={() => setReviewing(reviewing === item.title ? null : item.title)} aria-expanded={reviewing === item.title}>
                        Watched it
                      </Button>
                    )
                  }
                  secondary={
                    <a
                      href={trailerHref(item)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center rounded-xl border border-border-strong px-3.5 text-sm text-fg hover:border-accent-border hover:text-accent md:min-h-9 md:px-3 md:text-xs"
                    >
                      Trailer
                    </a>
                  }
                  tail={
                    user.length > 1 && (
                      <span className="inline-flex overflow-hidden rounded-xl border border-border" aria-label={`Position ${i + 1} of ${user.length}`}>
                        <IconButton label="Move up" className="rounded-none" disabled={i === 0} onClick={() => move(item.title, i - 1)}>
                          <ChevronUpIcon size={18} />
                        </IconButton>
                        <IconButton
                          label="Move down"
                          className="rounded-none border-l border-border"
                          disabled={i === user.length - 1}
                          onClick={() => move(item.title, i + 1)}
                        >
                          <ChevronDownIcon size={18} />
                        </IconButton>
                      </span>
                    )
                  }
                >
                  {review(item)}
                </Card>
              )
          )}
        </div>
      </section>

      <section data-testid="suggestions" className="pt-6">
        <div className="mb-2.5 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold tracking-[0.08em] text-muted">LOUIE SUGGESTS</h2>
          <span className="text-xs text-faint">best fit first</span>
        </div>
        {loaded && onDeck.length === 0 && (
          <div className="rounded-2xl border border-border bg-surface-1 p-4 text-sm text-muted md:text-xs">
            No suggestions on deck — ask for recommendations in the chat.
          </div>
        )}
        <div className="space-y-3">
          {onDeck.filter(visible).map((item) => (
            <Card
              key={item.title}
              posterPath={item.poster_path}
              title={item.title}
              year={item.year}
              facts={<Facts item={item} />}
              predicted={item.predicted}
              note={item.note}
              synopsis={item.overview}
              menu={
                <MoreMenu
                  items={[{ label: "Not interested", tone: "danger", onConfirm: (reason) => addVeto(item, false, reason) }]}
                />
              }
              primary={
                pending.has(item.title) ? (
                  <LoggingPill />
                ) : (
                  <Button
                    variant="filled"
                    onClick={() =>
                      post({
                        action: "add",
                        title: item.title,
                        year: item.year,
                        media: item.media,
                        note: item.note,
                        predicted: item.predicted,
                      })
                    }
                  >
                    <PlusIcon size={16} />
                    Save
                  </Button>
                )
              }
              secondary={
                !pending.has(item.title) && (
                  <Button variant="secondary" onClick={() => setReviewing(reviewing === item.title ? null : item.title)} aria-expanded={reviewing === item.title}>
                    Watched it
                  </Button>
                )
              }
              tail={
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSuggestions((s) => s.filter((x) => x.title !== item.title));
                    save({ action: "snooze", title: item.title });
                  }}
                  title="Hide for two weeks"
                >
                  Not now
                </Button>
              }
            >
              {review(item)}
            </Card>
          ))}
        </div>
      </section>

      <section className="pt-6">
        <button
          onClick={() => setShowVetoes((v) => !v)}
          aria-expanded={showVetoes}
          className="flex min-h-11 w-full items-center gap-2 text-left text-xs font-semibold tracking-[0.08em] text-muted hover:text-fg md:min-h-9"
        >
          <span className={`transition-transform ${showVetoes ? "rotate-90" : ""}`}>›</span>
          NOT INTERESTED{notInterested.length > 0 && ` · ${notInterested.length}`}
        </button>
        {showVetoes && (
          <>
            <div className="mb-2 mt-1 text-sm text-muted md:text-xs">Never suggested again — remove one if you change your mind.</div>
            {notInterested.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface-1 p-4 text-sm text-muted md:text-xs">
                Nothing here — say &ldquo;don&apos;t suggest X&rdquo; in chat to add one.
              </div>
            ) : (
              <div className="space-y-2">
                {notInterested.map((item) => (
                  <div
                    key={item.title}
                    className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-surface-1 py-1 pl-4 pr-1 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      {item.note && <div className="truncate text-xs text-muted">{item.note}</div>}
                    </div>
                    {removingVeto.has(item.title) ? (
                      <span className="shrink-0 animate-pulse px-3 text-xs text-accent">removing…</span>
                    ) : (
                      <Button variant="ghost" onClick={() => removeVeto(item.title)}>
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default memo(Watchlist);
