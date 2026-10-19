"use client";

// The primitives every panel is built from (PLAN.md §3). Sizes are
// mobile-first: 44px hit areas on touch, denser on md+ where a pointer is
// assumed. No panel should carry its own bespoke button class strings.

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CloseIcon } from "./icons";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "filled";
type Size = "md" | "sm";

const VARIANT: Record<Variant, string> = {
  primary: "border border-accent-border text-accent hover:bg-accent-subtle",
  filled: "bg-accent text-accent-text font-semibold hover:brightness-105",
  secondary: "border border-border-strong text-fg hover:border-accent-border hover:text-accent",
  ghost: "text-muted hover:text-fg hover:bg-surface-3",
  danger: "border border-danger/60 text-danger hover:bg-danger-subtle",
};

// md: 44px everywhere. sm: 44px on touch, 36px on md+ (desktop density).
const SIZE: Record<Size, string> = {
  md: "min-h-11 px-4 text-sm",
  sm: "min-h-11 px-3.5 text-sm md:min-h-9 md:px-3 md:text-xs",
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
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl transition-colors disabled:cursor-default disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
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
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-3 hover:text-fg disabled:opacity-40 md:h-9 md:w-9 ${className}`}
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

// --- rating -----------------------------------------------------------------

export function ratingWord(n: number): string {
  if (n <= 2) return "Skip it";
  if (n <= 4) return "Not for me";
  if (n === 5) return "Fine";
  if (n <= 7) return "Liked it";
  if (n <= 9) return "Loved it";
  return "All-timer";
}

/**
 * 1–10 as one scale: ten joined segments you tap or drag across, the chosen
 * number large above it. Each segment is a real radio for the screen reader
 * and keyboard (arrow keys move the value); the track is the touch target,
 * a continuous slider rather than ten separate buttons, so the layout gate's
 * 44px-per-control rule is waived on it by design.
 */
export function RatingScale({
  value,
  onChange,
  predicted,
  compact = false,
  disabled = false,
  label = "Rating out of 10",
}: {
  value: number | null;
  onChange: (n: number) => void;
  /** Louie's projection, shown beside the heading ("8-9") */
  predicted?: string;
  /** bar + number only (checklist widget) */
  compact?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pickAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el || disabled) return;
    const r = el.getBoundingClientRect();
    const n = Math.min(10, Math.max(1, Math.ceil(((clientX - r.left) / r.width) * 10)));
    if (n !== value) onChange(n);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const cur = value ?? 0;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(10, cur + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(1, cur - 1));
    }
  };
  const track = (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      data-allow-small
      onKeyDown={onKey}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pickAt(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons) pickAt(e.clientX);
      }}
      className="grid min-w-0 flex-1 touch-none select-none grid-cols-10 gap-1"
    >
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const picked = value === n;
        const below = value !== null && n < value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={picked}
            aria-label={String(n)}
            tabIndex={picked || (value === null && n === 1) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(n)}
            className={`h-11 min-w-0 rounded-md transition-[background-color,box-shadow] md:h-9 ${
              picked ? "bg-accent shadow-[0_0_0_2px_var(--surface-0),0_0_0_4px_var(--accent)]" : ""
            } ${n === 1 ? "rounded-l-lg" : ""} ${n === 10 ? "rounded-r-lg" : ""}`}
            style={picked ? undefined : { backgroundColor: `rgb(245 185 66 / ${below ? 0.18 + (n / 10) * 0.5 : 0.12})` }}
          />
        );
      })}
    </div>
  );
  if (compact)
    return (
      <div className="flex items-center gap-3">
        {track}
        <span className="w-9 shrink-0 text-right text-base font-semibold tabular-nums text-accent">{value ?? "–"}</span>
      </div>
    );
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold tracking-[0.08em] text-muted">HOW WAS IT</div>
        {predicted && (
          <div className="text-xs text-muted">
            Louie predicted <span className="text-info">{predicted.replace("-", "–")}</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex items-end gap-3">
        <div className="text-6xl font-bold leading-none tracking-tight text-accent tabular-nums md:text-5xl">{value ?? "–"}</div>
        <div className="pb-2 text-base font-medium text-fg md:pb-1 md:text-sm">{value ? ratingWord(value) : "Tap or drag the scale"}</div>
      </div>
      <div className="mt-4">{track}</div>
      <div aria-hidden className="mt-1.5 flex justify-between text-xs tracking-wide text-faint">
        <span>1 · skip it</span>
        <span>5 · fine</span>
        <span>10 · all-timer</span>
      </div>
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
  eyebrow,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** small caps line above the title (kind, counts) */
  eyebrow?: ReactNode;
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
        className={`sheet-up absolute inset-x-0 bottom-0 z-20 flex max-h-[62%] flex-col rounded-t-3xl border-t border-border bg-surface-1/95 shadow-[0_-24px_48px_rgba(0,0,0,0.5)] backdrop-blur-sm md:inset-auto md:right-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80 md:rounded-2xl md:border ${className}`}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-strong md:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-2 pl-5 pr-1 pt-2">
          <div className="min-w-0 flex-1 py-2">
            {eyebrow && <div className="text-[11px] font-semibold tracking-[0.08em] text-info md:text-[10px]">{eyebrow}</div>}
            <div className="text-xl font-semibold leading-snug text-fg md:text-base">{title}</div>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <CloseIcon size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-sm leading-relaxed">
          {children}
        </div>
      </section>
    </>
  );
}
