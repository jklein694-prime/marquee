"use client";

import { useSyncExternalStore } from "react";

// matchMedia as an external store. The server snapshot is the fallback, so
// SSR and the first client render agree; the real answer lands on hydration.
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => fallback
  );
}

/** Below Tailwind's md breakpoint: the single-column phone layout. */
export const useIsPhone = () => useMediaQuery("(max-width: 767px)");

/** A mouse or trackpad is present (drag-and-drop, hover affordances). */
export const useFinePointer = () => useMediaQuery("(pointer: fine)", true);
