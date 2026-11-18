// The FM picture: every operator in the sound is a labelled horizontal bar, the note you hear is the bottom one, and one line (the real wave, in each shaker's colour)
// threads down through all of them, pinched at each bar. It is all something you can grab:
//   a ring on a bar's end: that shaker's pitch (its harmonic, longer = higher). A ring on an arm's elbow: how hard it shakes (its index, wider = harder).
//   the orange ring on a bar: its feedback. Tap a bar (or a number) to pick the shaker whose envelope shows underneath: drag the first dot for the attack,
//   the second for the decay and sustain. A dot shows where the note is now. Each handle shows its value while you drag it.
import { animate, put, putStyle, putText } from './anim.js';
import { fmStructure, fmEnv, fmHold, fmSignals } from './fmsignals.js';
import { fmLinkKey, OWAVE, FM_WAVE_NAMES, fmWaveFn } from './modules.js';
const NS = 'http://www.w3.org/2000/svg';
const W = 240, H = 272, CX = 120;
const TOP = 18, STEP = 30, AMP = 24;                                // bars view: the first bar, the gap between bars (the wave under the note bar is one gap long too), how far the wave swings
const ENV_X0 = 12, ENV_X1 = 228, ENV_Y0 = 216, ENV_Y1 = 262, TMAX = 4;  // envelope strip (time runs on a square-root scale so short attacks are easy to set)
// the same colours as the routes and tune views: one per shaker, green for the note you hear
const COLORS = { 1: '#7cc4ff', 2: '#c79bff', 3: '#5fd1b3', 4: '#ff8fb1' }, NOTE_COLOR = '#8bd49c';
const colorOf = (op) => (op ? COLORS[op] : NOTE_COLOR);
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const snapH = (v) => { const s = v < 2 ? 0.25 : v < 4 ? 0.5 : 1; return clamp(Math.round(v / s) * s, 0.25, 16); };
const harmKey = (op) => (op === 1 ? 'harm' : 'harm' + op), sfx = (op) => (op === 1 ? '' : String(op));
const halfLen = (harm) => clamp(26 + 6 * Math.log2(Math.max(0.25, harm)), 8, 50);   // bars stay inside x 70 to 170, so the left edge is free for the numbers
const harmOfLen = (len) => 2 ** ((len - 26) / 6);
const bulgeOf = (idx) => 12 + 1.2 * clamp(idx, 0, 16);   // arms reach at most x 205, so the right edge is free for the numbers
const tX = (t) => ENV_X0 + (ENV_X1 - ENV_X0) * Math.sqrt(clamp(t, 0, TMAX) / TMAX);
const xT = (x) => TMAX * clamp((x - ENV_X0) / (ENV_X1 - ENV_X0), 0, 1) ** 2;
const vY = (v) => ENV_Y1 - clamp(v, 0, 1) * (ENV_Y1 - ENV_Y0);

