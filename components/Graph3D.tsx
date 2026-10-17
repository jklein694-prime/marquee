"use client";

// next/dynamic does not forward refs, so this thin wrapper takes the graph
// methods ref as a regular prop; PredictPanel imports it with ssr: false
// (react-force-graph-3d touches window at module scope).
import { useEffect, useRef, type MutableRefObject } from "react";
import ForceGraph3D, { type ForceGraphMethods, type ForceGraphProps } from "react-force-graph-3d";
import { useIsPhone } from "@/lib/useMediaQuery";

export default function Graph3D({
  fgRef,
  paused = false,
  ...props
}: ForceGraphProps & {
  fgRef?: MutableRefObject<ForceGraphMethods | undefined>;
  /** stop the render loop while the graph is off-screen (hidden panel, other mode) */
  paused?: boolean;
}) {
  const phone = useIsPhone();
  const localRef = useRef<ForceGraphMethods | undefined>(undefined);
  const ref = fgRef ?? localRef;

  // three.js renders every frame forever by default; a hidden panel or a
  // backgrounded app still burns the battery. Pause whenever we are not
  // actually being looked at.
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

  // crisp solid spheres everywhere (lib defaults: resolution 8, opacity 0.75);
  // per-node dimming still works — material opacity = nodeOpacity × color alpha.
  // Faster alpha decay + heavier velocity damping calm the re-heat jiggle when
  // ghost nodes stream in mid-turn. Phones get the lighter sphere mesh.
  return (
    <ForceGraph3D
      nodeResolution={phone ? 8 : 16}
      nodeOpacity={1}
      d3AlphaMin={0.001}
      d3AlphaDecay={0.05}
      d3VelocityDecay={0.5}
      ref={ref}
      {...props}
    />
  );
}
