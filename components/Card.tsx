"use client";

// The one title card. Poster, title, a facts line, Louie's projection, his
// reason, the overflow menu pinned top-right, and then EXACTLY one action
// row: a filled primary, an optional quiet secondary, and an optional tail
// pushed to the right edge (reorder control, "Not now"). The row never wraps —
// enforced here, so no screen can grow a second line of buttons again.
//
// The reason shows two lines; tapping it opens the full reason and the
// synopsis in place. That is a disclosure on the text, not a button in the
// row, so the row stays one row.

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
  /** Louie's reason; two lines, tap to open */
  note?: string;
  /** the TMDB overview, shown under the open reason */
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
          {expandable && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={
                open
                  ? "Hide the reason and synopsis"
                  : "Show the full reason and synopsis"
              }
              className="mt-1 flex min-h-11 w-full flex-col justify-center text-left"
            >
              {note && (
                <div
                  className={`text-sm leading-snug text-muted md:text-xs ${open ? "" : "line-clamp-2"}`}
                >
                  {note}
                </div>
              )}
              {open && synopsis && (
                <div className="mt-2 border-t border-border pt-2 text-sm leading-snug text-muted md:text-xs">
                  <div className="mb-0.5 text-xs font-semibold tracking-[0.08em] text-faint">
                    SYNOPSIS
                  </div>
                  {synopsis}
                </div>
              )}
              {!open && synopsis && (
                <div className="mt-0.5 text-xs text-faint">
                  {note ? "more" : "synopsis"}
                </div>
              )}
            </button>
          )}
        </div>
      </div>
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
