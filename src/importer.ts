import type { Doc, Layer, Role } from './types';
import { commit, getState, status } from './store';
import { getImg, loadImage, Loaded } from './images';
import { newLayer, reparent } from './edit';
import { uid } from './math';

const stripExt = (n: string) => n.replace(/\.[^.]+$/, '');

interface Guess {
  role: Role;
  kind: 'head' | 'body' | 'arm' | 'hand' | 'leg' | 'hair' | 'face' | 'weapon' | 'other';
  back: boolean;
}

export function guess(name: string): Guess {
  const n = name.toLowerCase();
  const back = /back|뒤|뒷/.test(n);
  if (/hair|머리카락|앞머리|뒷머리|bang|ponytail|tail/.test(n)) return { role: 'accessory', kind: 'hair', back };
  if (/eye|brow|mouth|nose|cheek|blush|눈|입|코|볼|face_?part/.test(n)) return { role: 'none', kind: 'face', back };
  if (/head|face|머리|얼굴/.test(n)) return { role: 'head', kind: 'head', back };
  if (/body|torso|chest|몸|상체|몸통/.test(n)) return { role: 'body', kind: 'body', back };
  if (/hand|손/.test(n)) return { role: 'arm', kind: 'hand', back };
  if (/arm|팔|shoulder/.test(n)) return { role: 'arm', kind: 'arm', back };
  if (/leg|foot|feet|shin|thigh|다리|발/.test(n)) return { role: 'leg', kind: 'leg', back };
  if (/weapon|sword|staff|wand|gun|bow|shield|무기|검|칼|지팡이|방패/.test(n)) return { role: 'accessory', kind: 'weapon', back };
  return { role: 'none', kind: 'other', back };
}

function zOf(g: Guess): number {
  if (g.kind === 'hair' && g.back) return 0;
  if (g.back) return 1;
  switch (g.kind) {
    case 'leg': return 2;
    case 'body': return 3;
    case 'arm': return 4;
    case 'hand': return 4.5;
    case 'head': return 5;
    case 'face': return 6;
    case 'hair': return 7;
    case 'weapon': return 8;
    default: return 4.8;
  }
}

function pivotFor(g: Guess, L: Loaded): [number, number] {
  const b = L.bbox;
  const cx = Math.round(b.x + b.w / 2);
  switch (g.kind) {
    case 'head': return [cx, Math.round(b.y + b.h * 0.92)];
    case 'body': return [cx, Math.round(b.y + b.h)];
    case 'arm':
    case 'leg':
    case 'hand': return [cx, Math.round(b.y + Math.min(b.w, b.h) * 0.25)];
    case 'hair': return [cx, Math.round(b.y + b.h * 0.15)];
    case 'weapon': return [cx, Math.round(b.y + b.h * 0.85)];
    default: return [cx, Math.round(b.y + b.h / 2)];
  }
}

export const sideTag = (n: string): 'L' | 'R' | null => {
  if (/(^|[_\-\s.])(l|left)($|[_\-\s.])|왼/i.test(n)) return 'L';
  if (/(^|[_\-\s.])(r|right)($|[_\-\s.])|오른/i.test(n)) return 'R';
  return null;
};

/** Parent layers by name: head/arm/leg → body, face parts/hair → head, hand → arm, weapon → hand/arm. */
export function autoParent(d: Doc, ids?: string[]) {
  const layers = d.layers as Layer[];
  const g = new Map(layers.map((l) => [l.id, guess(l.name)] as const));
  const first = (k: Guess['kind'], side?: 'L' | 'R' | null) =>
    layers.find((l) => g.get(l.id)!.kind === k && (!side || sideTag(l.name) === side));
  const body = first('body');
  const head = first('head');
  let n = 0;
  for (const L of [...layers]) {
    if (ids && !ids.includes(L.id)) continue;
    if (L.parentId) continue;
    const k = g.get(L.id)!.kind;
    const side = sideTag(L.name);
    let target: Layer | undefined;
    if (k === 'head' || k === 'arm' || k === 'leg') target = body;
    else if (k === 'face' || k === 'hair') target = head ?? body;
    else if (k === 'hand') target = first('arm', side) ?? body;
    else if (k === 'weapon') target = first('hand', 'R') ?? first('arm', 'R') ?? first('hand') ?? first('arm') ?? body;
    if (target && target.id !== L.id) {
      reparent(d, L.id, target.id);
      n++;
    }
  }
  return n;
}

