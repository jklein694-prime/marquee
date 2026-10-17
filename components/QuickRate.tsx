"use client";

import { memo, useEffect, useRef, useState } from "react";
import { ReviewForm } from "./Watchlist";
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
        className="min-h-11 w-full rounded-md border border-border bg-surface-2 px-3 text-base outline-none placeholder:text-muted focus:border-accent-border md:text-sm"
      />
      {searching && <div className="text-xs text-muted">searching…</div>}
      {shown.map((r) => (
        <button
          key={`${r.media}-${r.id}`}
          onClick={() => {
            setQuery("");
            setResults([]);
            onPick(r);
          }}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface-1 p-2 text-left hover:border-accent-border"
        >
          <Poster path={r.poster_path} alt="" width={44} height={66} className="h-[66px] w-11 shrink-0 rounded" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-medium md:text-sm">
              {r.title}
              {r.year && <span className="text-muted"> ({r.year})</span>}
            </div>
            <span className="text-xs text-muted">{r.media === "tv" ? "TV" : "Movie"}</span>
          </div>
        </button>
      ))}
      {error && query.trim() && <div className="text-sm text-danger md:text-xs">{error}</div>}
      {!searching && !error && query.trim() && shown.length === 0 && <div className="text-xs text-muted">No results.</div>}
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
    <div className="h-full space-y-4 overflow-y-auto px-4 py-4 md:px-5">
      <div>
        <h2 className="mb-1 text-base font-medium text-fg md:text-sm">Quick rate</h2>
        <div className="text-sm text-muted md:text-xs">
          Search any movie or show, rate it, and it logs to your taste graph in the background — no need to add it to
          your watchlist first.
        </div>
      </div>

      {picked ? (
        <div className="rounded-lg border border-border bg-surface-1 p-3">
          <div className="flex gap-3">
            <Poster path={picked.poster_path} alt="" width={56} height={84} className="h-21 w-14 shrink-0 rounded" eager />
            <div className="min-w-0 flex-1">
              <div className="text-base font-medium leading-tight md:text-sm">
                {picked.title}
                {picked.year && <span className="text-muted"> ({picked.year})</span>}
              </div>
              <span className="mt-1 inline-block rounded bg-accent-muted px-1.5 py-0.5 text-xs text-accent">
                {picked.media === "tv" ? "TV" : "Movie"}
              </span>
            </div>
          </div>
          {/* full card width: ten rating cells never fit beside a poster on a phone */}
          <ReviewForm title={picked.title} onSubmit={submit} onCancel={() => setPicked(null)} />
        </div>
      ) : (
        <TitleSearch autoFocus onPick={setPicked} />
      )}

      {(pending.length > 0 || logged.length > 0) && (
        <div className="space-y-1.5 border-t border-border pt-3 text-sm md:text-xs">
          {pending.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-accent">
              <span className="animate-pulse">●</span> logging {p.label}…
            </div>
          ))}
          {logged.map((l) => (
            <div key={l.id} className="text-muted">
              Logged {l.label}.
            </div>
          ))}
          {logged.length > 0 && (
            <div className="pt-1">
              <Button variant="ghost" onClick={() => setLogged([])}>
                Clear
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(QuickRate);
