// CodeMirror view of the compiled Strudel code. The patch stays the source of truth, so the text is locked except for the numbers that come
// from a knob: click one, type, press Enter and the module's knob takes the value (Escape cancels; up and down arrows nudge it).
// Choices (a sound name, a bank, a filter type ...) are marked too: click one and the owner of the code opens a picker or menu (onChoice).
// Also:
//  - plain-English annotations at line ends (toggle-able, not part of the document)
//  - hover marks (module <-> code), and "playing now" marks driven by real event locations
import { EditorState, StateEffect, StateField, Annotation } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const programmatic = Annotation.define();   // a change we make ourselves (a new compile), as opposed to the person typing
const setModel = StateEffect.define();   // { lines, showNotes, segments, hover }
const setPlaying = StateEffect.define(); // Map<string,{from,to,n}>

// Which numbers can be edited: the single plain number in a knob's call, e.g. .lpf(800), .room(0.4), the value in slider(0.5, 0, 1), the tempo in setcpm(120/4)
const NUM = String.raw`(-?\d*\.?\d+)`;
const NUM_PATTERNS = [
  new RegExp(String.raw`^\.[A-Za-z_]\w*\(\s*${NUM}\s*\)$`),
  new RegExp(String.raw`^slider\(\s*${NUM}\s*,`),
  new RegExp(String.raw`^setcpm\(\s*(\d+(?:\.\d+)?)\s*/`),
  new RegExp(String.raw`^\.(?:every|sometimesBy|ribbon)\(\s*${NUM}\s*,`),
  new RegExp(String.raw`^irand\(\s*(\d+)\s*\)`),
];
function numberIn(text) {
  for (const re of NUM_PATTERNS) {
    const m = re.exec(text);
    if (m) { const at = text.indexOf(m[1], text.indexOf('(') + 1); return [at, at + m[1].length]; }
  }
  return null;
}
export function editableNumbers(res) {
  const out = [];
  for (const s of res.segments) {
    if (s.role !== 'knob' || !s.node || !s.key) continue;
    const call = res.code.slice(s.from, s.to), r = numberIn(call);
    if (r) out.push({ from: s.from + r[0], to: s.from + r[1], seg: s, call });
  }
  return out;
}

class NoteWidget extends WidgetType {
  constructor(text, node, key) { super(); this.text = text; this.node = node; this.key = key; }
  eq(o) { return o.text === this.text && o.node === this.node; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-note';
    el.textContent = this.text;
    el.dataset.node = this.node || '';
    el.dataset.key = this.key || '';
    return el;
  }
  ignoreEvent() { return false; }
}

