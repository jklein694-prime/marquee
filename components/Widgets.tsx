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
  const inert = answered || locked;

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
      <div className="flex flex-wrap gap-2">
        {data.options.map((o) => (
          <button
            key={o.id}
            disabled={inert}
            onClick={() => toggle(o.label)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              picked.has(o.label)
                ? "border-glow bg-glow/20 text-glow"
                : "border-card-border bg-transparent text-foreground"
            } ${locked && !answered ? "cursor-wait opacity-50" : answered ? "cursor-default" : "cursor-pointer hover:border-glow/60"}`}
            title={o.sublabel}
          >
            {o.label}
            {o.sublabel && <span className="ml-1.5 text-xs text-muted">{o.sublabel}</span>}
          </button>
        ))}
      </div>
      {data.mode === "multi" && !answered && (
        <button
          onClick={() => picked.size && onSelect([...picked].join(", "))}
          disabled={!picked.size || locked}
          className="mt-3 rounded-md border border-glow/60 px-3 py-1 text-sm text-glow hover:bg-glow/10 disabled:opacity-40"
        >
          Confirm
        </button>
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
    onSubmit(parts.join(". ") || "Haven't seen any of these.");
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
        <button
          onClick={submit}
          disabled={locked}
          className="mt-3 rounded-md border border-glow/60 px-3 py-1 text-sm text-glow hover:bg-glow/10 disabled:opacity-40"
        >
          Confirm
        </button>
      )}
      {locked && !answered && (
        <div className="mt-2 animate-pulse text-xs text-muted">
          unlocks when the expert finishes…
        </div>
      )}
    </div>
  );
}

export function MovieCards({
  data,
  locked = false,
  onAction,
}: {
  data: RecsData;
  locked?: boolean;
  onAction: (text: string) => void;
}) {
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
                // straight to the personal list; the agent still logs categories
                void fetch("/api/watchlist", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "add",
                    title: m.title,
                    year: m.year,
                    note: m.why,
                  }),
                });
                onAction(`Add ${m.title} (${m.year}) to my watchlist`);
              }}
              disabled={locked}
              className="mt-2 w-full rounded-md border border-glow/50 py-1 text-xs text-glow hover:bg-glow/10 disabled:cursor-wait disabled:opacity-40"
            >
              + Watchlist
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
