import type { Doc, Eff, ImageRef, Layer } from './types';
import { applySquash, evalKeys, sideOf } from './anim';
import { M, I, mul, fromTRS, inv, apply, angleOf, clamp, normDeg } from './math';
import { getImg } from './images';

export interface ResolveOpts {
  animated: boolean;
  frame: number;
  sq: number;
}

export function baseEff(doc: Doc): Map<string, Eff> {
  const m = new Map<string, Eff>();
  for (const L of doc.layers) {
    m.set(L.id, {
      x: L.x, y: L.y, rotation: L.rotation, scaleX: L.scaleX, scaleY: L.scaleY,
      opacity: L.opacity, visible: L.visible, variant: L.activeVariant,
    });
  }
  return m;
}

export function resolveEff(doc: Doc, o: ResolveOpts): Map<string, Eff> {
  const m = baseEff(doc);
  const clip = o.animated ? doc.clips.find((c) => c.id === doc.activeClipId) : undefined;
  if (clip) {
    for (const L of doc.layers) {
      const r = evalKeys(clip.tracks[L.id], o.frame);
      if (r) {
        const e = m.get(L.id)!;
        Object.assign(e, r.v);
        if (r.variant != null) e.variant = r.variant;
      }
    }
  }
  if (o.sq) {
    for (const L of doc.layers) {
      if (L.role === 'none') continue;
      const e = m.get(L.id)!;
      const ref = imageRefFor(doc, L, e.variant);
      Object.assign(e, applySquash(e, L.role, o.sq, sideOf(L), ref?.h ?? 100));
    }
  }
  return m;
}

export function imageRefFor(doc: Doc, L: Layer, variant: number): ImageRef | undefined {
  const v = L.variants[variant] ?? L.variants[0];
  return v ? doc.images.find((i) => i.id === v.imageId) : undefined;
}

/** Which image to draw and whether to flip it back (sprite set mode facing left). */
export function drawSource(doc: Doc, L: Layer, variant: number): { id: string | null; flip: boolean } {
  const v = L.variants[variant] ?? L.variants[0];
  if (!v) return { id: null, flip: false };
  if (doc.facing === 'left' && doc.flipMode === 'spriteSet' && v.leftImageId) return { id: v.leftImageId, flip: true };
  return { id: v.imageId, flip: false };
}

export function computeWorld(doc: Doc, eff: Map<string, Eff>, off?: Map<string, number>): Map<string, M> {
  const byId = new Map(doc.layers.map((l) => [l.id, l] as const));
  const out = new Map<string, M>();
  const visiting = new Set<string>();
  const get = (id: string): M => {
    const c = out.get(id);
    if (c) return c;
    const l = byId.get(id);
    const e = eff.get(id);
    if (!l || !e || visiting.has(id)) return I;
    visiting.add(id);
    const pm = l.parentId && byId.has(l.parentId) ? get(l.parentId) : I;
    const m = mul(pm, fromTRS(e.x, e.y, e.rotation + (off?.get(id) ?? 0), e.scaleX, e.scaleY));
    visiting.delete(id);
    out.set(id, m);
    return m;
  };
  doc.layers.forEach((l) => get(l.id));
  return out;
}

export const mirrorM = (doc: Doc): M => (doc.facing === 'left' ? [-1, 0, 0, 1, 0, 0] : I);

// ---------- Spring (secondary motion) ----------

interface SpringState {
  th: number;
  om: number;
  lx: number;
  ly: number;
  la: number;
  hist: { t: number; v: number }[];
}

export class SpringSim {
  st = new Map<string, SpringState>();
  offsets = new Map<string, number>();
  t = 0;

  reset() {
    this.st.clear();
    this.offsets.clear();
  }

  step(dt: number, doc: Doc, eff: Map<string, Eff>, worlds: Map<string, M>) {
    this.t += dt;
    for (const L of doc.layers) {
      if (!L.spring.enabled) {
        this.st.delete(L.id);
        this.offsets.delete(L.id);
        continue;
      }
      const e = eff.get(L.id)!;
      const pw = (L.parentId && worlds.get(L.parentId)) || I;
      const [px, py] = apply(pw, e.x, e.y);
      const ang = angleOf(pw);
      let s = this.st.get(L.id);
      if (!s) {
        s = { th: 0, om: 0, lx: px, ly: py, la: ang, hist: [] };
        this.st.set(L.id, s);
      }
      if (dt <= 0) continue;
      const vx = (px - s.lx) / dt;
      const vy = (py - s.ly) / dt;
      const va = normDeg(ang - s.la) / dt;
      s.lx = px;
      s.ly = py;
      s.la = ang;
      const drive = vx * 0.06 + vy * 0.01 - va * 0.2;
      s.hist.push({ t: this.t, v: drive });
      const delay = L.spring.delay / 1000;
      while (s.hist.length > 2 && s.hist[1].t <= this.t - delay - 0.05) s.hist.shift();
      let delayed = s.hist[0].v;
      for (const h of s.hist) if (h.t <= this.t - delay) delayed = h.v;
      const max = L.spring.maxRot;
      const target = clamp(delayed, -max, max);
      const n = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const acc = L.spring.stiffness * (target - s.th) - L.spring.damping * s.om;
        s.om += acc * h;
        s.th += s.om * h;
      }
      s.th = clamp(s.th, -max, max);
      this.offsets.set(L.id, s.th);
    }
  }
}