export async function importFiles(files: File[]) {
  const imgs = files.filter((f) => /\.(png|webp|jpe?g|gif)$/i.test(f.name) || f.type.startsWith('image/'));
  if (!imgs.length) {
    status('PNG/WebP 이미지만 가져올 수 있습니다');
    return;
  }
  const doc = getState().doc;
  // bind to missing image refs (after loading a JSON project)
  const missing = new Map(doc.images.filter((r) => !getImg(r.id)).map((r) => [r.fileName.toLowerCase(), r]));
  let bound = 0;
  const fresh: { file: File; id: string; L: Loaded }[] = [];
  for (const f of imgs) {
    const m = missing.get(f.name.toLowerCase());
    try {
      if (m) {
        await loadImage(m.id, f);
        missing.delete(f.name.toLowerCase());
        bound++;
      } else {
        const id = uid();
        fresh.push({ file: f, id, L: await loadImage(id, f) });
      }
    } catch {
      status(`읽기 실패: ${f.name}`);
    }
  }
  if (!fresh.length) {
    if (bound) {
      commit((d) => { d.fps = d.fps; });
      status(`이미지 ${bound}개를 프로젝트에 연결했습니다`);
    }
    return;
  }
  let created = 0, variants = 0;
  commit((d) => {
    const newIds: string[] = [];
    const items = fresh.map((it) => {
      const base = stripExt(it.file.name);
      const [lname, vname] = base.includes('@') ? base.split('@') : [base, null];
      return { ...it, lname, vname, g: guess(lname) };
    });
    // plain layers first, so @variants can attach to them
    items.sort((a, b) => (a.vname ? 1 : 0) - (b.vname ? 1 : 0) || zOf(a.g) - zOf(b.g));
    for (const it of items) {
      d.images.push({ id: it.id, fileName: it.file.name, w: it.L.w, h: it.L.h });
      const existing = d.layers.find((l) => l.name.toLowerCase() === it.lname.toLowerCase());
      if (it.vname && existing) {
        existing.variants.push({ name: it.vname, imageId: it.id, leftImageId: null });
        variants++;
        continue;
      }
      const [px, py] = pivotFor(it.g, it.L);
      const L = newLayer(it.lname, it.id, px, py, it.L.w, it.L.h);
      if (it.vname) L.variants[0].name = it.vname;
      L.role = it.g.role;
      if (it.g.kind === 'hair') L.spring.enabled = true;
      // insert by guessed z among new layers (stable for existing project)
      d.layers.push(L);
      newIds.push(L.id);
      created++;
    }
    if (newIds.length) autoParent(d, newIds);
  });
  const st = getState();
  if (!st.ui.selectedId && st.doc.layers.length) {
    // nothing
  }
  status(`레이어 ${created}개${variants ? `, 표정/variant ${variants}개` : ''}${bound ? `, 연결 ${bound}개` : ''} 가져옴`);
}

export async function addVariantFiles(layerId: string, files: File[], asLeft?: number) {
  const loaded: { id: string; f: File; L: Loaded }[] = [];
  for (const f of files) {
    const id = uid();
    try {
      loaded.push({ id, f, L: await loadImage(id, f) });
    } catch {
      status(`읽기 실패: ${f.name}`);
    }
  }
  commit((d) => {
    const L = d.layers.find((l) => l.id === layerId);
    if (!L) return;
    for (const it of loaded) {
      d.images.push({ id: it.id, fileName: it.f.name, w: it.L.w, h: it.L.h });
      if (asLeft != null) {
        const v = L.variants[asLeft];
        if (v) v.leftImageId = it.id;
      } else {
        const nm = stripExt(it.f.name);
        L.variants.push({ name: nm.includes('@') ? nm.split('@')[1] : nm, imageId: it.id, leftImageId: null });
      }
    }
  });
}
