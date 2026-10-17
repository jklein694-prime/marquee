"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WatchItem, VetoItem } from "@/lib/watchlist";
import { canonicalService, canonicalServices } from "@/lib/services";
import type { ChatSend } from "./ChatPane";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { useFinePointer } from "@/lib/useMediaQuery";
import { Button, Chip, IconButton, RatingGrid } from "./ui";
import { ChevronDownIcon, ChevronUpIcon, DotsIcon } from "./icons";
import { Poster } from "./Poster";

const EXCLUDED_KEY = "marquee-excluded-services";

function trailerHref(item: WatchItem): string {
  return item.trailer ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${item.title} trailer`)}`;
}

export function ReviewForm({
  title,
  onSubmit,
  onCancel,
}: {
  title: string;
  onSubmit: (rating: number, review: string) => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [review, setReview] = useState("");
  return (
    <div className="mt-3 rounded-md border border-border bg-surface-2 p-3">
      <div className="mb-2 text-sm text-muted">How was {title}? Rate it:</div>
      <RatingGrid value={rating} onChange={setRating} />
      <textarea
        value={review}
        onChange={(e) => setReview(e.target.value)}
        placeholder="Any thoughts? (optional)"
        rows={2}
        className="mt-3 w-full resize-none rounded-md border border-border bg-surface-0 px-3 py-2 text-base outline-none placeholder:text-muted focus:border-accent-border md:text-sm"
      />
      <div className="mt-2 flex gap-2">
        <Button variant="primary" disabled={!rating} onClick={() => rating && onSubmit(rating, review.trim())}>
          Log it
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
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
        <div className="absolute right-0 top-11 z-20 w-64 overflow-hidden rounded-md border border-border bg-surface-1 shadow-lg md:top-9">
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
                className="w-full resize-none rounded-md border border-border bg-surface-0 px-3 py-2 text-base outline-none placeholder:text-muted focus:border-accent-border md:text-sm"
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

function Card({
  item,
  menu,
  actions,
  primaryWatched = false,
  reviewing,
  pending,
  onReview,
  onReviewSubmit,
  onReviewCancel,
  dragProps,
}: {
  item: WatchItem;
  menu: React.ReactNode;
  actions?: React.ReactNode;
  /** "Watched it" is the card's main action (my list) rather than a secondary one (suggestions) */
  primaryWatched?: boolean;
  reviewing: boolean;
  pending?: boolean;
  onReview: () => void;
  onReviewSubmit: (rating: number, review: string) => void;
  onReviewCancel: () => void;
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      {...dragProps}
      className={`rounded-lg border border-border bg-surface-1 p-3 ${dragProps?.draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex gap-3">
        <Poster path={item.poster_path} alt="" width={56} height={84} className="h-21 w-14 shrink-0 rounded" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1 pt-2 text-base font-medium leading-tight md:text-sm">
              {item.title}
              {item.year && !item.title.includes(`(${item.year})`) && <span className="text-muted"> ({item.year})</span>}
            </div>
            <div className="-mr-2 -mt-1">{menu}</div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
            {item.streaming && item.streaming.length > 0 ? (
              canonicalServices(item.streaming)
                .slice(0, 3)
                .map((s) => (
                  <span key={s} className="rounded bg-accent-muted px-1.5 py-0.5 text-accent">
                    {s}
                  </span>
                ))
            ) : (
              <span className="text-muted">not streaming (US)</span>
            )}
            {item.predicted && (
              <span className="rounded bg-info-subtle px-1.5 py-0.5 text-info" title="Louie's projected score based on your taste">
                Louie predicts {item.predicted.replace("-", "–")}
              </span>
            )}
          </div>
          {item.note && <div className={`mt-1 text-sm text-muted md:text-xs ${expanded ? "" : "line-clamp-2"}`}>{item.note}</div>}
        </div>
      </div>
      {expanded && (item.note || item.predicted) && (
        <div className="mt-2 rounded-md border border-border bg-surface-2 p-3 text-sm leading-relaxed text-muted md:text-xs">
          <div className="mb-1 flex items-center gap-2 font-semibold text-fg">
            Why Louie picked this
            {item.predicted && (
              <span className="rounded bg-info-subtle px-1.5 py-0.5 font-normal text-info">
                projected {item.predicted.replace("-", "–")}/10
              </span>
            )}
          </div>
          {item.note || "No note yet."}
        </div>
      )}
      {expanded && item.overview && (
        <div className="mt-2 rounded-md border border-border bg-surface-2 p-3 text-sm leading-relaxed text-muted md:text-xs">
          <div className="mb-1 font-semibold text-fg">Synopsis</div>
          {item.overview}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {pending ? (
          <span className="inline-flex min-h-11 items-center rounded-md border border-accent-border px-3 text-sm text-accent md:min-h-9 md:text-xs">
            <span className="animate-pulse">logging…</span>
          </span>
        ) : (
          <Button variant={primaryWatched ? "primary" : "secondary"} onClick={onReview} aria-expanded={reviewing}>
            Watched it
          </Button>
        )}
        {actions}
        <a
          href={trailerHref(item)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted hover:bg-surface-3 hover:text-fg md:min-h-9 md:text-xs"
        >
          Trailer
        </a>
        {(item.note || item.overview) && (
          <Button variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? "Less" : "More"}
          </Button>
        )}
      </div>
      {reviewing && !pending && <ReviewForm title={item.title} onSubmit={onReviewSubmit} onCancel={onReviewCancel} />}
    </div>
  );
}

export default function Watchlist({ version, onChat }: { version: number; onChat: ChatSend }) {
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

  const services = canonicalServices([...user, ...suggestions].flatMap((i) => i.streaming ?? [])).sort();
  // view-only filter: hide items available ONLY on excluded services; items with
  // no streaming data always show, and nothing is ever removed from the data
  const visible = (i: WatchItem) => !i.streaming?.length || i.streaming.some((s) => !excluded.has(canonicalService(s)));

  const refetch = useCallback(() => {
    fetch("/api/watchlist")
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user ?? []);
        setSuggestions(d.suggestions ?? []);
        setNotInterested(d.notInterested ?? []);
        setLoaded(true);
      })
      .catch(() => {});
  }, []);

  useEffect(refetch, [refetch, version]);

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
        // (silent turn: nothing rendered in chat; the pill below is the UI)
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

  return (
    <div className="h-full space-y-6 overflow-y-auto px-4 py-4 md:px-5">
      {services.length > 0 && (
        <section>
          <div className="mb-2 text-sm text-muted md:text-xs">
            My services — uncheck what you don&apos;t pay for to hide those picks (view only)
          </div>
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <Chip key={s} selected={!excluded.has(s)} onClick={() => toggleService(s)}>
                {s}
              </Chip>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="mb-1 text-base font-medium text-fg md:text-sm">My watchlist</h2>
        <div className="mb-3 text-sm text-muted md:text-xs">
          Yours alone, ranked — {canDrag ? "drag a card or use the arrows" : "use the arrows"} to reorder.
        </div>
        {loaded && user.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-1 p-4 text-sm text-muted md:text-xs">
            Nothing saved yet — add picks from the suggestions below or from recommendations in the chat.
          </div>
        )}
        <div className="space-y-3">
          {/* map (not filter) keeps i as the real list index for move/drag */}
          {user.map(
            (item, i) =>
              visible(item) && (
                <Card
                  key={item.title}
                  item={item}
                  primaryWatched
                  pending={pending.has(item.title)}
                  reviewing={reviewing === item.title}
                  onReview={() => setReviewing(reviewing === item.title ? null : item.title)}
                  onReviewSubmit={(r, txt) => markWatched(item, r, txt)}
                  onReviewCancel={() => setReviewing(null)}
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
                        {
                          label: "Not interested",
                          tone: "danger",
                          onConfirm: (reason) => addVeto(item, true, reason),
                        },
                      ]}
                    />
                  }
                  actions={
                    user.length > 1 && (
                      <span className="inline-flex items-center" aria-label={`Position ${i + 1} of ${user.length}`}>
                        <IconButton label="Move up" disabled={i === 0} onClick={() => move(item.title, i - 1)}>
                          <ChevronUpIcon />
                        </IconButton>
                        <IconButton label="Move down" disabled={i === user.length - 1} onClick={() => move(item.title, i + 1)}>
                          <ChevronDownIcon />
                        </IconButton>
                        <span className="text-xs text-muted">#{i + 1}</span>
                      </span>
                    )
                  }
                />
              )
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-medium text-fg md:text-sm">Louie&apos;s suggestions</h2>
        <div className="mb-3 text-sm text-muted md:text-xs">Reranked as your taste graph grows — grab what looks good.</div>
        {loaded && suggestions.length === 0 && (
          <div className="rounded-lg border border-border bg-surface-1 p-4 text-sm text-muted md:text-xs">
            No suggestions on deck — ask for recommendations in the chat.
          </div>
        )}
        <div className="space-y-3">
          {suggestions.filter(visible).map((item) => (
            <Card
              key={item.title}
              item={item}
              pending={pending.has(item.title)}
              reviewing={reviewing === item.title}
              onReview={() => setReviewing(reviewing === item.title ? null : item.title)}
              onReviewSubmit={(r, txt) => markWatched(item, r, txt)}
              onReviewCancel={() => setReviewing(null)}
              menu={
                <MoreMenu
                  items={[
                    {
                      label: "Not now (hide for two weeks)",
                      instant: true,
                      onConfirm: () => {
                        setSuggestions((s) => s.filter((x) => x.title !== item.title));
                        save({ action: "snooze", title: item.title });
                      },
                    },
                    {
                      label: "Not interested",
                      tone: "danger",
                      onConfirm: (reason) => addVeto(item, false, reason),
                    },
                  ]}
                />
              }
              actions={
                <Button
                  variant="primary"
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
                  + My watchlist
                </Button>
              }
            />
          ))}
        </div>
      </section>

      <section>
        <button
          onClick={() => setShowVetoes((v) => !v)}
          aria-expanded={showVetoes}
          className="flex min-h-11 w-full items-center gap-2 text-left text-base font-medium text-muted hover:text-fg md:min-h-9 md:text-sm"
        >
          <span className={`transition-transform ${showVetoes ? "rotate-90" : ""}`}>›</span>
          Not interested{notInterested.length > 0 && ` (${notInterested.length})`}
        </button>
        {showVetoes && (
          <>
            <div className="mb-2 mt-1 text-sm text-muted md:text-xs">Never suggested again — remove one if you change your mind.</div>
            {notInterested.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface-1 p-4 text-sm text-muted md:text-xs">
                Nothing here — say &ldquo;don&apos;t suggest X&rdquo; in chat to add one.
              </div>
            ) : (
              <div className="space-y-2">
                {notInterested.map((item) => (
                  <div
                    key={item.title}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-1 py-1 pl-3 pr-1 text-sm"
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
