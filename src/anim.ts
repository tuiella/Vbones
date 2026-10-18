import type { Clip, Doc, Ease, Keyframe, Layer, Role, Transform } from './types';
import { lerp, uid } from './math';

/** Upper bound for keyframe/clip frames accepted from MCP (2 minutes at 30fps); the timeline draws a tick per frame. */
export const MAX_FRAME = 3600;

export const EASES: Ease[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack'];
export const EASE_LABEL: Record<Ease, string> = {
  linear: 'Linear',
  easeIn: 'Ease In',
  easeOut: 'Ease Out',
  easeInOut: 'Ease In Out',
  easeOutBack: 'Ease Out Back',
};

export function easeFn(e: Ease, t: number) {
  switch (e) {
    case 'linear':
      return t;
    case 'easeIn':
      return t * t * t;
    case 'easeOut':
      return 1 - Math.pow(1 - t, 3);
    case 'easeInOut':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'easeOutBack': {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
  }
}

export interface KeyVals extends Transform {
  opacity: number;
}

const pickVals = (k: Keyframe): KeyVals => ({
  x: k.x, y: k.y, rotation: k.rotation, scaleX: k.scaleX, scaleY: k.scaleY, opacity: k.opacity,
});

/** Evaluate a sorted key list. Returns null when there are no keys. */
export function evalKeys(keys: Keyframe[] | undefined, f: number): { v: KeyVals; variant: number | null } | null {
  if (!keys || !keys.length) return null;
  let variant: number | null = null;
  for (const k of keys) {
    if (k.frame <= f + 1e-6 && k.variant != null) variant = k.variant;
  }
  if (f <= keys[0].frame) return { v: pickVals(keys[0]), variant: variant ?? keys[0].variant };
  const last = keys[keys.length - 1];
  if (f >= last.frame) return { v: pickVals(last), variant };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (f >= a.frame && f < b.frame) {
      const t = easeFn(a.ease, (f - a.frame) / Math.max(1e-6, b.frame - a.frame));
      return {
        v: {
          x: lerp(a.x, b.x, t),
          y: lerp(a.y, b.y, t),
          rotation: lerp(a.rotation, b.rotation, t),
          scaleX: lerp(a.scaleX, b.scaleX, t),
          scaleY: lerp(a.scaleY, b.scaleY, t),
          opacity: Math.max(0, Math.min(1, lerp(a.opacity, b.opacity, t))),
        },
        variant,
      };
    }
  }
  return { v: pickVals(last), variant };
}

export function layerVals(L: Layer): KeyVals {
  return { x: L.x, y: L.y, rotation: L.rotation, scaleX: L.scaleX, scaleY: L.scaleY, opacity: L.opacity };
}

// ---------- Squash & Stretch ----------

/** s > 0 squash, s < 0 stretch. side: -1 left, +1 right. h: image height reference */
export function applySquash<T extends Transform>(t: T, role: Role, s: number, side: number, h: number): T {
  if (!s || role === 'none') return t;
  let dx = 0, dy = 0, dsx = 0, dsy = 0;
  switch (role) {
    case 'head':
      dsx = 0.14 * s; dsy = -0.14 * s; dy = 0.05 * h * s;
      break;
    case 'body':
      dsx = 0.2 * s; dsy = -0.2 * s;
      break;
    case 'leg':
      dsx = 0.05 * s; dsy = -0.18 * s; dx = side * 0.05 * h * s;
      break;
    case 'arm':
      dsx = 0.06 * s; dsy = -0.08 * s;
      break;
    case 'accessory':
      dsx = 0.08 * s; dsy = -0.08 * s;
      break;
  }
  return { ...t, x: t.x + dx, y: t.y + dy, scaleX: t.scaleX * (1 + dsx), scaleY: t.scaleY * (1 + dsy) };
}

export function sideOf(L: Layer): number {
  if (/(^|[_\-\s.])(l|left)$|_l_|왼/i.test(L.name)) return -1;
  if (/(^|[_\-\s.])(r|right)$|_r_|오른/i.test(L.name)) return 1;
  return Math.sign(L.x) || 1;
}

// ---------- Presets ----------

export type PresetKind = 'Idle' | 'Squash' | 'Stretch' | 'Attack' | 'Hit' | 'Bounce';
export const PRESETS: PresetKind[] = ['Idle', 'Squash', 'Stretch', 'Attack', 'Hit', 'Bounce'];

interface PK {
  t: number; // ms
  ease: Ease;
  dx?: number; // fraction of character height
  dy?: number;
  sq?: number;
  lean?: number; // deg, + = lean forward
  arm?: number; // deg, + = weapon swings forward
  head?: number;
}

// Hold → Burst → Overshoot → Settle
const DEFS: Record<PresetKind, { loop: boolean; keys: PK[] }> = {
  Idle: {
    loop: true,
    keys: [
      { t: 0, ease: 'easeInOut' },
      { t: 600, ease: 'easeInOut', sq: 0.12, dy: 0.01, arm: 4, head: -2 },
      { t: 1200, ease: 'linear' },
    ],
  },
  Squash: {
    loop: false,
    keys: [
      { t: 0, ease: 'easeOut' },
      { t: 120, ease: 'easeOut', sq: 0.6 },
      { t: 260, ease: 'easeOut', sq: -0.18 },
      { t: 400, ease: 'easeInOut', sq: 0.06 },
      { t: 520, ease: 'linear' },
    ],
  },
  Stretch: {
    loop: false,
    keys: [
      { t: 0, ease: 'easeOut' },
      { t: 120, ease: 'easeOut', sq: -0.6, dy: -0.05 },
      { t: 260, ease: 'easeOut', sq: 0.18 },
      { t: 400, ease: 'easeInOut', sq: -0.05 },
      { t: 520, ease: 'linear' },
    ],
  },
  Attack: {
    loop: false,
    keys: [
      { t: 0, ease: 'easeOut' },
      { t: 150, ease: 'easeIn', dx: -0.06, dy: 0.01, sq: 0.35, lean: -8, arm: -45, head: -4 },
      { t: 220, ease: 'linear', dx: 0.18, sq: -0.45, lean: 12, arm: 95, head: 4 },
      { t: 250, ease: 'easeOut', dx: 0.2, sq: 0.2, lean: 10, arm: 105, head: 6 },
      { t: 300, ease: 'easeInOut', dx: 0.14, sq: -0.08, lean: 4, arm: 85, head: 2 },
      { t: 450, ease: 'linear' },
    ],
  },
  Hit: {
    loop: false,
    keys: [
      { t: 0, ease: 'easeOut' },
      { t: 60, ease: 'easeOut', dx: -0.1, sq: -0.2, lean: -14, arm: 25, head: -14 },
      { t: 140, ease: 'easeOut', dx: -0.12, sq: 0.3, lean: -6, arm: 15, head: -6 },
      { t: 260, ease: 'easeInOut', dx: -0.03, sq: -0.05, lean: 3, head: 3 },
      { t: 400, ease: 'linear' },
    ],
  },
  Bounce: {
    loop: true,
    keys: [
      { t: 0, ease: 'easeOut', sq: 0.4 },
      { t: 100, ease: 'easeOut', sq: -0.35, dy: -0.06, arm: 5 },
      { t: 300, ease: 'easeIn', sq: -0.08, dy: -0.32, arm: 8 },
      { t: 500, ease: 'easeIn', sq: -0.35, dy: -0.06, arm: 5 },
      { t: 600, ease: 'linear', sq: 0.4 },
    ],
  },
};

function hasAccessoryChild(doc: Doc, id: string): boolean {
  return doc.layers.some((c) => c.parentId === id && (c.role === 'accessory' || hasAccessoryChild(doc, c.id)));
}

export function buildPreset(doc: Doc, kind: PresetKind): Clip {
  const def = DEFS[kind];
  const fps = doc.fps;
  let H = 100;
  for (const L of doc.layers) {
    const ref = doc.images.find((i) => i.id === L.variants[L.activeVariant]?.imageId);
    if (ref) H = Math.max(H, ref.h * Math.abs(L.scaleY));
  }
  H *= 0.7;
  const body = doc.layers.find((l) => l.role === 'body');
  const tracks: Record<string, Keyframe[]> = {};
  const used = new Set<number>();
  const frames = def.keys.map((k) => {
    let f = Math.round((k.t / 1000) * fps);
    while (used.has(f)) f++;
    used.add(f);
    return f;
  });
  for (const L of doc.layers) {
    const isRoot = !L.parentId;
    if (!isRoot && L.role === 'none') continue;
    const side = sideOf(L);
    const ref = doc.images.find((i) => i.id === L.variants[L.activeVariant]?.imageId);
    const h = ref?.h ?? 100;
    const armW = L.role === 'arm' ? (hasAccessoryChild(doc, L.id) || (side > 0 && !doc.layers.some((o) => o.role === 'arm' && o !== L && hasAccessoryChild(doc, o.id))) ? 1 : 0.4) : 0;
    tracks[L.id] = def.keys.map((k, i) => {
      let t: Transform = { x: L.x, y: L.y, rotation: L.rotation, scaleX: L.scaleX, scaleY: L.scaleY };
      if (isRoot) {
        t.x += (k.dx ?? 0) * H;
        t.y += (k.dy ?? 0) * H;
        if (!body || body.id === L.id) t.rotation += k.lean ?? 0;
      } else if (L.role === 'body') t.rotation += k.lean ?? 0;
      if (L.role === 'arm') t.rotation += (k.arm ?? 0) * armW;
      if (L.role === 'head') t.rotation += k.head ?? 0;
      t = applySquash(t, L.role, k.sq ?? 0, side, h);
      return { ...t, frame: frames[i], opacity: L.opacity, variant: null, ease: k.ease };
    });
  }
  return { id: uid(), name: kind, length: frames[frames.length - 1], loop: def.loop, tracks, preset: kind };
}

/**
 * Put a freshly built preset clip into the doc and make it active. Regenerates an earlier clip of the
 * same preset in place, but never overwrites a user clip that merely has the same name.
 */
export function upsertPresetClip(d: Doc, clip: Clip): Clip {
  const i = d.clips.findIndex((c) => c.name === clip.name && c.preset === clip.preset);
  if (i >= 0) {
    clip.id = d.clips[i].id;
    d.clips[i] = clip;
  } else {
    const taken = new Set(d.clips.map((c) => c.name));
    let name = clip.name;
    for (let n = 2; taken.has(name); n++) name = `${clip.name} ${n}`;
    clip.name = name;
    d.clips.push(clip);
  }
  d.activeClipId = clip.id;
  return clip;
}
