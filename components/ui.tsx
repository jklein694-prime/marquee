"use client";

// The primitives every panel is built from (PLAN.md §3). Sizes are
// mobile-first: 44px hit areas on touch, denser on md+ where a pointer is
// assumed. No panel should carry its own bespoke button class strings.

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CloseIcon } from "./icons";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "filled";
type Size = "md" | "sm";

const VARIANT: Record<Variant, string> = {
  primary: "border border-accent-border text-accent hover:bg-accent-subtle",
  filled: "bg-accent text-accent-text font-semibold hover:brightness-105",
  secondary: "border border-border text-muted hover:border-accent-border hover:text-accent",
  ghost: "text-muted hover:text-fg hover:bg-surface-3",
  danger: "border border-danger/60 text-danger hover:bg-danger-subtle",
};

// md: 44px everywhere. sm: 44px on touch, 36px on md+ (desktop density).
const SIZE: Record<Size, string> = {
  md: "min-h-11 px-4 text-sm",
  sm: "min-h-11 px-3 text-sm md:min-h-9 md:text-xs",
};

export function Button({
  variant = "secondary",
  size = "sm",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md transition-colors disabled:cursor-default disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  );
}

/** A 44px hit area around a small glyph; always needs a label. */
export function IconButton({
  label,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-fg md:h-9 md:w-9 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Selectable pill: service filters, help section jumps, 2D/3D switch. */
export function Chip({
  selected = false,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm transition-colors md:min-h-8 md:px-3 md:text-xs ${
        selected
          ? "border-accent-border bg-accent-muted text-accent"
          : "border-border text-muted hover:border-border-strong hover:text-fg"
      } ${className}`}
      {...rest}
    />
  );
}

/**
 * 1–10 rating: a 5×2 grid of 44px cells on phones (ten across never fit a
 * card at 390px), one dense row on md+. Shared by the watchlist review form,
 * Quick Rate, and the chat checklist widget.
 */
export function RatingGrid({
  value,
  onChange,
  disabled = false,
  label = "Rating out of 10",
}: {
  value: number | null;
  onChange: (n: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1.5 md:flex md:gap-1">
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          disabled={disabled}
          onClick={() => onChange(n)}
          className={`h-11 rounded-md text-sm transition-colors disabled:opacity-50 md:h-8 md:w-8 md:text-xs ${
            value === n
              ? "bg-accent font-semibold text-accent-text"
              : "border border-border text-muted hover:border-accent-border hover:text-fg"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

/**
 * Detail surface: a bottom sheet on phones (scrolls inside, backdrop closes
 * it), a floating card pinned top-right on md+ (the graph stays interactive;
 * the caller closes it on an outside click). Escape closes either.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="absolute inset-0 z-10 md:hidden" onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-label={typeof title === "string" ? title : "Details"}
        data-sheet
        className={`sheet-up absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] flex-col rounded-t-2xl border-t border-border bg-surface-1/95 shadow-2xl backdrop-blur-sm md:inset-auto md:right-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80 md:rounded-lg md:border ${className}`}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong md:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-2 pl-4 pr-1 pt-2">
          <div className="min-w-0 flex-1 py-2 text-base font-medium leading-snug text-fg md:text-sm">{title}</div>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">
          {children}
        </div>
      </section>
    </>
  );
}
