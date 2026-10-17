"use client";

// The four primitives every panel is built from (PLAN.md §3). Sizes are
// mobile-first: 44px hit areas on touch, denser on md+ where a pointer is
// assumed. No panel should carry its own bespoke button class strings.

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

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

/** A 44px hit area around a small glyph; always needs aria-label. */
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
      className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-sm transition-colors md:min-h-8 md:text-xs ${
        selected
          ? "border-accent-border bg-accent-muted text-accent"
          : "border-border text-muted hover:border-border-strong hover:text-fg"
      } ${className}`}
      {...rest}
    />
  );
}

/**
 * Detail surface: a bottom sheet on phones (half height, scrolls inside), a
 * floating card pinned top-right on md+. Escape closes; the backdrop is
 * tap-to-close on phones only (desktop keeps the graph interactive).
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
        aria-label={typeof title === "string" ? title : undefined}
        className={`sheet-up absolute inset-x-0 bottom-0 z-20 flex max-h-[60%] flex-col rounded-t-2xl border-t border-border bg-surface-1/95 shadow-2xl backdrop-blur-sm md:inset-auto md:right-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80 md:rounded-lg md:border ${className}`}
      >
        <header className="flex items-start justify-between gap-2 px-4 pt-3 pb-2">
          <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-border-strong md:hidden" aria-hidden />
        </header>
        <div className="-mt-6 flex items-start justify-between gap-2 px-4 pb-2 md:mt-0">
          <div className="min-w-0 text-base font-medium text-fg md:text-sm">{title}</div>
          <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-2">
            <span aria-hidden className="text-lg leading-none">
              ×
            </span>
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm">{children}</div>
      </section>
    </>
  );
}
