// The Harmonics picture: 16 bars, one per harmonic. Press or drag across them to paint how loud each harmonic is.
// All the numbers are in HTML around the bars (never on top of them), and every bar also works from the keyboard.
import { HARM_COUNT, HARM_PRESETS } from './modules.js';

const NAMES = ['the note', 'octave', 'octave + fifth', '2 octaves', '+ major third', '+ fifth', '+ minor seventh', '3 octaves', '+ ninth', '+ major third', '+ tritone', '+ fifth', '+ sixth', '+ minor seventh', '+ major seventh', '4 octaves'];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r2 = (v) => Math.round(v * 100) / 100;

export function buildHarmonicsPic(node, ctl, { store, hooks, h }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const bars = h('div', { class: 'harm-bars', role: 'group', 'aria-label': 'How loud each harmonic is' });
  const cols = Array.from({ length: HARM_COUNT }, (_, i) => {
    const fill = h('i', { class: 'harm-fill' });
    const col = h('div', { class: 'harm-col', tabindex: 0, role: 'slider', 'aria-label': `Harmonic ${i + 1}, ${NAMES[i]}`, 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': 0 }, fill);
    col.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const d = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.25, PageDown: -0.25 }[e.key];
      if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setOne(i, e.key === 'End' ? 1 : 0); return; }
      if (d === undefined) return;
      e.preventDefault(); setOne(i, r2(clamp((Number(paramsOf().partials?.[i]) || 0) + d, 0, 1)));
    });
    col.addEventListener('focus', () => say(i));
    col.addEventListener('mouseenter', () => say(i));
    return { col, fill };
  });
  bars.append(...cols.map((c) => c.col));
  const nums = h('div', { class: 'harm-nums', 'aria-hidden': 'true' }, cols.map((_, i) => h('span', {}, String(i + 1))));
  const read = h('div', { class: 'harm-read' });
  let cur = 0;
  const say = (i) => { cur = i; const v = Number(paramsOf().partials?.[i]) || 0; read.textContent = `${i + 1} · ${NAMES[i]} · ${v.toFixed(2)}`; cols.forEach((c, k) => c.col.classList.toggle('on', k === i)); };
  const setAll = (arr) => hooks.setParam(node.id, 'partials', arr);
  const setOne = (i, v) => { const a = (paramsOf().partials || []).slice(); while (a.length < HARM_COUNT) a.push(0); a[i] = v; setAll(a); say(i); };

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
    const a = (paramsOf().partials || []).slice(); while (a.length < HARM_COUNT) a.push(0);
    const paint = (ev) => { const { i, v } = at(ev); if (a[i] !== v) { a[i] = v; setAll(a.slice()); } say(i); };
    paint(e);
    const up = () => { bars.removeEventListener('pointermove', paint); bars.removeEventListener('pointerup', up); bars.removeEventListener('pointercancel', up); };
    bars.addEventListener('pointermove', paint); bars.addEventListener('pointerup', up); bars.addEventListener('pointercancel', up);
  });

  const presets = h('div', { class: 'harm-presets', role: 'group', 'aria-label': 'Starting shapes' }, Object.entries(HARM_PRESETS).map(([k, pr]) => {
    const b = h('button', { type: 'button', class: 'btn sm', title: pr.tip }, pr.label);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => { setAll(pr.bars.slice()); say(cur); });
    return b;
  }));
  const draw = (p) => {
    const P = p || paramsOf();
    cols.forEach((c, i) => { const v = clamp(Number(P.partials?.[i]) || 0, 0, 1); c.fill.style.height = (v * 100).toFixed(1) + '%'; c.col.setAttribute('aria-valuenow', v.toFixed(2)); });
    say(cur);
  };
  ctl.harmonics = { draw };
  const wrap = h('div', { class: 'harmwrap' }, bars, nums, read, presets);
  draw(node.params);
  return wrap;
}
export const HARMPICS = { harmonics: buildHarmonicsPic };
