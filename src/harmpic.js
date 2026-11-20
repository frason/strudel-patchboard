// The Harmonics picture: 16 bars, one per harmonic. Press or drag across them to paint how loud each harmonic is.
// "Only some notes" switches to a second set of bars that are added only when one of the picked notes plays.
// All the numbers are in HTML around the bars (never on top of them), and every bar also works from the keyboard.
import { HARM_COUNT, HARM_PRESETS } from './modules.js';
import { audibleLimit } from './compile.js';

const NAMES = ['the note', 'octave', 'octave + fifth', '2 octaves', '+ major third', '+ fifth', '+ minor seventh', '3 octaves', '+ ninth', '+ major third', '+ tritone', '+ fifth', '+ sixth', '+ minor seventh', '+ major seventh', '4 octaves'];
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;

export function buildHarmonicsPic(node, ctl, { store, hooks, h }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const some = () => paramsOf().scope === 'some';   // which bars are in use: for all notes, or only for the picked notes
  const key = () => (some() ? 'accent' : 'partials');   // the bars being edited
  const getArr = (k) => { const a = (paramsOf()[k] || []).slice(0, HARM_COUNT); while (a.length < HARM_COUNT) a.push(0); return a; };

  const seg = h('div', { class: 'harm-seg', role: 'group', 'aria-label': 'Which notes the bars are for' });
  const bAll = h('button', { type: 'button', class: 'btn sm', title: 'These bars shape every note' }, 'All notes');
  const bSome = h('button', { type: 'button', class: 'btn sm', title: 'Extra harmonics added only when one of the picked notes plays' }, 'Only some notes');
  seg.append(bAll, bSome);
  for (const b of [bAll, bSome]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  bAll.addEventListener('click', () => { hooks.setParam(node.id, 'scope', 'all'); });
  bSome.addEventListener('click', () => {
    const P = paramsOf(), a = (P.accent || []);
    if (!a.some((v) => v > 0)) hooks.setParam(node.id, 'accent', getArr('partials'));   // start from the bars for all notes, so the picked notes are not left silent
    hooks.setParam(node.id, 'scope', 'some');
  });
  const keysRow = h('div', { class: 'harm-keys', role: 'group', 'aria-label': 'Which notes get the extra harmonics' });
  const keyBtns = PC.map((name, i) => {
    const b = h('button', { type: 'button', class: 'harm-key' + (name.includes('#') ? ' black' : ''), 'aria-pressed': 'false', title: `${name}, in every octave` }, name);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => { const a = (paramsOf().accentNotes || []).slice(0, 12); while (a.length < 12) a.push(false); a[i] = !a[i]; hooks.setParam(node.id, 'accentNotes', a); });
    return b;
  });
  keysRow.append(...keyBtns);
  const hint = h('div', { class: 'harm-hint' });

  const bars = h('div', { class: 'harm-bars', role: 'group', 'aria-label': 'How loud each harmonic is' });
  const cols = Array.from({ length: HARM_COUNT }, (_, i) => {
    const ghost = null, fill = h('i', { class: 'harm-fill' });
    const col = h('div', { class: 'harm-col', tabindex: 0, role: 'slider', 'aria-label': `Harmonic ${i + 1}, ${NAMES[i]}`, 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': 0 }, fill);
    col.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.25, PageDown: -0.25 }[e.key];
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setOne(i, e.key === 'End' ? 1 : 0); return; }
      if (d === undefined) return;
      e.preventDefault(); setOne(i, r2(clamp((Number(paramsOf()[key()]?.[i]) || 0) + d, 0, 1)));
    });
    col.addEventListener('focus', () => say(i));
    col.addEventListener('mouseenter', () => say(i));
    return { col, fill, ghost };
  });
  bars.append(...cols.map((c) => c.col));
  const nums = h('div', { class: 'harm-nums', 'aria-hidden': 'true' }, cols.map((_, i) => h('span', {}, String(i + 1))));
  const read = h('div', { class: 'harm-read' });
  let cur = 0;
  const picked = () => PC.filter((_, i) => (paramsOf().accentNotes || [])[i]);
  const say = (i) => {
    cur = i; const v = Number(paramsOf()[key()]?.[i]) || 0;
    read.textContent = some() ? `${i + 1} · ${NAMES[i]} · ${v.toFixed(2)} on ${picked().join(', ') || 'no notes picked yet'}` : `${i + 1} · ${NAMES[i]} · ${v.toFixed(2)}`;
    cols.forEach((c, k) => c.col.classList.toggle('on', k === i));
  };
  const setAll = (arr) => hooks.setParam(node.id, key(), arr);
  const setOne = (i, v) => { const a = getArr(key()); a[i] = v; setAll(a); say(i); };

  // pressing or dragging: the bar under the pointer takes the height of the pointer
  const at = (e) => {
    const r = bars.getBoundingClientRect();
    const i = clamp(Math.floor(((e.clientX - r.left) / r.width) * HARM_COUNT), 0, HARM_COUNT - 1);
    const v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
    return { i, v: v < 0.03 ? 0 : r2(v) };
  };
  bars.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    try { bars.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const a = getArr(key());
    const paint = (ev) => { const { i, v } = at(ev); if (a[i] !== v) { a[i] = v; setAll(a.slice()); } say(i); };
    paint(e);
    const up = () => { bars.removeEventListener('pointermove', paint); bars.removeEventListener('pointerup', up); bars.removeEventListener('pointercancel', up); };
    bars.addEventListener('pointermove', paint); bars.addEventListener('pointerup', up); bars.addEventListener('pointercancel', up);
  });

  const presets = h('div', { class: 'harm-presets', role: 'group', 'aria-label': 'Starting shapes' });
  const presetBtns = Object.entries(HARM_PRESETS).map(([, pr]) => {
    const b = h('button', { type: 'button', class: 'btn sm', title: pr.tip }, pr.label);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => { setAll(pr.bars.slice()); say(cur); });
    return b;
  });
  const clear = h('button', { type: 'button', class: 'btn sm ghost', title: 'Take every extra bar away' }, 'Clear');
  clear.addEventListener('pointerdown', (e) => e.stopPropagation());
  clear.addEventListener('click', () => { setAll(Array(HARM_COUNT).fill(0)); say(cur); });
  presets.append(...presetBtns, clear);

  const draw = (p) => {
    const P = p || paramsOf(), sm = some(), mine = P[key()] || [];
    bAll.classList.toggle('on', !sm); bSome.classList.toggle('on', sm);
    keysRow.hidden = !sm;
    bars.classList.toggle('some', sm);
    const pk = (P.accentNotes || []);
    keyBtns.forEach((b, i) => { b.classList.toggle('on', !!pk[i]); b.setAttribute('aria-pressed', pk[i] ? 'true' : 'false'); });
    hint.textContent = sm ? (pk.some(Boolean) ? 'Only the picked notes use these bars. Every other note plays the Instrument\'s own sound, unchanged.' : 'Pick the notes on the keyboard, then draw their bars.') : '';
    hint.hidden = !hint.textContent;
    {   // two things that make the bars seem to do nothing
      const extra = [];
      if (P.base !== 'user') extra.push('The wave setting is "filter the Instrument\'s wave": the bars multiply the harmonics the Instrument already has (a triangle has very few), so little changes. Choose "made from the bars" to hear exactly what you draw.');
      if (extra.length) hint.textContent = (hint.textContent ? hint.textContent + ' ' : '') + extra.join(' ');
    }
    const pickSet = new Set((P.accentNotes || []).map((v, i) => (v ? i : -1)).filter((i) => i >= 0)), lim = audibleLimit(store.graph, { id: node.id }, pickSet.size ? pickSet : null), mx = sm ? lim.maxHarmonicPicked : lim.maxHarmonic;
    const cutting = lim.cutoff < 20000 && mx < HARM_COUNT;
    if (cutting) hint.textContent = (hint.textContent ? hint.textContent + ' ' : '') + `The Instrument's filter cuts at ${Math.round(lim.cutoff)} Hz: bars above ${mx} (hatched) come out much quieter. Raise its lpf to hear them.`;
    hint.hidden = !hint.textContent;
    cols.forEach((c, i) => {
      c.col.classList.toggle('cut', cutting && i + 1 > mx);
      const v = clamp(Number(mine[i]) || 0, 0, 1);
      c.fill.style.height = (v * 100).toFixed(1) + '%'; c.col.setAttribute('aria-valuenow', v.toFixed(2));
    });
    say(cur);
  };
  ctl.harmonics = { draw };
  const wrap = h('div', { class: 'harmwrap' }, seg, keysRow, bars, nums, read, hint, presets);
  draw(node.params);
  return wrap;
}
export const HARMPICS = { harmonics: buildHarmonicsPic };

