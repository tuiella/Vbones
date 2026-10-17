import { useEffect, useRef, useState } from 'react';
import { beginGesture, commit, endGesture, getState, setUI, status, useDoc, useUI } from '../store';
import { applyPose, capturePose, findLayer, isDescendant, reparent, setKey, setPivot, setTransform } from '../edit';
import { currentEff, keySelected } from '../actions';
import { applySquash, sideOf } from '../anim';
import { imageRefFor } from '../scene';
import { addVariantFiles, autoParent } from '../importer';
import { loadDemo } from '../demo';
import { emptyDoc, replaceDoc } from '../store';
import { r4, uid } from '../math';
import type { Layer, Role } from '../types';

const ROLES: Role[] = ['none', 'head', 'body', 'arm', 'leg', 'accessory'];

function Num(p: { label: string; value: number; onCommit: (v: number) => void; step?: number; disabled?: boolean; digits?: number }) {
  const fmt = (v: number) => String(Math.round(v * 10 ** (p.digits ?? 2)) / 10 ** (p.digits ?? 2));
  const [txt, setTxt] = useState(fmt(p.value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setTxt(fmt(p.value));
  }, [p.value]);
  const done = () => {
    focused.current = false;
    const v = parseFloat(txt);
    if (isFinite(v) && Math.abs(v - p.value) > 1e-9) p.onCommit(v);
    else setTxt(fmt(p.value));
  };
  return (
    <label className="field">
      <span>{p.label}</span>
      <input
        type="number"
        step={p.step ?? 1}
        value={txt}
        disabled={p.disabled}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** Range slider that records one undo step per drag. */
function Slider(p: { label: string; value: number; min: number; max: number; step: number; onLive: (v: number) => void; history?: boolean; disabled?: boolean; fmt?: (v: number) => string }) {
  return (
    <label className="field slider">
      <span>{p.label}</span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        disabled={p.disabled}
        onPointerDown={() => p.history !== false && beginGesture()}
        onPointerUp={() => p.history !== false && endGesture()}
        onChange={(e) => p.onLive(parseFloat(e.target.value))}
      />
      <em>{p.fmt ? p.fmt(p.value) : r4(p.value)}</em>
    </label>
  );
}

type Tab = 'layer' | 'pose' | 'squash' | 'scene';

export function Inspector() {
  const [tab, setTab] = useState<Tab>('layer');
  return (
    <div className="panel right">
      <div className="tabs">
        {(['layer', 'pose', 'squash', 'scene'] as Tab[]).map((t) => (
          <button key={t} className={'tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>
            {t === 'layer' ? 'Layer' : t === 'pose' ? 'Pose' : t === 'squash' ? 'Squash' : 'Scene'}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'layer' && <LayerTab />}
        {tab === 'pose' && <PoseTab />}
        {tab === 'squash' && <SquashTab />}
        {tab === 'scene' && <SceneTab />}
      </div>
    </div>
  );
}

function LayerTab() {
  const doc = useDoc();
  const ui = useUI();
  const L = findLayer(doc, ui.selectedId);
  const addRef = useRef<HTMLInputElement>(null);
  const leftRef = useRef<HTMLInputElement>(null);
  const [leftIdx, setLeftIdx] = useState(0);
  if (!L) return <div className="hint">레이어를 선택하세요.<br /><br />W 이동 · E 회전 · R 스케일 · P 피벗<br />Shift: 이동 미세 / 회전 15° 스냅 / 스케일 균일<br />휠 줌 · 중클릭 또는 Space+드래그 팬</div>;
  const e = currentEff().get(L.id)!;
  const lock = L.locked;
  const upd = (fn: (l: Layer) => void) => commit((d) => { const l = d.layers.find((x) => x.id === L.id); if (l) fn(l as Layer); });
  const tr = (p: Partial<{ x: number; y: number; rotation: number; scaleX: number; scaleY: number; opacity: number }>) =>
    commit((d) => setTransform(d, getState().ui, L.id, p));
  const parents = doc.layers.filter((o) => o.id !== L.id && !isDescendant(doc, o.id, L.id));
  const ref = imageRefFor(doc, L, e.variant);

  return (
    <>
      <section>
        <h4>Layer {ui.animate && <span className="pill red">키 편집</span>}</h4>
        <label className="field"><span>Name</span>
          <input key={L.id + L.name} defaultValue={L.name} onBlur={(ev) => { const v = ev.target.value.trim(); if (v && v !== L.name) upd((l) => (l.name = v)); }}
            onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()} />
        </label>
        <label className="field"><span>Parent</span>
          <select value={L.parentId ?? ''} onChange={(ev) => commit((d) => reparent(d, L.id, ev.target.value || null))}>
            <option value="">(없음)</option>
            {parents.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Role</span>
          <select value={L.role} onChange={(ev) => upd((l) => (l.role = ev.target.value as Role))}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="row2">
          <label className="check"><input type="checkbox" checked={L.visible} onChange={() => upd((l) => (l.visible = !l.visible))} />Visible</label>
          <label className="check"><input type="checkbox" checked={L.locked} onChange={() => upd((l) => (l.locked = !l.locked))} />Lock</label>
        </div>
      </section>

      <section>
        <h4>Transform</h4>
        <div className="row2">
          <Num label="X" value={e.x} disabled={lock} onCommit={(v) => tr({ x: v })} />
          <Num label="Y" value={e.y} disabled={lock} onCommit={(v) => tr({ y: v })} />
        </div>
        <Num label="Rotation" value={e.rotation} disabled={lock} onCommit={(v) => tr({ rotation: v })} />
        <div className="row2">
          <Num label="Scale X" value={e.scaleX} step={0.05} disabled={lock} digits={3} onCommit={(v) => tr({ scaleX: v })} />
          <Num label="Scale Y" value={e.scaleY} step={0.05} disabled={lock} digits={3} onCommit={(v) => tr({ scaleY: v })} />
        </div>
        <Slider label="Opacity" value={e.opacity} min={0} max={1} step={0.01} disabled={lock} onLive={(v) => tr({ opacity: v })} />
        <button className="btn sm" disabled={lock} onClick={() => tr({ x: e.x, y: e.y, rotation: 0, scaleX: 1, scaleY: 1 })}>Reset Rot/Scale</button>
      </section>

      <section>
        <h4>Pivot <small>이미지 로컬 px {ref ? `(${ref.w}×${ref.h})` : ''}</small></h4>
        <div className="row2">
          <Num label="Pivot X" value={L.pivotX} disabled={lock || ui.animate} onCommit={(v) => commit((d) => setPivot(d, L.id, v, L.pivotY))} />
          <Num label="Pivot Y" value={L.pivotY} disabled={lock || ui.animate} onCommit={(v) => commit((d) => setPivot(d, L.id, L.pivotX, v))} />
        </div>
        <div className="hint">P 키로 Pivot 모드 → 주황 점을 드래그.</div>
      </section>

      <section>
        <h4>Sprite Variants <small>표정 교체</small></h4>
        <label className="field"><span>Current</span>
          <select value={e.variant} onChange={(ev) => {
            const v = parseInt(ev.target.value);
            const ui2 = getState().ui;
            if (ui2.animate) commit((d) => setKey(d, L.id, Math.round(ui2.frame), { variant: v }));
            else upd((l) => (l.activeVariant = v));
          }}>
            {L.variants.map((v, i) => <option key={i} value={i}>{v.name}</option>)}
          </select>
        </label>
        <div className="variant-list">
          {L.variants.map((v, i) => (
            <div className="variant" key={i}>
              <span className="vname" onDoubleClick={() => { const n = prompt('Variant 이름', v.name); if (n) upd((l) => (l.variants[i].name = n)); }}>{v.name}</span>
              <span className={'tag' + (v.leftImageId ? ' on' : '')} title="Left 이미지 (Sprite Set 모드)">L</span>
              <button className="btn xs" onClick={() => { setLeftIdx(i); leftRef.current?.click(); }}>Left…</button>
              {v.leftImageId && <button className="btn xs" onClick={() => upd((l) => (l.variants[i].leftImageId = null))}>×L</button>}
              <button className="btn xs" disabled={L.variants.length < 2} onClick={() => upd((l) => {
                l.variants.splice(i, 1);
                if (l.activeVariant >= l.variants.length) l.activeVariant = l.variants.length - 1;
              })}>Del</button>
            </div>
          ))}
        </div>
        <button className="btn sm" onClick={() => addRef.current?.click()}>+ 이미지 추가</button>
        <input ref={addRef} type="file" accept="image/*" multiple hidden onChange={(ev) => { addVariantFiles(L.id, Array.from(ev.target.files ?? [])); ev.target.value = ''; }} />
        <input ref={leftRef} type="file" accept="image/*" hidden onChange={(ev) => { addVariantFiles(L.id, Array.from(ev.target.files ?? []).slice(0, 1), leftIdx); ev.target.value = ''; }} />
        {ui.animate && <div className="hint">Animate 모드에서는 현재 프레임에 표정 키가 들어갑니다.</div>}
      </section>

      <section>
        <h4>Spring <small>Secondary Motion</small></h4>
        <label className="check"><input type="checkbox" checked={L.spring.enabled} onChange={() => upd((l) => (l.spring.enabled = !l.spring.enabled))} />Enable Spring</label>
        {L.spring.enabled && (
          <>
            <Slider label="Stiffness" value={L.spring.stiffness} min={10} max={400} step={1} onLive={(v) => upd((l) => (l.spring.stiffness = v))} />
            <Slider label="Damping" value={L.spring.damping} min={0} max={40} step={0.5} onLive={(v) => upd((l) => (l.spring.damping = v))} />
            <Slider label="Delay ms" value={L.spring.delay} min={0} max={300} step={5} onLive={(v) => upd((l) => (l.spring.delay = v))} />
            <Slider label="Max Rot" value={L.spring.maxRot} min={1} max={90} step={1} onLive={(v) => upd((l) => (l.spring.maxRot = v))} />
          </>
        )}
      </section>
    </>
  );
}

function PoseTab() {
  const doc = useDoc();
  const ui = useUI();
  const [name, setName] = useState('');
  return (
    <>
      <section>
        <h4>Poses</h4>
        <div className="row-inline">
          <input placeholder={`Pose ${doc.poses.length + 1}`} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={!doc.layers.length} onClick={() => {
            const p = capturePose(getState().doc, currentEff(), name.trim() || `Pose ${doc.poses.length + 1}`);
            commit((d) => { d.poses.push(p); });
            setName('');
          }}>Save</button>
        </div>
        <div className="hint">예: Idle, Squash, Stretch, AttackReady, AttackImpact, Hit, Jump</div>
        <div className="pose-list">
          {doc.poses.map((p, i) => (
            <div className="pose" key={p.id}>
              <span className="pname" onDoubleClick={() => { const n = prompt('Pose 이름', p.name); if (n) commit((d) => { d.poses[i].name = n; }); }}>{p.name}</span>
              <button className="btn xs" onClick={() => { commit((d) => applyPose(d, getState().ui, p)); status(`${p.name} 적용${getState().ui.animate ? ' (키)' : ''}`); }}>Apply</button>
              <button className="btn xs" onClick={() => { const n = prompt('Pose 이름', p.name); if (n) commit((d) => { d.poses[i].name = n; }); }}>Ren</button>
              <button className="btn xs" onClick={() => commit((d) => { d.poses.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(p)), id: uid(), name: p.name + ' copy' }); })}>Dup</button>
              <button className="btn xs" onClick={() => commit((d) => { d.poses.splice(i, 1); })}>Del</button>
            </div>
          ))}
          {!doc.poses.length && <div className="hint">저장된 포즈가 없습니다.</div>}
        </div>
        <div className="hint">{ui.animate ? 'Animate 모드: Apply 시 현재 프레임에 모든 레이어 키 생성' : 'Setup 모드: Apply 시 기본 포즈로 적용 (Undo 가능)'}</div>
      </section>
    </>
  );
}

function SquashTab() {
  const doc = useDoc();
  const ui = useUI();
  const bake = () => {
    const { ui } = getState();
    if (!ui.sq) return;
    if (ui.animate) {
      keySelectedAll();
    } else {
      commit((d) => {
        for (const L of d.layers) {
          if (L.role === 'none') continue;
          const ref = imageRefFor(d as any, L as Layer, L.activeVariant);
          Object.assign(L, applySquash({ x: L.x, y: L.y, rotation: L.rotation, scaleX: L.scaleX, scaleY: L.scaleY }, L.role, ui.sq, sideOf(L as Layer), ref?.h ?? 100));
        }
      });
      setUI({ sq: 0 });
    }
  };
  return (
    <>
      <section>
        <h4>Squash &amp; Stretch</h4>
        <Slider label={ui.sq >= 0 ? 'Squash' : 'Stretch'} value={ui.sq} min={-1} max={1} step={0.01} history={false} onLive={(v) => setUI({ sq: v })}
          fmt={(v) => (v >= 0 ? `Squash ${v.toFixed(2)}` : `Stretch ${(-v).toFixed(2)}`)} />
        <div className="scale-labels"><span>← Stretch</span><span>Squash →</span></div>
        <div className="row-inline">
          <button className="btn" onClick={() => setUI({ sq: 0 })}>Reset</button>
          <button className="btn" onClick={() => setUI({ sq: 0.6 })}>Squash</button>
          <button className="btn" onClick={() => setUI({ sq: -0.6 })}>Stretch</button>
        </div>
        <button className="btn primary" disabled={!ui.sq} onClick={bake}>{ui.animate ? '현재 프레임에 키로 넣기' : 'Setup 포즈에 적용'}</button>
        <div className="hint">Role이 지정된 파츠만 개별 변형합니다. Head: 넓어지고 낮아짐 · Body: 넓고 납작 · Leg: 짧아지고 바깥으로 · Arm/Accessory: 약하게.</div>
      </section>
      <section>
        <h4>Roles</h4>
        {doc.layers.slice().reverse().map((L) => (
          <label className="field" key={L.id}>
            <span>{L.name}</span>
            <select value={L.role} onChange={(e) => commit((d) => { d.layers.find((x) => x.id === L.id)!.role = e.target.value as Role; })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        ))}
        {!doc.layers.length && <div className="hint">레이어가 없습니다.</div>}
      </section>
    </>
  );
}

function keySelectedAll() {
  keySelected(true);
}

function SceneTab() {
  const doc = useDoc();
  return (
    <>
      <section>
        <h4>Facing</h4>
        <div className="row-inline">
          <button className={'btn' + (doc.facing === 'right' ? ' on' : '')} onClick={() => commit((d) => { d.facing = 'right'; })}>Right →</button>
          <button className={'btn' + (doc.facing === 'left' ? ' on' : '')} onClick={() => commit((d) => { d.facing = 'left'; })}>← Left</button>
        </div>
        <label className="field"><span>Mode</span>
          <select value={doc.flipMode} onChange={(e) => commit((d) => { d.flipMode = e.target.value as any; })}>
            <option value="mirror">Mirror Mode</option>
            <option value="spriteSet">Sprite Set Mode</option>
          </select>
        </label>
        <div className="hint">
          Mirror: 캐릭터 전체를 좌우 반전합니다.<br />
          Sprite Set: 반전하되, Left 이미지가 등록된 파츠는 그 이미지를 그려진 그대로 표시합니다 (Layer 탭 → Variants → Left…). 비대칭 디자인(머리 장식, 무기 손 등)에 사용하세요.
        </div>
      </section>
      <section>
        <h4>Rig</h4>
        <button className="btn" onClick={() => {
          let n = 0;
          commit((d) => { n = autoParent(d); });
          status(n ? `${n}개 레이어 부모 자동 지정` : '자동 지정할 레이어가 없습니다 (이미 부모가 있거나 이름 인식 실패)');
        }}>Auto Parent (이름 기준)</button>
        <div className="hint">Head/Arm/Leg → Body, Eye/Mouth/Hair → Head, Hand → Arm, Weapon → Hand/Arm_R</div>
      </section>
      <section>
        <h4>Project</h4>
        <div className="row-inline">
          <button className="btn" onClick={() => loadDemo()}>데모 캐릭터 추가</button>
          <button className="btn" onClick={() => { if (confirm('현재 프로젝트를 비울까요? (저장하지 않은 내용은 사라집니다)')) replaceDoc(emptyDoc()); }}>New</button>
        </div>
        <div className="hint">FPS: {doc.fps} · 모든 데이터는 브라우저 안에서만 처리됩니다.</div>
      </section>
    </>
  );
}
