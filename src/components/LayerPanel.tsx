import { useState } from 'react';
import { commit, setUI, useDoc, useUI } from '../store';
import { deleteLayer, duplicateLayer, moveAbove, shiftLayer } from '../edit';
import type { Doc, Layer } from '../types';

function depth(doc: Doc, L: Layer) {
  let n = 0;
  let p = L.parentId;
  const seen = new Set<string>();
  while (p && !seen.has(p) && n < 20) {
    seen.add(p);
    n++;
    p = doc.layers.find((l) => l.id === p)?.parentId ?? null;
  }
  return n;
}

const Eye = ({ on }: { on: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" opacity={on ? 1 : 0.35} />
    {on ? <circle cx="8" cy="8" r="2.2" fill="currentColor" /> : <path d="M2 14L14 2" />}
  </svg>
);
const Lock = ({ on }: { on: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" opacity={on ? 1 : 0.3}>
    <rect x="3" y="7" width="10" height="7" rx="1" />
    <path d={on ? 'M5 7V5a3 3 0 016 0v2' : 'M5 7V5a3 3 0 015.6-1.5'} />
  </svg>
);

export function LayerPanel() {
  const doc = useDoc();
  const ui = useUI();
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const sel = ui.selectedId;
  const list = [...doc.layers].reverse();

  return (
    <div className="panel left">
      <div className="panel-head">
        <span>Layers</span>
        <div className="mini">
          <button className="btn sm" disabled={!sel} title="위로" onClick={() => sel && commit((d) => shiftLayer(d, sel, 1))}>▲</button>
          <button className="btn sm" disabled={!sel} title="아래로" onClick={() => sel && commit((d) => shiftLayer(d, sel, -1))}>▼</button>
          <button className="btn sm" disabled={!sel} title="복제 (Ctrl+D)" onClick={() => {
            if (!sel) return;
            let nid: string | null = null;
            commit((d) => { nid = duplicateLayer(d, sel); });
            if (nid) setUI({ selectedId: nid });
          }}>Dup</button>
          <button className="btn sm" disabled={!sel} title="삭제 (Del)" onClick={() => sel && commit((d) => deleteLayer(d, sel))}>Del</button>
        </div>
      </div>
      <div className="layer-list" onClick={(e) => e.target === e.currentTarget && setUI({ selectedId: null })}>
        {list.length === 0 && <div className="hint">이미지를 가져오면 여기에 레이어가 표시됩니다.</div>}
        {list.map((L) => (
          <div
            key={L.id}
            className={'layer-row' + (L.id === sel ? ' sel' : '') + (over === L.id && dragId !== L.id ? ' over' : '') + (!L.visible ? ' hidden' : '')}
            draggable={editing !== L.id}
            onDragStart={(e) => { setDragId(L.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); setOver(L.id); } }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== L.id) commit((d) => moveAbove(d, dragId, L.id));
              setDragId(null); setOver(null);
            }}
            onDragEnd={() => { setDragId(null); setOver(null); }}
            onClick={() => setUI({ selectedId: L.id })}
          >
            <button className="icon" title="Show / Hide" onClick={(e) => { e.stopPropagation(); commit((d) => { const l = d.layers.find((x) => x.id === L.id)!; l.visible = !l.visible; }); }}>
              <Eye on={L.visible} />
            </button>
            <button className="icon" title="Lock" onClick={(e) => { e.stopPropagation(); commit((d) => { const l = d.layers.find((x) => x.id === L.id)!; l.locked = !l.locked; }); }}>
              <Lock on={L.locked} />
            </button>
            <span className="indent" style={{ width: depth(doc, L) * 12 }} />
            {depth(doc, L) > 0 && <span className="branch">└</span>}
            {editing === L.id ? (
              <input
                className="rename"
                autoFocus
                defaultValue={L.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== L.name) commit((d) => { d.layers.find((x) => x.id === L.id)!.name = v; }); setEditing(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
              />
            ) : (
              <span className="lname" onDoubleClick={(e) => { e.stopPropagation(); setEditing(L.id); }} title="더블클릭으로 이름 변경">{L.name}</span>
            )}
            {L.role !== 'none' && <span className="tag">{L.role}</span>}
            {L.spring.enabled && <span className="tag spring">~</span>}
          </div>
        ))}
      </div>
      <div className="panel-foot">위 = 앞쪽. 드래그로 순서 변경, 더블클릭으로 이름 변경</div>
    </div>
  );
}
