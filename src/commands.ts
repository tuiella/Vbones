import { buildPreset, type KeyVals, type PresetKind } from './anim';
import { currentEff } from './actions';
import { applyPose, capturePose, findLayer, reparent, setKey, setPivot } from './edit';
import { autoParent, importFiles } from './importer';
import { uid } from './math';
import { commit, getState, setUI } from './store';
import type { Ease, Role } from './types';

type Params = Record<string, any>;
const roleValues: Role[] = ['none', 'head', 'body', 'arm', 'leg', 'accessory'];
const easeValues: Ease[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'easeOutBack'];

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

function layerSummary(id: string) {
  const { doc } = getState();
  const layer = findLayer(doc, id);
  if (!layer) throw new Error(`Layer not found: ${id}`);
  const imageId = layer.variants[layer.activeVariant]?.imageId ?? null;
  const image = imageId ? doc.images.find((i) => i.id === imageId) : undefined;
  const parent = layer.parentId ? findLayer(doc, layer.parentId) : undefined;
  return {
    id: layer.id,
    name: layer.name,
    role: layer.role,
    parentId: layer.parentId,
    parentName: parent?.name ?? null,
    transform: {
      x: layer.x,
      y: layer.y,
      rotation: layer.rotation,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY,
    },
    pivot: { x: layer.pivotX, y: layer.pivotY },
    image: image ? { id: image.id, fileName: image.fileName, width: image.w, height: image.h } : null,
    variants: layer.variants.map((v, index) => ({
      index,
      name: v.name,
      imageId: v.imageId,
      leftImageId: v.leftImageId,
    })),
    activeVariant: layer.activeVariant,
    visible: layer.visible,
    opacity: layer.opacity,
  };
}

function base64ToFile(dataBase64: string, fileName: string, mimeType: string): File {
  const clean = dataBase64.includes(',') ? dataBase64.slice(dataBase64.indexOf(',') + 1) : dataBase64;
  const raw = atob(clean.replace(/\s/g, ''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType });
}

function imageSizeForLayer(id: string) {
  const { doc } = getState();
  const layer = findLayer(doc, id);
  if (!layer) throw new Error(`Layer not found: ${id}`);
  const imageId = layer.variants[layer.activeVariant]?.imageId;
  const ref = imageId ? doc.images.find((i) => i.id === imageId) : undefined;
  if (!ref) throw new Error(`Layer has no loaded image: ${layer.name}`);
  return { w: ref.w, h: ref.h };
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
        trackCount: Object.keys(c.tracks).length,
      })),
      poses: doc.poses.map((p) => ({ id: p.id, name: p.name })),
      layers: doc.layers.map((l) => layerSummary(l.id)),
    },
    playback: {
      frame: ui.frame,
      playing: ui.playing,
      animate: ui.animate,
      selectedId: ui.selectedId,
    },
  };
}

export async function executeMcpCommand(method: string, p: Params = {}) {
  switch (method) {
    case 'getState':
      return getMcpState();

    case 'getLayers':
      return getState().doc.layers.map((l) => layerSummary(l.id));

    case 'importImage': {
      if (!p.fileName || !p.dataBase64) throw new Error('fileName and dataBase64 are required');
      const before = new Set(getState().doc.layers.map((l) => l.id));
      const file = base64ToFile(String(p.dataBase64), String(p.fileName), String(p.mimeType || 'image/png'));
      await importFiles([file]);
      return getState().doc.layers.filter((l) => !before.has(l.id)).map((l) => layerSummary(l.id));
    }

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
      const { w, h } = imageSizeForLayer(id);
      const x = Math.max(0, Math.min(1, Number(p.x)));
      const y = Math.max(0, Math.min(1, Number(p.y)));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('x and y must be normalized numbers from 0 to 1');
      commit((d) => setPivot(d, id, x * w, y * h));
      return layerSummary(id);
    }

    case 'setTransform': {
      const id = resolveLayerId(String(p.layer));
      const mode = p.mode === 'relative' ? 'relative' : 'absolute';
      commit((d) => {
        const layer = findLayer(d, id);
        if (!layer) return;
        const nums = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const;
        for (const k of nums) {
          if (p[k] == null) continue;
          const v = Number(p[k]);
          if (!Number.isFinite(v)) continue;
          if (mode === 'relative') {
            if (k === 'scaleX' || k === 'scaleY') layer[k] *= v;
            else layer[k] += v;
          } else {
            layer[k] = v;
          }
        }
        if (p.opacity != null) layer.opacity = Math.max(0, Math.min(1, Number(p.opacity)));
        if (p.visible != null) layer.visible = !!p.visible;
      });
      return layerSummary(id);
    }

    case 'createPose': {
      const name = String(p.name || `Pose ${getState().doc.poses.length + 1}`);
      const pose = capturePose(getState().doc, currentEff(), name);
      commit((d) => d.poses.push(pose));
      return { id: pose.id, name: pose.name };
    }

    case 'applyPose': {
      const poseId = resolvePoseId(String(p.pose));
      const pose = getState().doc.poses.find((x) => x.id === poseId)!;
      const ui = getState().ui;
      commit((d) => applyPose(d, ui, pose));
      return { id: pose.id, name: pose.name };
    }

    case 'createBasicAnimation': {
      const preset = p.preset as PresetKind;
      const allowed: PresetKind[] = ['Idle', 'Squash', 'Stretch', 'Attack', 'Hit', 'Bounce'];
      if (!allowed.includes(preset)) throw new Error(`Unsupported preset: ${preset}`);
      if (!getState().doc.layers.length) throw new Error('Import character images first');
      const clip = buildPreset(getState().doc, preset);
      commit((d) => {
        const i = d.clips.findIndex((c) => c.name === preset);
        if (i >= 0) {
          clip.id = d.clips[i].id;
          d.clips[i] = clip;
        } else {
          d.clips.push(clip);
        }
        d.activeClipId = clip.id;
      });
      setUI({ animate: true, frame: 0, playing: !!p.play, selectedKey: null, sq: 0 });
      return { id: clip.id, name: clip.name, length: clip.length, loop: clip.loop };
    }

    case 'addKeyframe': {
      const id = resolveLayerId(String(p.layer));
      const frame = Math.max(0, Math.round(Number(p.frame) || 0));
      const ease = (p.ease ?? 'easeInOut') as Ease;
      if (!easeValues.includes(ease)) throw new Error(`Invalid easing: ${ease}`);
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
        if (p.variant != null) vals.variant = Math.max(0, Math.round(Number(p.variant)));
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
      if (action === 'play') {
        const clip = getState().doc.clips.find((c) => c.id === getState().doc.activeClipId);
        if (!clip) throw new Error('No active animation clip');
        setUI({ playing: true, frame: p.frame != null ? Number(p.frame) : getState().ui.frame });
      } else if (action === 'stop') {
        setUI({ playing: false, frame: p.frame != null ? Number(p.frame) : 0 });
      } else if (action === 'seek') {
        setUI({ playing: false, frame: Math.max(0, Number(p.frame) || 0) });
      } else {
        throw new Error(`Unsupported playback action: ${action}`);
      }
      return { frame: getState().ui.frame, playing: getState().ui.playing };
    }

    default:
      throw new Error(`Unknown MCP command: ${method}`);
  }
}
