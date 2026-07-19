"use client";

// next/dynamic does not forward refs, so this thin wrapper takes the graph
// methods ref as a regular prop; PredictPanel imports it with ssr: false
// (react-force-graph-3d touches window at module scope).
import type { MutableRefObject } from "react";
import ForceGraph3D, {
  type ForceGraphMethods,
  type ForceGraphProps,
} from "react-force-graph-3d";

export default function Graph3D({
  fgRef,
  ...props
}: ForceGraphProps & { fgRef?: MutableRefObject<ForceGraphMethods | undefined> }) {
  // crisp solid spheres everywhere (lib defaults: resolution 8, opacity 0.75);
  // per-node dimming still works — material opacity = nodeOpacity × color alpha.
  // Faster alpha decay + heavier velocity damping calm the re-heat jiggle when
  // ghost nodes stream in mid-turn.
  return (
    <ForceGraph3D
      nodeResolution={16}
      nodeOpacity={1}
      d3AlphaDecay={0.05}
      d3VelocityDecay={0.5}
      ref={fgRef}
      {...props}
    />
  );
}
