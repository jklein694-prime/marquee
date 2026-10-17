"use client";

// The 3D taste-graph scene. Owns everything that must stay identity-stable
// across the heat engine's 10Hz re-renders: the cluster force, the label
// sprites, the LOD loop that fades labels by camera distance, bloom and fog.
// (three-forcegraph rebuilds EVERY node object when the nodeThreeObject
// accessor changes identity, so labels are mutated in place from a rAF loop
// and never driven through React props.)
//
// next/dynamic does not forward refs, so the graph methods ref arrives as a
// regular prop; callers import this with ssr: false (react-force-graph-3d
// touches window at module scope).
import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import ForceGraph3D, {
  type ForceGraphMethods,
  type ForceGraphProps,
  type NodeObject,
} from "react-force-graph-3d";
import type { GraphCluster, GraphNode } from "@/lib/vault";
import {
  CLUSTER_LABEL_MAX_PX,
  LABEL_COLOR,
  clusterColor,
  labelTexture,
  makeLabelSprite,
  spriteScale,
} from "./graph/labels";
import { clusterCentroids, installClusterLayout, removeClusterLayout } from "./graph/clusterForce";

type Pos = GraphNode & {
  x?: number; y?: number; z?: number;
  __threeObj?: THREE.Object3D;
};

export interface Graph3DProps extends ForceGraphProps {
  fgRef?: MutableRefObject<ForceGraphMethods | undefined>;
  clusters?: GraphCluster[];
  // live heat (0..1 per node id) — hot nodes keep their label whatever the distance
  heatRef?: MutableRefObject<Map<string, number>>;
  // selection / cluster filter: these always carry a label
  focusIds?: Set<string> | null;
  selectedId?: string | null;
}

const LABEL_BUDGET = 40; // nearest-to-camera labels shown besides hot/focused ones
const NODE_LABEL_PX = 12;
const CLUSTER_LABEL_PX = 15;

