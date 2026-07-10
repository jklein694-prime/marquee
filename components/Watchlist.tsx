"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WatchItem, VetoItem } from "@/lib/watchlist";
import { canonicalService, canonicalServices } from "@/lib/services";
import type { ChatSend } from "./ChatPane";

const EXCLUDED_KEY = "marquee-excluded-services";

function trailerHref(item: WatchItem): string {
  return (
    item.trailer ??
    `https://www.youtube.com/results?search_query=${encodeURIComponent(
      `${item.title} trailer`
    )}`
  );
}

function ReviewForm({
  item,
  onSubmit,
  onCancel,
}: {
  item: WatchItem;
  onSubmit: (rating: number, review: string) => void;
  onCancel: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [review, setReview] = useState("");
  return (
    <div className="mt-2 rounded-md border border-card-border bg-background/60 p-2.5">
      <div className="mb-1.5 text-xs text-muted">
        How was {item.title}? Rate it:
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            onClick={() => setRating(n)}
            className={`h-6 w-6 rounded text-[11px] ${
              rating === n
                ? "bg-glow font-semibold text-background"
                : "border border-card-border text-muted hover:text-glow"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <textarea
        value={review}
        onChange={(e) => setReview(e.target.value)}
        placeholder="Any thoughts? (optional)"
        rows={2}
        className="mt-2 w-full resize-none rounded-md border border-card-border bg-background px-2 py-1.5 text-xs outline-none focus:border-glow/60"
      />
      <div className="mt-1.5 flex gap-2">
        <button
          onClick={() => rating && onSubmit(rating, review.trim())}
          disabled={!rating}
          className="rounded-md border border-glow/60 px-3 py-1 text-xs text-glow hover:bg-glow/10 disabled:opacity-40"
        >
          Log it
        </button>
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
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
// a small form instead of firing immediately; closes on outside click, Escape,
// or after a confirm/instant action.
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
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
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
      <button
        onClick={() => (open ? close() : setOpen(true))}
        title="More actions"
        className="flex h-6 w-6 items-center justify-center rounded-md border border-card-border text-muted hover:border-glow/60 hover:text-glow"
      >
        ⋮
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-56 overflow-hidden rounded-md border border-card-border bg-card shadow-lg">
          {!active ? (
            items.map((it) => (
              <button
                key={it.label}
                onClick={() => pick(it)}
                className={`block w-full px-3 py-1.5 text-left text-[11px] ${
                  it.tone === "danger" ? "text-ember hover:bg-ember/10" : "text-muted hover:bg-glow/10 hover:text-glow"
                }`}
              >
                {it.label}
              </button>
            ))
          ) : (
            <div className="p-2.5">
              <div className="mb-1.5 text-[11px] font-medium text-foreground">
                {active.label} — reason (optional)
              </div>
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. too slow-paced for me"
                rows={2}
                className="w-full resize-none rounded-md border border-card-border bg-background px-2 py-1.5 text-xs outline-none focus:border-glow/60"
              />
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => {
                    active.onConfirm(reason.trim());
                    close();
                  }}
                  className={`rounded-md border px-2 py-1 text-[11px] ${
                    active.tone === "danger"
                      ? "border-ember/60 text-ember hover:bg-ember/10"
                      : "border-glow/60 text-glow hover:bg-glow/10"
                  }`}
                >
                  Confirm
                </button>
                <button
                  onClick={() => {
                    setActive(null);
                    setReason("");
                  }}
                  className="rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground"
                >
                  Cancel
                </button>
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
  controls,
  reviewing,
  pending,
  onReview,
  onReviewSubmit,
  onReviewCancel,
  dragProps,
}: {
  item: WatchItem;
  controls: React.ReactNode;
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
      className={`rounded-lg border border-card-border bg-card p-2.5 ${
        dragProps?.draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <div className="flex gap-3">
        {item.poster_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
            alt={item.title}
            className="h-24 w-16 shrink-0 rounded object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded bg-background text-center text-[10px] text-muted">
            no poster
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-tight">
            {item.title}
            {item.year && !item.title.includes(`(${item.year})`) && (
              <span className="text-muted"> ({item.year})</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {item.streaming && item.streaming.length > 0 ? (
              canonicalServices(item.streaming).slice(0, 3).map((s) => (
                <span
                  key={s}
                  className="rounded bg-glow/15 px-1.5 py-0.5 text-[11px] text-glow"
                >
                  {s}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-muted">not streaming (US)</span>
            )}
            {item.predicted && (
              <span
                className="rounded bg-candle/15 px-1.5 py-0.5 text-[11px] text-candle"
                title="Louie's projected score based on your taste"
              >
                Louie predicts {item.predicted.replace("-", "–")}
              </span>
            )}
          </div>
          {item.note && (
            <div className={`mt-1 text-xs text-muted ${expanded ? "" : "line-clamp-2"}`}>
              {item.note}
            </div>
          )}
          {(item.note || item.overview) && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-[11px] font-medium text-glow hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {expanded && (item.note || item.predicted) && (
            <div className="mt-1.5 rounded-md border border-card-border bg-background/60 p-2 text-xs leading-relaxed text-muted">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-foreground">
                Why Louie picked this
                {item.predicted && (
                  <span className="rounded bg-candle/15 px-1.5 py-0.5 font-normal text-candle">
                    projected {item.predicted.replace("-", "–")}/10
                  </span>
                )}
              </div>
              {item.note || "No note yet."}
            </div>
          )}
          {expanded && item.overview && (
            <div className="mt-1.5 rounded-md border border-card-border bg-background/60 p-2 text-xs leading-relaxed text-muted">
              <div className="mb-1 text-[11px] font-semibold text-foreground">Synopsis</div>
              {item.overview}
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <a
              href={trailerHref(item)}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-card-border px-2 py-0.5 text-[11px] text-candle hover:border-candle/60 hover:bg-candle/10"
            >
              Trailer
            </a>
            {pending ? (
              <span className="animate-pulse rounded-md border border-glow/40 px-2 py-0.5 text-[11px] text-glow">
                logging…
              </span>
            ) : (
              <button
                onClick={onReview}
                className="rounded-md border border-card-border px-2 py-0.5 text-[11px] text-muted hover:border-glow/60 hover:text-glow"
              >
                Watched it
              </button>
            )}
            {controls}
          </div>
        </div>
      </div>
      {reviewing && !pending && (
        <ReviewForm item={item} onSubmit={onReviewSubmit} onCancel={onReviewCancel} />
      )}
    </div>
  );
}

export default function Watchlist({
  version,
  onChat,
}: {
  version: number;
  onChat: ChatSend;
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
  // services the user unchecked — stored as exclusions so new services default on
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      setExcluded(new Set(JSON.parse(localStorage.getItem(EXCLUDED_KEY) ?? "[]")));
    } catch {}
  }, []);

  function toggleService(s: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  const services = canonicalServices([...user, ...suggestions].flatMap((i) => i.streaming ?? [])).sort();
  // view-only filter: hide items available ONLY on excluded services; items with
  // no streaming data always show, and nothing is ever removed from the data
  const visible = (i: WatchItem) =>
    !i.streaming?.length || i.streaming.some((s) => !excluded.has(canonicalService(s)));

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
    const year =
      item.year && !item.title.includes(`(${item.year})`) ? ` (${item.year})` : "";
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
      const year =
        item.year && !item.title.includes(`(${item.year})`) ? ` (${item.year})` : "";
      onChat(`${item.title}${year} — ${reason}`, undefined, { silent: true, tag: "watchlist-remove" });
    }
  }

  // permanent veto: pull the card off whichever list it's on now (optimistic),
  // then a silent turn adds it to the hub's Not interested section (using the
  // reason as the bullet's note, if given) and strips any matching Watchlist
  // bullet so it can't resurface as a suggestion
  function addVeto(item: WatchItem, fromMine: boolean, reason: string) {
    const year =
      item.year && !item.title.includes(`(${item.year})`) ? ` (${item.year})` : "";
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
    <div className="h-full space-y-5 overflow-y-auto px-5 py-4">
      {services.length > 0 && (
        <section>
          <div className="mb-1.5 text-xs text-muted">
            My services — uncheck what you don&apos;t pay for to hide those picks (view only)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {services.map((s) => (
              <button
                key={s}
                onClick={() => toggleService(s)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  excluded.has(s)
                    ? "border-card-border text-muted opacity-60"
                    : "border-glow/50 bg-glow/15 text-glow"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>
      )}
      <section>
        <div className="mb-2 text-sm font-medium text-glow">My watchlist</div>
        <div className="mb-2 text-xs text-muted">
          Yours alone — drag to reorder, or use the position picker.
        </div>
        {loaded && user.length === 0 && (
          <div className="rounded-lg border border-card-border bg-card p-4 text-xs text-muted">
            Nothing saved yet — add picks from the suggestions below or from
            recommendations in the chat.
          </div>
        )}
        <div className="space-y-2">
          {/* map (not filter) keeps i as the real list index for move/drag */}
          {user.map((item, i) => visible(item) && (
            <Card
              key={item.title}
              item={item}
              pending={pending.has(item.title)}
              reviewing={reviewing === item.title}
              onReview={() =>
                setReviewing(reviewing === item.title ? null : item.title)
              }
              onReviewSubmit={(r, txt) => markWatched(item, r, txt)}
              onReviewCancel={() => setReviewing(null)}
              dragProps={{
                draggable: true,
                onDragStart: () => setDragIdx(i),
                onDragOver: (e) => e.preventDefault(),
                onDrop: () => {
                  if (dragIdx !== null && dragIdx !== i)
                    move(user[dragIdx].title, i);
                  setDragIdx(null);
                },
              }}
              controls={
                <>
                  {user.length > 1 && (
                    <select
                      value={i + 1}
                      onChange={(e) => move(item.title, Number(e.target.value) - 1)}
                      className="rounded-md border border-card-border bg-card px-1 py-0.5 text-[11px] text-muted"
                      title="Position in the ranking"
                    >
                      {user.map((_, n) => (
                        <option key={n} value={n + 1}>
                          #{n + 1}
                        </option>
                      ))}
                    </select>
                  )}
                  <MoreMenu
                    items={[
                      { label: "Remove", onConfirm: (reason) => removeFromMine(item, reason) },
                      {
                        label: "Not interested",
                        tone: "danger",
                        onConfirm: (reason) => addVeto(item, true, reason),
                      },
                    ]}
                  />
                </>
              }
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 text-sm font-medium text-candle">
          Louie&apos;s suggestions
        </div>
        <div className="mb-2 text-xs text-muted">
          Reranked as your taste graph grows — grab what looks good.
        </div>
        {loaded && suggestions.length === 0 && (
          <div className="rounded-lg border border-card-border bg-card p-4 text-xs text-muted">
            No suggestions on deck — ask for recommendations in the chat.
          </div>
        )}
        <div className="space-y-2">
          {suggestions.filter(visible).map((item) => (
            <Card
              key={item.title}
              item={item}
              pending={pending.has(item.title)}
              reviewing={reviewing === item.title}
              onReview={() =>
                setReviewing(reviewing === item.title ? null : item.title)
              }
              onReviewSubmit={(r, txt) => markWatched(item, r, txt)}
              onReviewCancel={() => setReviewing(null)}
              controls={
                <>
                  <button
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
                    className="rounded-md border border-glow/50 px-2 py-0.5 text-[11px] text-glow hover:bg-glow/10"
                  >
                    + My watchlist
                  </button>
                  <MoreMenu
                    items={[
                      {
                        label: "Not now",
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
                </>
              }
            />
          ))}
        </div>
      </section>

      <section>
        <button
          onClick={() => setShowVetoes((v) => !v)}
          className="flex w-full items-center gap-1.5 text-left text-sm font-medium text-muted hover:text-foreground"
        >
          <span className={`transition-transform ${showVetoes ? "rotate-90" : ""}`}>›</span>
          Not interested{notInterested.length > 0 && ` (${notInterested.length})`}
        </button>
        {showVetoes && (
          <>
            <div className="mb-2 mt-1 text-xs text-muted">
              Never suggested again — remove one if you change your mind.
            </div>
            {notInterested.length === 0 ? (
              <div className="rounded-lg border border-card-border bg-card p-4 text-xs text-muted">
                Nothing here — say &ldquo;don&apos;t suggest X&rdquo; in chat to add one.
              </div>
            ) : (
              <div className="space-y-1.5">
                {notInterested.map((item) => (
                  <div
                    key={item.title}
                    className="flex items-center justify-between gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{item.title}</div>
                      {item.note && <div className="truncate text-muted">{item.note}</div>}
                    </div>
                    {removingVeto.has(item.title) ? (
                      <span className="shrink-0 animate-pulse rounded-md border border-glow/40 px-2 py-0.5 text-[11px] text-glow">
                        removing…
                      </span>
                    ) : (
                      <button
                        onClick={() => removeVeto(item.title)}
                        className="shrink-0 rounded-md border border-card-border px-2 py-0.5 text-[11px] text-muted hover:border-glow/60 hover:text-glow"
                      >
                        Remove
                      </button>
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
