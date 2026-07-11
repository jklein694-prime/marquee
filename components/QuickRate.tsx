"use client";

import { useEffect, useRef, useState } from "react";
import { ReviewForm } from "./Watchlist";
import type { ChatSend } from "./ChatPane";

interface SearchResult {
  id: number;
  title: string;
  year?: string;
  media: "movie" | "tv";
  poster_path: string | null;
}

interface LogEntry {
  id: string;
  label: string;
}

export default function QuickRate({ onChat }: { onChat: ChatSend }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [pending, setPending] = useState<LogEntry[]>([]);
  const [logged, setLogged] = useState<LogEntry[]>([]);
  const counterRef = useRef(0);

  useEffect(() => {
    if (picked || !query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(id);
  }, [query, picked]);

  function submit(rating: number, review: string) {
    if (!picked) return;
    const year = picked.year ? ` (${picked.year})` : "";
    const label = `${picked.title}${year}`;
    const text = `I watched ${label} — ${rating}/10.${review ? ` ${review}` : ""}`;
    const id = `${picked.media}-${picked.id}-${counterRef.current++}`;
    // logged immediately, in the background — no need to wait around before
    // searching for the next one, the silent lane queues concurrent sends
    setPending((p) => [...p, { id, label }]);
    onChat(
      text,
      () => {
        setPending((p) => p.filter((x) => x.id !== id));
        setLogged((l) => [{ id, label: `${label} — ${rating}/10` }, ...l].slice(0, 5));
      },
      { silent: true }
    );
    setPicked(null);
    setQuery("");
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto px-5 py-4">
      <div>
        <div className="mb-1.5 text-sm font-medium text-glow">Quick rate</div>
        <div className="mb-2 text-xs text-muted">
          Search any movie or show, rate it, and it logs to your taste graph
          in the background — no need to add it to your watchlist first.
        </div>
        {!picked && (
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a title…"
            className="w-full rounded-md border border-card-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-glow/60"
          />
        )}
      </div>

      {picked ? (
        <div className="rounded-lg border border-card-border bg-card p-2.5">
          <div className="flex gap-3">
            {picked.poster_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://image.tmdb.org/t/p/w185${picked.poster_path}`}
                alt={picked.title}
                className="h-24 w-16 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded bg-background text-center text-[10px] text-muted">
                no poster
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium leading-tight">
                {picked.title}
                {picked.year && <span className="text-muted"> ({picked.year})</span>}
              </div>
              <span className="mt-1 inline-block rounded bg-glow/15 px-1.5 py-0.5 text-[11px] text-glow">
                {picked.media === "tv" ? "TV" : "Movie"}
              </span>
              <ReviewForm title={picked.title} onSubmit={submit} onCancel={() => setPicked(null)} />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {searching && <div className="text-xs text-muted">searching…</div>}
          {results.map((r) => (
            <button
              key={`${r.media}-${r.id}`}
              onClick={() => setPicked(r)}
              className="flex w-full items-center gap-3 rounded-lg border border-card-border bg-card p-2.5 text-left hover:border-glow/60"
            >
              {r.poster_path ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`https://image.tmdb.org/t/p/w92${r.poster_path}`}
                  alt={r.title}
                  className="h-16 w-11 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded bg-background text-center text-[9px] text-muted">
                  no poster
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {r.title}
                  {r.year && <span className="text-muted"> ({r.year})</span>}
                </div>
                <span className="text-[11px] text-muted">{r.media === "tv" ? "TV" : "Movie"}</span>
              </div>
            </button>
          ))}
          {!searching && query.trim() && results.length === 0 && (
            <div className="text-xs text-muted">No results.</div>
          )}
        </div>
      )}

      {(pending.length > 0 || logged.length > 0) && (
        <div className="space-y-1.5 border-t border-card-border pt-3">
          {pending.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-xs text-glow">
              <span className="animate-pulse">●</span> logging {p.label}…
            </div>
          ))}
          {logged.map((l) => (
            <div key={l.id} className="text-xs text-muted">
              Logged {l.label}.
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
