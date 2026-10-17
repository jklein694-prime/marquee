"use client";

// One client-side copy of the taste graph, shared by every panel that draws
// it. A fetch is started at most once per version (the turn counter the app
// bumps when a reply finishes); concurrent subscribers share it, and nothing
// fetches until the first panel that needs the graph is actually shown.

import { useEffect, useSyncExternalStore } from "react";
import type { GraphLink, GraphNode } from "@/lib/vault";

export type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

interface GraphState {
  data: GraphData;
  /** the version the current data was fetched for (-1 before any fetch) */
  version: number;
}

const EMPTY: GraphData = { nodes: [], links: [] };
let state: GraphState = { data: EMPTY, version: -1 };
let inFlight: { version: number; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Fetch the graph for `version` unless that fetch is already done or running. */
export function ensureGraph(version: number): Promise<void> {
  if (state.version >= version) return Promise.resolve();
  if (inFlight && inFlight.version >= version) return inFlight.promise;
  const promise = fetch("/api/graph")
    .then((r) => r.json())
    .then((d: GraphData) => {
      state = { data: d, version };
      notify();
    })
    .catch(() => {})
    .finally(() => {
      if (inFlight?.version === version) inFlight = null;
    });
  inFlight = { version, promise };
  return promise;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const getSnapshot = () => state;
const SERVER: GraphState = { data: EMPTY, version: -1 };
const getServerSnapshot = () => SERVER;

/**
 * The latest graph. Passing `version` keeps it fresh: a newer version triggers
 * one fetch, and stale data stays on screen until the new one lands (no
 * flash to empty). `active: false` reads the cache but never fetches, so a
 * panel mounted off-screen costs nothing.
 */
export function useGraph(version: number, active = true): GraphData {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (active) void ensureGraph(version);
  }, [version, active]);
  return s.data;
}