export function buildFmPicture(node, ctl, { store, hooks, h, relayout }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const set = (k, v) => { if (paramsOf()[k] !== v) hooks.setParam(node.id, k, v); };
  const svg = el('svg', { class: 'fmpic', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'FM picture: operators as bars, or the finished sound as turning wheels, and the envelope of one operator' });
  let P = paramsOf(), S = fmStructure(P), ys = [], sel = 1, noteT = 0, hold = 2, phase = 0, last = 0, raf = 0, sig = '';
  const animated = () => !svg.closest('.no-anim');
  const envOf = (op) => (animated() && op ? fmEnv(P, op, noteT, hold) : 1);

  // one pointer drag; onMove gets x and y in picture units
  const drag = (target, onDown, onMove) => target.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const box = svg.getBoundingClientRect(), s = W / box.width, x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    onDown?.({ x: (e.clientX - box.left) * s, y: (e.clientY - box.top) * s + vbY });
    const move = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 3) moved = true; if (moved) onMove((ev.clientX - box.left) * s, (ev.clientY - box.top) * s + vbY); };
    const up = () => { say(''); target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  });

  // ================= bars =================
  let active = '';   // which number is being dragged now (it is lit in the row under the picture)
  const say = (k) => { if (k !== active) { active = k; paintChips(); } };
  const barsG = el('g'), axis = el('line', { class: 'fp-axis', x1: CX, x2: CX, y1: 6, y2: 150 });
  const armG = el('g'), barG = el('g'), waveG = el('g'), handG = el('g');
  let segRefs = [];
  barsG.append(axis, armG, barG, waveG, handG);
  let rowRefs = {}, linkRefs = [], envDy = 0, lastH = 0, paintWaves = () => {}, legendEl = null;
  let isBars = true, vbY = 0, lastHn = 272;
  const rebuild = () => {
    S = fmStructure(P);
    const n = S.rows.length;
    ys = S.rows.map((_, r) => TOP + STEP * (n === 1 ? 1 : r));
    const bottom = ys[n - 1] + STEP + 4, Hn = bottom + 62;   // the picture is only as tall as its rows; the envelope strip sits right under it
    axis.setAttribute('y2', bottom); envDy = bottom - 208; envG.setAttribute('transform', `translate(0 ${envDy})`); lastHn = Hn; applyView();
    if (Hn !== lastH) { lastH = Hn; relayout?.(); }
    armG.replaceChildren(); barG.replaceChildren(); handG.replaceChildren(); waveG.replaceChildren(); rowRefs = {}; linkRefs = []; segRefs = [];
    S.rows.forEach((op, r) => {   // one piece of the wave per bar, in that shaker's colour (the last piece, below the note bar, is the note's own wave)
      const glow = el('path', { class: 'fp-wave fp-glow', fill: 'none' }), wave = el('path', { class: 'fp-wave', fill: 'none' }), fbw = el('path', { class: 'fp-wave fp-fbwave', fill: 'none' });
      const c = colorOf(r < n - 1 ? op : 0); glow.style.setProperty('--c', c); wave.style.setProperty('--c', c);
      waveG.append(fbw, glow, wave); segRefs.push({ glow, wave, fbw, op: r < n - 1 ? op : 0 });
    });
    S.rows.forEach((op, r) => {
      const line = el('line', { class: 'fp-bar' + (op === 0 ? ' fp-note' : ''), y1: ys[r], y2: ys[r] });
      const hit = op ? el('line', { class: 'fp-hit', y1: ys[r], y2: ys[r] }) : null;   // the note bar has no handles: it is just where everything ends up
      const rings = op ? [-1, 1].map(() => el('circle', { class: 'fp-ring fp-grab', r: 4 })) : [];
      const fb = op ? el('circle', { class: 'fp-fb', cy: ys[r], cx: CX }) : null, fbg = op ? el('circle', { class: 'fp-fbhit fp-grab', cy: ys[r], cx: CX }) : null;
      barG.append(line); handG.append(...(hit ? [hit] : []), ...rings, ...(fb ? [fb, fbg] : []));
      const lab = el('text', { class: 'fp-lab', x: 3, y: ys[r] + 3 }), fbl = op ? el('text', { class: 'fp-lab fp-orange', x: 3, y: ys[r] + 14 }) : null;   // left edge: pitch, and feedback under it
      for (const x of [line, lab, ...rings]) x.style.setProperty('--c', colorOf(op));
      if (op) {   // drag a number sideways: pitch and feedback at the left edge
        const ph = el('rect', { class: 'fp-scrub', x: 0, y: ys[r] - 7, width: 58, height: 14 }), fh = el('rect', { class: 'fp-scrub', x: 0, y: ys[r] + 7, width: 58, height: 13 });
        handG.append(ph, fh);
        let sp = null, sf = null;
        drag(ph, ({ x }) => { sel = op; setSel(); sp = { x0: x, L0: halfLen(harmOf(op)) }; }, (x) => { set(harmKey(op), snapH(harmOfLen(sp.L0 + (x - sp.x0) * 0.5))); say('pitch'); });
        drag(fh, ({ x }) => { sel = op; setSel(); sf = { x0: x, f0: clamp(Number(P['fb' + op]) || 0, 0, 1) }; }, (x) => { set('fb' + op, Math.round(clamp(sf.f0 + (x - sf.x0) / 60, 0, 1) * 100) / 100); say('fb'); });
      }
      handG.append(lab, ...(fbl ? [fbl] : []));
      rowRefs[op] = { line, hit, rings, fb, fbg, fbl, lab, y: ys[r] };
      if (op) {
        drag(hit, () => { sel = op; setSel(); }, () => {});
        // every drag moves relative to where you took hold, so grabbing a ring a little off-centre never makes it jump
        let st = null;
        rings.forEach((ring, k) => drag(ring, ({ x }) => { sel = op; setSel(); st = { x0: x, L0: halfLen(harmOf(op)) }; }, (x) => { const v = snapH(harmOfLen(st.L0 + (k ? 1 : -1) * (x - st.x0))); set(harmKey(op), v); say('pitch'); }));
        drag(fbg, ({ x }) => { sel = op; setSel(); st = { x0: x, f0: clamp(Number(P['fb' + op]) || 0, 0, 1) }; }, (x) => { const v = Math.round(clamp(st.f0 + (Math.abs(x - CX) - Math.abs(st.x0 - CX)) / 8, 0, 1) * 100) / 100; set('fb' + op, v); say('fb'); });
      }
    });
    S.rows.forEach((op, r) => {
      if (!op) return;
      for (const [, j] of S.out(op)) {
        const r2 = S.rows.indexOf(j); if (r2 < 0) continue;
        const key = fmLinkKey(op, j);
        const left = el('polyline', { class: 'fp-arm', fill: 'none' }), right = el('polyline', { class: 'fp-arm', fill: 'none' });
        const handle = el('circle', { class: 'fp-ring fp-grab', r: 4.5 }), ilab = el('text', { class: 'fp-lab fp-mid', x: W - 3, 'text-anchor': 'end' });   // right edge: how hard it shakes
        for (const x of [left, right, handle, ilab]) x.style.setProperty('--c', colorOf(op));
        const ih = el('rect', { class: 'fp-scrub', x: W - 34, y: (ys[r] + ys[r2]) / 2 - 8, width: 34, height: 15 });   // drag the number at the right edge sideways
        armG.append(left, right); handG.append(ih, handle, ilab);
        let si = null;
        drag(ih, ({ x }) => { sel = op; setSel(); si = { x0: x, i0: Number(P[key]) || 0 }; }, (x) => { set(key, Math.round(clamp(si.i0 + (x - si.x0) / 3, 0.1, 16) * 10) / 10); say('i' + j); });
        linkRefs.push({ op, j, r, r2, key, left, right, handle, ilab });
        let ist = null;
        drag(handle, ({ x }) => { sel = op; setSel(); ist = { x0: x, i0: Number(P[key]) || 0 }; }, (x) => { const v = Math.round(clamp(ist.i0 + (x - ist.x0) / 1.6, 0.1, 16) * 10) / 10;   // never below 0.1 here: a route is only removed in the routes tab, so a slip can't drop it
           set(key, v); say('i' + j); });
      }
    });
  };
  const harmOf = (op) => Number(P[harmKey(op)]) || 1;
  const placeBars = () => {
    for (const op of S.rows) {
      const R = rowRefs[op], L = halfLen(op ? harmOf(op) : 1), e = envOf(op);
      put(R.line, 'x1', CX - L); put(R.line, 'x2', CX + L); if (R.hit) { put(R.hit, 'x1', CX - L); put(R.hit, 'x2', CX + L); }
      putStyle(R.line, 'opacity', String((op === sel || !op ? 0.3 : 0.18) + 0.7 * e * (op === sel || !op ? 1 : 0.6))); putStyle(R.line, 'strokeWidth', String(op ? 1.2 + 2 * e + (op === sel ? 0.8 : 0) : 2.6));
      putText(R.lab, op ? `${op} ×${harmOf(op)}` : 'note'); R.lab.classList.toggle('fp-faint', !!op && op !== sel); R.lab.classList.toggle('fp-on', op === sel && active === 'pitch');
      R.rings.forEach((ring, k) => { put(ring, 'cx', CX + (k ? 1 : -1) * L); put(ring, 'cy', R.y); ring.classList.toggle('fp-sel', op === sel); });
      if (R.fb) { const fb = clamp(Number(P['fb' + op]) || 0, 0, 1); put(R.fb, 'r', 7 + 8 * fb); put(R.fbg, 'r', 7 + 8 * fb); R.fb.classList.toggle('fp-zero', fb === 0); putText(R.fbl, `fb ${fb}`); R.fbl.classList.toggle('fp-faint', op !== sel || fb === 0); R.fbl.classList.toggle('fp-on', op === sel && active === 'fb'); }
    }
    for (const k of linkRefs) {
      const idx = Number(P[k.key]) || 0, L1 = halfLen(harmOf(k.op)), L2 = halfLen(k.j === 0 ? 1 : harmOf(k.j)), y1 = ys[k.r], y2 = ys[k.r2], bulge = bulgeOf(idx), ym = (y1 + y2) / 2, Lm = Math.max(L1, L2);
      put(k.left, 'points', `${CX - L1},${y1} ${CX - Lm - bulge},${ym} ${CX - L2},${y2}`);
      put(k.right, 'points', `${CX + L1},${y1} ${CX + Lm + bulge},${ym} ${CX + L2},${y2}`);
      put(k.handle, 'cx', CX + Lm + bulge); put(k.handle, 'cy', ym);
      putText(k.ilab, idx.toFixed(1)); put(k.ilab, 'y', ym + 3); k.ilab.classList.toggle('fp-faint', k.op !== sel); k.ilab.classList.toggle('fp-on', k.op === sel && active === 'i' + k.j);
      putStyle(k.left, 'display', k.right.style.display = k.handle.style.display = k.ilab.style.display = idx > 0 ? '' : 'none');
    }
  };
  const paintBars = () => {
    const n = S.rows.length, sim = fmSignals(P, S, envOf, phase * 0.12, 192, 1, 'sine');
    const seg = (y0, y1, samples, tail, wide = 1) => {
      const m = samples.length; let d = '';
      for (let k = 0; k < m; k++) { const u = k / (m - 1), pinch = tail ? Math.min(1, u / 0.12) ** 0.6 : Math.sin(Math.PI * u) ** 0.6; d += (k ? 'L' : 'M') + (CX + AMP * wide * pinch * samples[k]).toFixed(1) + ' ' + (y0 + ((y1 - y0) * k) / (m - 1)).toFixed(1) + ' '; }
      return d;
    };
    for (let r = 0; r < n; r++) {
      // under a shaker is what it sends down: its wave times how hard it shakes (index, with the envelope), so a bigger index is a wider wave
      let wide = 1;
      if (r < n - 1) { const op = S.rows[r], sent = S.out(op).reduce((t, o) => t + o[2], 0); wide = clamp(0.15 + (sent * envOf(op)) / 3, 0.15, 1.5); }
      const d = r < n - 1 ? seg(ys[r], ys[r + 1], sim.ops[S.rows[r]] || sim.note, false, wide) : seg(ys[n - 1], ys[n - 1] + STEP, sim.note, true);
      put(segRefs[r].wave, 'd', d); put(segRefs[r].glow, 'd', d);
      const fbAmt = segRefs[r].op ? clamp(Number(P['fb' + segRefs[r].op]) || 0, 0, 1) : 0;   // feedback shows as an orange glow behind that shaker's wave, thicker the more it shakes itself
      put(segRefs[r].fbw, 'd', fbAmt > 0 ? d : ''); putStyle(segRefs[r].fbw, 'opacity', String(fbAmt > 0 ? Math.min(0.85, 0.2 + fbAmt) : 0)); putStyle(segRefs[r].fbw, 'strokeWidth', String(3 + 7 * fbAmt));
    }
    placeBars();
  };

  // ================= envelope strip =================
  const envG = el('g');
  const envArea = el('path', { class: 'fp-envfill' }), envLine = el('path', { class: 'fp-envline', fill: 'none' }), holdLine = el('line', { class: 'fp-axis', y1: ENV_Y0 - 4, y2: ENV_Y1 }), play = el('circle', { class: 'fp-tip', r: 3 });
  const base = el('line', { class: 'fp-axis', x1: ENV_X0, x2: ENV_X1, y1: ENV_Y1, y2: ENV_Y1 });
  const hA = el('circle', { class: 'fp-ring fp-grab', r: 5 }), hD = el('circle', { class: 'fp-ring fp-grab', r: 5 });
  envG.append(base, envArea, envLine, holdLine, play, hA, hD);
  const envVals = () => {
    const k = sfx(sel);
    return { a: Math.max(0, Number(P['attack' + k]) || 0), d: Math.max(0.01, Number(P['decay' + k] ?? (sel === 1 ? 0.4 : 0.2))), s: clamp(Number(P['sustain' + k] ?? (sel === 1 ? 0.4 : 1)), 0, 1) };
  };
  drag(hA, null, (x) => { const v = Math.round(clamp(xT(x), 0, 2) * 1000) / 1000; set('attack' + sfx(sel), v); say('env'); });
  drag(hD, null, (x, y) => {
    const v = envVals(), k = sfx(sel);
    set('decay' + k, Math.round(clamp(xT(x) - v.a, 0.01, 2) * 100) / 100);
    const sv = Math.round(clamp((ENV_Y1 - (y - envDy)) / (ENV_Y1 - ENV_Y0), 0, 1) * 100) / 100; set('sustain' + k, sv);
    say('env');
  });
  const paintEnv = () => {
    envG.style.setProperty('--c', colorOf(sel)); paintWaves();
    const v = envVals(), ta = v.a, td = v.a + v.d, hd = clamp(hold, td + 0.2, TMAX);
    const pts = [[0, 0], [ta, 1], [td, v.s], [hd, v.s], [hd + 0.2, 0]];
    const d = 'M' + pts.map(([t, e]) => `${tX(t).toFixed(1)} ${vY(e).toFixed(1)}`).join('L');
    put(envLine, 'd', d); put(envArea, 'd', d + `L${tX(0)} ${ENV_Y1}Z`);
    put(hA, 'cx', tX(ta)); put(hA, 'cy', vY(1)); put(hD, 'cx', tX(td)); put(hD, 'cy', vY(v.s));
    put(holdLine, 'x1', tX(hd)); put(holdLine, 'x2', tX(hd));
    const e = animated() ? fmEnv(P, sel, noteT, hold) : v.s;
    put(play, 'cx', tX(animated() ? noteT : td)); put(play, 'cy', vY(e));
    const rd = `attack ${v.a.toFixed(2)} s · decay ${v.d.toFixed(2)} s · sustain ${Math.round(v.s * 100)}%`;
    if (envText.textContent !== rd) envText.textContent = rd;
  };
  function setSel() { paintChips(); paintAll(); }

  svg.append(barsG, envG);
  // on the bars tab the picture is the bars and the envelope under them; on the other tabs only the envelope part (shaker buttons, wave buttons, strip) is shown
  const applyView = () => {
    barsG.style.display = isBars ? '' : 'none';
    if (legendEl) legendEl.style.display = isBars ? '' : 'none';
    vbY = isBars ? 0 : ENV_Y0 - 8 + envDy;
    svg.setAttribute('viewBox', isBars ? `0 0 ${W} ${lastHn}` : `0 ${vbY} ${W} 62`);
  };
  const paintAll = () => { if (isBars) paintBars(); paintEnv(); };
  // runs on the shared clock, only while the picture is on screen
  const anim = animate(svg, (now, dt, off) => {
    if (off) { paintAll(); return; }
    noteT = (noteT + dt) % (hold + 0.35); phase += 2 * Math.PI * 0.6 * dt;
    paintAll();
  }, { fps: 30 });
  const draw = (p) => {
    P = p || paramsOf();
    const s0 = fmStructure(P);
    hold = fmHold(P, s0.rows.filter(Boolean));
    const s = JSON.stringify([s0.rows, s0.links.map((l) => [l[0], l[1]])]);
    if (s !== sig) { sig = s; rebuild(); if (!s0.rows.includes(sel) && s0.rows.length > 1) sel = s0.rows[0]; }
    S = s0;   // the route strengths change without a rebuild, so the wave must always be worked out from the latest ones
    paintChips(); paintAll(); anim.kick();
  };
  ctl.fmpicture = { draw };
  // ---- the numbers, outside the drawing ----
  const opBtns = [1, 2, 3, 4].map((op) => {
    const b = h('button', { type: 'button', class: 'fm-opb', style: `--c: ${COLORS[op]}`, title: `Pick shaker ${op}` }, String(op));
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => { sel = op; setSel(); });
    return { op, b };
  });
  const envText = h('div', { class: 'fm-envread' });
    function paintChips() {
    opBtns.forEach(({ op, b }) => { b.classList.toggle('on', op === sel); b.classList.toggle('off', !S.rows.includes(op)); });
  }
  const legend = h('div', { class: 'fm-legend' }, h('b', {}, 'Bars'), ': one per shaker, the note you hear at the bottom. Drag a ring on a bar sideways for that shaker\'s ', h('b', {}, 'pitch'), ' (longer is higher). Drag the ring on an arm sideways for ', h('b', {}, 'how hard'), ' it shakes the one below. The ', h('b', { style: 'color:#ffb454' }, 'orange ring'), ' is feedback: the shaker shakes itself, which brightens and roughens the tone (it is not the Distortion effect). The numbers sit in the left edge (pitch and feedback) and the right edge (how hard). The coloured line is the wave, pinched through each bar and coloured like the shaker it belongs to (green is the note you hear). Under a shaker it is what that shaker sends down, so a bigger index makes it wider. Below it, the ', h('b', {}, 'envelope'), ' of the picked shaker: drag the first dot for attack, the second for decay and sustain.');
  // the wave each shaker plays (sine, triangle, saw or square), for the picked shaker
  const glyph = (name) => {
    const sv = el('svg', { viewBox: '0 0 24 14', width: 24, height: 14 }), pa = el('path', { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round' });
    let d = ''; for (let k = 0; k <= 48; k++) d += (k ? 'L' : 'M') + (1 + (22 * k) / 48).toFixed(1) + ' ' + (7 - fmWaveFn(name, k / 48) * 5).toFixed(1);
    pa.setAttribute('d', d); sv.append(pa); return sv;
  };
  const wbtns = FM_WAVE_NAMES.map((w) => h('button', { type: 'button', class: 'fm-wv', title: `The picked shaker plays a ${w} wave` + (w === 'sine' ? ' (the cleanest)' : ' (adds overtones of its own)'), onclick: () => { if (sel) set(OWAVE[sel - 1], w); } }, glyph(w)));
  const wlab = h('span', { class: 'fm-envl' }, 'wave of 1');
  const wrow = h('div', { class: 'fm-waverow fp-waverow', role: 'group', 'aria-label': 'The wave the picked shaker plays' }, wlab, wbtns);
  wrow.addEventListener('pointerdown', (e) => e.stopPropagation());
  paintWaves = () => { wlab.textContent = `wave of ${sel}`; FM_WAVE_NAMES.forEach((w, i) => wbtns[i].classList.toggle('on', (P[OWAVE[sel - 1]] || 'sine') === w)); };
  legendEl = legend;
  const topRow = h('div', { class: 'fm-toprow' }, h('div', { class: 'fm-opbs' }, opBtns.map((x) => x.b)), h('span', { class: 'fm-pickhint' }, 'pick a shaker, then drag its rings'));
  topRow.addEventListener('pointerdown', (e) => e.stopPropagation());
  const wrap = h('div', { class: 'fmpicwrap' }, topRow, svg, envText, wrow, legend);
  draw(node.params);
  return { el: wrap, draw, setView(bars) { isBars = !!bars; applyView(); draw(P); } };
}
