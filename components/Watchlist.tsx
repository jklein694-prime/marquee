"use client";

import { useCallback, useEffect, useState } from "react";
import type { WatchItem } from "@/lib/watchlist";
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
          {item.streaming && item.streaming.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {item.streaming.slice(0, 3).map((s) => (
                <span
                  key={s}
                  className="rounded bg-glow/15 px-1.5 py-0.5 text-[11px] text-glow"
                >
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-[11px] text-muted">
              not streaming (US)
            </div>
          )}
          {item.note && (
            <div className="mt-1 line-clamp-2 text-xs text-muted">{item.note}</div>
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

  const services = [...new Set([...user, ...suggestions].flatMap((i) => i.streaming ?? []))].sort();
  // view-only filter: hide items available ONLY on excluded services; items with
  // no streaming data always show, and nothing is ever removed from the data
  const visible = (i: WatchItem) =>
    !i.streaming?.length || i.streaming.some((s) => !excluded.has(s));

  const refetch = useCallback(() => {
    fetch("/api/watchlist")
      .then((r) => r.json())
      .then((d) => {
        setUser(d.user ?? []);
        setSuggestions(d.suggestions ?? []);
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

  function markWatched(item: WatchItem, rating: number, review: string) {
    const year =
      item.year && !item.title.includes(`(${item.year})`) ? ` (${item.year})` : "";
    // busy chat = queued, not dropped; the item is only removed once its log
    // message actually ran (a reload mid-queue leaves it on the list — safe)
    const result = onChat(
      `I watched ${item.title}${year} — ${rating}/10.${review ? ` ${review}` : ""}`,
      () => {
        void post({ action: "remove", title: item.title });
        setPending((p) => {
          const next = new Set(p);
          next.delete(item.title);
          return next;
        });
      }
    );
    if (result) {
      setReviewing(null);
      setPending((p) => new Set(p).add(item.title));
    }
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
          Yours alone — drag to reorder, or use Top / the position picker.
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
                    post({ action: "move", title: user[dragIdx].title, to: i });
                  setDragIdx(null);
                },
              }}
              controls={
                <>
                  {i > 0 && (
                    <button
                      onClick={() => post({ action: "move", title: item.title, to: 0 })}
                      className="rounded-md border border-card-border px-2 py-0.5 text-[11px] text-muted hover:border-glow/60 hover:text-glow"
                    >
                      Top
                    </button>
                  )}
                  {user.length > 1 && (
                    <select
                      value={i + 1}
                      onChange={(e) =>
                        post({
                          action: "move",
                          title: item.title,
                          to: Number(e.target.value) - 1,
                        })
                      }
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
                      })
                    }
                    className="rounded-md border border-glow/50 px-2 py-0.5 text-[11px] text-glow hover:bg-glow/10"
                  >
                    + My watchlist
                  </button>
                  <button
                    onClick={() => post({ action: "snooze", title: item.title })}
                    title="Hide this suggestion for a couple of weeks"
                    className="rounded-md border border-card-border px-2 py-0.5 text-[11px] text-muted hover:border-ember/60 hover:text-ember"
                  >
                    Not now
                  </button>
                </>
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}
