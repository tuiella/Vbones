import { useEffect, useRef } from 'react';
import { beginGesture, commit, endGesture, getState, setUI, useDoc, useUI } from '../store';
import { computeWorld, layerCorners, mirrorM, pick, renderRig, resolveEff, SpringSim } from '../scene';
import { M, I, apply, inv, mul, clamp, normDeg, r4 } from '../math';
import { findLayer, setPivot, setTransform } from '../edit';
import { importFiles } from '../importer';
import { loadDemo } from '../demo';
import type { Eff } from '../types';
import { keys } from '../keys';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number }
  | { kind: 'move' | 'rotate' | 'scale'; id: string; start: Eff; startRig: [number, number]; startScreen: [number, number]; parentW: M; acc: number; lastA: number }
  | { kind: 'pivot'; id: string; Wstart: M; pivot0: [number, number] };

let checker: CanvasPattern | null = null;
function checkerPattern(ctx: CanvasRenderingContext2D) {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const x = c.getContext('2d')!;
  x.fillStyle = '#3a3a3e'; x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#2e2e32'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  checker = ctx.createPattern(c, 'repeat');
  return checker;
}

export function CanvasView() {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const spring = useRef(new SpringSim());
  const drag = useRef<Drag | null>(null);
  const size = useRef({ w: 1, h: 1, dpr: 1 });
  const doc = useDoc();
  const ui = useUI();

  // view matrix in css px (rig → screen)
  const viewM = (): M => {
    const { ui, doc } = getState();
    const { w, h } = size.current;
    return mul([ui.zoom, 0, 0, ui.zoom, w / 2 + ui.panX, h / 2 + ui.panY], mirrorM(doc));
  };
  const frameState = () => {
    const { doc, ui } = getState();
    const clip = doc.clips.find((c) => c.id === doc.activeClipId);
    const eff = resolveEff(doc, { animated: !!clip && (ui.animate || ui.playing), frame: ui.frame, sq: ui.sq });
    const worlds = computeWorld(doc, eff, spring.current.offsets);
    return { doc, ui, eff, worlds };
  };

  useEffect(() => {
    const el = wrap.current!, c = cv.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: r.width, h: r.height, dpr };
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(r.height * dpr));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // render loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let s = getState();
      if (s.ui.playing) {
        const clip = s.doc.clips.find((c) => c.id === s.doc.activeClipId);
        if (!clip) setUI({ playing: false });
        else {
          let f = s.ui.frame + dt * s.doc.fps;
          if (f > clip.length) {
            if (clip.loop && clip.length > 0) f = f % clip.length;
            else {
              setUI({ playing: false, frame: clip.length });
              f = -1;
            }
          }
          if (f >= 0) setUI({ frame: f });
        }
      }
      draw(dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const draw = (dt: number) => {
    const c = cv.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const { w, h, dpr } = size.current;
    const { doc, ui, eff, worlds } = frameState();
    spring.current.step(dt, doc, eff, worlds);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (ui.bg === 'checker') {
      ctx.fillStyle = checkerPattern(ctx)!;
    } else ctx.fillStyle = ui.bg === 'white' ? '#fff' : ui.bg === 'gray' ? '#808080' : '#000';
    ctx.fillRect(0, 0, c.width, c.height);

    const V = viewM();
    // origin axes
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [ox, oy] = apply(V, 0, 0);
    ctx.strokeStyle = 'rgba(120,160,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke();

    const base = mul([dpr, 0, 0, dpr, 0, 0], V);
    renderRig(ctx, base, doc, eff, worlds);

    // gizmos (css px)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ui.tool === 'pivot') {
      for (const L of doc.layers) {
        if (!eff.get(L.id)?.visible || L.id === ui.selectedId) continue;
        const [x, y] = apply(mul(V, worlds.get(L.id) ?? I), 0, 0);
        ctx.fillStyle = 'rgba(255,170,60,0.6)';
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    const sel = findLayer(doc, ui.selectedId);
    if (sel && !ui.playing) {
      const e = eff.get(sel.id)!;
      const S = mul(V, worlds.get(sel.id) ?? I);
      const pts = layerCorners(doc, sel, e.variant).map(([x, y]) => apply(S, x, y));
      ctx.strokeStyle = sel.locked ? '#888' : '#4a9eff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      const [px, py] = apply(S, 0, 0);
      const ang = Math.atan2(S[1], S[0]);
      if (ui.tool === 'rotate') {
        ctx.strokeStyle = '#ffcc33';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 46, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * 46, py + Math.sin(ang) * 46); ctx.stroke();
      } else if (ui.tool === 'scale') {
        ctx.fillStyle = '#ffcc33';
        for (const [x, y] of pts) ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
        ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ang) * 36, py + Math.sin(ang) * 36); ctx.stroke();
        ctx.strokeStyle = '#5ad05a';
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - Math.sin(ang) * 36, py + Math.cos(ang) * 36); ctx.stroke();
      } else if (ui.tool === 'move') {
        ctx.strokeStyle = '#4a9eff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py); ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10); ctx.stroke();
      }
      const big = ui.tool === 'pivot';
      ctx.fillStyle = big ? '#ff9b2f' : '#fff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, big ? 6 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (big) {
        ctx.strokeStyle = '#ff9b2f';
        ctx.beginPath(); ctx.moveTo(px - 14, py); ctx.lineTo(px + 14, py); ctx.moveTo(px, py - 14); ctx.lineTo(px, py + 14); ctx.stroke();
      }
    }
  };

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = cv.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toRig = (p: [number, number]) => apply(inv(viewM()), p[0], p[1]);

  const onDown = (e: React.PointerEvent) => {
    const p = local(e);
    cv.current!.setPointerCapture(e.pointerId);
    const { ui } = getState();
    if (e.button === 1 || (e.button === 0 && keys.space)) {
      e.preventDefault();
      drag.current = { kind: 'pan', sx: p[0], sy: p[1], px: ui.panX, py: ui.panY };
      return;
    }
    if (e.button !== 0) return;
    if (ui.playing) setUI({ playing: false });
    const { doc, eff, worlds } = frameState();
    const rig = toRig(p);
    const V = viewM();
    const sel = findLayer(doc, ui.selectedId);

    if (ui.tool === 'pivot') {
      if (sel && !sel.locked) {
        const W = worlds.get(sel.id) ?? I;
        const [sx, sy] = apply(mul(V, W), 0, 0);
        if (Math.hypot(sx - p[0], sy - p[1]) < 12) {
          if (ui.animate) {
            setUI({ status: 'Pivot은 Setup 모드에서만 편집할 수 있습니다 (Animate 해제)' });
            return;
          }
          beginGesture();
          drag.current = { kind: 'pivot', id: sel.id, Wstart: W, pivot0: [sel.pivotX, sel.pivotY] };
          return;
        }
      }
      setUI({ selectedId: pick(doc, eff, worlds, rig[0], rig[1]) });
      return;
    }

    const hit = pick(doc, eff, worlds, rig[0], rig[1]);
    let target: string | null;
    if (ui.tool === 'move') {
      setUI({ selectedId: hit });
      target = hit;
    } else {
      if (hit && hit !== ui.selectedId) setUI({ selectedId: hit });
      target = hit ?? ui.selectedId;
    }
    const L = findLayer(doc, target);
    if (!L || L.locked) return;
    const pw = (L.parentId && worlds.get(L.parentId)) || I;
    const start = { ...eff.get(L.id)! };
    const [ppx, ppy] = apply(pw, start.x, start.y);
    beginGesture();
    drag.current = {
      kind: ui.tool as 'move' | 'rotate' | 'scale',
      id: L.id,
      start,
      startRig: rig,
      startScreen: p,
      parentW: pw,
      acc: 0,
      lastA: Math.atan2(rig[1] - ppy, rig[0] - ppx),
    };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = local(e);
    if (d.kind === 'pan') {
      setUI({ panX: d.px + p[0] - d.sx, panY: d.py + p[1] - d.sy });
      return;
    }
    const rig = toRig(p);
    const ui = getState().ui;
    if (d.kind === 'pivot') {
      const [lx, ly] = apply(inv(d.Wstart), rig[0], rig[1]);
      let nx = d.pivot0[0] + lx, ny = d.pivot0[1] + ly;
      nx = Math.round(nx); ny = Math.round(ny);
      commit((dr) => setPivot(dr, d.id, nx, ny));
      return;
    }
    const s = d.start;
    if (d.kind === 'move') {
      const fine = e.shiftKey ? 0.25 : 1;
      const dx = (rig[0] - d.startRig[0]) * fine, dy = (rig[1] - d.startRig[1]) * fine;
      const pi = inv(d.parentW);
      const lx = pi[0] * dx + pi[2] * dy, ly = pi[1] * dx + pi[3] * dy;
      commit((dr) => setTransform(dr, ui, d.id, { x: r4(s.x + lx), y: r4(s.y + ly) }));
    } else if (d.kind === 'rotate') {
      const [ppx, ppy] = apply(d.parentW, s.x, s.y);
      const a = Math.atan2(rig[1] - ppy, rig[0] - ppx);
      d.acc += normDeg(((a - d.lastA) * 180) / Math.PI);
      d.lastA = a;
      const det = d.parentW[0] * d.parentW[3] - d.parentW[1] * d.parentW[2];
      let r = s.rotation + (det < 0 ? -d.acc : d.acc);
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      commit((dr) => setTransform(dr, ui, d.id, { rotation: r4(r) }));
    } else if (d.kind === 'scale') {
      const dxs = (p[0] - d.startScreen[0]) / 100;
      const dys = -(p[1] - d.startScreen[1]) / 100;
      let sx = s.scaleX * Math.max(0.02, 1 + dxs);
      let sy = s.scaleY * Math.max(0.02, 1 + dys);
      if (e.shiftKey) {
        const k = Math.max(0.02, 1 + (Math.abs(dxs) > Math.abs(dys) ? dxs : dys));
        sx = s.scaleX * k;
        sy = s.scaleY * k;
      }
      commit((dr) => setTransform(dr, ui, d.id, { scaleX: r4(sx), scaleY: r4(sy) }));
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind !== 'pan') endGesture();
  };

  useEffect(() => {
    const c = cv.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { ui } = getState();
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const nz = clamp(ui.zoom * Math.exp(-e.deltaY * 0.0015), 0.1, 12);
      const cx = size.current.w / 2, cy = size.current.h / 2;
      const rx = (px - cx - ui.panX) / ui.zoom, ry = (py - cy - ui.panY) / ui.zoom;
      setUI({ zoom: nz, panX: px - cx - rx * nz, panY: py - cy - ry * nz });
    };
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  }, []);

  const cursor = ui.tool === 'move' ? 'default' : ui.tool === 'rotate' ? 'alias' : ui.tool === 'scale' ? 'nwse-resize' : 'crosshair';

  return (
    <div
      className="canvas-wrap"
      ref={wrap}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <canvas
        ref={cv}
        style={{ cursor }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onAuxClick={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      />
      {doc.layers.length === 0 && (
        <div className="empty">
          <div className="empty-title">분리된 캐릭터 PNG / WebP를 여기에 드롭하세요</div>
          <div className="empty-sub">
            파일 이름이 레이어 이름이 됩니다. Head, Body, Arm_L, Leg_R, Hair_Front, Eye… 같은 이름이면 역할·Pivot·부모가 자동 설정됩니다.
            <br />
            표정 변형은 <code>Eye@Blink.png</code> 처럼 <code>@</code>로 이름을 붙이세요.
          </div>
          <button className="btn primary" onClick={() => loadDemo()}>데모 캐릭터 불러오기</button>
        </div>
      )}
      <div className="canvas-hud">
        {Math.round(ui.zoom * 100)}% · {ui.animate ? 'ANIMATE' : 'SETUP'} · {doc.facing === 'left' ? '← Left' : 'Right →'}
      </div>
    </div>
  );
}