// stable accessor: every node gets an (empty, hidden) screen-space sprite
// hung under its sphere; the LOD loop fills it in when it first shows
const labelObject = () => makeLabelSprite();

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export default function Graph3D({
  fgRef: fgRefProp,
  clusters,
  heatRef,
  focusIds,
  selectedId,
  graphData,
  width,
  height,
  ...props
}: Graph3DProps) {
  const localRef = useRef<ForceGraphMethods | undefined>(undefined);
  const fgRef = fgRefProp ?? localRef;
  const live = useRef({ clusters, heatRef, focusIds, selectedId, graphData, width, height });
  live.current = { clusters, heatRef, focusIds, selectedId, graphData, width, height };

  // forces: once, on the simulation instance (re-initialized by the lib on
  // every graphData change — our force's initialize() sees the new nodes)
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    installClusterLayout(fg);
    return () => removeClusterLayout(fg);
  }, [fgRef]);

  // scene dressing: fog for depth, bloom so hot gold actually glows
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene();
    const prevFog = scene.fog;
    const z0 = Math.cbrt(Math.max(1, graphData?.nodes.length ?? 1)) * 170;
    scene.fog = new THREE.Fog(0x0c0a08, z0 * 0.6, z0 * 2.6);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const weakGpu = window.devicePixelRatio > 2 && (width ?? 0) < 700;
    let bloom: UnrealBloomPass | null = null;
    if (!reduced && !weakGpu) {
      bloom = new UnrealBloomPass(new THREE.Vector2(width ?? 600, height ?? 600), 0.75, 0.45, 0.62);
      fg.postProcessingComposer().addPass(bloom);
    }
    return () => {
      scene.fog = prevFog;
      if (bloom) {
        fg.postProcessingComposer().removePass(bloom);
        bloom.dispose();
      }
    };
    // z0 only needs the first node count; a later resize is handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fgRef]);
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !width || !height) return;
    for (const p of fg.postProcessingComposer().passes)
      if (p instanceof UnrealBloomPass) p.setSize(width, height);
  }, [fgRef, width, height]);

  // cluster label sprites live directly in the scene; one per cluster
  const clusterSprites = useRef(new Map<number, THREE.Sprite>());
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const scene = fg.scene();
    const map = clusterSprites.current;
    for (const c of clusters ?? []) {
      if (map.has(c.id)) continue;
      const s = makeLabelSprite();
      const tex = labelTexture(c.label, clusterColor(c.id), { maxPx: CLUSTER_LABEL_MAX_PX, weight: 600 });
      (s.material as THREE.SpriteMaterial).map = tex.texture;
      s.userData.aspect = tex.aspect;
      s.renderOrder = 11;
      scene.add(s);
      map.set(c.id, s);
    }
    const keep = new Set((clusters ?? []).map((c) => c.id));
    for (const [id, s] of map)
      if (!keep.has(id)) {
        scene.remove(s);
        map.delete(id);
      }
    return () => {
      for (const s of map.values()) scene.remove(s);
      map.clear();
    };
  }, [fgRef, clusters]);

  // LOD loop (~30fps): node labels fade in by camera distance under a budget;
  // cluster labels fade out as you approach. Everything here is a mutation of
  // existing three objects — no React state, no accessor churn.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const camPos = new THREE.Vector3();
    const proj = new THREE.Vector3();
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33) return;
      last = t;
      const fg = fgRef.current;
      const { graphData, heatRef, focusIds, selectedId, clusters, height, width } = live.current;
      if (!fg || !graphData || !height) return;
      const cam = fg.camera() as THREE.PerspectiveCamera;
      camPos.copy(cam.position);
      const nodes = graphData.nodes as Pos[];
      const z0 = Math.cbrt(Math.max(1, nodes.length)) * 170;
      const FAR = 0.34 * z0;
      const NEAR = 0.13 * z0;
      const scale = spriteScale(NODE_LABEL_PX, height, cam.fov);
      const pxPerUnit = (d: number) => height / (2 * d * Math.tan((cam.fov * Math.PI) / 360));

      // candidates by priority: always-on (hot / focused / selected) first,
      // then nearest-to-camera; each one is placed in screen space only
      // where no earlier label sits, so labels never pile up
      const ranked: { n: Pos; d: number; o: number; always: boolean }[] = [];
      for (const n of nodes) {
        if (n.x === undefined || !n.__threeObj) continue;
        const d = camPos.distanceTo(n as unknown as THREE.Vector3Like);
        const heat = heatRef?.current.get(n.id) ?? 0;
        const focused = (focusIds?.has(n.id) ?? false) || n.id === selectedId;
        let o = clamp01((FAR - d) / (FAR - NEAR));
        if (heat > 0.3) o = Math.max(o, Math.min(1, heat + 0.2));
        if (focused) o = Math.max(o, 0.92);
        const always = heat > 0.3 || focused;
        if (o > 0.02 || always) ranked.push({ n, d, o, always });
      }
      ranked.sort((a, b) => Number(b.always) - Number(a.always) || a.d - b.d);
      const spritePx = NODE_LABEL_PX / 0.56;
      const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const show = new Map<Pos, { o: number; aspect: number; radiusPx: number }>();
      let budget = LABEL_BUDGET;
      for (const r of ranked) {
        if (!r.always && budget <= 0) break;
        const n = r.n;
        const sprite = n.__threeObj!.children[0] as THREE.Sprite | undefined;
        if (!sprite || !(sprite instanceof THREE.Sprite)) continue;
        const mat = sprite.material as THREE.SpriteMaterial;
        const selected = n.id === selectedId;
        const color = selected ? "#f5b942" : n.kind === "ghost" ? "#a89d90" : LABEL_COLOR;
        if (!mat.map || sprite.userData.color !== color || sprite.userData.text !== n.label) {
          const tex = labelTexture(n.label, color, { maxPx: 120, weight: selected ? 600 : 400 });
          mat.map = tex.texture;
          mat.needsUpdate = true;
          sprite.userData.aspect = tex.aspect;
          sprite.userData.color = color;
          sprite.userData.text = n.label;
        }
        const mesh = n.__threeObj as THREE.Mesh;
        const radius = (mesh.geometry as THREE.SphereGeometry)?.parameters?.radius ?? 6;
        const radiusPx = radius * pxPerUnit(r.d);
        proj.set(n.x!, n.y!, n.z!).project(cam);
        if (proj.z > 1) continue; // behind the camera
        const sx = ((proj.x + 1) / 2) * (width ?? 0);
        const sy = ((1 - proj.y) / 2) * height;
        const w = sprite.userData.aspect * spritePx * 0.8; // texture has side padding
        const rect = { x0: sx - w / 2, y0: sy + radiusPx, x1: sx + w / 2, y1: sy + radiusPx + spritePx * 0.8 };
        if (placed.some((p) => p.x0 < rect.x1 && p.x1 > rect.x0 && p.y0 < rect.y1 && p.y1 > rect.y0)) continue;
        placed.push(rect);
        if (!r.always) budget--;
        show.set(n, { o: r.o, aspect: sprite.userData.aspect, radiusPx });
      }
      for (const n of nodes) {
        const obj = n.__threeObj;
        const sprite = obj?.children[0] as THREE.Sprite | undefined;
        if (!sprite || !(sprite instanceof THREE.Sprite)) continue;
        const mat = sprite.material as THREE.SpriteMaterial;
        const s = show.get(n);
        if (!s) {
          if (sprite.visible) {
            mat.opacity = 0;
            sprite.visible = false;
          }
          continue;
        }
        // hang the text just below the sphere, in screen px: the sprite is
        // anchored at its top edge, pushed down by the sphere's on-screen radius
        sprite.center.set(0.5, 1 + (s.radiusPx + 1) / spritePx);
        sprite.scale.set(scale * s.aspect, scale, 1);
        mat.opacity += (s.o - mat.opacity) * 0.35; // ease toward target
        sprite.visible = mat.opacity > 0.02;
      }

      // cluster labels at the live centroid; visible from afar, gone up close
      if (clusters?.length) {
        const cents = clusterCentroids(nodes);
        const cscale = spriteScale(CLUSTER_LABEL_PX, height, cam.fov);
        for (const [id, s] of clusterSprites.current) {
          const c = cents.get(id);
          const mat = s.material as THREE.SpriteMaterial;
          if (!c || c.n < 2) {
            s.visible = false;
            continue;
          }
          s.position.set(c.x, c.y, c.z);
          const d = camPos.distanceTo(s.position);
          const target = clamp01((d - 0.3 * z0) / (0.3 * z0)) * 0.9;
          mat.opacity += (target - mat.opacity) * 0.3;
          s.scale.set(cscale * (s.userData.aspect ?? 4), cscale, 1);
          s.visible = mat.opacity > 0.02;
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fgRef]);

  return (
    <ForceGraph3D
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      // crisp solid spheres (lib defaults: resolution 8, opacity 0.75);
      // per-node dimming still works — material opacity = nodeOpacity × color alpha
      nodeResolution={20}
      nodeOpacity={1}
      nodeThreeObject={labelObject as (n: NodeObject) => THREE.Object3D}
      nodeThreeObjectExtend={true}
      linkOpacity={0.45}
      linkCurvature={0.12}
      // faster alpha decay + heavier velocity damping calm the re-heat jiggle
      // when ghost nodes stream in mid-turn
      d3AlphaDecay={0.05}
      d3VelocityDecay={0.5}
      {...props}
    />
  );
}
