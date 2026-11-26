// The Grab window: pick a module, a starting cycle and a length; see what it plays there; add it to the board as a Take (notes) or a Strudel Code (pattern) module (sample hits).
// It reads with the same offline query as the x-ray (snapshot.js), so a grab is a replay of what the board's CURRENT code plays over those cycles, with the Slider values as they are now.
import { compileTap } from './compile.js';
import { queryEvents } from './snapshot.js';
import { grabFrom } from './grab.js';
import { drawTakeRoll } from './takepic.js';
import { MODULES } from './modules.js';

const LENGTHS = [1, 2, 4, 8, 16, 32, 64];
const SNAPS = [[24, 'as exact as possible'], [12, '16ths and triplets'], [4, '16ths'], [2, '8ths']];
export function openGrab({ h, showModal, closeModal, onClose, getGraph, nodeId, bake = false, isPlaying = () => false, nowCycle = () => 0, sliders = () => ({}), onAddTake, onAddHits }) {
  const g0 = getGraph(), node = g0.nodes.find((n) => n.id === nodeId), out = g0.nodes.find((n) => n.type === 'output');
  if (!node) return;
  const bpm = Number(out?.params.bpm) || 120, beats = Number(out?.params.beats) || 4;
  const start = h('input', { type: 'number', min: 0, step: 1, value: isPlaying() ? Math.floor(nowCycle()) : 0, 'aria-label': 'Start at cycle', style: 'width:5em' });
  const len = h('select', { 'aria-label': 'How many cycles' }, ...LENGTHS.map((n) => h('option', { value: n, selected: n === (bake ? 8 : 4) }, `${n} cycle${n === 1 ? '' : 's'}`)));
  const snap = h('select', { 'aria-label': 'Snap notes to' }, ...SNAPS.map(([v, t]) => h('option', { value: v, selected: v === 12 }, t)));
  const status = h('div', { class: 'imp-hint', 'aria-live': 'polite' }, 'Reading…'), report = h('div', { class: 'imp-hint' }), caveat = h('p', { class: 'imp-hint' }), canvas = h('canvas', { width: 640, height: 150, style: 'width:100%;max-width:640px;border-radius:6px' });
  const addTake = h('button', { class: 'btn', type: 'button', disabled: true }, bake ? 'Bake into a Take' : 'Add as a Take'), addHits = h('button', { class: 'btn', type: 'button', disabled: true }, 'Add as a hit pattern'), close = h('button', { class: 'btn', type: 'button' }, 'Close');
  let last = null, gen = 0, timer = 0, name = '';
  const read = async () => {
    const mine = ++gen; last = null; addTake.disabled = addHits.disabled = true; status.textContent = 'Reading…'; report.textContent = '';
    const from = Math.max(0, Math.floor(Number(start.value) || 0)), cycles = Number(len.value), tap = compileTap(getGraph(), nodeId);
    if (tap.error) { status.textContent = tap.error; return; }
    try {
      const rec = await queryEvents(tap.code, { from, to: from + cycles, kind: 'queried', context: { sliders: sliders() } });
      if (mine !== gen) return;
      const r = grabFrom(rec, { bpm, beatsPerBar: beats, grid: Number(snap.value) }); last = { r, rec };
      status.textContent = r.line + '.';
      const bits = [];
      const tr = r.takeReport;
      if (r.take.events.length) {
        if (tr.clipped) bits.push(`${tr.clipped} note${tr.clipped === 1 ? '' : 's'} cut at the edge of the span`);
        if (tr.detuned) bits.push(`${tr.detuned} pitch${tr.detuned === 1 ? '' : 'es'} rounded to a semitone`);
        if (tr.silent) bits.push(`${tr.silent} silent note${tr.silent === 1 ? '' : 's'} left out`);
        if (tr.emitted.changed || tr.emitted.extra) bits.push('some notes move when written on the grid');
        if (tr.controlsLost.length) bits.push(`a Take keeps pitch, timing and loudness only (not ${tr.controlsLost.slice(0, 6).join(', ')}${tr.controlsLost.length > 6 ? '…' : ''})`);
      }
      if (!r.hits.empty) { const hr = r.hits.report; bits.push(`hits keep the sound and the timing only${hr.gainLost ? ' (not their loudness)' : ''}${hr.snapped ? `; ${hr.snapped} moved onto a grid of ${hr.steps} per cycle` : ''}`); }
      report.textContent = bits.length ? 'Not kept or changed: ' + bits.join('; ') + '.' : '';
      addTake.disabled = !r.take.events.length; addHits.disabled = r.hits.empty;
      if (r.take.events.length) drawTakeRoll(canvas, r.take.events, beats); else { const c = canvas.getContext('2d'); c.fillStyle = '#0b0f13'; c.fillRect(0, 0, canvas.width, canvas.height); }
      canvas.style.display = r.take.events.length ? '' : 'none';
    } catch (e) { if (mine === gen) status.textContent = 'Could not read this: ' + String((e && e.message) || e).slice(0, 140); }
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(read, 250); };
  start.addEventListener('input', later); len.addEventListener('change', later); snap.addEventListener('change', later);
  addTake.addEventListener('click', () => { if (last && last.r.take.events.length) { onAddTake(last.r.take, Number(snap.value) === 24 ? 12 : Number(snap.value), `from ${MODULES[node.type].title}`, { bake }); close.click(); } });
  addHits.addEventListener('click', () => { if (last && !last.r.hits.empty) { onAddHits(last.r.hits.code, `from ${MODULES[node.type].title}`); close.click(); } });
  const row = (label, el) => h('label', { style: 'display:flex;gap:8px;align-items:center;margin:4px 0' }, h('span', { style: 'min-width:9em' }, label), el);
  const body = h('div', {},
    h('p', { class: 'imp-hint' }, bake ? `Freeze what ${MODULES[node.type].title} plays over these cycles into a Take. Whatever it feeds is plugged into the Take instead; ${MODULES[node.type].title} stays on the board, unconnected, so you can undo or bake again. The Take loops these cycles, so the random parts stop changing.` : `What comes out of ${MODULES[node.type].title}, copied into a module of its own that you can edit and keep.`),
    row('Start at cycle', start), row('Length', len), row('Snap notes to', snap),
    status, canvas, report,
    h('p', { class: 'imp-hint' }, 'This replays what the board plays now over those cycles: random and conditional modules give the same answer again, Sliders are read at their current values, and it is not a recording of what you heard. Master volume, Mixer and effects further along are not applied.'),
    caveat,
    h('div', { class: 'modal-btns' }, addTake, addHits, close));
  if (bake) addHits.style.display = 'none';
  showModal(`${bake ? 'Bake' : 'Grab from'} ${MODULES[node.type].title}`, body);
  onClose?.(() => { clearTimeout(timer); gen++; });   // a read still on its way is dropped when the window closes
  close.addEventListener('click', () => closeModal());
  if (isPlaying()) caveat.textContent = 'The music is playing: a long grab reads for a moment on the same thread as the player, so keep it short while you listen.';
  read();
  return { close: () => close.click() };
}
