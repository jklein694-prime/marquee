"use client";

// Shared label + cluster styling for the 2D canvas and the 3D sprites. One
// width budget ("fits") and one palette, applied the same way in both views.
import * as THREE from "three";
import type { GraphLink, GraphNode } from "@/lib/vault";

export const NODE_LABEL_MAX_PX = 120; // screen px a node label may take
export const CLUSTER_LABEL_MAX_PX = 150;
export const LABEL_COLOR = "#e8dcc8";

// 12 muted hues that sit under the gold/red/orange node colors — used for
// cluster labels, cluster fields and intra-cluster edges, never for nodes
// (node color is the taste signal: loved / disliked / category …)
const CLUSTER_HUES = [
  "#c9a26a", "#7fa7a1", "#a97fa0", "#8da36f", "#b08a6a", "#6f8fb3",
  "#c08a8a", "#9aa06a", "#8a9fb8", "#b39a7f", "#7fa58a", "#a88fb8",
];
export function clusterColor(cluster: number | undefined): string {
  if (cluster === undefined || cluster < 0) return "#5a4f44";
  return CLUSTER_HUES[cluster % CLUSTER_HUES.length];
}

export function clusterOf(end: GraphLink["source"]): number | undefined {
  return typeof end === "object" ? (end as unknown as GraphNode).cluster : undefined;
}

// cold edge: tinted when both ends live in one cluster, bark-dark across
export const CROSS_LINK = "rgba(90,79,68,0.16)"; // faint: structure, not fog
export function clusterLinkColor(l: GraphLink, alpha = 0.35): string {
  const a = clusterOf(l.source);
  const b = clusterOf(l.target);
  if (a === undefined || a < 0 || a !== b) return CROSS_LINK;
  const [r, g, bb] = hexRgb(clusterColor(a));
  return `rgba(${r},${g},${bb},${alpha})`;
}

const hexRgb = (c: string) => [
  parseInt(c.slice(1, 3), 16),
  parseInt(c.slice(3, 5), 16),
  parseInt(c.slice(5, 7), 16),
];

let fontFamily: string | null = null;
export function uiFont(): string {
  if (fontFamily) return fontFamily;
  if (typeof document === "undefined") return "sans-serif";
  const f = getComputedStyle(document.body).fontFamily;
  fontFamily = f && f !== "" ? f : "sans-serif";
  return fontFamily;
}

// ellipsis-truncate so the text's measured width fits maxPx
export function fitLabel(
  text: string,
  maxPx: number,
  ctx: CanvasRenderingContext2D
): string {
  if (ctx.measureText(text).width <= maxPx) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid).trimEnd() + "…").width <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "…" : text.slice(0, lo).trimEnd() + "…";
}

// --- 3D sprites -------------------------------------------------------------

interface LabelTex {
  texture: THREE.CanvasTexture;
  aspect: number; // w / h of the drawn text box
}
const texCache = new Map<string, LabelTex>();
const TEX_H = 64; // texture px per text line height; drawn text uses ~60%

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")!;
  return measureCtx;
}

// canvas texture for one label; cached by text + color + weight. Width is
// fitted to NODE/CLUSTER budgets scaled to the texture's pixel density.
export function labelTexture(
  text: string,
  color: string,
  opts: { maxPx: number; weight?: number; letterSpacing?: number } = { maxPx: NODE_LABEL_MAX_PX }
): LabelTex {
  const key = `${text}|${color}|${opts.weight ?? 400}|${opts.maxPx}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const fontPx = Math.round(TEX_H * 0.56);
  const font = `${opts.weight ?? 400} ${fontPx}px ${uiFont()}`;
  const m = measurer();
  m.font = font;
  // budget is expressed in on-screen px at a nominal 12px label; scale to this
  // texture's font size so truncation matches the 2D canvas
  const fitted = fitLabel(text, (opts.maxPx * fontPx) / 12, m);
  const w = Math.ceil(m.measureText(fitted).width) + 16;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // soft dark halo keeps text legible over bright spheres and edges
  ctx.shadowColor = "rgba(12,10,8,0.9)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(fitted, w / 2, TEX_H / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const entry = { texture, aspect: w / TEX_H };
  texCache.set(key, entry);
  return entry;
}

// a screen-space sprite (constant pixel size regardless of depth), initially
// empty and hidden; the LOD loop assigns a texture when it first shows
export function makeLabelSprite(): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.visible = false;
  s.renderOrder = 10;
  return s;
}

// scale for a sizeAttenuation:false sprite so its text renders `px` tall on a
// viewport `heightPx` tall through a camera with vertical `fovDeg`
export function spriteScale(px: number, heightPx: number, fovDeg: number): number {
  return (px / 0.56) * (2 * Math.tan((fovDeg * Math.PI) / 360)) / heightPx;
}
