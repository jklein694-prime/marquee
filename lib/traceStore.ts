"use client";

// The Projection Booth feed as an external store. Trace events arrive several
// times a second during a turn; keeping them in page state re-rendered the
// whole app (chat, open panel, graph accessors) per line. Here only the Booth
// subscribes, and the buffer is a ring so a long session can't grow without
// bound.

import { useSyncExternalStore } from "react";
import type { TraceEntry } from "@/components/ChatPane";

const CAP = 500;

interface TraceState {
  entries: TraceEntry[];
  /** model the API served for the last reply, from the "model" trace line */
  model: string | null;
}

let state: TraceState = { entries: [], model: null };
const listeners = new Set<() => void>();

export function pushTrace(t: TraceEntry) {
  const entries = state.entries.length >= CAP ? [...state.entries.slice(-CAP + 1), t] : [...state.entries, t];
  state = { entries, model: t.kind === "model" ? t.label : state.model };
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => state;
const EMPTY: TraceState = { entries: [], model: null };
const getServerSnapshot = () => EMPTY;

export function useTrace(): TraceState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
