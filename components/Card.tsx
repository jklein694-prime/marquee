"use client";

// The one title card. Poster, title, a facts line, Louie's projection, his
// reason, the overflow menu pinned top-right, and then EXACTLY one action
// row: a filled primary, an optional quiet secondary, and an optional tail
// pushed to the right edge (reorder control, "Not now"). The row never wraps —
// enforced here, so no screen can grow a second line of buttons again.
//
// Louie's reason is always shown in full, labelled, under the poster row;
// tapping that block reveals the synopsis. That is a disclosure on the
// text, not a button in the row, so the row stays one row.

import { useState, type HTMLAttributes, type ReactNode } from "react";
import { Poster } from "./Poster";

export function Card({
  posterPath,
  title,
  year,
  facts,
  predicted,
  note,
  synopsis,
  menu,
  primary,
  secondary,
  tail,
  children,
  dragProps,
  className = "",
}: {
  posterPath?: string | null;
  title: string;
  year?: number | string;
  /** one line: where it streams (truncates) */
  facts?: ReactNode;
  /** Louie's projected score, e.g. "8-9"; always visible when present */
  predicted?: string;
  /** Louie's reason, shown in full */
  note?: string;
  /** the TMDB overview, revealed by tapping the reason block */
  synopsis?: string;
  menu?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  tail?: ReactNode;
  /** expands below the action row (the review form) */
  children?: ReactNode;
  dragProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const showYear = year && !title.includes(`(${year})`);
  const expandable = !!(note || synopsis);
  return (
    <article
      {...dragProps}
      className={`rounded-2xl border border-border bg-surface-1 p-3 ${dragProps?.draggable ? "cursor-grab active:cursor-grabbing" : ""} ${className}`}
    >
      <div className="flex gap-3">
        <Poster
          path={posterPath}
          alt=""
          width={64}
          height={96}
          className="h-24 w-16 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1 pt-1">
              <h3 className="text-base font-semibold leading-tight md:text-sm">
                {title}
                {showYear && (
                  <span className="font-normal text-muted"> {year}</span>
                )}
              </h3>
              {facts && (
                <div className="mt-1 truncate text-xs text-muted">{facts}</div>
              )}
              {predicted && (
                <div
                  className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-info-subtle px-2 py-0.5 text-xs text-info"
                  title="Louie's projected score from your taste graph"
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-info"
                  />
                  Louie predicts {predicted.replace("-", "–")}
                </div>
              )}
            </div>
            {menu && <div className="-mr-2 -mt-1.5 shrink-0">{menu}</div>}
          </div>
        </div>
      </div>
      {expandable && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={
            open
              ? "Hide the synopsis"
              : synopsis
                ? "Show the synopsis"
                : "Louie's reason"
          }
          className="mt-2.5 block w-full rounded-xl bg-surface-2 px-3 py-2 text-left"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold tracking-[0.08em] text-faint">
              {note ? "WHY LOUIE PICKED THIS" : "SYNOPSIS"}
            </span>
            {synopsis && note && (
              <span className="text-xs text-faint">
                {open ? "hide synopsis" : "synopsis"}
              </span>
            )}
          </div>
          {note && (
            <div className="mt-0.5 text-sm leading-snug text-fg md:text-xs">
              {note}
            </div>
          )}
          {synopsis && (open || !note) && (
            <div
              className={`text-sm leading-snug text-muted md:text-xs ${note ? "mt-2 border-t border-border pt-2" : "mt-0.5"}`}
            >
              {synopsis}
            </div>
          )}
        </button>
      )}
      <div className="mt-3 flex items-center gap-2 overflow-hidden whitespace-nowrap">
        {primary}
        {secondary}
        {tail && (
          <span className="ml-auto flex shrink-0 items-center">{tail}</span>
        )}
      </div>
      {children}
    </article>
  );
}
