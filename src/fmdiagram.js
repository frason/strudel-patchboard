// The FM picture. Two views of the same four operators (modulators 1 to 4 shake the note, or each other):
//   tune:    a chain, highest modulator on top. Slide a disc sideways for its harmonic (the faint lines are x0.25 ... x16),
//            up or down for its index (the arrow thickens). The blue arc on its left is the index, the orange arc on its right is feedback.
//   routes:  the four discs in a square. Drag from one disc to another (or to the note) to connect them; drag the dot on an arrow
//            up or down to change how hard it shakes (down to 0 removes it); tap a dot to remove it; tap a disc to switch its feedback on or off.
// Every handle also works from the keyboard (Tab to it, then the arrow keys), and a number grid under the routes picture does the same.
import { FM_PRESETS } from './modules.js';
const NS = 'http://www.w3.org/2000/svg';
const W = 240;
export const IDX = ['index', 'index2', 'index3', 'index4'];
export const HARM = ['harm', 'harm2', 'harm3', 'harm4'];
export const FB = ['fb1', 'fb2', 'fb3', 'fb4'];
// the parameter that holds "operator i shakes operator j" (j = 0 is the note you hear; i = j means feedback)
export const edgeKey = (i, j) => (i === j ? FB[i - 1] : i === j + 1 ? IDX[i - 1] : `r${i}${j}`);
const COLORS = { 1: '#7cc4ff', 2: '#c79bff', 3: '#5fd1b3', 4: '#ff8fb1' };
const el = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); kids.forEach((c) => e.append(c)); return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const snapH = (v) => { const s = v < 2 ? 0.25 : v < 4 ? 0.5 : 1; return clamp(Math.round(v / s) * s, 0.25, 16); };
const idx1 = (v) => clamp(Math.round(v * 10) / 10, 0, 16);
// Dragging a disc changes the index on a cubic curve: fine steps in the musical range (0 to 3), faster only past that. 125 pixels is the whole 0 to 16.
const dragIndex = (start, dy) => idx1(16 * clamp(Math.cbrt(Math.max(0, start) / 16) + dy * 0.008, 0, 1) ** 3);
const fb2 = (v) => clamp(Math.round(v * 100) / 100, 0, 1);

