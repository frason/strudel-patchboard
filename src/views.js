// Display-only modules: Piano Roll and Scope. They read what Strudel is really playing (the live pattern's events and
// the audio analysers) and draw it. They never change the sound or the code, except Scope's .analyze(n) tag.
import { scopeId, nodeById } from './graph.js';
import { getPrefs } from './prefs.js';

const accent = () => (getComputedStyle(document.getElementById('app') || document.body).getPropertyValue('--accent') || '#f3c9a0').trim();
const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function midi(v) {
  if (typeof v === 'number') return v;
  const m = /^([a-g])([#bs]*)(-?\d+)?$/i.exec(String(v));
  if (!m) return null;
  let n = NOTE[m[1].toLowerCase()];
  for (const ch of m[2]) n += ch === '#' || ch === 's' ? 1 : -1;
  return n + 12 * ((m[3] === undefined ? 3 : Number(m[3])) + 1);
}

function upstream(g, id) {
  const seen = new Set();
  const walk = (x) => {
    for (const w of g.wires) if (w.to.node === x && !w.to.port.startsWith('p:') && !seen.has(w.from.node)) { seen.add(w.from.node); walk(w.from.node); }
  };
  walk(id);
  return seen;
}

// Where in its pattern a sequencer is, estimated from Strudel's own clock and any Fast / Slow / Reverse after it.
function timeInfo(g, id) {
  let scale = 1, rev = false, cur = id;
  const seen = new Set([id]);
  for (;;) {
    const w = g.wires.find((x) => x.from.node === cur && !x.to.port.startsWith('p:'));
    if (!w) return { scale, rev };
    const nx = nodeById(g, w.to.node);
    if (!nx || seen.has(nx.id)) return { scale, rev };
    seen.add(nx.id);
    if (nx.type === 'fast' || nx.type === 'slow') {
      if (g.wires.some((x) => x.to.node === nx.id && x.to.port === 'p:n')) return null; // speed driven by a cable: unknown
      scale *= nx.type === 'fast' ? nx.params.n : 1 / nx.params.n;
    } else if (nx.type === 'rev') rev = !rev;
    else if (nx.type === 'cat' || nx.type === 'arrange') return null;
    cur = nx.id;
  }
}

export function createViews({ board, store, engine, getEvaluated }) {
  let raf = null, idleDrawn = false;

  const prep = (canvas) => {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b0f13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return ctx;
  };
  const idle = (canvas, text) => {
    const ctx = prep(canvas);
    ctx.fillStyle = '#4b5764';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  };

  // The events that came from this view's own upstream modules
  function collect(g, node, haps, segments) {
    const mine = upstream(g, node.id);
    const items = [];
    for (const h of haps) {
      if (!h.whole) continue;
      const hit = (h.context?.locations || []).some((loc) => segments.some((s) => loc.start >= s.from && loc.end <= s.to && mine.has(s.node)));
      if (!hit) continue;
      const v = h.value || {};
      items.push({ b: h.whole.begin.valueOf(), e: h.whole.end.valueOf(), m: v.note !== undefined ? midi(v.note) : null, name: String(v.s ?? '') });
    }
    return items;
  }
  const label = (ctx, text, x, y) => { ctx.fillStyle = '#6b7886'; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillText(text, x, y); };
  const rowsOf = (items) => {
    const pitched = items.filter((x) => x.m !== null);
    if (pitched.length) {
      const ms = [...new Set(pitched.map((x) => x.m))].sort((a, b) => b - a);
      return { keys: ms, of: (x) => ms.indexOf(x.m), text: (k) => NOTE_NAMES[k % 12] + (Math.floor(k / 12) - 1) };
    }
    const names = [...new Set(items.map((x) => x.name))];
    return { keys: names, of: (x) => names.indexOf(x.name), text: (k) => k };
  };

  // Punchcard: two cycles of events, one row per pitch or sound, the playhead a quarter of the way in.
  function drawPunch(canvas, g, node, items, now) {
    const ctx = prep(canvas);
    const W = canvas.width, H = canvas.height, w0 = now - 0.5, span = 2;
    const rows = rowsOf(items), n = Math.max(rows.keys.length, 1), rh = H / n;
    ctx.strokeStyle = '#1b232c';
    for (let c = Math.ceil(w0); c < w0 + span; c++) { const x = ((c - w0) / span) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (const x of items) {
      if (x.e < w0 || x.b > w0 + span) continue;
      const r = rows.of(x), x0 = ((x.b - w0) / span) * W, w = Math.max(3, ((x.e - x.b) / span) * W - 1);
      const active = x.b <= now && now < x.e, past = x.e <= now;
      ctx.fillStyle = active ? '#ffffff' : past ? '#7a5d1c' : accent();
      ctx.fillRect(x0, r * rh + 1, w, Math.max(3, rh - 2));
    }
    rows.keys.forEach((k, i) => { if (rh >= 10) label(ctx, rows.text(k), 3, i * rh + rh / 2 + 3); });
    const px = ((now - w0) / span) * W;
    ctx.strokeStyle = '#ffffffcc'; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }

  // Spiral: time winds outwards, one turn per cycle; the playhead sweeps round.
  function drawSpiral(canvas, g, node, items, now) {
    const ctx = prep(canvas);
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 6, r0 = R * 0.2;
    const back = 2, fwd = 0.6, total = back + fwd;
    const at = (t, off = 0) => { const k = (t - (now - back)) / total, a = (t % 1) * Math.PI * 2 - Math.PI / 2, r = r0 + (R - r0) * k + off; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
    ctx.strokeStyle = '#1b232c'; ctx.lineWidth = 1; ctx.beginPath();
    for (let t = now - back; t <= now + fwd; t += 0.02) { const [x, y] = at(t); if (t === now - back) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    const rows = rowsOf(items), nr = Math.max(rows.keys.length, 1);
    ctx.lineWidth = Math.max(2, Math.min(7, (R - r0) / total / nr + 1)); ctx.lineCap = 'round';
    for (const x of items) {
      if (x.e < now - back || x.b > now + fwd) continue;
      const active = x.b <= now && now < x.e, past = x.e <= now;
      ctx.strokeStyle = active ? '#ffffff' : past ? '#7a5d1c' : accent();
      const off = ((rows.of(x) + 0.5) / nr - 0.5) * (R - r0) / total * 0.8;
      ctx.beginPath();
      const b = Math.max(x.b, now - back), e = Math.min(x.e, now + fwd);
      for (let t = b; t <= e; t += 0.015) { const [px, py] = at(t, off); if (t === b) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      const [ex, ey] = at(e, off); ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    const a = (now % 1) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#ffffffcc'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
  }

  // Pitch wheel: the twelve pitch classes on a circle; the ones sounding right now light up.
  function drawWheel(canvas, g, node, items, now) {
    const ctx = prep(canvas);
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 14;
    const pos = (pc, r = R) => [cx + Math.sin((pc / 12) * Math.PI * 2) * r, cy - Math.cos((pc / 12) * Math.PI * 2) * r];
    ctx.strokeStyle = '#1b232c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    const live = new Set(items.filter((x) => x.m !== null && x.b <= now && now < x.e).map((x) => ((x.m % 12) + 12) % 12));
    const recent = new Set(items.filter((x) => x.m !== null && x.e <= now && x.e > now - 1).map((x) => ((x.m % 12) + 12) % 12));
    const pts = [...live].sort((a, b) => a - b);
    if (pts.length > 1) { ctx.strokeStyle = accent(); ctx.lineWidth = 2; ctx.beginPath(); pts.forEach((pc, i) => { const [x, y] = pos(pc); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); ctx.stroke(); }
    ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center';
    for (let pc = 0; pc < 12; pc++) {
      const [x, y] = pos(pc), on = live.has(pc);
      ctx.fillStyle = on ? '#ffffff' : recent.has(pc) ? '#7a5d1c' : '#2a333d';
      ctx.beginPath(); ctx.arc(x, y, on ? 6 : 4, 0, Math.PI * 2); ctx.fill();
      const [lx, ly] = pos(pc, R + 11); ctx.fillStyle = on ? '#fff' : '#6b7886'; ctx.fillText(NOTE_NAMES[pc].toUpperCase(), lx, ly + 3);
    }
  }

  // One cycle across the width. The playhead sweeps left to right and wraps at the end of each cycle.
  function drawRoll(canvas, g, node, haps, now, segments) {
    const ctx = prep(canvas);
    const W = canvas.width, H = canvas.height, c0 = Math.floor(now);
    const mine = upstream(g, node.id);
    const items = [];
    for (const h of haps) {
      if (!h.whole) continue;
      const hit = (h.context?.locations || []).some((loc) => segments.some((s) => loc.start >= s.from && loc.end <= s.to && mine.has(s.node)));
      if (!hit) continue;
      const v = h.value || {};
      const m = v.note !== undefined ? midi(v.note) : null;
      items.push({ b: h.whole.begin.valueOf(), e: h.whole.end.valueOf(), m, name: v.s ?? '' });
    }
    ctx.strokeStyle = '#1b232c';
    ctx.lineWidth = 1;
    for (let q = 1; q < 4; q++) { ctx.beginPath(); ctx.moveTo((q / 4) * W, 0); ctx.lineTo((q / 4) * W, H); ctx.stroke(); }
    const pitched = items.filter((x) => x.m !== null);
    let row;
    if (pitched.length) {
      const lo = Math.min(...pitched.map((x) => x.m)) - 1, hi = Math.max(...pitched.map((x) => x.m)) + 1;
      const span = Math.max(hi - lo, 10);
      const mid = (hi + lo) / 2;
      row = (x) => ({ y: H - ((x.m - (mid - span / 2) + 0.5) / (span + 1)) * H, h: Math.max(3, H / (span + 1) - 1) });
    } else {
      const names = [...new Set(items.map((x) => x.name))];
      row = (x) => ({ y: ((names.indexOf(x.name) + 0.5) / Math.max(names.length, 1)) * H, h: Math.max(3, H / Math.max(names.length, 1) - 2) });
    }
    for (const x of items) {
      const r = row(x);
      const x0 = (x.b - c0) * W, w = Math.max(2, (x.e - x.b) * W - 1);
      const active = x.b <= now && now < x.e;
      ctx.fillStyle = active ? '#ffffff' : x.e <= now ? '#7a5d1c' : accent();
      ctx.fillRect(x0, r.y - r.h / 2, w, r.h);
    }
    ctx.strokeStyle = '#ffffffcc';
    const px = (now - c0) * W;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
  }

  function drawScope(canvas, g, node) {
    const ctx = prep(canvas);
    const W = canvas.width, H = canvas.height;
    const spectrum = node.params.style === 'spectrum';
    const data = engine.analyser(spectrum ? 'frequency' : 'time', scopeId(g, node));
    ctx.strokeStyle = spectrum ? '#4cc3f0' : '#78d68b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (!data || !data.length) { ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); return; }
    let start = 0;
    if (!spectrum) { for (let i = 1; i < data.length; i++) if (data[i - 1] > 0 && data[i] <= 0) { start = i; break; } }
    const n = spectrum ? Math.floor(data.length / 2) : data.length - start;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * W;
      const v = spectrum ? Math.min(1, Math.max(0, (data[i] + 120) / 120)) : data[start + i] * 0.5 + 0.5;
      const y = spectrum ? H - v * H : H - v * H;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  function playheads(g, now) {
    for (const n of g.nodes) {
      if (!['melody', 'rhythm', 'chords', 'drums'].includes(n.type)) continue;
      const info = n.muted ? null : timeInfo(g, n.id);
      if (!info) { board.setPlayhead(n.id, null); continue; }
      const steps = n.params.steps, t = now * info.scale;
      const pace = n.params.mode === 'pace' && steps > 8;
      let idx = n.params.mode === 'turns' ? ((Math.floor(t) % steps) + steps) % steps : pace ? Math.floor(t * 8) % steps : Math.floor((t - Math.floor(t)) * steps);
      if (info.rev && n.params.mode !== 'turns') idx = steps - 1 - idx;
      board.setPlayhead(n.id, idx);
    }
  }
  function frame() {
    raf = requestAnimationFrame(frame);
    if (getPrefs().animations === false) {   // animations off: nothing moves; show a still note instead of drawing every frame
      board.clearPlayheads();
      const cv0 = board.canvases();
      if (!idleDrawn && cv0.length) { cv0.forEach((c) => idle(c.canvas, 'animations are off (Settings)')); idleDrawn = true; }
      return;
    }
    if (engine.playing) {
      const now = engine.nowCycle(), g = store.graph;
      playheads(g, now);
      for (const n of g.nodes) if (n.type === 'wave') board.setPhase(n.id, (((now / Math.max(0.25, n.params.slow)) % 1) + 1) % 1);
    } else { board.clearPlayheads(); for (const n of store.graph.nodes) if (n.type === 'wave') board.setPhase(n.id, null); }
    const cv = board.canvases();
    if (!cv.length) return;
    if (!engine.playing) {
      if (!idleDrawn) { cv.forEach((c) => idle(c.canvas, 'press Start to see it play')); idleDrawn = true; }
      return;
    }
    idleDrawn = false;
    const g = store.graph;
    const now = engine.nowCycle();
    const wide = cv.some((c) => ['punchcard', 'spiral', 'pitchwheel'].includes(c.type));
    const haps = cv.some((c) => c.type === 'pianoroll') ? engine.haps(Math.floor(now), Math.floor(now) + 1) : [];
    const whapss = wide ? engine.haps(Math.floor(now) - 3, Math.floor(now) + 2) : [];
    const segments = getEvaluated().segments;
    for (const c of cv) {
      const node = g.nodes.find((n) => n.id === c.id);
      if (!node) continue;
      if (c.type === 'pianoroll') drawRoll(c.canvas, g, node, haps, now, segments);
      else if (c.type === 'punchcard') drawPunch(c.canvas, g, node, collect(g, node, whapss, segments), now);
      else if (c.type === 'spiral') drawSpiral(c.canvas, g, node, collect(g, node, whapss, segments), now);
      else if (c.type === 'pitchwheel') drawWheel(c.canvas, g, node, collect(g, node, whapss, segments), now);
      else drawScope(c.canvas, g, node);
    }
  }
  return {
    start() { if (!raf) raf = requestAnimationFrame(frame); },
    dirty() { idleDrawn = false; },
  };
}
