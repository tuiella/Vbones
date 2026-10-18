import { useSyncExternalStore } from 'react';
import type { Doc, UI } from './types';

export const emptyDoc = (): Doc => ({
  layers: [],
  images: [],
  poses: [],
  clips: [],
  activeClipId: null,
  facing: 'right',
  flipMode: 'mirror',
  fps: 30,
});

const defaultUI: UI = {
  selectedId: null,
  tool: 'move',
  zoom: 1,
  panX: 0,
  panY: 0,
  bg: 'checker',
  frame: 0,
  playing: false,
  animate: false,
  selectedKey: null,
  sq: 0,
  status: '',
};

interface State {
  doc: Doc;
  ui: UI;
  past: Doc[];
  future: Doc[];
}

const MAXH = 200;
let state: State = { doc: emptyDoc(), ui: defaultUI, past: [], future: [] };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const getState = () => state;
export const useDoc = () => useSyncExternalStore(subscribe, () => state.doc);
export const useUI = () => useSyncExternalStore(subscribe, () => state.ui);
export const useHistoryInfo = () =>
  useSyncExternalStore(subscribe, () => state.past.length * 100000 + state.future.length);

export function setUI(p: Partial<UI>) {
  state = { ...state, ui: { ...state.ui, ...p } };
  emit();
}

let gestureBase: Doc | null = null;
let idleWaiters: (() => void)[] = [];
/** Bumped whenever the whole document is replaced (project load). */
let docGen = 0;
export const getDocGen = () => docGen;

/** Resolves once no UI gesture (drag/rotate/scale) is in progress. */
export function whenIdle(): Promise<void> {
  if (!gestureBase) return Promise.resolve();
  return new Promise((r) => idleWaiters.push(r));
}

/** Update doc. Adds an undo step unless inside a gesture. */
export function commit(fn: (d: Doc) => void) {
  const next = structuredClone(state.doc);
  fn(next);
  if (JSON.stringify(next) === JSON.stringify(state.doc)) return;
  if (gestureBase) state = { ...state, doc: next };
  else state = { ...state, doc: next, past: [...state.past.slice(-MAXH), state.doc], future: [] };
  fixSelection();
  emit();
}

export function beginGesture() {
  gestureBase = state.doc;
}

export function endGesture() {
  if (gestureBase && gestureBase !== state.doc) {
    state = { ...state, past: [...state.past.slice(-MAXH), gestureBase], future: [] };
  }
  gestureBase = null;
  emit();
  const w = idleWaiters;
  idleWaiters = [];
  w.forEach((r) => r());
}

export function undo() {
  if (!state.past.length) return;
  const prev = state.past[state.past.length - 1];
  state = { ...state, doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future] };
  fixSelection();
  emit();
}

export function redo() {
  if (!state.future.length) return;
  const [next, ...rest] = state.future;
  state = { ...state, doc: next, past: [...state.past, state.doc], future: rest };
  fixSelection();
  emit();
}

export function replaceDoc(doc: Doc) {
  docGen++;
  state = { ...state, doc, past: [], future: [], ui: { ...state.ui, selectedId: null, selectedKey: null, frame: 0, playing: false } };
  emit();
}

function fixSelection() {
  const ui = state.ui;
  if (ui.selectedId && !state.doc.layers.some((l) => l.id === ui.selectedId)) {
    state = { ...state, ui: { ...ui, selectedId: null } };
  }
}

export function status(msg: string) {
  setUI({ status: msg });
}
