"use client";

import { useState } from "react";
import { Poster } from "./Poster";
import { Button, RatingScale } from "./ui";

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

const STEER_INPUT =
  "mt-3 min-h-11 w-full rounded-md border border-border bg-surface-0 px-3 text-base outline-none placeholder:text-muted focus:border-accent-border md:min-h-9 md:text-sm";

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
    <div className={`rounded-2xl border border-border bg-surface-1 p-4 ${answered ? "opacity-60" : ""}`}>
      <div className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted">{data.title.toUpperCase()}</div>
      {data.context && <div className="mb-2 text-sm text-muted md:text-xs">{data.context}</div>}
      <div className="flex flex-col gap-2">
        {data.options.map((o) => (
          <button
            key={o.id}
            disabled={inert}
            aria-pressed={data.mode === "multi" ? picked.has(o.label) : undefined}
            onClick={() => toggle(o.label)}
            className={`min-h-12 w-full rounded-xl border px-4 py-3 text-left text-[15px] transition-colors md:min-h-10 md:text-sm ${
              picked.has(o.label) ? "border-accent bg-accent-muted text-accent" : "border-border bg-transparent text-fg"
            } ${locked && !answered ? "cursor-wait opacity-50" : answered ? "cursor-default" : "cursor-pointer hover:border-accent-border"}`}
          >
            <div className="font-medium">{o.label}</div>
            {o.sublabel && <div className="mt-1 text-sm text-muted md:text-xs">{o.sublabel}</div>}
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
            aria-label="Steer me"
            className={STEER_INPUT}
          />
          <Button variant="primary" size="md" className="mt-2" onClick={confirm} disabled={(!picked.size && !comment.trim()) || locked}>
            Confirm
          </Button>
        </>
      )}
      {locked && !answered && <div className="mt-2 animate-pulse text-xs text-muted">unlocks when the expert finishes…</div>}
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

  const label = (m: ChecklistData["movies"][number]) => (m.year ? `${m.title} (${m.year})` : m.title);

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
    if (unseenList.length) parts.push("Haven't seen: " + unseenList.map(label).join("; "));
    if (!parts.length) parts.push("Haven't seen any of these.");
    if (comment.trim()) parts.push(comment.trim());
    onSubmit(parts.join(". "));
  };

  return (
    <div className={`rounded-2xl border border-border bg-surface-1 p-4 ${answered ? "opacity-60" : ""}`}>
      <div className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted">{data.title.toUpperCase()}</div>
      <div className="space-y-2">
        {data.movies.map((m) => {
          const key = label(m);
          const checked = seen[key] !== undefined;
          return (
            <div key={key} className="space-y-2">
              <label
                className={`flex min-h-11 items-center gap-3 text-[15px] md:min-h-9 md:text-sm ${inert ? "" : "cursor-pointer"} ${
                  locked && !answered ? "opacity-50" : ""
                }`}
              >
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
                  className="h-5 w-5 accent-accent md:h-4 md:w-4"
                />
                {key}
              </label>
              {checked && (
                <div className="pl-8 md:pl-7">
                  <RatingScale
                    compact
                    value={seen[key] ?? null}
                    disabled={inert}
                    label={`Rating for ${key}`}
                    onChange={(n) => setSeen((s) => ({ ...s, [key]: n }))}
                  />
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
            aria-label="Steer me"
            className={STEER_INPUT}
          />
          <Button variant="primary" size="md" className="mt-2" onClick={submit} disabled={locked}>
            Confirm
          </Button>
        </>
      )}
      {locked && !answered && <div className="mt-2 animate-pulse text-xs text-muted">unlocks when the expert finishes…</div>}
    </div>
  );
}

export function MovieCards({ data }: { data: RecsData }) {
  // adding to the watchlist is a pure app action: it writes the personal list
  // via the API and deliberately does NOT touch the chat or the taste graph —
  // queueing something you're merely curious about is not a taste signal
  const [added, setAdded] = useState<Set<string>>(new Set());
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      {data.movies.map((m) => {
        const key = `${m.title}-${m.year}`;
        return (
          <div key={key} className="w-44 shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-surface-1">
            <Poster path={m.poster_path} alt="" width={176} height={264} className="h-66 w-full" />
            <div className="p-3">
              <div className="text-sm font-medium leading-tight">
                {m.title} <span className="text-muted">({m.year})</span>
              </div>
              {m.genres && <div className="mt-1 text-xs text-muted">{m.genres.join(" · ")}</div>}
              <div className="mt-1 line-clamp-3 text-xs text-muted">{m.why}</div>
              {m.streaming && (
                <div className="mt-1.5 inline-block rounded bg-accent-muted px-1.5 py-0.5 text-xs text-accent">{m.streaming}</div>
              )}
              <Button
                variant={added.has(key) ? "secondary" : "filled"}
                className="mt-2 w-full"
                disabled={added.has(key)}
                onClick={() => {
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
                      if (!r.ok)
                        setAdded((a) => {
                          const n = new Set(a);
                          n.delete(key);
                          return n;
                        });
                    })
                    .catch(() =>
                      setAdded((a) => {
                        const n = new Set(a);
                        n.delete(key);
                        return n;
                      })
                    );
                }}
              >
                {added.has(key) ? "On your watchlist" : "+ Watchlist"}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
