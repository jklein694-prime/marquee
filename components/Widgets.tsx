"use client";

import { useState } from "react";

export interface OptionsData {
  title: string;
  mode: "single" | "multi";
  options: { id: string; label: string; sublabel?: string }[];
  context?: string;
}

export interface ChecklistData {
  title: string;
  movies: { title: string; year?: number }[];
}

export interface RecsData {
  movies: {
    title: string;
    year: number;
    why: string;
    predicted?: string; // Louie's projected score, e.g. "8-9"; optional only for pre-schema legacy cards
    genres?: string[];
    streaming?: string;
    poster_path?: string;
  }[];
}

export function OptionPicker({
  data,
  answered,
  locked = false,
  onSelect,
}: {
  data: OptionsData;
  answered: boolean;
  locked?: boolean;
  onSelect: (text: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const inert = answered || locked;

  const confirm = () => {
    const note = comment.trim();
    const sel = [...picked].join(", ");
    if (sel || note) onSelect(sel && note ? `${sel} — ${note}` : sel || note);
  };

  const toggle = (label: string) => {
    if (inert) return;
    if (data.mode === "single") {
      onSelect(label);
      return;
    }
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className={`rounded-lg border border-card-border bg-card p-4 ${answered ? "opacity-60" : ""}`}>
      <div className="mb-1 text-sm font-medium text-glow">{data.title}</div>
      {data.context && <div className="mb-2 text-xs text-muted">{data.context}</div>}
      <div className="flex flex-col gap-2">
        {data.options.map((o) => (
          <button
            key={o.id}
            disabled={inert}
            onClick={() => toggle(o.label)}
            className={`w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
              picked.has(o.label)
                ? "border-glow bg-glow/20 text-glow"
                : "border-card-border bg-transparent text-foreground"
            } ${locked && !answered ? "cursor-wait opacity-50" : answered ? "cursor-default" : "cursor-pointer hover:border-glow/60"}`}
          >
            <div className="font-medium">{o.label}</div>
            {o.sublabel && <div className="mt-1 text-xs text-muted">{o.sublabel}</div>}
          </button>
        ))}
      </div>
      {data.mode === "multi" && !answered && (
        <>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={locked}
            placeholder="Anything else? Steer me… (optional)"
            className="mt-3 w-full rounded-md border border-card-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted focus:border-glow/60"
          />
          <button
            onClick={confirm}
            disabled={(!picked.size && !comment.trim()) || locked}
            className="mt-2 rounded-md border border-glow/60 px-3 py-1 text-sm text-glow hover:bg-glow/10 disabled:opacity-40"
          >
            Confirm
          </button>
        </>
      )}
      {locked && !answered && (
        <div className="mt-2 animate-pulse text-xs text-muted">
          unlocks when the expert finishes…
        </div>
      )}
    </div>
  );
}

export function MovieChecklist({
  data,
  answered,
  locked = false,
  onSubmit,
}: {
  data: ChecklistData;
  answered: boolean;
  locked?: boolean;
  onSubmit: (text: string) => void;
}) {
  const inert = answered || locked;
  // per movie: undefined = untouched, null = seen but unrated, number = rating
  const [seen, setSeen] = useState<Record<string, number | null | undefined>>({});
  const [comment, setComment] = useState("");

  const label = (m: ChecklistData["movies"][number]) =>
    m.year ? `${m.title} (${m.year})` : m.title;

  const submit = () => {
    const seenList = data.movies.filter((m) => seen[label(m)] !== undefined);
    const unseenList = data.movies.filter((m) => seen[label(m)] === undefined);
    const parts: string[] = [];
    if (seenList.length)
      parts.push(
        "Seen: " +
          seenList
            .map((m) => {
              const r = seen[label(m)];
              return r != null ? `${label(m)} — ${r}/10` : `${label(m)} — no rating`;
            })
            .join("; ")
      );
    if (unseenList.length)
      parts.push("Haven't seen: " + unseenList.map(label).join("; "));
    if (!parts.length) parts.push("Haven't seen any of these.");
    if (comment.trim()) parts.push(comment.trim());
    onSubmit(parts.join(". "));
  };

  return (
    <div className={`rounded-lg border border-card-border bg-card p-4 ${answered ? "opacity-60" : ""}`}>
      <div className="mb-2 text-sm font-medium text-glow">{data.title}</div>
      <div className="space-y-2">
        {data.movies.map((m) => {
          const key = label(m);
          const checked = seen[key] !== undefined;
          return (
            <div key={key} className="flex flex-wrap items-center gap-2">
              <label className={`flex items-center gap-2 text-sm ${inert ? "" : "cursor-pointer"} ${locked && !answered ? "opacity-50" : ""}`}>
                <input
                  type="checkbox"
                  disabled={inert}
                  checked={checked}
                  onChange={(e) =>
                    setSeen((s) => {
                      const next = { ...s };
                      if (e.target.checked) next[key] = null;
                      else delete next[key];
                      return next;
                    })
                  }
                  className="h-4 w-4 accent-[#f5b942]"
                />
                {key}
              </label>
              {checked && (
                <div className="flex items-center gap-1">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      disabled={inert}
                      onClick={() => setSeen((s) => ({ ...s, [key]: n }))}
                      className={`h-6 w-6 rounded text-[11px] leading-none transition-colors ${
                        seen[key] === n
                          ? "bg-glow text-background font-semibold"
                          : "border border-card-border text-muted hover:border-glow/60 hover:text-foreground"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!answered && (
        <>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={locked}
            placeholder="Anything else? Steer me… (optional)"
            className="mt-3 w-full rounded-md border border-card-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted focus:border-glow/60"
          />
          <button
            onClick={submit}
            disabled={locked}
            className="mt-2 rounded-md border border-glow/60 px-3 py-1 text-sm text-glow hover:bg-glow/10 disabled:opacity-40"
          >
            Confirm
          </button>
        </>
      )}
      {locked && !answered && (
        <div className="mt-2 animate-pulse text-xs text-muted">
          unlocks when the expert finishes…
        </div>
      )}
    </div>
  );
}

export function MovieCards({ data }: { data: RecsData }) {
  // adding to the watchlist is a pure app action: it writes the personal list
  // via the API and deliberately does NOT touch the chat or the taste graph —
  // queueing something you're merely curious about is not a taste signal
  const [added, setAdded] = useState<Set<string>>(new Set());
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {data.movies.map((m) => (
        <div
          key={`${m.title}-${m.year}`}
          className="w-44 shrink-0 overflow-hidden rounded-lg border border-card-border bg-card"
        >
          {m.poster_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://image.tmdb.org/t/p/w342${m.poster_path}`}
              alt={m.title}
              className="h-56 w-full object-cover"
            />
          ) : (
            <div className="flex h-56 w-full items-center justify-center bg-background text-xs text-muted">
              no poster
            </div>
          )}
          <div className="p-2.5">
            <div className="text-sm font-medium leading-tight">
              {m.title} <span className="text-muted">({m.year})</span>
            </div>
            {m.genres && (
              <div className="mt-1 text-[11px] text-candle">{m.genres.join(" · ")}</div>
            )}
            <div className="mt-1 line-clamp-3 text-xs text-muted">{m.why}</div>
            {m.streaming && (
              <div className="mt-1.5 inline-block rounded bg-glow/15 px-1.5 py-0.5 text-[11px] text-glow">
                {m.streaming}
              </div>
            )}
            <button
              onClick={() => {
                const key = `${m.title}-${m.year}`;
                setAdded((a) => new Set(a).add(key));
                fetch("/api/watchlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "add",
                    title: m.title,
                    year: m.year,
                    note: m.why,
                    predicted: m.predicted,
                  }),
                })
                  .then((r) => {
                    // e.g. a stale tab whose card predates a required field — don't
                    // claim success when the write was rejected
                    if (!r.ok) setAdded((a) => { const n = new Set(a); n.delete(key); return n; });
                  })
                  .catch(() => setAdded((a) => { const n = new Set(a); n.delete(key); return n; }));
              }}
              disabled={added.has(`${m.title}-${m.year}`)}
              className="mt-2 w-full rounded-md border border-glow/50 py-1 text-xs text-glow hover:bg-glow/10 disabled:opacity-60"
            >
              {added.has(`${m.title}-${m.year}`) ? "✓ on your watchlist" : "+ Watchlist"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
