import { useRef } from 'react';
import { beginGesture, commit, endGesture, getState, setUI, status, useDoc, useUI } from '../store';
import { buildPreset, EASE_LABEL, EASES, PRESETS, PresetKind, upsertPresetClip } from '../anim';
import { keySelected, stop, togglePlay } from '../actions';
import { clamp, uid } from '../math';
import type { Ease } from '../types';

const PX = 16;

export function Timeline() {
  const doc = useDoc();
  const ui = useUI();
  const clip = doc.clips.find((c) => c.id === doc.activeClipId);
  const scroller = useRef<HTMLDivElement>(null);
  const layers = [...doc.layers].reverse();
  const sk = ui.selectedKey;
  const selKey = clip && sk ? clip.tracks[sk.layerId]?.find((k) => k.frame === sk.frame) : undefined;
  const frame = Math.round(ui.frame);

  const frameAt = (clientX: number) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    return clamp(Math.round((clientX - r.left + el.scrollLeft - 8) / PX), 0, clip?.length ?? 0);
  };

  const scrub = (e: React.PointerEvent) => {
    if (!clip) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setUI({ playing: false, frame: frameAt(e.clientX) });
  };

  const preset = (k: PresetKind) => {
    if (!doc.layers.length) return status('먼저 이미지를 가져오세요');
    const c = buildPreset(getState().doc, k);
    commit((d) => {
      upsertPresetClip(d, c);
    });
    setUI({ animate: true, frame: 0, playing: true, sq: 0, selectedKey: null });
    status(`${k} 프리셋 생성 — 모든 키프레임 수정 가능`);
  };

  const keyDown = (e: React.PointerEvent, layerId: string, f0: number) => {
    e.stopPropagation();
    if (!clip) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setUI({ selectedKey: { layerId, frame: f0 }, selectedId: layerId, frame: f0, playing: false });
    beginGesture();
    let cur = f0;
    const move = (ev: PointerEvent) => {
      const nf = frameAt(ev.clientX);
      if (nf === cur) return;
      const keys = getState().doc.clips.find((c) => c.id === clip.id)?.tracks[layerId] ?? [];
      if (keys.some((k) => k.frame === nf)) return;
      const from = cur;
      commit((d) => {
        const ks = d.clips.find((c) => c.id === clip.id)!.tracks[layerId];
        const k = ks.find((k) => k.frame === from);
        if (k) k.frame = nf;
        ks.sort((a, b) => a.frame - b.frame);
      });
      cur = nf;
      setUI({ selectedKey: { layerId, frame: nf }, frame: nf });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const delKey = () => {
    if (!clip) return;
    const target = sk ?? (ui.selectedId ? { layerId: ui.selectedId, frame } : null);
    if (!target) return;
    commit((d) => {
      const c = d.clips.find((x) => x.id === clip.id)!;
      const ks = c.tracks[target.layerId];
      if (!ks) return;
      c.tracks[target.layerId] = ks.filter((k) => k.frame !== target.frame);
      if (!c.tracks[target.layerId].length) delete c.tracks[target.layerId];
    });
    setUI({ selectedKey: null });
  };

  const updClip = (fn: (c: NonNullable<typeof clip>) => void) =>
    clip && commit((d) => { const c = d.clips.find((x) => x.id === clip.id); if (c) fn(c as any); });

  const width = ((clip?.length ?? 30) + 2) * PX + 16;

  return (
    <div className="timeline">
      <div className="tl-bar">
        <select value={doc.activeClipId ?? ''} onChange={(e) => { commit((d) => { d.activeClipId = e.target.value || null; }); setUI({ frame: 0, selectedKey: null }); }}>
          {!doc.clips.length && <option value="">(클립 없음)</option>}
          {doc.clips.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn sm" onClick={() => {
          const id = uid();
          commit((d) => { d.clips.push({ id, name: `Clip ${d.clips.length + 1}`, length: 30, loop: true, tracks: {} }); d.activeClipId = id; });
          setUI({ frame: 0, animate: true });
        }}>New</button>
        <button className="btn sm" disabled={!clip} onClick={() => { const n = clip && prompt('클립 이름', clip.name); if (n) updClip((c) => (c.name = n)); }}>Ren</button>
        <button className="btn sm" disabled={!clip} onClick={() => {
          if (!clip) return;
          const id = uid();
          commit((d) => { d.clips.push({ ...JSON.parse(JSON.stringify(clip)), id, name: clip.name + ' copy' }); d.activeClipId = id; });
        }}>Dup</button>
        <button className="btn sm" disabled={!clip} onClick={() => clip && commit((d) => {
          d.clips = d.clips.filter((c) => c.id !== clip.id);
          d.activeClipId = d.clips[0]?.id ?? null;
        })}>Del</button>
        <span className="sep" />
        <button className={'btn sm anim' + (ui.animate ? ' on' : '')} title="Animate 모드: 편집이 키프레임으로 기록됩니다" onClick={() => setUI({ animate: !ui.animate, playing: false })}>● Animate</button>
        <button className={'btn sm' + (ui.playing ? ' on' : '')} onClick={togglePlay}>{ui.playing ? '❚❚' : '▶'}</button>
        <button className="btn sm" onClick={stop}>■</button>
        <label className="check"><input type="checkbox" disabled={!clip} checked={!!clip?.loop} onChange={() => updClip((c) => (c.loop = !c.loop))} />Loop</label>
        <span className="frame-no">{frame} / {clip?.length ?? 0} <small>({doc.fps}fps)</small></span>
        <label className="field inline"><span>Len</span>
          <input type="number" min={1} value={clip?.length ?? 0} disabled={!clip} onChange={(e) => { const v = parseInt(e.target.value); if (v > 0) updClip((c) => (c.length = v)); }} />
        </label>
        <span className="sep" />
        <button className="btn sm" onClick={() => keySelected(false)} title="선택 레이어 키 (K)">◆ Key</button>
        <button className="btn sm" onClick={() => keySelected(true)}>◆ Key All</button>
        <button className="btn sm" onClick={delKey}>Del Key</button>
        <select disabled={!selKey} value={selKey?.ease ?? 'linear'} title="선택한 키 → 다음 키 구간의 easing"
          onChange={(e) => sk && commit((d) => {
            const k = d.clips.find((c) => c.id === clip!.id)?.tracks[sk.layerId]?.find((k) => k.frame === sk.frame);
            if (k) k.ease = e.target.value as Ease;
          })}>
          {EASES.map((x) => <option key={x} value={x}>{EASE_LABEL[x]}</option>)}
        </select>
        <span className="sep" />
        <span className="lbl">Preset</span>
        {PRESETS.map((p) => <button key={p} className="btn sm" onClick={() => preset(p)}>{p}</button>)}
      </div>

      <div className="tl-main">
        <div className="tl-names">
          <div className="tl-ruler-spacer" />
          {layers.map((L) => (
            <div key={L.id} className={'tl-name' + (L.id === ui.selectedId ? ' sel' : '')} onClick={() => setUI({ selectedId: L.id })}>{L.name}</div>
          ))}
        </div>
        <div className="tl-scroll" ref={scroller}>
          <div style={{ width, position: 'relative' }}>
            <div className="tl-ruler" onPointerDown={scrub} onPointerMove={(e) => e.buttons & 1 && scrub(e)}>
              {clip && Array.from({ length: clip.length + 1 }, (_, i) => (
                <span key={i} className={'tick' + (i % 5 === 0 ? ' major' : '')} style={{ left: 8 + i * PX }}>
                  {i % 5 === 0 && <b>{i}</b>}
                </span>
              ))}
            </div>
            {layers.map((L) => (
              <div key={L.id} className={'tl-row' + (L.id === ui.selectedId ? ' sel' : '')} onPointerDown={scrub}>
                {clip?.tracks[L.id]?.map((k) => (
                  <span
                    key={k.frame}
                    className={'kf' + (sk && sk.layerId === L.id && sk.frame === k.frame ? ' sel' : '') + (k.variant != null ? ' var' : '')}
                    style={{ left: 8 + k.frame * PX - 5 }}
                    title={`f${k.frame} · ${EASE_LABEL[k.ease]}${k.variant != null ? ' · variant ' + k.variant : ''}`}
                    onPointerDown={(e) => keyDown(e, L.id, k.frame)}
                  />
                ))}
              </div>
            ))}
            {clip && <div className="playhead" style={{ left: 8 + ui.frame * PX }} />}
            {clip && <div className="tl-end" style={{ left: 8 + clip.length * PX }} />}
          </div>
          {!clip && <div className="hint pad">클립이 없습니다. 위의 Preset 버튼(Idle, Attack…)을 누르거나 New로 만드세요.</div>}
        </div>
      </div>
    </div>
  );
}
