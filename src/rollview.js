// A look at a pattern written as text: a piano roll for the Note Pattern module, a strip of hits for the Hit Pattern module.
// The text is evaluated offline by the real engine (the same code check as playback; nothing sounds), so what is drawn is exactly what would play.
// Read-only for now: you see the notes and hits, laid out over the pattern's own cycles, and can scroll along a long one or fit it all in.
import { queryPatch, midiOf, noteName } from './snapshot.js';

const NOTE_COLOR = '#f2b134', HIT_COLOR = '#f0625f', GRID = '#27313b', BEAT = '#1c252d';
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

// How many cycles the pattern runs before it comes round again: a <a b c> group takes three, two groups of 2 and 3 take six.
export function periodOf(text, cap = 64) {
  const s = String(text || ''), groups = [];
  const open = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '<') open.push({ depth: 0, items: 0, inWord: false });
    else if (ch === '>') { const g = open.pop(); if (g) { if (g.inWord) g.items++; groups.push(Math.max(1, g.items)); } }
    else if (ch === '[' || ch === '(' || ch === '{') { const g = open[open.length - 1]; if (g) { if (g.depth === 0 && !g.inWord) g.inWord = true; g.depth++; } }
    else if (ch === ']' || ch === ')' || ch === '}') { const g = open[open.length - 1]; if (g && g.depth > 0) g.depth--; }
    else if (/\s/.test(ch)) { const g = open[open.length - 1]; if (g && g.depth === 0 && g.inWord) { g.items++; g.inWord = false; } }
    else { const g = open[open.length - 1]; if (g && !g.inWord && g.depth === 0) g.inWord = true; }
  }
  let p = 1;
  for (const k of groups) { p = (p * k) / gcd(p, k); if (p >= cap) return cap; }
  return Math.max(1, Math.min(cap, p));
}

// ---- layout (pure: no page needed) ----
export function pxPerCycle(cycles, width, fit) {
  if (fit) return Math.max(1.5, width / cycles);
  return cycles <= 2 ? 150 : cycles <= 4 ? 110 : cycles <= 16 ? 70 : 44;
}
export function rollLayout(events, { cycles, ppc, scale = 1, height = 112, top = 14, bottom = 4 }) {
  const notes = [];
  for (const e of events) { const m = midiOf(e.note ?? e.n); if (m !== null && m !== undefined && Number.isFinite(m)) notes.push({ m, a: e.start, b: e.end, v: Number.isFinite(e.velocity) ? Math.max(0, Math.min(1, e.velocity)) : 0.8 }); }
  if (!notes.length) return { notes: [], lo: 60, hi: 71, rows: 12, rowH: 0, width: cycles * ppc, height, top, ppc, cycles, scale };
  let lo = Math.min(...notes.map((n) => n.m)), hi = Math.max(...notes.map((n) => n.m));
  if (hi - lo < 11) { const mid = Math.round((hi + lo) / 2); lo = mid - 6; hi = mid + 5; }   // always at least an octave tall, so a few notes do not look huge
  lo -= 1; hi += 1;
  const rows = hi - lo + 1, plot = height - top - bottom, rowH = Math.min(9, plot / rows);
  const laid = notes.map((n) => ({ x: n.a * ppc, w: Math.max(2, (Math.min(n.b, cycles) - n.a) * ppc - 1), y: top + (hi - n.m) * rowH, h: Math.max(2, rowH - 1), v: n.v, m: n.m }));
  return { notes: laid, lo, hi, rows, rowH, width: cycles * ppc, height, top, ppc, cycles, scale };
}
export function hitLayout(events, { cycles, ppc, scale = 1, height = 56, top = 14, bottom = 6 }) {
  const hits = events.map((e) => ({ x: e.start * ppc, w: Math.max(2, Math.min(14, (e.end - e.start) * ppc * 0.6)), v: Number.isFinite(e.velocity) ? e.velocity : 1 }));
  return { hits, width: cycles * ppc, height, top, plot: height - top - bottom, ppc, cycles, scale };
}

// ---- drawing ----
function setup(canvas, width, height) {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}
function grid(ctx, lay) {
  const { height, top } = lay, scale = lay.scale || 1, bars = Math.max(1, Math.round(lay.cycles * scale)), ppb = lay.ppc / scale;   // ppb: pixels per bar
  ctx.font = '8px ui-monospace, monospace'; ctx.textBaseline = 'top';
  const every = Math.max(1, Math.ceil(26 / Math.max(ppb, 1))), lineEvery = ppb >= 3 ? 1 : Math.ceil(3 / ppb);
  for (let c = 0; c <= bars; c += lineEvery) {
    const x = Math.round(c * ppb) + 0.5;
    if (ppb >= 40) for (let q = 1; q < 4 && c < bars; q++) { ctx.strokeStyle = BEAT; ctx.beginPath(); ctx.moveTo(x + (q * ppb) / 4, top); ctx.lineTo(x + (q * ppb) / 4, height - 2); ctx.stroke(); }
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, height - 2); ctx.stroke();
    if (c < bars && c % every === 0) { ctx.fillStyle = '#5f7b79'; ctx.fillText(String(c + 1), x + 2, 2); }
  }
}
export function drawRoll(canvas, lay) {
  const ctx = setup(canvas, Math.max(40, lay.width), lay.height);
  if (lay.rowH) for (let m = lay.lo; m <= lay.hi; m++) {
    const y = lay.top + (lay.hi - m) * lay.rowH, k = ((m % 12) + 12) % 12;
    if ([1, 3, 6, 8, 10].includes(k)) { ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(0, y, lay.width, lay.rowH); }
    if (k === 0) { ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(0, y + lay.rowH + 0.5); ctx.lineTo(lay.width, y + lay.rowH + 0.5); ctx.stroke(); }
  }
  grid(ctx, lay);
  if (lay.rowH) for (let m = lay.lo; m <= lay.hi; m++) if (m % 12 === 0 && lay.rowH >= 4) { ctx.fillStyle = '#5f7b79'; ctx.fillText(noteName(m), 2, lay.top + (lay.hi - m) * lay.rowH + 1); }
  for (const n of lay.notes) { ctx.fillStyle = NOTE_COLOR; ctx.globalAlpha = 0.4 + 0.6 * n.v; ctx.fillRect(n.x, n.y, n.w, n.h); }
  ctx.globalAlpha = 1;
}
export function drawHits(canvas, lay) {
  const ctx = setup(canvas, Math.max(40, lay.width), lay.height);
  grid(ctx, lay);
  ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(0, lay.top + lay.plot + 0.5); ctx.lineTo(lay.width, lay.top + lay.plot + 0.5); ctx.stroke();
  for (const hit of lay.hits) { ctx.fillStyle = HIT_COLOR; ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, hit.v); ctx.fillRect(hit.x, lay.top, hit.w, lay.plot); }
  ctx.globalAlpha = 1;
}