const highlight = HighlightStyle.define([
  { tag: t.string, color: 'var(--c-str)' },
  { tag: t.number, color: 'var(--c-num)' },
  { tag: t.propertyName, color: 'var(--c-prop)' },
  { tag: [t.function(t.variableName), t.variableName], color: 'var(--c-fn)' },
  { tag: t.comment, color: 'var(--c-dim)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.bracket, t.operator], color: 'var(--c-punct)' },
  { tag: t.labelName, color: 'var(--c-label)' },
]);

const field = StateField.define({
  create: () => ({ model: { lines: [], showNotes: true, segments: [], hover: null, editable: [], choices: [] }, playing: new Map(), deco: Decoration.none }),
  update(v, tr) {
    let { model, playing } = v;
    let dirty = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(setModel)) { model = { ...model, ...e.value }; dirty = true; }
      if (e.is(setPlaying)) { playing = e.value; dirty = true; }
    }
    if (!dirty) return v;
    const r = [];
    const docLen = tr.state.doc.length;
    if (model.hover) {
      for (const s of model.segments) {
        if (s.node !== model.hover.node) continue;
        const key = model.hover.key;
        r.push(Decoration.mark({ class: key && s.key === key ? 'cm-hover-key' : 'cm-hover-node' }).range(s.from, s.to));
      }
    }
    for (const [, p] of playing) if (p.to <= docLen && p.from < p.to) r.push(Decoration.mark({ class: 'cm-play' }).range(p.from, p.to));
    for (const c of model.choices || []) if (c.to <= docLen && c.from < c.to) r.push(Decoration.mark({ class: 'cm-choice', attributes: { title: 'Click to choose something else' } }).range(c.from, c.to));
    for (const e of model.editable || []) if (e.to <= docLen && e.from < e.to) r.push(Decoration.mark({ class: 'cm-editnum', attributes: { title: 'Click to edit this number. Enter applies it, Esc cancels, up and down arrows nudge it.' } }).range(e.from, e.to));
    if (model.showNotes) {
      for (const l of model.lines) {
        if (!l.notes.length || l.to > docLen) continue;
        const text = l.notes.map((n) => n.text).join('  ·  ');
        r.push(Decoration.widget({ widget: new NoteWidget(text, l.notes[0].node, l.notes[0].key), side: 1 }).range(l.to));
      }
    }
    return { model, playing, deco: Decoration.set(r, true) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

export function createCodePanel(parent, { onHover, onEdit, onNudge, choicesOf, onChoice }) {
  let pending = null;          // the number being typed: { from, to, seg, call } (positions follow the typing)
  let idle = null, queued = null, lastEdit = null;
  let current = { code: '', segments: [], lines: [] }, currentShow = true;
  const choiceAt = (state, pos) => state.field(field).model.choices.find((c) => pos >= c.from && pos <= c.to) || null;
  const openChoice = (v, c) => { const a = v.coordsAtPos(c.from), b = v.coordsAtPos(c.to) || a; if (a) onChoice?.(c, { left: a.left, right: b.right, top: a.top, bottom: a.bottom }); };
  const rangeAt = (state, pos) => state.field(field).model.editable.find((r) => pos >= r.from && pos <= r.to) || null;
  // the text stays locked except inside an editable number, and only digits, a minus sign and a point can go there
  const guard = EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(programmatic)) return tr;
    const ranges = pending ? [pending] : tr.startState.field(field).model.editable;
    let hit = null, ok = true;
    tr.changes.iterChanges((fromA, toA, fromB, toB, ins) => {
      const r = ranges.find((q) => fromA >= q.from && toA <= q.to);
      if (!r || !/^[0-9.\-]*$/.test(ins.toString())) ok = false; else hit = r;
    });
    if (!ok || !hit) return [];
    pending = { seg: hit.seg, call: hit.call, from: tr.changes.mapPos(hit.from, -1), to: tr.changes.mapPos(hit.to, 1) };
    return tr;
  });
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        javascript(), syntaxHighlighting(highlight), field,
        guard,
        EditorView.contentAttributes.of({ 'aria-label': 'Strudel code. The numbers can be edited; the rest follows the modules.', spellcheck: 'false', inputmode: 'decimal', enterkeyhint: 'done' }),   // the only thing that can be typed is a number: phones show the number pad
        EditorView.updateListener.of((u) => {
          if (u.docChanged && pending && !u.transactions.some((t) => t.annotation(programmatic))) { clearTimeout(idle); idle = setTimeout(commit, 900); }
        }),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({
          pointerdown(e, v) {   // a number pad has no minus sign: a number that is already negative gets the full keyboard instead
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            const r = pos == null ? null : rangeAt(v.state, pos);
            v.contentDOM.setAttribute('inputmode', r && /^-/.test(v.state.sliceDoc(r.from, r.to)) ? 'text' : 'decimal');
            return false;
          },
          mousemove(e, v) {
            const w = e.target.closest?.('.cm-note');
            if (w) return onHover?.(w.dataset.node ? { node: w.dataset.node, key: w.dataset.key || null } : null);
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return onHover?.(null);
            const { segments } = v.state.field(field).model;
            let best = null;
            for (const s of segments) if (pos >= s.from && pos <= s.to && (!best || s.to - s.from < best.to - best.from)) best = s;
            onHover?.(best ? { node: best.node, key: best.key || null } : null);
          },
          mouseleave() { onHover?.(null); },
          click(e, v) {   // a click in an editable number selects all of it, so typing replaces it
            lastEdit = null;
            const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            const ch = pos == null || pending ? null : choiceAt(v.state, pos);
            if (ch) { openChoice(v, ch); return true; }
            const r = pos == null ? null : rangeAt(v.state, pos);
            if (r && !pending) v.dispatch({ selection: { anchor: r.from, head: r.to }, annotations: programmatic.of(true) });
            return false;
          },
          blur() { commit(); lastEdit = null; },
          keydown(e, v) {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === 'z' && pending) { e.preventDefault(); e.stopPropagation(); pending = null; clearTimeout(idle); revert(); return true; }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!pending) { const ch = choiceAt(v.state, v.state.selection.main.head); if (ch) { openChoice(v, ch); return true; } }   // Enter on a choice opens it, like a click
              commit(); return true;
            }
            if (e.key === 'Escape') { if (pending) { pending = null; clearTimeout(idle); revert(); } return true; }
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod) {
              if (pending) { e.preventDefault(); commit(); return true; }
              const r = rangeAt(v.state, v.state.selection.main.head);
              if (!r) return false;
              e.preventDefault();
              lastEdit = { node: r.seg.node, key: r.seg.key, step: r.seg.step };
              onNudge?.({ seg: r.seg, call: r.call, dir: e.key === 'ArrowUp' ? 1 : -1, big: e.shiftKey });
              return true;
            }
            return false;
          },
        }),
      ],
    }),
  });

  let playing = new Map();
  const timers = new Set();

  const apply = (res, showNotes) => {
    current = res; currentShow = showNotes;
    const editable = editableNumbers(res), choices = choicesOf ? choicesOf(res) : [];
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: res.code },
      effects: setModel.of({ lines: res.lines, segments: res.segments, showNotes, editable, choices }),
      annotations: programmatic.of(true),
    });
    // after a nudge or an Enter the text was rewritten: put the caret back at the end of the same number
    if (lastEdit && view.hasFocus) {
      const r = editable.find((q) => q.seg.node === lastEdit.node && q.seg.key === lastEdit.key && q.seg.step === lastEdit.step);
      if (r) view.dispatch({ selection: { anchor: r.to }, annotations: programmatic.of(true) });
    }
  };
  function revert() { const q = queued; queued = null; apply(q ? q[0] : current, q ? q[1] : currentShow); }
  function commit() {
    clearTimeout(idle);
    if (!pending) return;
    const p = pending; pending = null;
    const text = view.state.doc.sliceString(p.from, p.to).trim(), v = Number(text);
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text) || !Number.isFinite(v)) return revert();
    lastEdit = { node: p.seg.node, key: p.seg.key, step: p.seg.step };
    queued = null;
    onEdit?.({ seg: p.seg, call: p.call, value: v });
    if (view.state.doc.toString() !== current.code) revert();   // nothing changed in the patch (same value, or clamped back): show the real code again
  }

  return {
    view,
    setCompiled(res, showNotes) {
      if (pending) { queued = [res, showNotes]; current = res; currentShow = showNotes; return; }   // do not rewrite the text under someone's fingers
      apply(res, showNotes);
    },
    setShowNotes(showNotes) { currentShow = showNotes; view.dispatch({ effects: setModel.of({ showNotes }) }); },
    setHover(hover) { view.dispatch({ effects: setModel.of({ hover }) }); },
    // light up code ranges for the length of an event
    flash(ranges, ms) {
      const keys = ranges.map((r) => `${r.start}-${r.end}`);
      keys.forEach((k, i) => {
        const cur = playing.get(k);
        playing.set(k, { from: ranges[i].start, to: ranges[i].end, n: (cur?.n || 0) + 1 });
      });
      view.dispatch({ effects: setPlaying.of(new Map(playing)) });
      const id = setTimeout(() => {
        timers.delete(id);
        keys.forEach((k) => {
          const cur = playing.get(k);
          if (!cur) return;
          if (cur.n <= 1) playing.delete(k); else cur.n--;
        });
        view.dispatch({ effects: setPlaying.of(new Map(playing)) });
      }, ms);
      timers.add(id);
    },
    clearFlashes() { timers.forEach(clearTimeout); timers.clear(); playing = new Map(); view.dispatch({ effects: setPlaying.of(playing) }); },
    get code() { return view.state.doc.toString(); },
  };
}
