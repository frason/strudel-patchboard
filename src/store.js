// Single source of truth + undo/redo + autosave + named saves + history snapshots (all localStorage, all JSON).
import { clone, normalize, validateShape, emptyGraph } from './graph.js';

const K = { auto: 'pb.autosave', prev: 'pb.previousSession', hist: 'pb.history', saves: 'pb.saves' };
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const storage = {
  // capture the previous session BEFORE the first autosave of this one overwrites it
  capturePrevious() {
    const a = localStorage.getItem(K.auto);
    if (a) { try { localStorage.setItem(K.prev, a); } catch {} }
  },
  previous: () => lsGet(K.prev),
  autosaved: () => lsGet(K.auto),
  saves: () => lsGet(K.saves) || {},
  putSave(name, graph) { const s = storage.saves(); s[name] = { t: Date.now(), graph }; return lsSet(K.saves, s); },
  deleteSave(name) { const s = storage.saves(); const old = s[name]; delete s[name]; lsSet(K.saves, s); return old; },
  restoreSave(name, entry) { const s = storage.saves(); s[name] = entry; lsSet(K.saves, s); },
  history: () => lsGet(K.hist) || [],
};

export function createStore(initial) {
  let graph = initial;
  let undo = [], redo = [];
  let lastKey = null, lastAt = 0;
  let fresh = false;   // true from a replace() until the next change: the automatic tidy after a load can join that one undo step
  const subs = new Set();
  let autosaveTimer = null, lastSnapshotAt = 0, lastSnapshot = '';
  const saveSubs = new Set();   // told after every autosave whether it worked (the browser's storage can be full or blocked)

  const emit = (meta = {}) => subs.forEach((f) => f(graph, meta));

  function scheduleSave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      const json = JSON.stringify(graph);
      const saved = lsSet(K.auto, graph);
      saveSubs.forEach((f) => { try { f(saved); } catch { /* ignore */ } });
      const now = Date.now();
      if (json !== lastSnapshot && now - lastSnapshotAt > 4000) {
        const h = storage.history();
        h.unshift({ t: now, graph });
        lsSet(K.hist, h.slice(0, 25));
        lastSnapshot = json; lastSnapshotAt = now;
      }
    }, 350);
  }

  const store = {
    get graph() { return graph; },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    onSave(f) { saveSubs.add(f); return () => saveSubs.delete(f); },
    // mutate a draft copy; coalesce lets a knob drag or node drag count as one undo step
    update(fn, { coalesce = null, label = '' } = {}) {
      const draft = clone(graph);
      fn(draft);
      const removed = normalize(draft);
      if (JSON.stringify(draft) === JSON.stringify(graph)) return removed;
      const now = Date.now();
      fresh = false;
      if (!(coalesce && coalesce === lastKey && now - lastAt < 700)) {
        undo.push(JSON.stringify(graph));
        if (undo.length > 200) undo.shift();
      }
      lastKey = coalesce; lastAt = now;
      redo = [];
      graph = draft;
      emit({ label, removed });
      scheduleSave();
      return removed;
    },
    // change the patch as part of the step just taken (e.g. the automatic tidy right after a load): no extra undo step.
    // Anything else in between, and it falls back to an ordinary update.
    amend(fn, { label = '' } = {}) {
      if (!fresh) return store.update(fn, { label });
      const draft = clone(graph);
      fn(draft);
      const removed = normalize(draft);
      if (JSON.stringify(draft) === JSON.stringify(graph)) return removed;
      graph = draft;
      emit({ label, removed });
      scheduleSave();
      return removed;
    },
    // replace the whole patch (load / import / starter): one undoable step
    replace(next, label = '') {
      const g = validateShape(clone(next));
      normalize(g);
      undo.push(JSON.stringify(graph));
      redo = []; lastKey = null; fresh = true;
      graph = g;
      emit({ label, replaced: true });
      scheduleSave();
    },
    undo() {
      if (!undo.length) return false;
      redo.push(JSON.stringify(graph));
      graph = JSON.parse(undo.pop()); lastKey = null; fresh = false;
      emit({ label: 'undo', replaced: true }); scheduleSave();
      return true;
    },
    redo() {
      if (!redo.length) return false;
      undo.push(JSON.stringify(graph));
      graph = JSON.parse(redo.pop()); lastKey = null; fresh = false;
      emit({ label: 'redo', replaced: true }); scheduleSave();
      return true;
    },
    flush() { clearTimeout(autosaveTimer); lsSet(K.auto, graph); },
  };
  return store;
}

export { emptyGraph };