// A Slow or Fast module further along the wire stretches or squeezes the pattern (a generated take is one long sequence slowed over its bars): how many real cycles one cycle of this pattern lasts
export function timeScaleOf(graph, nodeId) {
  let scale = 1, cur = nodeId;
  for (let hop = 0; hop < 12; hop++) {
    const w = graph.wires.find((x) => x.from.node === cur);
    const nx = w && graph.nodes.find((n) => n.id === w.to.node);
    if (!nx) break;
    if (nx.type === 'slow' && Number(nx.params.n) > 0) scale *= Number(nx.params.n);
    else if (nx.type === 'fast' && Number(nx.params.n) > 0) scale /= Number(nx.params.n);
    cur = nx.id;
  }
  return scale;
}

// ---- the views on the board ----
function view(node, ctl, { store, h }, kind) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const canvas = h('canvas', { class: 'rollcanvas', role: 'img', 'aria-label': kind === 'notes' ? 'The notes of this pattern as a piano roll' : 'The hits of this pattern as a strip' });
  const scroll = h('div', { class: 'rollscroll' }, canvas);
  const info = h('div', { class: 'rollinfo' });
  const fitBtn = h('button', { type: 'button', class: 'rollfit', title: 'Fit the whole pattern in the box, or show it at a readable size and scroll along it' }, 'fit');
  const foot = h('div', { class: 'rollfoot' }, info, fitBtn);
  const wrap = h('div', { class: 'rollwrap' }, scroll, foot);
  let fit = false, events = null, cycles = 1, scale = 1, key = '', timer = 0, seq = 0, error = '';
  const paint = () => {
    if (!events) return;
    scale = timeScaleOf(store.graph, node.id);
    const bars = Math.max(1, Math.round(cycles * scale)), boxW = Math.max(160, scroll.clientWidth || 260), ppb = pxPerCycle(bars, boxW, fit || bars * pxPerCycle(bars, boxW, false) <= boxW), ppc = ppb * scale;
    const span = scale === 1 ? `${cycles} cycle${cycles === 1 ? '' : 's'}` : `${bars} bar${bars === 1 ? '' : 's'}`;
    if (kind === 'notes') {
      const lay = rollLayout(events, { cycles, ppc, scale }); drawRoll(canvas, lay);
      const ms = lay.notes.map((n) => n.m);
      info.textContent = events.length ? `${events.length} note${events.length === 1 ? '' : 's'} · ${span} · ${noteName(Math.min(...ms))} to ${noteName(Math.max(...ms))}` : error || 'no notes';
    } else {
      drawHits(canvas, hitLayout(events, { cycles, ppc, scale }));
      info.textContent = events.length ? `${events.length} hit${events.length === 1 ? '' : 's'} · ${span}` : error || 'no hits';
    }
    fitBtn.style.display = canvas.offsetWidth > boxW + 2 || fit ? '' : 'none';
    fitBtn.textContent = fit ? 'detail' : 'fit';
  };
  fitBtn.addEventListener('click', () => { fit = !fit; paint(); });
  fitBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  scroll.addEventListener('pointerdown', (e) => e.stopPropagation());
  scroll.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  const code = (p) => {
    const text = JSON.stringify(String(p.text || '').trim() || '~');
    if (kind === 'notes') { const vel = String(p.vel || '').trim(); return `$: note(${text})${vel ? `.velocity(${JSON.stringify(vel)})` : ''}`; }
    return `$: note("c3").struct(${text})`;
  };
  const compute = async (p) => {
    const mine = ++seq; cycles = periodOf(p.text);
    try {
      const ev = await queryPatch(code(p), cycles);
      if (mine !== seq) return;
      events = ev.length > 6000 ? ev.slice(0, 6000) : ev; error = ev.length > 6000 ? 'showing the first 6000' : '';
    } catch (e) { if (mine !== seq) return; events = []; error = "can't read this pattern yet"; }
    paint();
  };
  const draw = (p) => {
    const k = `${p.text}|${p.vel || ''}|${timeScaleOf(store.graph, node.id)}`;
    if (k === key) return;
    key = k; clearTimeout(timer);
    timer = setTimeout(() => compute(p), events ? 250 : 0);   // while you type, wait for a pause
  };
  ctl[kind === 'notes' ? 'noteroll' : 'hitstrip'] = { draw };
  draw(node.params);
  return wrap;
}
export const buildNoteRoll = (node, ctl, deps) => view(node, ctl, deps, 'notes');
export const buildHitStrip = (node, ctl, deps) => view(node, ctl, deps, 'hits');
export const ROLLS = { noteroll: buildNoteRoll, hitstrip: buildHitStrip };
