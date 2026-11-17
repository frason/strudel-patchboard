// The Pulse width picture: just the wave, animated. The knobs below it do the work and the wave shows what they mean.
// Two cycles of the pulse wave (purple). The width knob sets how wide each pulse is; with sweep depth above 0 the pulse edge swings
// in and out at the sweep speed (shown no faster than 2 swings a second, so it never flickers). Nothing here takes a click or a key.
import { animate, put } from './anim.js';
const NS = 'http://www.w3.org/2000/svg';
const W = 240, H = 90;
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const X0 = 16, X1 = 224, CYC = (X1 - X0) / 2;   // two cycles across
const HI = 20, LO = 68;                          // the wave's two levels

export function buildPulseDiagram(node, ctl, { store, h }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const svg = el('svg', { class: 'pulsepic', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Animation of the pulse wave: its width, and how the width swings' });
  const axis = el('line', { class: 'pp-axis', x1: X0, x2: X1, y1: (HI + LO) / 2, y2: (HI + LO) / 2 });
  const glow = el('path', { class: 'pp-wave pp-glow', fill: 'none' });
  const wave = el('path', { class: 'pp-wave', fill: 'none' });
  svg.append(axis, glow, wave);

  // high for `w` of each cycle, then low
  const pathFor = (w) => {
    let d = '';
    for (let c = 0; c < 2; c++) {
      const a = X0 + c * CYC, b = a + CYC * w, e = a + CYC;
      d += `${c ? 'L' : 'M'}${a} ${LO} L${a} ${HI} L${b} ${HI} L${b} ${LO} L${e} ${LO} `;
    }
    return d;
  };
  let P = paramsOf();
  const sweeping = () => P.depth > 0 && !svg.closest('.no-anim');
  const paint = (phase) => {
    const w = clamp(P.width, 0.05, 0.95), d = clamp(P.depth, 0, 0.45);
    const now = clamp(w + (sweeping() ? d * Math.sin(phase) : 0), 0.02, 0.98);
    const dd = pathFor(now); put(wave, 'd', dd); put(glow, 'd', dd);
  };

  // runs on the shared clock, only while the picture is on screen; with sweep depth 0 there is nothing to move, so it stops until a knob changes
  let phase = 0;
  const anim = animate(svg, (now, dt, off) => {
    if (off || !(P.depth > 0)) { paint(0); return off ? undefined : false; }
    phase += 2 * Math.PI * Math.min(P.rate, 2) * dt;
    paint(phase);
  }, { fps: 30 });
  const draw = (p) => { P = p || paramsOf(); paint(phase); anim.kick(); };
  ctl.pulsepic = { draw };
  const wrap = h('div', { class: 'pulsewrap' }, svg);
  draw(node.params);
  return wrap;
}