// The Note filter's picture: a little keyboard of the twelve notes. A picked note counts in every octave.
export function buildNoteFilterPic(node, ctl, { store, hooks, h }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const row = h('div', { class: 'harm-keys', role: 'group', 'aria-label': 'Which notes the filter is about' });
  const btns = PC.map((name, i) => {
    const b = h('button', { type: 'button', class: 'harm-key' + (name.includes('#') ? ' black' : ''), 'aria-pressed': 'false', title: `${name}, in every octave` }, name);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => { const a = (paramsOf().pcs || []).slice(0, 12); while (a.length < 12) a.push(false); a[i] = !a[i]; hooks.setParam(node.id, 'pcs', a); });
    return b;
  });
  row.append(...btns);
  const hint = h('div', { class: 'harm-hint' });
  const draw = (p) => {
    const P = p || paramsOf(), pk = P.pcs || [], names = PC.filter((_, i) => pk[i]);
    btns.forEach((b, i) => { b.classList.toggle('on', !!pk[i]); b.setAttribute('aria-pressed', pk[i] ? 'true' : 'false'); });
    hint.textContent = names.length ? (P.mode === 'except' ? `Everything except ${names.join(', ')} passes.` : `Only ${names.join(', ')} passes; every other note is silent.`) : 'Pick the notes on the keyboard.';
  };
  ctl.notefilter = { draw };
  const wrap = h('div', { class: 'harmwrap' }, row, hint);
  draw(node.params);
  return wrap;
}
export const NOTEFILTERPICS = { notefilter: buildNoteFilterPic };
