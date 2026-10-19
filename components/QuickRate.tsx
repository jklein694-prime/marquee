"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ReviewForm } from "./ReviewForm";
import type { ChatSend } from "./ChatPane";
import { Poster } from "./Poster";
import { Button } from "./ui";

export interface SearchResult {
  id: number;
  title: string;
  year?: string;
  media: "movie" | "tv";
  poster_path: string | null;
}

// debounced TMDB typeahead + poster result list — shared by Quick Rate and Screen Test
export function TitleSearch({ onPick, autoFocus }: { onPick: (r: SearchResult) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query.trim()) return;
    let stale = false;
    const id = setTimeout(() => {
      setSearching(true);
      setError("");
      fetch(`/api/search?q=${encodeURIComponent(query)}`)
        .then(async (r) => {
          if (!r.ok) {
            // a missing TMDB key is a setup problem, not "no results"
            const body = (await r.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error || `search failed (${r.status})`);
          }
          return r.json();
        })
        .then((hits) => !stale && setResults(hits))
        .catch((err) => {
          if (stale) return;
          setResults([]);
          setError(err instanceof Error ? err.message : "search failed");
        })
        .finally(() => !stale && setSearching(false));
    }, 300);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [query]);
  // an empty query shows nothing, whatever the last fetch returned
  const shown = query.trim() ? results : [];

  return (
    <div className="space-y-2">
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a title…"
        aria-label="Search a title"
        type="search"
        enterKeyHint="search"
        className="min-h-12 w-full rounded-full border border-border-strong bg-surface-2 px-4 text-base outline-none placeholder:text-muted focus:border-accent-border md:min-h-10 md:text-sm"
      />
      {searching && <div className="px-1 text-xs text-muted">searching…</div>}
      {shown.map((r) => (
        <button
          key={`${r.media}-${r.id}`}
          onClick={() => {
            setQuery("");
            setResults([]);
            onPick(r);
          }}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface-1 p-2 text-left hover:border-accent-border"
        >
          <Poster path={r.poster_path} alt="" width={44} height={66} className="h-[66px] w-11 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium md:text-sm">
              {r.title}
              {r.year && <span className="text-muted"> {r.year}</span>}
            </div>
            <span className="text-xs text-muted">{r.media === "tv" ? "TV" : "Movie"}</span>
          </div>
        </button>
      ))}
      {error && query.trim() && <div className="px-1 text-sm text-danger md:text-xs">{error}</div>}
      {!searching && !error && query.trim() && shown.length === 0 && <div className="px-1 text-xs text-muted">No results.</div>}
    </div>
  );
}

interface LogEntry {
  id: string;
  label: string;
}

function QuickRate({ onChat }: { onChat: ChatSend }) {
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [pending, setPending] = useState<LogEntry[]>([]);
  const [logged, setLogged] = useState<LogEntry[]>([]);
  const counterRef = useRef(0);

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
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-4 md:px-5">
      {picked ? (
        <div>
          <div className="flex items-center gap-4">
            <Poster path={picked.poster_path} alt="" width={72} height={108} className="h-27 w-18 shrink-0 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.5)]" eager />
            <div className="min-w-0 flex-1">
              <div className="text-xl font-semibold leading-tight md:text-base">{picked.title}</div>
              <div className="mt-1 text-sm text-muted md:text-xs">
                {picked.year ? `${picked.year} · ` : ""}
                {picked.media === "tv" ? "TV" : "Movie"}
              </div>
              <Button variant="secondary" className="mt-2.5" onClick={() => setPicked(null)}>
                Change title
              </Button>
            </div>
          </div>
          <ReviewForm title={picked.title} onSubmit={submit} onCancel={() => setPicked(null)} />
        </div>
      ) : (
        <div>
          <h2 className="text-xs font-semibold tracking-[0.08em] text-muted">RATE ANYTHING</h2>
          <div className="mb-3 mt-1 text-sm text-muted md:text-xs">
            Search a movie or show and rate it. It logs to your taste graph in the background, no watchlist needed.
          </div>
          <TitleSearch autoFocus onPick={setPicked} />
        </div>
      )}

      {(pending.length > 0 || logged.length > 0) && (
        <div className="mt-auto space-y-2 border-t border-border pt-3 text-sm md:text-xs">
          {pending.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 text-muted">
              <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-accent shadow-[0_0_8px_var(--accent)]" />
              Logging {p.label} in the background
            </div>
          ))}
          {logged.map((l) => (
            <div key={l.id} className="flex items-center gap-2.5 text-muted">
              <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
              Logged {l.label}.
            </div>
          ))}
          {logged.length > 0 && (
            <Button variant="ghost" onClick={() => setLogged([])}>
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(QuickRate);
