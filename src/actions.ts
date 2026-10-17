import { commit, getState, setUI, status } from './store';
import { resolveEff } from './scene';
import { setKey } from './edit';

export function currentEff() {
  const { doc, ui } = getState();
  const clip = doc.clips.find((c) => c.id === doc.activeClipId);
  return resolveEff(doc, { animated: !!clip && (ui.animate || ui.playing), frame: ui.frame, sq: ui.sq });
}

/** Key the selected layer (or all layers) at the current frame with what is displayed. */
export function keySelected(all: boolean) {
  const { doc, ui } = getState();
  const ids = all ? doc.layers.map((l) => l.id) : ui.selectedId ? [ui.selectedId] : [];
  if (!ids.length) return status('키를 넣을 레이어를 선택하세요');
  const eff = currentEff();
  const f = Math.round(ui.frame);
  commit((d) => {
    for (const id of ids) {
      const e = eff.get(id);
      if (!e) continue;
      setKey(d, id, f, { x: e.x, y: e.y, rotation: e.rotation, scaleX: e.scaleX, scaleY: e.scaleY, opacity: e.opacity });
    }
  });
  setUI({ animate: true, sq: 0, frame: f });
  status(`프레임 ${f}에 키 ${ids.length}개`);
}

export function togglePlay() {
  const { doc, ui } = getState();
  const clip = doc.clips.find((c) => c.id === doc.activeClipId);
  if (!clip) return status('재생할 클립이 없습니다. 타임라인에서 Preset을 눌러 보세요');
  if (ui.playing) setUI({ playing: false, frame: Math.round(ui.frame) });
  else setUI({ playing: true, frame: ui.frame >= clip.length ? 0 : ui.frame });
}

export function stop() {
  setUI({ playing: false, frame: 0 });
}