const viewMemory = new Map();   // which tab (tune or routes) each FM module was showing, so a redraw of the module does not flip it back
export function buildFmDiagram(node, ctl, { store, hooks, h, relayout }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const set = (k, v) => { if (paramsOf()[k] !== v) hooks.setParam(node.id, k, v); };
  const amt = (p, i, j) => +p[edgeKey(i, j)] || 0;
  const outOf = (p, i) => { let s = 0; for (let j = 0; j <= 4; j++) if (j !== i) s += amt(p, i, j); return s; };
  const mid = 'fmarr' + node.id;
  const defs = () => el('defs', {}, el('marker', { id: mid, viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, markerUnits: 'userSpaceOnUse', orient: 'auto' }, el('path', { d: 'M0 0L8 4L0 8z', class: 'fm-arrowhead' })));
  // one pointer drag: onMove gets the movement since the press (in picture units); onEnd says whether the pointer moved at all
  const drag = (svg, target, onMove, onEnd, onStart) => target.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const box = svg.getBoundingClientRect(), sx = W / box.width, x0 = e.clientX, y0 = e.clientY, start = { ...paramsOf() };
    let moved = false;
    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    onStart?.({ start, box, sx });
    const move = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 4) moved = true; onMove({ dx: (ev.clientX - x0) * sx, dy: (y0 - ev.clientY) * sx, x: (ev.clientX - box.left) * sx, y: (ev.clientY - box.top) * sx, start, moved }); };
    const up = (ev) => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); onEnd?.({ moved, start, x: (ev.clientX - box.left) * sx, y: (ev.clientY - box.top) * sx }); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  });
  // keyboard: Tab to a handle, arrow keys to change it (shift = bigger steps)
  const keys = (target, label, onKey) => {
    target.setAttribute('tabindex', '0'); target.setAttribute('role', 'slider'); target.setAttribute('aria-label', label);
    target.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const dir = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] }[e.key];
      if (!dir && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault(); onKey(dir || [0, 0], e.shiftKey, e.key);
    });
    target.addEventListener('pointerdown', () => target.blur?.(), { capture: true });
  };

  // ======================= tune view =======================
  const R = 19, X0 = 46, X1 = 190, CXN = 100, TOP = 52, ROWH = 66;
  const PX_OCT = (X1 - X0) / 6;
  const xOf = (hv) => X0 + PX_OCT * Math.log2(Math.max(0.25, hv) / 0.25);
  const GA = 1.0;
  const gp = (x, y, r, a) => `${(x + Math.cos(a) * r).toFixed(1)} ${(y + Math.sin(a) * r).toFixed(1)}`;
  const tune = (() => {
    const svg = el('svg', { class: 'fmdiagram', viewBox: `0 0 ${W} 214`, role: 'group', 'aria-label': 'FM operators, tuning view' });
    svg.append(defs());
    const hint = el('text', { class: 'fm-read', x: 6, y: 12 });
    const HINT = 'drag a disc: ↔ harmonic   ↕ index';
    const scaleG = el('g', { class: 'fm-scale' });
    const scaleLines = [0.25, 0.5, 1, 2, 4, 8, 16].map((v) => { const ln = el('line', { class: v === 1 ? 'one' : '', x1: xOf(v), x2: xOf(v) }), tx = el('text', { x: xOf(v), 'text-anchor': 'middle' }, '×' + v); scaleG.append(ln, tx); return { ln, tx }; });
    svg.append(hint, scaleG);
    const ops = [1, 2, 3, 4].map((i) => {
      const g = el('g', { class: `fm-op fm-m${i}`, style: `--c: ${COLORS[i]}` });
      const link = el('path', { class: 'fm-link', 'marker-end': `url(#${mid})` });
      const lab = el('text', { class: 'fm-idx' });
      const track = el('path', { class: 'fm-gtrack' }), fill = el('path', { class: 'fm-gfill' });
      const hit = el('path', { class: 'fm-archit' }, el('title', {}, 'Feedback: drag up to fill it, down to empty it'));
      const itrack = el('path', { class: 'fm-gtrack' }), ifill = el('path', { class: 'fm-gfill idx' });
      const ihit = el('path', { class: 'fm-archit' }, el('title', {}, 'Index: drag up to raise it, down to lower it'));
      const circ = el('circle', { class: 'fm-circle', r: R }, el('title', {}, 'Drag sideways for the harmonic, up or down for the index'));
      const wave = el('path', { class: 'fm-wave' });
      const txt = el('text', { class: 'fm-txt', 'text-anchor': 'middle' });
      g.append(link, lab, track, fill, hit, itrack, ifill, ihit, circ, wave, txt);
      svg.append(g);
      const o = { i, g, link, lab, track, fill, hit, itrack, ifill, ihit, circ, wave, txt };
      drag(svg, circ, ({ dx, dy, start }) => {
        set(HARM[i - 1], snapH(start[HARM[i - 1]] * 2 ** (dx / PX_OCT)));
        set(IDX[i - 1], idx1(start[IDX[i - 1]] + dy / 5));
        const p = paramsOf(); hint.textContent = `modulator ${i}: harmonic ×${p[HARM[i - 1]]} · index ${(+p[IDX[i - 1]]).toFixed(1)}`;
      }, ({ moved, start }) => { hint.textContent = HINT; if (!moved && !(outOf(start, i) > 0) && !(start[IDX[i - 1]] > 0)) set(IDX[i - 1], 4); });
      drag(svg, hit, ({ dy, start }) => { set(FB[i - 1], fb2(start[FB[i - 1]] + dy / 40)); hint.textContent = `feedback ${i}: ${paramsOf()[FB[i - 1]].toFixed(2)}`; }, () => { hint.textContent = HINT; });
      drag(svg, ihit, ({ dy, start }) => { set(IDX[i - 1], dragIndex(start[IDX[i - 1]], dy)); const v = +paramsOf()[IDX[i - 1]]; hint.textContent = `index ${i}: ${v.toFixed(1)}${v > 6 ? ' · very bright, harsh' : v > 3 ? ' · bright' : ''}`; }, ({ moved, start }) => { hint.textContent = HINT; if (!moved && !(start[IDX[i - 1]] > 0)) set(IDX[i - 1], 1.5); });
      keys(circ, `Modulator ${i}. Up and down change its index, left and right its harmonic`, ([dx, dy], shift) => {
        const p = paramsOf();
        if (dy) set(IDX[i - 1], idx1(p[IDX[i - 1]] + dy * (shift ? 2 : 0.5)));
        if (dx) { const v = p[HARM[i - 1]], s = v < 2 ? 0.25 : v < 4 ? 0.5 : 1; set(HARM[i - 1], clamp(v + dx * s * (shift ? 4 : 1), 0.25, 16)); }
      });
      keys(hit, `Feedback of modulator ${i}. Up and down change it`, ([, dy], shift, k) => set(FB[i - 1], fb2(k === 'Home' ? 0 : paramsOf()[FB[i - 1]] + dy * (shift ? 0.1 : 0.02))));
      keys(ihit, `Index of modulator ${i}. Up and down change it`, ([, dy], shift, k) => set(IDX[i - 1], idx1(k === 'Home' ? 0 : paramsOf()[IDX[i - 1]] + dy * (shift ? 2 : 0.5))));
      return o;
    });
    const pillG = el('g', { class: 'fm-op fm-car' }, el('rect', { class: 'fm-circle', x: CXN - 46, width: 92, height: 24, rx: 12 }), el('text', { class: 'fm-txt', x: CXN, 'text-anchor': 'middle' }, 'note you hear'));
    svg.append(pillG);
    const more = el('text', { class: 'fm-read', x: 6 });
    svg.append(more);
    let lastH = 0;
    const place = (o, x, y, to, index, harm, fb, ghost) => {
      const i = o.i;
      o.g.classList.toggle('ghost', ghost); o.g.classList.toggle('off', ghost);
      o.circ.setAttribute('cx', x); o.circ.setAttribute('cy', y);
      o.txt.setAttribute('x', x); o.txt.setAttribute('y', y + 4); o.txt.textContent = ghost ? '+' : '×' + harm;
      const pts = [];
      for (let k = 0; k <= 80; k++) pts.push(`${(x - 13 + (26 * k) / 80).toFixed(1)} ${(y - 8 - Math.sin((k / 80) * Math.PI * 2 * harm) * 3.5).toFixed(1)}`);
      o.wave.setAttribute('d', ghost ? '' : 'M' + pts.join('L'));
      const y0 = y + R + 1, y1 = to.y - (to.pill ? 13 : R + 2), my = (y0 + y1) / 2;
      o.link.setAttribute('d', `M${x} ${y0}C${x} ${my} ${to.x} ${my} ${to.x} ${y1}`);
      o.link.setAttribute('stroke-width', 1.2 + (index / 16) * 4.5);
      o.link.style.display = index > 0 ? '' : 'none';
      o.lab.setAttribute('x', (x + to.x) / 2 + 9); o.lab.setAttribute('y', my + 3); o.lab.textContent = index > 0 ? (+index).toFixed(1) : '';
      const gr = R + 9, rs = gp(x, y, gr, GA), re = gp(x, y, gr, -GA), ls = gp(x, y, gr, Math.PI - GA), le = gp(x, y, gr, Math.PI + GA);
      o.track.setAttribute('d', `M${rs}A${gr} ${gr} 0 0 0 ${re}`); o.hit.setAttribute('d', o.track.getAttribute('d'));
      o.fill.setAttribute('d', fb > 0 ? `M${rs}A${gr} ${gr} 0 0 0 ${gp(x, y, gr, GA - fb * 2 * GA)}` : '');
      o.itrack.setAttribute('d', `M${ls}A${gr} ${gr} 0 0 1 ${le}`); o.ihit.setAttribute('d', o.itrack.getAttribute('d'));
      o.ifill.setAttribute('d', index > 0 ? `M${ls}A${gr} ${gr} 0 0 1 ${gp(x, y, gr, Math.PI - GA + (index / 16) * 2 * GA)}` : '');
      o.track.style.display = o.fill.style.display = o.hit.style.display = ghost ? 'none' : '';
      o.circ.setAttribute('aria-label', `Modulator ${i}: harmonic ${harm}, index ${(+index).toFixed(1)}`);
      o.hit.setAttribute('aria-valuenow', fb); o.hit.setAttribute('aria-valuemin', 0); o.hit.setAttribute('aria-valuemax', 1);
      o.ihit.setAttribute('aria-valuenow', index); o.ihit.setAttribute('aria-valuemin', 0); o.ihit.setAttribute('aria-valuemax', 16);
      o.hit.style.display = ghost ? 'none' : ''; o.hit.toggleAttribute('hidden', ghost);
    };
    hint.textContent = HINT;
    return {
      svg,
      draw(p) {
        let hi = 0; for (let i = 1; i <= 4; i++) if (outOf(p, i) > 0) hi = i;
        const rows = Math.max(2, Math.min(4, hi + 1));
        const rowY = (i) => TOP + (rows - i) * ROWH, noteY = rowY(1) + 54, scaleY = noteY + 30, H = scaleY + 14;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        scaleLines.forEach(({ ln, tx }) => { ln.setAttribute('y1', 20); ln.setAttribute('y2', scaleY - 4); tx.setAttribute('y', scaleY + 8); });
        pillG.querySelector('rect').setAttribute('y', noteY - 12); pillG.querySelector('text').setAttribute('y', noteY + 4);
        ops.forEach((o) => {
          const i = o.i;
          o.g.style.display = i > rows ? 'none' : '';
          if (i > rows) return;
          const to = i === 1 ? { x: CXN, y: noteY, pill: true } : { x: xOf(p[HARM[i - 2]]), y: rowY(i - 1) };
          place(o, xOf(p[HARM[i - 1]]), rowY(i), to, p[IDX[i - 1]], p[HARM[i - 1]], p[FB[i - 1]], !(outOf(p, i) > 0));
        });
        const extra = Object.keys(p).filter((k) => /^r\d\d$/.test(k) && p[k] > 0).length;
        more.textContent = extra ? `+ ${extra} extra route${extra > 1 ? 's' : ''} (see routes)` : '';
        more.setAttribute('y', H - 1);
        if (H !== lastH) { lastH = H; relayout?.(); }
      },
    };
  })();

  // ======================= routes view =======================
  const POS = { 1: [62, 128], 2: [178, 128], 3: [178, 58], 4: [62, 58] }, NOTE = [120, 188], RH = 214;
  const routes = (() => {
    const svg = el('svg', { class: 'fmdiagram fmroutes', viewBox: `0 0 ${W} ${RH}`, role: 'group', 'aria-label': 'FM operators, routing view' });
    svg.append(defs());
    const hint = el('text', { class: 'fm-read', x: 6, y: 12 });
    const HINT = 'drag disc → disc to connect · tap = feedback';
    svg.append(hint);
    svg.append(el('g', { class: 'fm-op fm-car' }, el('rect', { class: 'fm-circle', x: NOTE[0] - 46, y: NOTE[1] - 12, width: 92, height: 24, rx: 12 }), el('text', { class: 'fm-txt', x: NOTE[0], y: NOTE[1] + 4, 'text-anchor': 'middle' }, 'note you hear')));
    const temp = el('line', { class: 'fm-temp' }); temp.style.display = 'none';
    // every possible arrow (16), drawn only while its amount is above zero
    const edges = {};
    for (let i = 1; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      if (i === j) continue;
      const g = el('g', { class: 'fm-edge', style: `--c: ${COLORS[i]}` });
      const path = el('path', { class: 'fm-link', 'marker-end': `url(#${mid})` });
      const dot = el('circle', { class: 'fm-eh', r: 6 }, el('title', {}, `Drag up or down to change how hard modulator ${i} shakes ${j ? 'modulator ' + j : 'the note'}. Tap to remove.`));
      const lab = el('text', { class: 'fm-idx', 'text-anchor': 'middle' });
      g.append(path, dot, lab); svg.append(g);
      edges[i + '-' + j] = { i, j, g, path, dot, lab };
      drag(svg, dot, ({ dy, start }) => { set(edgeKey(i, j), idx1(start[edgeKey(i, j)] + dy / 5)); hint.textContent = `modulator ${i} → ${j ? 'modulator ' + j : 'note'}: ${(+paramsOf()[edgeKey(i, j)]).toFixed(1)}`; },
        ({ moved }) => { hint.textContent = HINT; if (!moved) set(edgeKey(i, j), 0); });
      keys(dot, `Modulator ${i} into ${j ? 'modulator ' + j : 'the note'}. Up and down change it, Home removes it`, ([, dy], shift, k) => set(edgeKey(i, j), k === 'Home' ? 0 : idx1(paramsOf()[edgeKey(i, j)] + dy * (shift ? 2 : 0.5))));
    }
    const discs = [1, 2, 3, 4].map((i) => {
      const g = el('g', { class: `fm-op fm-m${i}`, style: `--c: ${COLORS[i]}` });
      const loop = el('path', { class: 'fm-loop' });
      const circ = el('circle', { class: 'fm-circle', r: R, cx: POS[i][0], cy: POS[i][1] }, el('title', {}, 'Drag to another disc or the note to connect. Tap for feedback on or off.'));
      const wave = el('path', { class: 'fm-wave' });
      const txt = el('text', { class: 'fm-txt', 'text-anchor': 'middle', x: POS[i][0], y: POS[i][1] + 4 });
      g.append(loop, circ, wave, txt); svg.append(g);
      drag(svg, circ, ({ x, y, moved }) => { if (!moved) return; temp.style.display = ''; temp.setAttribute('x1', POS[i][0]); temp.setAttribute('y1', POS[i][1]); temp.setAttribute('x2', x); temp.setAttribute('y2', y); temp.style.stroke = COLORS[i]; },
        ({ moved, x, y }) => {
          temp.style.display = 'none'; hint.textContent = HINT;
          if (!moved) { set(FB[i - 1], paramsOf()[FB[i - 1]] > 0 ? 0 : 0.15); return; }
          let to = null;
          for (let k = 1; k <= 4; k++) if (k !== i && Math.hypot(x - POS[k][0], y - POS[k][1]) < R + 10) to = k;
          if (to === null && Math.abs(x - NOTE[0]) < 52 && Math.abs(y - NOTE[1]) < 18) to = 0;
          if (to !== null && !(paramsOf()[edgeKey(i, to)] > 0)) set(edgeKey(i, to), 4);
        });
      keys(circ, `Operator ${i}. Enter or space turns its feedback on or off`, (_, __, k) => { if (k === 'Home') set(FB[i - 1], 0); });
      circ.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); set(FB[i - 1], paramsOf()[FB[i - 1]] > 0 ? 0 : 0.15); } });
      return { i, g, loop, circ, wave, txt };
    });
    svg.append(temp);
    hint.textContent = HINT;
    return {
      svg,
      draw(p) {
        for (const e of Object.values(edges)) {
          const a = amt(p, e.i, e.j), P0 = POS[e.i], P1 = e.j === 0 ? NOTE : POS[e.j];
          e.g.style.display = a > 0 ? '' : 'none';
          if (!(a > 0)) { e.dot.setAttribute('tabindex', '-1'); continue; }
          e.dot.setAttribute('tabindex', '0');
          const dx = P1[0] - P0[0], dy = P1[1] - P0[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
          const endR = e.j === 0 ? 15 : R + 3;
          const s = [P0[0] + ux * (R + 1), P0[1] + uy * (R + 1)], t = [P1[0] - ux * endR, P1[1] - uy * endR];
          const c = [(s[0] + t[0]) / 2 - uy * 16, (s[1] + t[1]) / 2 + ux * 16];
          e.path.setAttribute('d', `M${s[0].toFixed(1)} ${s[1].toFixed(1)}Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${t[0].toFixed(1)} ${t[1].toFixed(1)}`);
          e.path.setAttribute('stroke-width', 1.2 + (a / 16) * 4.5);
          const mx = 0.25 * s[0] + 0.5 * c[0] + 0.25 * t[0], my = 0.25 * s[1] + 0.5 * c[1] + 0.25 * t[1];
          e.dot.setAttribute('cx', mx.toFixed(1)); e.dot.setAttribute('cy', my.toFixed(1));
          e.lab.setAttribute('x', mx.toFixed(1)); e.lab.setAttribute('y', (my - 9).toFixed(1)); e.lab.textContent = a.toFixed(1);
          e.dot.setAttribute('aria-valuenow', a); e.dot.setAttribute('aria-valuemin', 0); e.dot.setAttribute('aria-valuemax', 16);
        }
        for (const d of discs) {
          const i = d.i, [x, y] = POS[i], hv = p[HARM[i - 1]], active = outOf(p, i) > 0 || amt(p, 1, i) > 0 || [1, 2, 3, 4].some((k) => k !== i && amt(p, k, i) > 0);
          d.g.classList.toggle('off', !active);
          d.txt.textContent = `${i} ×${hv}`;
          const pts = [];
          for (let k = 0; k <= 60; k++) pts.push(`${(x - 12 + (24 * k) / 60).toFixed(1)} ${(y - 8 - Math.sin((k / 60) * Math.PI * 2 * hv) * 3).toFixed(1)}`);
          d.wave.setAttribute('d', 'M' + pts.join('L'));
          const fbv = p[FB[i - 1]], dir = x < 120 ? -1 : 1, lx = x + dir * (R + 4), ly = y + (y < 90 ? -8 : 8), lr = 9;
          d.loop.setAttribute('d', `M${lx} ${ly - lr}A${lr} ${lr} 0 1 ${dir < 0 ? 0 : 1} ${lx} ${ly + lr}A${lr} ${lr} 0 1 ${dir < 0 ? 0 : 1} ${lx} ${ly - lr}`);
          d.loop.setAttribute('stroke-width', fbv > 0 ? 1 + fbv * 6 : 1); d.loop.classList.toggle('none', !(fbv > 0));
          d.circ.setAttribute('aria-label', `Operator ${i}, harmonic ${hv}, feedback ${fbv > 0 ? fbv.toFixed(2) : 'off'}`);
        }
      },
    };
  })();

  // ======================= number grid (precise, keyboard and touch friendly) =======================
  const grid = (() => {
    const wrap = h('details', { class: 'fm-grid' }, h('summary', {}, 'number grid'));
    const table = h('div', { class: 'fm-gridtable' });
    const cells = {};
    const head = h('div', { class: 'fm-gr head' }, h('span', {}, 'from ↓  into →'), ...[0, 1, 2, 3, 4].map((j) => h('span', {}, j ? 'op ' + j : 'note')));
    table.append(head);
    for (let i = 1; i <= 4; i++) {
      const row = h('div', { class: 'fm-gr' }, h('span', { style: `color:${COLORS[i]}` }, 'op ' + i));
      for (let j = 0; j <= 4; j++) {
        const k = edgeKey(i, j), self = i === j;
        const inp = h('input', { class: 'txt num', type: 'number', min: 0, max: self ? 1 : 16, step: self ? 0.05 : 0.5, 'aria-label': `operator ${i} ${self ? 'feedback' : 'into ' + (j ? 'operator ' + j : 'the note')}` });
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        inp.addEventListener('change', () => { if (inp.value !== '') set(k, clamp(Number(inp.value), 0, self ? 1 : 16)); });
        cells[k] = inp; row.append(inp);
      }
      table.append(row);
    }
    wrap.append(table);
    return { el: wrap, draw(p) { for (const [k, inp] of Object.entries(cells)) if (document.activeElement !== inp) inp.value = p[k] ?? 0; } };
  })();

  // ======================= tabs =======================
  let view = viewMemory.get(node.id) || 'tune';
  const tabs = h('div', { class: 'fm-tabs', role: 'tablist' },
    ...[['tune', 'tune'], ['routes', 'routes']].map(([v, label]) => h('button', { class: 'fm-tab' + (v === view ? ' on' : ''), role: 'tab', 'aria-selected': String(v === view), dataset: { v }, onclick: () => show(v) }, label)));
  tabs.addEventListener('pointerdown', (e) => e.stopPropagation());
  // presets: pick one and every FM knob is set to it (all the others go back to their defaults first)
  const pick = h('select', { class: 'sel fm-presets', 'aria-label': 'FM preset', title: 'Load a ready-made FM sound. It replaces the FM settings; the Instrument above keeps its own.' },
    h('option', { value: '' }, 'Presets: pick a sound…'), ...FM_PRESETS.map((pr) => h('option', { value: pr.id, title: pr.tip }, pr.label)));
  pick.addEventListener('pointerdown', (e) => e.stopPropagation());
  pick.addEventListener('keydown', (e) => e.stopPropagation());
  pick.addEventListener('change', () => { if (pick.value) hooks.applyFmPreset(node.id, pick.value); pick.value = ''; });
  const legendTune = h('div', { class: 'fm-legend' }, 'Each disc is one modulator, the wave that shakes the one below it (or the note you hear at the bottom). ',
    h('b', {}, 'Slide sideways'), ' for its pitch (harmonic): whole numbers sound musical, in-between ones sound like bells. ',
    h('b', {}, 'Slide up or down'), ' for how hard it shakes (index). A dashed disc is off. The orange arc is feedback: the disc shaking itself.');
  const legendRoutes = h('div', { class: 'fm-legend' }, 'An arrow means “this disc shakes that one”. The number on it, and the dot you drag up or down, is how hard (0 removes it). ',
    'Drag from a disc onto another disc, or onto “note you hear”, to add an arrow. The ', h('b', { style: 'color:#ffb454' }, 'orange ring'),
    ' on a disc is its feedback: it shakes itself. Tap a disc to switch it on or off. A dashed disc has nothing connected, so it is not in the sound.');
  const wrap = h('div', { class: 'fmwrap' }, pick, tabs, tune.svg, routes.svg, grid.el, legendTune, legendRoutes);
  function show(v) {
    view = v; viewMemory.set(node.id, v);
    tune.svg.style.display = v === 'tune' ? '' : 'none';
    routes.svg.style.display = v === 'routes' ? '' : 'none';
    grid.el.style.display = v === 'routes' ? '' : 'none';
    legendTune.style.display = v === 'tune' ? '' : 'none'; legendRoutes.style.display = v === 'routes' ? '' : 'none';
    tabs.querySelectorAll('.fm-tab').forEach((b) => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    relayout?.();
  }
  show(view);
  ctl.fmdiagram = { draw(p) { tune.draw(p); routes.draw(p); grid.draw(p); } };
  ctl.fmdiagram.draw(node.params);
  return wrap;
}
