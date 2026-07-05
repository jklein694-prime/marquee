"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphNode, GraphLink } from "@/lib/vault";
import { Markdown } from "./ChatPane";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

const COLORS: Record<string, string> = {
  loved: "#f5b942",
  liked: "#f5b942",
  disliked: "#b3402e",
  meh: "#8a8178",
};
const KIND_COLORS: Record<string, string> = {
  genre: "#e07b39",
  watchlist: "#f5b94266",
  taste: "#e8dcc8",
  movie: "#8a8178",
};

function nodeColor(n: GraphNode): string {
  if (n.kind === "movie" && n.verdict) return COLORS[n.verdict] ?? "#8a8178";
  return KIND_COLORS[n.kind] ?? "#8a8178";
}

// force-graph replaces link endpoint strings with node objects after layout
function endId(end: GraphLink["source"]): string {
  return typeof end === "object" ? (end as unknown as GraphNode).id : end;
}

type WikiState = "loading" | "missing" | { title: string; content: string };

export default function GraphView({ version }: { version: number }) {
  const [data, setData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({
    nodes: [],
    links: [],
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [wiki, setWiki] = useState<WikiState | null>(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [version]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!selected) {
      setWiki(null);
      return;
    }
    let stale = false;
    setWiki("loading");
    fetch(`/api/wiki?id=${encodeURIComponent(selected.id)}`)
      .then((r) => (r.ok ? r.json() : "missing"))
      .then((w) => !stale && setWiki(w))
      .catch(() => !stale && setWiki("missing"));
    return () => {
      stale = true;
    };
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    function handleClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setSelected(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selected]);

  const neighborIds = useMemo(() => {
    if (!selected) return null;
    const ids = new Set([selected.id]);
    for (const l of data.links) {
      const s = endId(l.source);
      const t = endId(l.target);
      if (s === selected.id) ids.add(t);
      if (t === selected.id) ids.add(s);
    }
    return ids;
  }, [selected, data]);

  const linkActive = (l: GraphLink) =>
    !!selected &&
    (endId(l.source) === selected.id || endId(l.target) === selected.id);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {data.nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-muted text-sm">
          The taste graph is empty — talk movies and watch it grow.
        </div>
      ) : (
        <ForceGraph2D
          width={size.width}
          height={size.height}
          graphData={data}
          backgroundColor="#0c0a08"
          autoPauseRedraw={false}
          linkColor={(l) => (linkActive(l as GraphLink) ? "#f5b942" : "#2a221a")}
          linkWidth={(l) => (linkActive(l as GraphLink) ? 2 : 1)}
          onNodeClick={(node) => {
            const n = node as unknown as GraphNode;
            setSelected((cur) => (cur?.id === n.id ? null : n));
          }}
          onBackgroundClick={() => setSelected(null)}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as unknown as GraphNode & { x: number; y: number };
            const color = nodeColor(n);
            const r = n.kind === "genre" ? 7 : n.kind === "taste" ? 3.5 : 5;
            const dimmed = neighborIds ? !neighborIds.has(n.id) : false;
            ctx.save();
            if (dimmed) ctx.globalAlpha = 0.15;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
            ctx.fill();
            if (selected?.id === n.id) {
              ctx.shadowBlur = 0;
              ctx.strokeStyle = "#f5b942";
              ctx.lineWidth = 1.5 / globalScale;
              ctx.beginPath();
              ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI);
              ctx.stroke();
            }
            if (globalScale > 0.8 || (!dimmed && neighborIds)) {
              ctx.shadowBlur = 0;
              ctx.font = `${11 / globalScale}px sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillStyle = "#e8dcc8cc";
              ctx.fillText(n.label, n.x, n.y + r + 2);
            }
            ctx.restore();
          }}
        />
      )}
      {selected && (
        <div className="absolute right-3 top-3 z-10 max-h-[calc(100%-1.5rem)] w-80 max-w-[85%] overflow-y-auto rounded-lg border border-card-border bg-card/95 backdrop-blur-sm">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-2 rounded-t-lg bg-card/95 p-4 pb-2 backdrop-blur-sm">
            <div className="text-sm font-medium text-glow">
              {typeof wiki === "object" && wiki ? wiki.title : selected.label}
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-muted hover:text-foreground"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="break-words px-4 pb-4 text-sm">
            {wiki === "loading" && <div className="text-muted">Loading…</div>}
            {wiki === "missing" && (
              <div className="text-muted">No wiki page for this node.</div>
            )}
            {typeof wiki === "object" && wiki && <Markdown text={wiki.content} />}
          </div>
        </div>
      )}
    </div>
  );
}
