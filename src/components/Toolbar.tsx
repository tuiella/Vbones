import { useRef } from 'react';
import { redo, setUI, undo, useHistoryInfo, useUI } from '../store';
import { importFiles } from '../importer';
import { exportPNG, exportWebM, loadProject, saveJson, saveZip } from '../io';
import { stop, togglePlay } from '../actions';
import type { Bg, Tool } from '../types';

const TOOLS: { t: Tool; label: string; key: string }[] = [
  { t: 'move', label: 'Move', key: 'W' },
  { t: 'rotate', label: 'Rotate', key: 'E' },
  { t: 'scale', label: 'Scale', key: 'R' },
  { t: 'pivot', label: 'Pivot', key: 'P' },
];

export function Toolbar() {
  const ui = useUI();
  const h = useHistoryInfo();
  const canUndo = h >= 100000;
  const canRedo = h % 100000 > 0;
  const imp = useRef<HTMLInputElement>(null);
  const load = useRef<HTMLInputElement>(null);

  return (
    <div className="toolbar">
      <span className="brand">Vbones</span>
      <div className="group">
        <button className="btn" onClick={() => imp.current?.click()} title="이미지 가져오기 (여러 개)">Import</button>
        <button className="btn" onClick={() => saveZip()} title="project.json + images/ ZIP">Save</button>
        <button className="btn" onClick={() => saveJson()} title="project.json만 저장">JSON</button>
        <button className="btn" onClick={() => load.current?.click()} title="ZIP 또는 JSON 불러오기">Load</button>
        <input ref={imp} type="file" accept="image/png,image/webp,image/jpeg" multiple hidden
          onChange={(e) => { importFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        <input ref={load} type="file" accept=".zip,.json,application/json,application/zip" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadProject(f); e.target.value = ''; }} />
      </div>
      <div className="group">
        <button className="btn" disabled={!canUndo} onClick={undo} title="Ctrl+Z">Undo</button>
        <button className="btn" disabled={!canRedo} onClick={redo} title="Ctrl+Shift+Z">Redo</button>
      </div>
      <div className="group">
        {TOOLS.map((x) => (
          <button key={x.t} className={'btn' + (ui.tool === x.t ? ' on' : '')} onClick={() => setUI({ tool: x.t })} title={`${x.label} (${x.key})`}>
            {x.label}<span className="kbd">{x.key}</span>
          </button>
        ))}
      </div>
      <div className="group">
        <button className={'btn' + (ui.playing ? ' on' : '')} onClick={togglePlay} title="Enter">{ui.playing ? 'Pause' : 'Play'}</button>
        <button className="btn" onClick={stop}>Stop</button>
      </div>
      <div className="group">
        <label className="lbl">BG</label>
        <select value={ui.bg} onChange={(e) => setUI({ bg: e.target.value as Bg })}>
          <option value="checker">Checker</option>
          <option value="white">White</option>
          <option value="gray">Gray</option>
          <option value="black">Black</option>
        </select>
      </div>
      <div className="group">
        <button className="btn" onClick={() => exportPNG()}>Export PNG</button>
        <button className="btn" onClick={() => exportWebM()}>Export WebM</button>
      </div>
      <div className="status">{ui.status}</div>
    </div>
  );
}
