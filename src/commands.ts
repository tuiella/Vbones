import { buildPreset, MAX_FRAME, upsertPresetClip, type KeyVals, type PresetKind } from './anim';
import { currentEff } from './actions';
import { applyPose, capturePose, findLayer, isDescendant, reparent, setKey, setPivot } from './edit';
import { autoParent, importFiles } from './importer';
import { getImg } from './images';
import { uid } from './math';
import { commit, getState, setUI } from './store';
import type { Ease, Role } from './types';

type Params = Record<string, any>;
/** Lets a long-running command notice that the MCP side gave up on it (timeout) before it commits. */
export interface CommandCtx {
  cancelled: () => boolean;
}
const noCtx: CommandCtx = { cancelled: () => false };
const roleValues: Role[] = ['none', 'head', 'body', 'arm', 'leg', 'accessory'];
const easeValues: Ease[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function resolveLayerId(ref: string): string {
  const { doc } = getState();
  const direct = doc.layers.find((l) => l.id === ref);
  if (direct) return direct.id;
  const byName = doc.layers.find((l) => l.name.toLowerCase() === ref.toLowerCase());
  if (byName) return byName.id;
  throw new Error(`Layer not found: ${ref}`);
}

function resolvePoseId(ref: string): string {
  const { doc } = getState();
  const direct = doc.poses.find((p) => p.id === ref);
  if (direct) return direct.id;
  const byName = doc.poses.find((p) => p.name.toLowerCase() === ref.toLowerCase());
  if (byName) return byName.id;
  throw new Error(`Pose not found: ${ref}`);
}

/** Throw instead of silently ignoring an invalid parent. */
function assertParent(id: string, parentId: string | null) {
  if (!parentId) return;
  const { doc } = getState();
  if (parentId === id) throw new Error('A layer cannot be its own parent');
  if (isDescendant(doc, parentId, id)) {
    const a = findLayer(doc, id)?.name, b = findLayer(doc, parentId)?.name;
    throw new Error(`Cycle: ${b} is already a descendant of ${a}`);
  }
}

function animating() {
  const { doc, ui } = getState();
  return ui.animate && !!doc.clips.find((c) => c.id === doc.activeClipId);
}

function layerSummary(id: string) {
  const { doc, ui } = getState();
  const layer = findLayer(doc, id);
  if (!layer) throw new Error(`Layer not found: ${id}`);
  const imageId = layer.variants[layer.activeVariant]?.imageId ?? null;
  const image = imageId ? doc.images.find((i) => i.id === imageId) : undefined;
  const loaded = getImg(imageId);
  const parent = layer.parentId ? findLayer(doc, layer.parentId) : undefined;
  const e = currentEff().get(id)!;
  return {
    id: layer.id,
    name: layer.name,
    role: layer.role,
    parentId: layer.parentId,
    parentName: parent?.name ?? null,
    /** setup (base) pose */
    transform: { x: layer.x, y: layer.y, rotation: layer.rotation, scaleX: layer.scaleX, scaleY: layer.scaleY },
    /** what is on screen right now (animation + squash preview applied) */
    displayed: { x: e.x, y: e.y, rotation: e.rotation, scaleX: e.scaleX, scaleY: e.scaleY, opacity: e.opacity, variant: e.variant },
    mode: ui.animate ? 'animate' : 'setup',
    pivot: { x: layer.pivotX, y: layer.pivotY },
    image: image ? { id: image.id, fileName: image.fileName, width: image.w, height: image.h } : null,
    opaqueBounds: loaded ? loaded.bbox : null,
    variants: layer.variants.map((v, index) => ({ index, name: v.name, imageId: v.imageId, leftImageId: v.leftImageId })),
    activeVariant: layer.activeVariant,
    visible: layer.visible,
    opacity: layer.opacity,
  };
}

const MAGIC: [string, (b: Uint8Array) => boolean][] = [
  ['png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['gif', (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  ['webp', (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
];

function base64ToFile(dataBase64: string, fileName: string, mimeType: string): File {
  const clean = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;
  let raw: string;
  try {
    raw = atob(clean.replace(/\s/g, ''));
  } catch {
    throw new Error(`${fileName}: invalid base64 data`);
  }
  if (raw.length > MAX_IMAGE_BYTES) throw new Error(`${fileName}: image larger than 20MB`);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  if (!MAGIC.some(([, ok]) => ok(bytes))) throw new Error(`${fileName}: not a PNG/JPEG/GIF/WebP image`);
  return new File([bytes], fileName, { type: mimeType });
}

export function getMcpState() {
  const { doc, ui } = getState();
  return {
    document: {
      fps: doc.fps,
      facing: doc.facing,
      flipMode: doc.flipMode,
      activeClipId: doc.activeClipId,
      clips: doc.clips.map((c) => ({
        id: c.id,
        name: c.name,
        length: c.length,
        loop: c.loop,
        preset: c.preset ?? null,
        tracks: Object.entries(c.tracks).map(([layerId, keys]) => ({
          layerId,
          layerName: findLayer(doc, layerId)?.name ?? null,
          keys: keys.map((k) => ({
            frame: k.frame, x: k.x, y: k.y, rotation: k.rotation, scaleX: k.scaleX, scaleY: k.scaleY,
            opacity: k.opacity, variant: k.variant, ease: k.ease,
          })),
        })),
      })),
      poses: doc.poses.map((p) => ({ id: p.id, name: p.name })),
      layers: doc.layers.map((l) => layerSummary(l.id)),
    },
    playback: { frame: ui.frame, playing: ui.playing, animate: ui.animate, selectedId: ui.selectedId },
  };
}

async function importBatch(images: Params[], ctx: CommandCtx) {
  if (!images.length) throw new Error('No images given');
  const files: File[] = [];
  const failed: string[] = [];
  for (const im of images) {
    try {
      if (!im?.fileName || !im?.dataBase64) throw new Error('fileName and dataBase64 are required');
      files.push(base64ToFile(String(im.dataBase64), String(im.fileName), String(im.mimeType || 'image/png')));
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  // one batch so draw order, auto-parenting and @variants work like a drag & drop
  const r = files.length ? await importFiles(files, () => !ctx.cancelled()) : { created: [], variants: 0, bound: 0, failed: [] };
  if (r.cancelled) throw new Error(r.cancelled);
  failed.push(...r.failed);
  if (!r.created.length && !r.variants && !r.bound) {
    throw new Error(`Nothing imported. ${failed.join('; ') || 'Unknown error'}`);
  }
  return { layers: r.created.map(layerSummary), variantsAdded: r.variants, boundToExisting: r.bound, failed };
}

export async function executeMcpCommand(method: string, p: Params = {}, ctx: CommandCtx = noCtx) {
  switch (method) {
    case 'getState':
      return getMcpState();

    case 'getLayers':
      return getState().doc.layers.map((l) => layerSummary(l.id));

    case 'importImages':
      return importBatch(Array.isArray(p.images) ? p.images : [], ctx);

    case 'importImage': // legacy single-image form
      return importBatch([p], ctx);

    case 'autoRig': {
      const refs: string[] | undefined = Array.isArray(p.layers) ? p.layers.map(String) : undefined;
      const ids = refs?.map(resolveLayerId);
      let count = 0;
      commit((d) => {
        count = autoParent(d, ids);
      });
      return { parented: count, layers: getState().doc.layers.map((l) => layerSummary(l.id)) };
    }

    case 'rigLayer': {
      const id = resolveLayerId(String(p.layer));
      const parentProvided = Object.prototype.hasOwnProperty.call(p, 'parent');
      const parentId = parentProvided && p.parent != null ? resolveLayerId(String(p.parent)) : null;
      if (p.role != null && !roleValues.includes(p.role as Role)) throw new Error(`Invalid role: ${p.role}`);
      if (parentProvided) assertParent(id, parentId);
      commit((d) => {
        const layer = findLayer(d, id);
        if (!layer) return;
        if (p.role != null) layer.role = p.role as Role;
        if (parentProvided) reparent(d, id, parentId);
      });
      return layerSummary(id);
    }

    case 'setParent': {
      const id = resolveLayerId(String(p.layer));
      const parentId = p.parent == null ? null : resolveLayerId(String(p.parent));
      assertParent(id, parentId);
      commit((d) => reparent(d, id, parentId));
      return layerSummary(id);
    }

    case 'setPivot': {
      const id = resolveLayerId(String(p.layer));
      const x = Number(p.x);
      const y = Number(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('x and y must be finite numbers');
      commit((d) => setPivot(d, id, x, y));
      return layerSummary(id);
    }

    case 'setAnchor': {
      const id = resolveLayerId(String(p.layer));
      const x = Number(p.x), y = Number(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new Error('x and y must be numbers from 0 to 1');
      }
      const { doc } = getState();
      const layer = findLayer(doc, id)!;
      const imageId = layer.variants[layer.activeVariant]?.imageId;
      const ref = imageId ? doc.images.find((i) => i.id === imageId) : undefined;
      if (!ref) throw new Error(`Layer has no image: ${layer.name}`);
      // default: the visible (non-transparent) part, so 0.5,0.9 means "near the bottom of the drawing"
      const space = p.space === 'image' ? 'image' : 'opaque';
      const box = space === 'opaque' ? getImg(imageId)?.bbox ?? { x: 0, y: 0, w: ref.w, h: ref.h } : { x: 0, y: 0, w: ref.w, h: ref.h };
      const px = Math.round((box.x + x * box.w) * 100) / 100;
      const py = Math.round((box.y + y * box.h) * 100) / 100;
      commit((d) => setPivot(d, id, px, py));
      return { ...layerSummary(id), anchorSpace: space };
    }

    case 'setTransform': {
      const id = resolveLayerId(String(p.layer));
      const mode = p.mode === 'relative' ? 'relative' : 'absolute';
      const target: 'setup' | 'key' =
        p.target === 'setup' ? 'setup' : p.target === 'key' ? 'key' : animating() ? 'key' : 'setup';
      const { ui } = getState();
      const shown = currentEff().get(id)!;
      const frame = Math.round(ui.frame);
      commit((d) => {
        const layer = findLayer(d, id);
        if (!layer) return;
        const startVals: KeyVals =
          target === 'key'
            ? { x: shown.x, y: shown.y, rotation: shown.rotation, scaleX: shown.scaleX, scaleY: shown.scaleY, opacity: shown.opacity }
            : { x: layer.x, y: layer.y, rotation: layer.rotation, scaleX: layer.scaleX, scaleY: layer.scaleY, opacity: layer.opacity };
        const vals: Partial<KeyVals> = {};
        for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const) {
          if (p[k] == null) continue;
          const v = Number(p[k]);
          if (!Number.isFinite(v)) continue;
          if (mode === 'relative') vals[k] = k === 'scaleX' || k === 'scaleY' ? startVals[k] * v : startVals[k] + v;
          else vals[k] = v;
        }
        if (p.opacity != null) vals.opacity = Math.max(0, Math.min(1, Number(p.opacity)));
        if (target === 'key') setKey(d, id, frame, vals);
        else Object.assign(layer, vals);
        if (p.visible != null) layer.visible = !!p.visible;
      });
      if (target === 'key') setUI({ animate: true });
      return { ...layerSummary(id), wroteTo: target === 'key' ? `keyframe ${frame}` : 'setup pose' };
    }

    case 'createPose': {
      const name = String(p.name || `Pose ${getState().doc.poses.length + 1}`);
      const pose = capturePose(getState().doc, currentEff(), name);
      commit((d) => {
        d.poses.push(pose);
      });
      return { id: pose.id, name: pose.name };
    }

    case 'applyPose': {
      const poseId = resolvePoseId(String(p.pose));
      const pose = getState().doc.poses.find((x) => x.id === poseId)!;
      const ui = getState().ui;
      commit((d) => applyPose(d, ui, pose));
      return { id: pose.id, name: pose.name, wroteTo: ui.animate ? `keyframe ${Math.round(ui.frame)}` : 'setup pose' };
    }

    case 'createBasicAnimation': {
      const preset = p.preset as PresetKind;
      const allowed: PresetKind[] = ['Idle', 'Squash', 'Stretch', 'Attack', 'Hit', 'Bounce'];
      if (!allowed.includes(preset)) throw new Error(`Unsupported preset: ${preset}`);
      if (!getState().doc.layers.length) throw new Error('Import character images first');
      const clip = buildPreset(getState().doc, preset);
      commit((d) => {
        upsertPresetClip(d, clip); // renames instead of overwriting a user clip called e.g. "Attack"
      });
      setUI({ animate: true, frame: 0, playing: !!p.play, selectedKey: null, sq: 0 });
      return {
        id: clip.id, name: clip.name, length: clip.length, loop: clip.loop,
        note: 'Animate mode is now on: vbones_set_transform writes keyframes at the current frame unless target="setup".',
      };
    }

    case 'addKeyframe': {
      const id = resolveLayerId(String(p.layer));
      const frame = Math.max(0, Math.round(Number(p.frame) || 0));
      if (frame > MAX_FRAME) throw new Error(`frame must be 0..${MAX_FRAME}`);
      const ease = (p.ease ?? 'easeInOut') as Ease;
      if (!easeValues.includes(ease)) throw new Error(`Invalid easing: ${ease}`);
      if (p.variant != null) {
        const n = findLayer(getState().doc, id)!.variants.length;
        const v = Math.round(Number(p.variant));
        if (!(v >= 0 && v < n)) throw new Error(`variant must be 0..${n - 1} for this layer`);
      }
      commit((d) => {
        if (p.clipName) {
          let clip = d.clips.find((c) => c.name === String(p.clipName));
          if (!clip) {
            clip = { id: uid(), name: String(p.clipName), length: Math.max(30, frame), loop: false, tracks: {} };
            d.clips.push(clip);
          }
          d.activeClipId = clip.id;
        }
        const vals: Partial<KeyVals> & { variant?: number | null } = {};
        for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity'] as const) {
          if (p[k] != null) vals[k] = Number(p[k]);
        }
        if (p.variant != null) vals.variant = Math.round(Number(p.variant));
        setKey(d, id, frame, vals);
        const clip = d.clips.find((c) => c.id === d.activeClipId);
        const key = clip?.tracks[id]?.find((k) => k.frame === frame);
        if (key) key.ease = ease;
      });
      setUI({ animate: true, frame, playing: false, selectedId: id });
      return { layer: layerSummary(id), frame, clipId: getState().doc.activeClipId };
    }

    case 'playback': {
      const action = String(p.action);
      const clip = getState().doc.clips.find((c) => c.id === getState().doc.activeClipId);
      const clampF = (f: number) => Math.max(0, Math.min(clip?.length ?? 0, Number.isFinite(f) ? f : 0));
      if (action === 'play') {
        if (!clip) throw new Error('No active animation clip');
        // like togglePlay: a finished (or past-the-end) clip starts over
        const cur = getState().ui.frame;
        const from = p.frame != null ? Number(p.frame) : cur >= clip.length ? 0 : cur;
        setUI({ playing: true, animate: true, frame: clampF(from) });
      } else if (action === 'stop') {
        setUI({ playing: false, frame: clampF(p.frame != null ? Number(p.frame) : 0) });
      } else if (action === 'seek') {
        if (!clip) throw new Error('No active animation clip');
        // the clip is only evaluated in Animate mode, so turn it on or the pose would not change
        setUI({ playing: false, animate: true, frame: clampF(Number(p.frame) || 0) });
      } else {
        throw new Error(`Unsupported playback action: ${action}`);
      }
      return { frame: getState().ui.frame, playing: getState().ui.playing };
    }

    default:
      throw new Error(`Unknown MCP command: ${method}`);
  }
}
