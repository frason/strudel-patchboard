// The Effects rack: one tile per effect. Tap a tile's name to switch it on or off; drag across its bar for how much.
// Everything is also reachable from the keyboard: Tab to a tile (Space or Enter switches it), then Tab to its bar and use the arrow keys.
import { FX_TILES } from './modules.js';

const ICONS = {
  reverb: '<circle cx="14" cy="9" r="2.2"/><circle cx="14" cy="9" r="5.5" opacity=".7"/><circle cx="14" cy="9" r="8.5" opacity=".4"/>',
  delay: '<circle cx="4" cy="9" r="3.2"/><circle cx="11" cy="9" r="2.6" opacity=".8"/><circle cx="17" cy="9" r="2" opacity=".6"/><circle cx="22.5" cy="9" r="1.4" opacity=".4"/>',
  distort: '<path d="M1 9 L5 3 H9 L13 15 H17 L21 3 H25" fill="none"/>',
  phaser: '<path d="M3 15 V9 M8 15 V5 M13 15 V3 M18 15 V6 M23 15 V10" fill="none" stroke-linecap="round"/>',
  tremolo: '<path d="M1 9 Q4 2 7 9 T13 9 T18 9 T22 9 T25 9" fill="none" stroke-width="1.6"/><path d="M1 9 Q4 16 7 9 T13 9 T18 9" fill="none" opacity=".4"/>',
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clean = (v) => Number(v.toFixed(4));   // 1.4500000000000002 -> 1.45

export function buildFxRack(node, ctl, { store, hooks, h }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const set = (k, v) => { if (paramsOf()[k] !== v) hooks.setParam(node.id, k, v); };
  const tiles = FX_TILES.map((t) => {
    const log = !!t.log;
    const tOf = (v) => (log ? Math.log(v / t.min) / Math.log(t.max / t.min) : (v - t.min) / (t.max - t.min));       // value -> 0..1 along the bar
    const vOf = (f) => { const raw = log ? t.min * (t.max / t.min) ** f : t.min + f * (t.max - t.min); return clean(clamp(Math.round(raw / t.step) * t.step, t.min, t.max)); };
    const icon = h('span', { class: 'fx-icon' });
    icon.innerHTML = `<svg viewBox="0 0 26 18" width="26" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.4" aria-hidden="true">${ICONS[t.key]}</svg>`;
    const toggle = h('button', { class: 'fx-toggle', type: 'button', title: t.tip + '. Tap to switch on or off.', 'aria-pressed': 'false' }, icon, h('span', { class: 'fx-name' }, t.label));
    const fill = h('div', { class: 'fx-fill' }), val = h('span', { class: 'fx-val' });
    const bar = h('div', { class: 'fx-track', tabindex: '0', role: 'slider', 'aria-label': t.label + ' amount', 'aria-valuemin': String(t.min), 'aria-valuemax': String(t.max) }, fill, val);
    const el = h('div', { class: 'fx-tile', dataset: { key: t.key } }, toggle, bar);
    toggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    toggle.addEventListener('click', () => set(t.key + '_on', !paramsOf()[t.key + '_on']));
    toggle.addEventListener('keydown', (e) => e.stopPropagation());
    const fromPointer = (ev) => { const r = bar.getBoundingClientRect(); set(t.key, vOf(clamp((ev.clientX - r.left) / r.width, 0, 1))); if (!paramsOf()[t.key + '_on']) set(t.key + '_on', true); };
    bar.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      fromPointer(e);
      const move = (ev) => fromPointer(ev);
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
      bar.addEventListener('pointermove', move); bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', up);
    });
    bar.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const cur = paramsOf()[t.key], big = e.shiftKey ? 5 : 1;
      let next = e.key === 'Home' ? t.min : e.key === 'End' ? t.max : log ? cur * 1.07 ** (d * big) : cur + d * big * (t.max - t.min) / 50;
      next = clean(clamp(Math.round(next / t.step) * t.step, t.min, t.max));
      if (next === cur && d) next = clean(clamp(cur + d * t.step, t.min, t.max));
      set(t.key, next);
    });
    return { t, el, toggle, fill, val, bar, tOf };
  });
  const root = h('div', { class: 'fxrack', role: 'group', 'aria-label': 'effects' }, tiles.map((x) => x.el));
  ctl.fxrack = {
    draw(p) {
      for (const { t, el, toggle, fill, val, bar, tOf } of tiles) {
        const on = !!p[t.key + '_on'], v = p[t.key];
        el.classList.toggle('on', on);
        toggle.setAttribute('aria-pressed', String(on));
        fill.style.width = `${(clamp(tOf(v), 0, 1) * 100).toFixed(1)}%`;
        val.textContent = (t.step < 0.1 ? v.toFixed(2) : t.step < 1 ? v.toFixed(1) : String(v)) + (t.unit ? ' ' + t.unit : '');
        bar.setAttribute('aria-valuenow', String(v)); bar.setAttribute('aria-valuetext', `${val.textContent}, ${on ? 'on' : 'off'}`);
      }
    },
  };
  ctl.fxrack.draw(node.params);
  return root;
}
