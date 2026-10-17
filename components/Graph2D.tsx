"use client";

// next/dynamic does not forward refs, so this thin wrapper takes the graph
// methods ref as a regular prop; GraphView imports it with ssr: false. It
// also installs the shared cluster force on the 2D simulation.
import { useEffect, useRef, type MutableRefObject } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type ForceGraphProps,
} from "react-force-graph-2d";
import { installClusterLayout, removeClusterLayout } from "./graph/clusterForce";

export default function Graph2D({
  fgRef: fgRefProp,
  ...props
}: ForceGraphProps & { fgRef?: MutableRefObject<ForceGraphMethods | undefined> }) {
  const localRef = useRef<ForceGraphMethods | undefined>(undefined);
  const fgRef = fgRefProp ?? localRef;
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    installClusterLayout(fg);
    return () => removeClusterLayout(fg);
  }, [fgRef]);
  return <ForceGraph2D ref={fgRef} {...props} />;
}
