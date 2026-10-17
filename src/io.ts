import JSZip from 'jszip';
import type { Doc, Layer } from './types';
import { emptyDoc, getState, replaceDoc, status } from './store';
import { getImg, loadImage } from './images';
import { bounds, computeWorld, mirrorM, renderRig, resolveEff, SpringSim } from './scene';
import { M, mul } from './math';

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function usedImageIds(doc: Doc) {
  const s = new Set<string>();
  for (const L of doc.layers) for (const v of L.variants) {
    if (v.imageId) s.add(v.imageId);
    if (v.leftImageId) s.add(v.leftImageId);
  }
  return s;
}

function projectJson(doc: Doc, paths: Map<string, string>) {
  const used = usedImageIds(doc);
  return JSON.stringify(
    {
      app: 'vbones',
      version: 1,
      ...doc,
      images: doc.images.filter((r) => used.has(r.id)).map((r) => ({ ...r, file: paths.get(r.id) ?? `images/${r.fileName}` })),
    },
    null,
    2,
  );
}

export async function saveZip() {
  const doc = getState().doc;
  const zip = new JSZip();
  const used = usedImageIds(doc);
  const names = new Set<string>();
  const paths = new Map<string, string>();
  for (const r of doc.images) {
    if (!used.has(r.id)) continue;
    let name = r.fileName.replace(/[\\/:*?"<>|]/g, '_');
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '.png';
    let i = 2;
    while (names.has(name.toLowerCase())) name = `${stem}_${i++}${ext}`;
    names.add(name.toLowerCase());
    paths.set(r.id, `images/${name}`);
    const img = getImg(r.id);
    if (img) zip.file(`images/${name}`, img.blob);
  }
  zip.file('project.json', projectJson(doc, paths));
  const blob = await zip.generateAsync({ type: 'blob' });
  download(blob, 'vbones_project.zip');
  status('ZIP 저장 완료');
}

export function saveJson() {
  const doc = getState().doc;
  download(new Blob([projectJson(doc, new Map())], { type: 'application/json' }), 'project.json');
  status('JSON 저장 완료 (이미지는 포함되지 않음)');
}

function normalize(j: any): Doc {
  const base = emptyDoc();
  const doc: Doc = {
    ...base,
    ...j,
    images: (j.images ?? []).map((r: any) => ({ id: r.id, fileName: r.fileName, w: r.w, h: r.h })),
    layers: (j.layers ?? []).map((l: any): Layer => ({
      parentId: null, rotation: 0, scaleX: 1, scaleY: 1, visible: true, opacity: 1, locked: false, role: 'none', activeVariant: 0,
      ...l,
      variants: (l.variants ?? []).map((v: any) => ({ name: v.name ?? 'Default', imageId: v.imageId ?? null, leftImageId: v.leftImageId ?? null })),
      spring: { enabled: false, stiffness: 120, damping: 7, delay: 60, maxRot: 30, ...(l.spring ?? {}) },
    })),
    poses: j.poses ?? [],
    clips: j.clips ?? [],
  };
  delete (doc as any).app;
  delete (doc as any).version;
  return doc;
}

export async function loadProject(file: File) {
  try {
    let json: any;
    let missing = 0;
    if (/\.zip$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(file);
      const pj = zip.file('project.json');
      if (!pj) throw new Error('project.json이 없습니다');
      json = JSON.parse(await pj.async('string'));
      for (const r of json.images ?? []) {
        const f = zip.file(r.file ?? `images/${r.fileName}`);
        if (f) await loadImage(r.id, await f.async('blob'));
        else missing++;
      }
    } else {
      json = JSON.parse(await file.text());
      missing = (json.images ?? []).filter((r: any) => !getImg(r.id)).length;
    }
    replaceDoc(normalize(json));
    status(missing ? `불러옴. 이미지 ${missing}개 없음 → 같은 파일 이름의 이미지를 드롭하면 연결됩니다` : '프로젝트 불러옴');
  } catch (e: any) {
    status('불러오기 실패: ' + (e?.message ?? e));
  }
}

function bgFill(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const bg = getState().ui.bg;
  if (bg === 'checker') return;
  ctx.fillStyle = bg === 'white' ? '#ffffff' : bg === 'gray' ? '#808080' : '#000000';
  ctx.fillRect(0, 0, w, h);
}

export async function exportPNG() {
  const { doc, ui } = getState();
  const clip = doc.clips.find((c) => c.id === doc.activeClipId);
  const eff = resolveEff(doc, { animated: !!clip && (ui.animate || ui.playing), frame: ui.frame, sq: ui.sq });
  const worlds = computeWorld(doc, eff);
  const mir = mirrorM(doc);
  const b = bounds(doc, eff, worlds, mir);
  if (!b) return status('내보낼 레이어가 없습니다');
  const pad = 16;
  const c = document.createElement('canvas');
  c.width = Math.ceil(b.maxX - b.minX + pad * 2);
  c.height = Math.ceil(b.maxY - b.minY + pad * 2);
  const ctx = c.getContext('2d')!;
  bgFill(ctx, c.width, c.height);
  renderRig(ctx, mul([1, 0, 0, 1, pad - b.minX, pad - b.minY], mir), doc, eff, worlds);
  c.toBlob((blob) => blob && download(blob, 'vbones_frame.png'), 'image/png');
  status('PNG 내보내기 완료');
}

export async function exportWebM() {
  const { doc } = getState();
  const clip = doc.clips.find((c) => c.id === doc.activeClipId);
  if (!clip) return status('먼저 애니메이션 클립을 만들어 주세요');
  if (typeof MediaRecorder === 'undefined') return status('이 브라우저는 WebM 녹화를 지원하지 않습니다');
  const mir = mirrorM(doc);
  let B: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (let f = 0; f <= clip.length; f++) {
    const eff = resolveEff(doc, { animated: true, frame: f, sq: 0 });
    const b = bounds(doc, eff, computeWorld(doc, eff), mir);
    if (!b) continue;
    B = B ? { minX: Math.min(B.minX, b.minX), minY: Math.min(B.minY, b.minY), maxX: Math.max(B.maxX, b.maxX), maxY: Math.max(B.maxY, b.maxY) } : b;
  }
  if (!B) return status('내보낼 레이어가 없습니다');
  const pad = 40;
  const c = document.createElement('canvas');
  c.width = Math.ceil((B.maxX - B.minX + pad * 2) / 2) * 2;
  c.height = Math.ceil((B.maxY - B.minY + pad * 2) / 2) * 2;
  const ctx = c.getContext('2d')!;
  const base: M = mul([1, 0, 0, 1, pad - B.minX, pad - B.minY], mir);
  const stream = c.captureStream(doc.fps);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  const spring = new SpringSim();
  const dt = 1 / doc.fps;
  const loops = clip.loop ? 2 : 1;
  const total = clip.length * loops + (clip.loop ? 0 : Math.round(doc.fps * 0.3));
  status('WebM 녹화 중…');
  const draw = (f: number) => {
    const frame = clip.loop ? f % Math.max(1, clip.length) : Math.min(f, clip.length);
    const eff = resolveEff(doc, { animated: true, frame, sq: 0 });
    const worlds = computeWorld(doc, eff, spring.offsets);
    spring.step(dt, doc, eff, worlds);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    bgFill(ctx, c.width, c.height);
    renderRig(ctx, base, doc, eff, worlds);
  };
  draw(0);
  rec.start();
  await new Promise<void>((resolve) => {
    let f = 0;
    const t0 = performance.now();
    const tick = () => {
      f++;
      if (f > total) return resolve();
      draw(f);
      setTimeout(tick, Math.max(0, t0 + (f + 1) * dt * 1000 - performance.now()));
    };
    setTimeout(tick, dt * 1000);
  });
  rec.stop();
  await done;
  download(new Blob(chunks, { type: 'video/webm' }), `vbones_${clip.name}.webm`);
  status('WebM 내보내기 완료');
}
