"use client";

import { useCallback, useSyncExternalStore } from "react";

// localStorage as an external store: the server snapshot is the fallback (so
// SSR and the first client render agree), and the real value lands on
// hydration without a setState-in-effect. Writes notify every subscriber in
// this tab; the "storage" event covers other tabs.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useLocalStorage(key: string, fallback: string): [string, (v: string) => void] {
  const read = () => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const value = useSyncExternalStore(subscribe, read, () => fallback);
  const set = useCallback(
    (v: string) => {
      try {
        localStorage.setItem(key, v);
      } catch {}
      notify();
    },
    [key]
  );
  return [value, set];
}