// ---------- Rendering ----------

export function renderRig(
  ctx: CanvasRenderingContext2D,
  base: M,
  doc: Doc,
  eff: Map<string, Eff>,
  worlds: Map<string, M>,
) {
  for (const L of doc.layers) {
    const e = eff.get(L.id);
    if (!e || !e.visible || e.opacity <= 0) continue;
    const src = drawSource(doc, L, e.variant);
    const m = mul(base, worlds.get(L.id) ?? I);
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = e.opacity;
    const img = getImg(src.id);
    if (img) {
      if (src.flip) {
        const cx = img.w / 2 - L.pivotX;
        ctx.translate(2 * cx, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(img.img, -L.pivotX, -L.pivotY);
    } else {
      const ref = doc.images.find((i) => i.id === src.id);
      const w = ref?.w ?? 100, h = ref?.h ?? 100;
      ctx.fillStyle = 'rgba(200,80,80,0.15)';
      ctx.fillRect(-L.pivotX, -L.pivotY, w, h);
      ctx.strokeStyle = '#c55';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1 / Math.max(0.01, Math.hypot(m[0], m[1]));
      ctx.strokeRect(-L.pivotX, -L.pivotY, w, h);
      ctx.setLineDash([]);
    }
  }
  ctx.globalAlpha = 1;
}

/** Corners of a layer image rect in its local frame. */
export function layerCorners(doc: Doc, L: Layer, variant: number): [number, number][] {
  const img = getImg(drawSource(doc, L, variant).id);
  if (img) {
    const b = img.bbox, x0 = b.x - L.pivotX, y0 = b.y - L.pivotY;
    return [[x0, y0], [x0 + b.w, y0], [x0 + b.w, y0 + b.h], [x0, y0 + b.h]];
  }
  const ref = imageRefFor(doc, L, variant);
  const w = ref?.w ?? 100, h = ref?.h ?? 100;
  const x0 = -L.pivotX, y0 = -L.pivotY;
  return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
}

export function bounds(doc: Doc, eff: Map<string, Eff>, worlds: Map<string, M>, pre: M) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const L of doc.layers) {
    const e = eff.get(L.id);
    if (!e || !e.visible || e.opacity <= 0) continue;
    const m = mul(pre, worlds.get(L.id) ?? I);
    let corners = layerCorners(doc, L, e.variant);
    const img = getImg(drawSource(doc, L, e.variant).id);
    if (img) {
      // use opaque bbox for tight bounds
      const b = img.bbox;
      const x0 = b.x - L.pivotX, y0 = b.y - L.pivotY;
      corners = [[x0, y0], [x0 + b.w, y0], [x0 + b.w, y0 + b.h], [x0, y0 + b.h]];
    }
    for (const [x, y] of corners) {
      const [X, Y] = apply(m, x, y);
      minX = Math.min(minX, X); maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Pick topmost layer at a rig-space point (point already un-mirrored). */
export function pick(doc: Doc, eff: Map<string, Eff>, worlds: Map<string, M>, rx: number, ry: number): string | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const L = doc.layers[i];
    const e = eff.get(L.id);
    if (!e || !e.visible || L.locked || e.opacity <= 0.02) continue;
    const [lx, ly] = apply(inv(worlds.get(L.id) ?? I), rx, ry);
    const src = drawSource(doc, L, e.variant);
    const img = getImg(src.id);
    const ref = doc.images.find((r) => r.id === src.id);
    const w = img?.w ?? ref?.w ?? 100, h = img?.h ?? ref?.h ?? 100;
    let ix = lx + L.pivotX;
    const iy = ly + L.pivotY;
    if (src.flip) ix = w - ix;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
    if (!img) return L.id;
    if (img.alpha[(iy | 0) * w + (ix | 0)] > 20) return L.id;
  }
  return null;
}
