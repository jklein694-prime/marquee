"use client";

// The one title card. Poster, title, a single facts line, an optional note,
// the overflow menu pinned top-right, and then EXACTLY one action row: a
// filled primary, an optional quiet secondary, and an optional tail pushed
// to the right edge (reorder control, "Not now"). The row never wraps —
// enforced here, so no screen can grow a second line of buttons again.

import type { HTMLAttributes, ReactNode } from "react";
import { Poster } from "./Poster";

export function Card({
  posterPath,
  title,
  year,
  facts,
  note,
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
  /** one line: service · runtime · Louie predicts … (truncates) */
  facts?: ReactNode;
  /** Louie's reason, clamped to two lines */
  note?: ReactNode;
  menu?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  tail?: ReactNode;
  /** expands below the action row (the review form) */
  children?: ReactNode;
  dragProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  className?: string;
}) {
  const showYear = year && !title.includes(`(${year})`);
  return (
    <article
      {...dragProps}
      className={`rounded-2xl border border-border bg-surface-1 p-3 ${dragProps?.draggable ? "cursor-grab active:cursor-grabbing" : ""} ${className}`}
    >
      <div className="flex gap-3">
        <Poster path={posterPath} alt="" width={64} height={96} className="h-24 w-16 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1 pt-1">
              <h3 className="text-base font-semibold leading-tight md:text-sm">
                {title}
                {showYear && <span className="font-normal text-muted"> {year}</span>}
              </h3>
              {facts && <div className="mt-1 truncate text-xs text-muted">{facts}</div>}
              {note && <div className="mt-1.5 line-clamp-2 text-sm leading-snug text-muted md:text-xs">{note}</div>}
            </div>
            {menu && <div className="-mr-2 -mt-1.5 shrink-0">{menu}</div>}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 overflow-hidden whitespace-nowrap">
        {primary}
        {secondary}
        {tail && <span className="ml-auto flex shrink-0 items-center">{tail}</span>}
      </div>
      {children}
    </article>
  );
}
