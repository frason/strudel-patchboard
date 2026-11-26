// Small pictures that show what a module does with its current settings. Drawing only: no sound, no Strudel.

// Bjorklund / Euclidean rhythm: k hits spread as evenly as possible over n steps (the same rhythms Strudel's euclid(k,n) plays)
export function bjorklund(k, n) {
  k = Math.max(0, Math.min(k, n));
  if (n <= 0) return [];
  if (k === 0) return Array(n).fill(false);
  let groups = [...Array(k).fill([true]), ...Array(n - k).fill([false])];
  let a = groups.slice(0, k), b = groups.slice(k);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length), merged = [];
    for (let i = 0; i < m; i++) merged.push([...a[i], ...b[i]]);
    const rest = a.length > b.length ? a.slice(m) : b.slice(m);
    a = merged; b = rest;
  }
  return [...a, ...b].flat();
}

// one value (0..1) of a Strudel signal at phase t (0..1)
export function signal(shape, t) {
  switch (shape) {
    case 'sine': return (Math.sin(t * 2 * Math.PI) + 1) / 2;
    case 'saw': return t;
    case 'tri': return t < 0.5 ? t * 2 : 2 - t * 2;
    case 'square': return t < 0.5 ? 0 : 1;
    default: return 0.5;
  }
}
const NOISE = Array.from({ length: 16 }, (_, i) => ((i * 7919 + 13) % 97) / 97); // a fixed "random" picture

// magnitude (dB) of a filter at frequency f
export function filterDb(type, slope, cutoff, qDb, f) {
  const x = f / cutoff, Q = Math.pow(10, Math.max(0, qDb) / 20);
  const den = (1 - x * x) ** 2 + (x / Q) ** 2;
  let m2 = type === 'hpf' ? x ** 4 / den : type === 'bpf' ? (x / Q) ** 2 / den : 1 / den;
  if (slope === '24db' || slope === 'ladder') m2 = m2 * m2;
  return 10 * Math.log10(Math.max(m2, 1e-9));
}

const COLORS = { grid: '#1f2830', text: '#7c8b9a', white: '#ffffff' };
function ready(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0b0f13'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '9px ui-monospace, monospace';
  return ctx;
}

