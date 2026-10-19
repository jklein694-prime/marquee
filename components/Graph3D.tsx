"use client";

// next/dynamic does not forward refs, so this thin wrapper takes the graph
// methods ref as a regular prop; PredictPanel imports it with ssr: false
// (react-force-graph-3d touches window at module scope).
//
// Look: smooth spheres (the library default is an 8-segment octagon), a warm
// key light and a cool rim light so the spheres read as lit objects, faint
// edges, and an additive glow sprite behind every node so hot and selected
// nodes bloom. Sprites, not a post-processing bloom pass: the pass re-encodes
// the frame's colour space and greys the ground, and it costs a full-screen
// blur per frame on a phone. All of this runs on the viewer's GPU.
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import ForceGraph3D, { type ForceGraphMethods, type ForceGraphProps, type NodeObject } from "react-force-graph-3d";
import {
  AdditiveBlending,
  AmbientLight,
  CanvasTexture,
  Color,
  DirectionalLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Object3D,
} from "three";
import { useIsPhone } from "@/lib/useMediaQuery";

const NODE_REL_SIZE = 4; // the library default: sphere radius = cbrt(val) × this

let glowTexture: CanvasTexture | null = null;
function glow(): CanvasTexture {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.3, "rgba(255,255,255,0.3)");
  grad.addColorStop(0.7, "rgba(255,255,255,0.06)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new CanvasTexture(c);
  glowTexture.colorSpace = SRGBColorSpace;
  return glowTexture;
}

// a colour accessor's string, with its alpha: "#rrggbbaa", "rgba(...)", or opaque
const tmp = new Color();
function parseColor(s: string): { color: Color; alpha: number } {
  let alpha = 1;
  let base = s;
  const hex8 = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/i);
  const rgba = s.match(/^rgba?\(([^)]+)\)$/i);
  if (hex8) {
    base = `#${hex8[1]}`;
    alpha = parseInt(hex8[2], 16) / 255;
  } else if (rgba) {
    const parts = rgba[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 4) alpha = parseFloat(parts[3]);
    base = `rgb(${parts.slice(0, 3).join(",")})`;
  }
  tmp.set(base);
  return { color: tmp, alpha: Number.isFinite(alpha) ? alpha : 1 };
}

type WithObj = NodeObject & { __threeObj?: Object3D };

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

  // a warm key and a cool rim instead of the flat default ambient
  useEffect(() => {
    const fg = ref.current;
    if (!fg) return;
    const key = new DirectionalLight(0xfff1d6, 1.5);
    key.position.set(1, 1.2, 1);
    const rim = new DirectionalLight(0x9fc3dc, 0.8);
    rim.position.set(-1, -0.4, -1);
    fg.lights([new AmbientLight(0xffffff, 0.6), key, rim]);
  }, [ref]);

  // one glow sprite per node, created once (a stable accessor keeps the
  // library from rebuilding objects on every render) …
  const makeGlow = useCallback(() => {
    const s = new Sprite(
      new SpriteMaterial({
        map: glow(),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0.5,
      })
    );
    s.renderOrder = -1;
    return s;
  }, []);

  // … then kept in step with the colour and size accessors at 10Hz, which is
  // the rate the heat engine re-renders at: a hot node brightens and swells,
  // a dimmed one fades, exactly as its sphere does
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });
  useEffect(() => {
    if (paused) return;
    const tick = () => {
      const { graphData, nodeColor, nodeVal } = propsRef.current;
      if (!graphData) return;
      for (const node of graphData.nodes as WithObj[]) {
        const sprite = node.__threeObj?.children.find((c): c is Sprite => c instanceof Sprite);
        if (!sprite) continue;
        const colorStr =
          typeof nodeColor === "function"
            ? nodeColor(node)
            : typeof nodeColor === "string"
              ? (node as Record<string, unknown>)[nodeColor]
              : undefined;
        const val =
          typeof nodeVal === "function"
            ? nodeVal(node)
            : typeof nodeVal === "number"
              ? nodeVal
              : typeof nodeVal === "string"
                ? (node as Record<string, unknown>)[nodeVal]
                : 1;
        const { color, alpha } = parseColor(String(colorStr ?? "#ffffff"));
        const mat = sprite.material;
        mat.color.copy(color);
        // the sphere's own alpha dims it; the glow dims faster so a dimmed
        // neighbourhood goes dark rather than hazy
        mat.opacity = 0.5 * alpha * alpha;
        const r = Math.cbrt(Math.max(1, Number(val) || 1)) * NODE_REL_SIZE;
        const d = r * 5.2;
        if (sprite.scale.x !== d) sprite.scale.set(d, d, 1);
      }
    };
    tick();
    const iv = window.setInterval(tick, 100);
    return () => window.clearInterval(iv);
  }, [paused]);

  // smooth spheres everywhere (lib default: resolution 8, opacity 0.75); per-
  // node dimming still works — material opacity = nodeOpacity × color alpha.
  // Faster alpha decay + heavier velocity damping calm the re-heat jiggle when
  // ghost nodes stream in mid-turn.
  return (
    <ForceGraph3D
      nodeResolution={phone ? 20 : 28}
      nodeOpacity={1}
      linkOpacity={0.22}
      nodeThreeObject={makeGlow}
      nodeThreeObjectExtend
      d3AlphaMin={0.001}
      d3AlphaDecay={0.05}
      d3VelocityDecay={0.5}
      ref={ref}
      {...props}
    />
  );
}
