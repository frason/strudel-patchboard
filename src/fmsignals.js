// The numbers behind the live FM picture: which operators are in the sound, how strongly each one is shaking at a moment in a note
// (its attack, decay and sustain), and the wave of every operator and of the note, worked out with the same sums as fmShape in modules.js.
import { fmLinks, fmWaveFn } from './modules.js';
const SAMPLES = 150;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const harmOf = (p, i) => Number(p[i === 1 ? 'harm' : 'harm' + i]) || 1;

// which operators are in the sound, how deep each sits below the note, and what each one shakes
export function fmStructure(p) {
  const links = fmLinks(p);
  const used = new Set();
  for (let pass = 0; pass < 4; pass++) for (const [i, j] of links) if (j === 0 || used.has(j)) used.add(i);
  const depth = { 0: 0 };
  for (let pass = 0; pass < 5; pass++) for (const [i, j] of links) if (used.has(i) && depth[j] !== undefined) depth[i] = Math.max(depth[i] ?? 0, depth[j] + 1);
  const ops = [...used].filter((i) => depth[i] !== undefined).sort((a, b) => depth[b] - depth[a] || a - b);
  const rows = [...ops, 0];                                              // deepest shaker on top, the note at the bottom
  const out = (i) => links.filter(([a, b]) => a === i && used.has(a) && (b === 0 || used.has(b)));
  return { rows, links, out, depth };
}

// how hard operator `op` is shaking at time t into a note held for `hold` seconds, as a fraction (0 to 1) of its index
export const fmEnv = (p, op, t, hold) => {
  const sfx = op === 1 ? '' : String(op);
  const a = Math.max(0, Number(p['attack' + sfx]) || 0);
  const d = Math.max(0.01, Number(p['decay' + sfx] ?? (op === 1 ? 0.4 : 0.2)));
  const s = clamp(Number(p['sustain' + sfx] ?? (op === 1 ? 0.4 : 1)), 0, 1);
  const level = (u) => (u < a ? (a > 0 ? u / a : 1) : u < a + d ? 1 - (1 - s) * ((u - a) / d) : s);
  return t <= hold ? level(t) : level(hold) * Math.max(0, 1 - (t - hold) / 0.2);   // let go over 0.2 s
};
export const fmHold = (p, ops) => clamp(Math.max(0, ...ops.map((o) => { const sfx = o === 1 ? '' : String(o); return (Number(p['attack' + sfx]) || 0) + (Number(p['decay' + sfx]) || 0.2); })) + 0.9, 1.6, 4.5);

// Work out the wave of every switched-on operator and of the note, over `cycles` cycles of the note (the same sums as fmShape in modules.js).
// `scaleOf(op)` is how much of its index each shaker has right now (its envelope); `shift` slides the window along so the wave seems to flow past.
export function fmSignals(p, S, scaleOf, shift = 0, N = SAMPLES, cycles = 1, carrier = 'sine') {
  const links = S.links.filter(([i, j]) => S.rows.includes(i) && (j === 0 || S.rows.includes(j)));
  const ops = S.rows.filter(Boolean);
  const harm = [0, 1, 2, 3, 4].map((i) => (i ? harmOf(p, i) : 1));
  const fb = [0, 1, 2, 3, 4].map((i) => (i ? clamp(Number(p['fb' + i]) || 0, 0, 1) : 0));
  const wave = [0, 1, 2, 3, 4].map((i) => (i ? p['owave' + (i === 1 ? '' : i)] || 'sine' : 'sine'));
  const phase = [0, 0, 0, 0, 0], out = [0, 0, 0, 0, 0], strength = [0, 0, 0, 0, 0];
  for (const k of ops) { phase[k] = shift * harm[k]; strength[k] = scaleOf(k); }   // each shaker's envelope level, once for the whole run
  let cph = shift;
  const res = { ops: {}, note: new Float32Array(N) };
  for (const k of ops) res.ops[k] = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const freq = [0, 0, 0, 0, 0];
    for (const k of ops) freq[k] = harm[k] + fb[k] * out[k] * harm[k];
    let cf = 1;
    for (const [i, j, v] of links) { const dv = out[i] * v * strength[i] * harm[i]; if (j === 0) cf += dv; else freq[j] += dv; }
    res.note[n] = fmWaveFn(carrier, cph);
    for (const k of ops) res.ops[k][n] = out[k];
    cph += (cf * cycles) / N;
    for (const k of ops) { phase[k] += (freq[k] * cycles) / N; out[k] = fmWaveFn(wave[k], phase[k]); }
  }
  return res;
}