export function drawPreview(kind, canvas, p, ctxInfo = {}) {
  const A = ctxInfo.accent || '#f3c9a0';
  const ctx = ready(canvas), W = canvas.width, H = canvas.height;
  if (kind === 'wave') {
    const L = 34, R = 8, T = 8, B = 16, w = W - L - R, h = H - T - B;
    const lo = Number(p.min), hi = Number(p.max);
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
    for (const y of [T, T + h]) { ctx.beginPath(); ctx.moveTo(L, y + 0.5); ctx.lineTo(L + w, y + 0.5); ctx.stroke(); }
    ctx.fillStyle = COLORS.text; ctx.textAlign = 'right';
    ctx.fillText(String(hi), L - 4, T + 8); ctx.fillText(String(lo), L - 4, T + h);
    ctx.textAlign = 'center';
    const cyc = Number(p.slow), whole = Number.isFinite(cyc) && cyc >= 1 && cyc <= 16 && Math.abs(cyc - Math.round(cyc)) < 1e-9;
    if (whole) {   // a tick at every cycle (a bar): the curve is read against the song's own count, 1 2 3 4 ...
      ctx.strokeStyle = '#2a3844'; ctx.lineWidth = 1;
      for (let c = 1; c < cyc; c++) { const x = L + (c / cyc) * w; ctx.beginPath(); ctx.moveTo(x + 0.5, T); ctx.lineTo(x + 0.5, T + h); ctx.stroke(); }
      ctx.fillStyle = COLORS.text; ctx.textAlign = 'left';
      for (let c = 0; c < cyc; c++) ctx.fillText(String(c + 1), L + (c / cyc) * w + 2, H - 3);
      ctx.textAlign = 'right'; ctx.fillText(`${cyc} cycle${cyc === 1 ? '' : 's'}, then repeats`, L + w - 2, T + 8);
    } else { ctx.fillText(`one sweep = ${p.slow} cycle${cyc === 1 ? '' : 's'}`, L + w / 2, H - 3); }
    const y = (v) => T + h - v * h;
    ctx.beginPath();
    if (p.shape === 'rand') {
      NOISE.forEach((v, i) => { const x0 = L + (i / NOISE.length) * w, x1 = L + ((i + 1) / NOISE.length) * w; ctx.moveTo(x0, y(v)); ctx.lineTo(x1, y(v)); });
    } else {
      for (let i = 0; i <= 120; i++) { const t = i / 120; const px = L + t * w, py = y(signal(p.shape, Math.min(t, 0.9999))); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    }
    ctx.strokeStyle = A; ctx.lineWidth = 2; ctx.stroke();
    if (ctxInfo.phase != null) {
      const t = ctxInfo.phase, v = p.shape === 'rand' ? NOISE[Math.floor(t * NOISE.length) % NOISE.length] : signal(p.shape, t);
      ctx.fillStyle = COLORS.white; ctx.beginPath(); ctx.arc(L + t * w, y(v), 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = A; ctx.textAlign = 'left'; ctx.fillText(String(Math.round(lo + (hi - lo) * v)), L + 4, T + 18);
    }
  } else if (kind === 'filter') {
    const L = 22, R = 6, T = 6, B = 14, w = W - L - R, h = H - T - B;
    const fx = (f) => L + (Math.log10(f / 20) / 3) * w;
    const db = (d) => T + h - ((Math.max(-48, Math.min(18, d)) + 48) / 66) * h;
    ctx.strokeStyle = COLORS.grid; ctx.lineWidth = 1;
    for (const d of [-24, 0]) { ctx.beginPath(); ctx.moveTo(L, db(d) + 0.5); ctx.lineTo(L + w, db(d) + 0.5); ctx.stroke(); }
    ctx.fillStyle = COLORS.text; ctx.textAlign = 'center';
    [['20', 20], ['200', 200], ['2k', 2000], ['20k', 20000]].forEach(([t, f]) => ctx.fillText(t, Math.min(Math.max(fx(f), L + 6), L + w - 8), H - 3));
    ctx.textAlign = 'right'; ctx.fillText('0 dB', L - 2, db(0) + 3);
    const cut = Math.max(20, Math.min(20000, Number(p.cutoff)));
    ctx.setLineDash([2, 3]); ctx.strokeStyle = '#4a5a6a';
    ctx.beginPath(); ctx.moveTo(fx(cut) + 0.5, T); ctx.lineTo(fx(cut) + 0.5, T + h); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) { const f = 20 * Math.pow(1000, i / 160); const px = fx(f), py = db(filterDb(p.type, p.ftype, cut, Number(p.q) > 1 ? Number(p.q) : 0, f)); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.strokeStyle = A; ctx.lineWidth = 2; ctx.stroke();
    if (ctxInfo.driven) { ctx.fillStyle = '#4cc3f0'; ctx.textAlign = 'left'; ctx.fillText('cutoff moved by a cable', L + 4, T + 10); }
  } else if (kind === 'euclid') {
    const n = Math.max(1, p.steps), k = Math.min(p.pulses, n), pat = bjorklund(k, n);
    const cx = 36, cy = H / 2, r = Math.min(26, H / 2 - 8);
    const pts = pat.map((on, i) => ({ on, x: cx + Math.sin((i / n) * 2 * Math.PI) * r, y: cy - Math.cos((i / n) * 2 * Math.PI) * r }));
    ctx.strokeStyle = COLORS.grid; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    const hits = pts.filter((q) => q.on);
    if (hits.length > 1) { ctx.beginPath(); hits.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.strokeStyle = A + '88'; ctx.lineWidth = 1.5; ctx.stroke(); }
    pts.forEach((q) => { ctx.beginPath(); ctx.arc(q.x, q.y, q.on ? 4 : 2, 0, Math.PI * 2); ctx.fillStyle = q.on ? A : '#2f3a46'; ctx.fill(); });
    ctx.fillStyle = A; ctx.font = '600 13px ui-monospace, monospace'; ctx.textAlign = 'left';
    const row = pat.map((on) => (on ? 'x' : '.')).join(' ');
    ctx.fillText(row.length > 30 ? row.slice(0, 30) + '…' : row, 84, cy - 2);
    ctx.fillStyle = COLORS.text; ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${k} hits in ${n} steps`, 84, cy + 16);
  } else if (kind === 'every') {
    const n = Math.min(16, Math.max(2, p.n)), cell = Math.min(22, (W - 16) / n - 3);
    ctx.fillStyle = COLORS.text; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left';
    ctx.fillText('cycles', 8, 14);
    for (let i = 0; i < n; i++) {
      const x = 8 + i * (cell + 3), last = i === n - 1;
      ctx.fillStyle = last ? A : '#1b232c'; ctx.fillRect(x, 22, cell, 22);
      ctx.fillStyle = last ? '#1a1208' : COLORS.text; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), x + cell / 2, 37);
    }
    ctx.fillStyle = A; ctx.textAlign = 'left'; ctx.fillText(`changes on cycle ${n}, then repeats`, 8, 62);
  }
}
