"use client";

// next/dynamic does not forward refs, so this thin wrapper takes the graph
// methods ref as a regular prop (same pattern as Graph3D). GraphView imports
// it with ssr: false — force-graph touches window at module scope.
import { useEffect, useRef, type MutableRefObject } from "react";
import ForceGraph2D, { type ForceGraphMethods, type ForceGraphProps } from "react-force-graph-2d";

export type Graph2DMethods = ForceGraphMethods;

export default function Graph2D({
  fgRef,
  paused = false,
  ...props
}: ForceGraphProps & {
  fgRef?: MutableRefObject<ForceGraphMethods | undefined>;
  /** stop the render loop while the graph is off-screen */
  paused?: boolean;
}) {
  const localRef = useRef<ForceGraphMethods | undefined>(undefined);
  const ref = fgRef ?? localRef;

  useEffect(() => {
    const apply = () => {
      const fg = ref.current;
      if (!fg) return;
      if (paused || document.hidden) fg.pauseAnimation();
      else fg.resumeAnimation();
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => document.removeEventListener("visibilitychange", apply);
  }, [paused, ref]);

  // force-graph's engine otherwise keeps ticking (and repainting every frame)
  // for a 15s cooldown even after the layout has visibly settled; stopping at
  // the d3 alpha floor ends it in a couple of seconds
  return <ForceGraph2D d3AlphaMin={0.001} ref={ref} {...props} />;
}
