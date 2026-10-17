import type { Doc, Eff, Keyframe, Layer, Pose, Transform, UI } from './types';
import { evalKeys, layerVals, KeyVals } from './anim';
import { baseEff, computeWorld } from './scene';
import { I, applyVec, decompose, fromTRS, inv, mul, r4, uid } from './math';

type D = Doc;

export const findLayer = (d: Doc | D, id: string | null | undefined) =>
  id ? (d.layers as Layer[]).find((l) => l.id === id) : undefined;

export function activeClip(d: D) {
  return d.clips.find((c) => c.id === d.activeClipId);
}

export function ensureClip(d: D) {
  let c = activeClip(d);
  if (!c) {
    c = { id: uid(), name: `Clip ${d.clips.length + 1}`, length: 30, loop: true, tracks: {} };
    d.clips.push(c);
    d.activeClipId = c.id;
    c = activeClip(d)!;
  }
  return c;
}

/** Upsert a key at frame f. Missing values are taken from the current evaluated pose. */
export function setKey(d: D, layerId: string, f: number, p: Partial<KeyVals> & { variant?: number | null }) {
  const L = findLayer(d, layerId);
  if (!L) return;
  const clip = ensureClip(d);
  const keys = (clip.tracks[layerId] ??= []);
  let k = keys.find((k) => k.frame === f);
  if (!k) {
    const ev = evalKeys(keys as Keyframe[], f);
    const vals = ev ? ev.v : layerVals(L as Layer);
    const prev = [...keys].reverse().find((k) => k.frame < f);
    keys.push({ ...vals, frame: f, variant: null, ease: prev?.ease ?? 'easeInOut' });
    keys.sort((a, b) => a.frame - b.frame);
    k = keys.find((k) => k.frame === f)!;
  }
  Object.assign(k, p);
  if (f > clip.length) clip.length = f;
}

/** Write transform either to base (setup) or as a key (animate mode). */
export function setTransform(d: D, ui: UI, id: string, p: Partial<KeyVals>) {
  const L = findLayer(d, id);
  if (!L) return;
  if (ui.animate) setKey(d, id, Math.round(ui.frame), p);
  else Object.assign(L, p);
}

export function isDescendant(d: Doc | D, a: string, b: string): boolean {
  let cur = findLayer(d, a);
  const seen = new Set<string>();
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parentId === b) return true;
    cur = findLayer(d, cur.parentId);
  }
  return false;
}

/** Re-parent keeping the current world placement (setup pose). */
export function reparent(d: D, id: string, pid: string | null) {
  const L = findLayer(d, id);
  if (!L || pid === id || L.parentId === pid) return;
  if (pid && isDescendant(d, pid, id)) return;
  const doc = d as unknown as Doc;
  const w = computeWorld(doc, baseEff(doc));
  const Pw = pid ? w.get(pid) ?? I : I;
  const t = decompose(mul(inv(Pw), w.get(id) ?? I));
  if (L.scaleY < 0 && t.scaleY > 0) {
    // keep flips on the same axis
  }
  L.x = r4(t.x);
  L.y = r4(t.y);
  L.rotation = r4(t.rotation);
  L.scaleX = r4(t.scaleX);
  L.scaleY = r4(t.scaleY);
  L.parentId = pid;
}

/** Move the pivot without moving the image or its children. */
export function setPivot(d: D, id: string, npx: number, npy: number) {
  const L = findLayer(d, id);
  if (!L) return;
  const dx = npx - L.pivotX, dy = npy - L.pivotY;
  if (!dx && !dy) return;
  const adj = (t: Transform) => {
    const [vx, vy] = applyVec(fromTRS(0, 0, t.rotation, t.scaleX, t.scaleY), dx, dy);
    t.x = r4(t.x + vx);
    t.y = r4(t.y + vy);
  };
  adj(L);
  for (const c of d.clips) for (const k of c.tracks[id] ?? []) adj(k);
  for (const C of d.layers) {
    if (C.parentId !== id) continue;
    C.x = r4(C.x - dx);
    C.y = r4(C.y - dy);
    for (const c of d.clips) for (const k of c.tracks[C.id] ?? []) { k.x -= dx; k.y -= dy; }
  }
  L.pivotX = npx;
  L.pivotY = npy;
}

export function deleteLayer(d: D, id: string) {
  const L = findLayer(d, id);
  if (!L) return;
  for (const C of d.layers.filter((c) => c.parentId === id)) reparent(d, C.id, L.parentId);
  d.layers = d.layers.filter((l) => l.id !== id);
  for (const c of d.clips) delete c.tracks[id];
  for (const p of d.poses) delete p.data[id];
}

export function duplicateLayer(d: D, id: string): string | null {
  const i = d.layers.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const src = JSON.parse(JSON.stringify(d.layers[i])) as Layer;
  const nid = uid();
  d.layers.splice(i + 1, 0, { ...src, id: nid, name: src.name + '_copy', locked: false });
  return nid;
}

/** Place `id` directly above `targetId` in draw order. */
export function moveAbove(d: D, id: string, targetId: string) {
  if (id === targetId) return;
  const from = d.layers.findIndex((l) => l.id === id);
  if (from < 0) return;
  const [L] = d.layers.splice(from, 1);
  const to = d.layers.findIndex((l) => l.id === targetId);
  d.layers.splice(to + 1, 0, L);
}

export function shiftLayer(d: D, id: string, dir: 1 | -1) {
  const i = d.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= d.layers.length) return;
  const t = d.layers[i];
  d.layers[i] = d.layers[j];
  d.layers[j] = t;
}

export function capturePose(doc: Doc, eff: Map<string, Eff>, name: string): Pose {
  const data: Pose['data'] = {};
  for (const L of doc.layers) {
    const e = eff.get(L.id)!;
    data[L.id] = { x: e.x, y: e.y, rotation: e.rotation, scaleX: e.scaleX, scaleY: e.scaleY, visible: e.visible, opacity: e.opacity };
  }
  return { id: uid(), name, data };
}

export function applyPose(d: D, ui: UI, pose: Pose) {
  for (const L of d.layers) {
    const p = pose.data[L.id];
    if (!p) continue;
    const { visible, ...vals } = p;
    if (ui.animate) setKey(d, L.id, Math.round(ui.frame), vals);
    else Object.assign(L, vals, { visible });
  }
}

export function newLayer(name: string, imageId: string, px: number, py: number, w: number, h: number): Layer {
  return {
    id: uid(),
    name,
    parentId: null,
    x: px - w / 2,
    y: py - h / 2,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    pivotX: px,
    pivotY: py,
    visible: true,
    opacity: 1,
    locked: false,
    role: 'none',
    variants: [{ name: 'Default', imageId, leftImageId: null }],
    activeVariant: 0,
    spring: { enabled: false, stiffness: 120, damping: 7, delay: 60, maxRot: 30 },
  };
}
