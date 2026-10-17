import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { LayerPanel } from './components/LayerPanel';
import { CanvasView } from './components/CanvasView';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { commit, getState, redo, setUI, undo } from './store';
import { deleteLayer, duplicateLayer } from './edit';
import { keys } from './keys';
import { keySelected, togglePlay } from './actions';
import { startMcpBridge } from './mcpBridge';

export function App() {
  useEffect(() => startMcpBridge(), []);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      const sel = getState().ui.selectedId;
      if (mod && k === 'd') {
        e.preventDefault();
        if (sel) {
          let nid: string | null = null;
          commit((d) => { nid = duplicateLayer(d, sel); });
          if (nid) setUI({ selectedId: nid });
        }
        return;
      }
      if (mod) return;
      if (e.code === 'Space') { keys.space = true; e.preventDefault(); return; }
      if (k === 'w') setUI({ tool: 'move' });
      else if (k === 'e') setUI({ tool: 'rotate' });
      else if (k === 'r') setUI({ tool: 'scale' });
      else if (k === 'p') setUI({ tool: 'pivot' });
      else if (k === 'k') keySelected(false);
      else if (k === 'enter') togglePlay();
      else if (k === 'escape') setUI({ selectedId: null });
      else if ((k === 'delete' || k === 'backspace') && sel) commit((d) => deleteLayer(d, sel));
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') keys.space = false;
    };
    const blur = () => (keys.space = false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <LayerPanel />
      <CanvasView />
      <Inspector />
      <Timeline />
    </div>
  );
}
