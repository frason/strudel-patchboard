// Grab: take a stretch of what a module plays and turn it into something you own.
//   notes  -> a Take (events.js recordToTake, with its loss report)
//   sample hits (drums, loops: events with a sound name and no pitch) -> a Strudel Code (pattern) module holding `stack(s("bd ~ ..."), s("~ hh ..."))`
// It works from an event record (events.js), so it is a replay of what the board's CURRENT code would play over those cycles: random and conditional modules are functions of time and
// give the same answer again, but the patch you edited since is not what played earlier, and Sliders are the live values at the moment of the grab. It is not a recording of what was heard.
// Plain functions, no DOM: tested without a browser.
import { onsets, midiOfControl, num, recordToTake } from './events.js';

const STEPS = [4, 8, 16, 12, 24, 32, 48, 64, 96];   // steps per cycle a hit pattern may be written on, finest last
const mini = (s) => String(s).replace(/[^A-Za-z0-9_:.-]/g, '');

// sample hits -> code. `steps` is picked as the smallest grid on which every hit lands exactly (else 96, and the hits that move are counted).
export function recordToHits(rec) {
  const from = rec.span.from, cycles = Math.max(1, Math.ceil(rec.span.to - rec.span.from - 1e-9)), hits = [];
  const report = { hits: 0, sounds: [], steps: 0, snapped: 0, merged: 0, gainLost: 0, spanPadded: Math.abs((rec.span.to - rec.span.from) - cycles) > 1e-9 ? 1 : 0, carried: 0, controlsLost: [] };
  const lost = new Set();
  for (const e of onsets(rec)) {
    if (midiOfControl(e.controls) !== null || typeof e.controls.s !== 'string') continue;
    const name = mini(e.controls.s) + (typeof e.controls.n === 'number' && Number.isInteger(e.controls.n) && e.controls.n > 0 ? ':' + e.controls.n : '');
    if (!name) continue;
    if (e.carry) report.carried++;
    const at = num(e.at) - from; if (at < -1e-9 || at >= cycles - 1e-9) continue;
    if (typeof e.controls.gain === 'number' && Math.abs(e.controls.gain - 1) > 1e-9) report.gainLost++;
    for (const k of Object.keys(e.controls)) if (!['s', 'n'].includes(k)) lost.add(k);
    hits.push({ name, at });
  }
  report.controlsLost = [...lost].sort();
  if (!hits.length) return { code: '', report, empty: true };
  let steps = STEPS.find((st) => hits.every((x) => Math.abs(x.at * st - Math.round(x.at * st)) < 1e-6)) || 96;
  report.steps = steps;
  const byName = new Map();
  for (const x of hits) {
    let k = Math.round(x.at * steps); if (Math.abs(x.at * steps - k) > 1e-6) report.snapped++;
    k = Math.min(cycles * steps - 1, Math.max(0, k));
    const row = byName.get(x.name) || new Map();
    if (row.has(k)) report.merged++; row.set(k, true); byName.set(x.name, row);
  }
  const total = cycles * steps, lines = [];
  for (const [name, row] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const toks = []; let rest = 0;
    const flush = () => { if (rest) { toks.push(rest === 1 ? '~' : `~@${rest}`); rest = 0; } };
    for (let k = 0; k < total; k++) { if (row.has(k)) { flush(); toks.push(name); } else rest++; }
    flush();
    lines.push(`s("${toks.join(' ')}")`); report.hits += row.size;
  }
  report.sounds = [...byName.keys()];
  const body = lines.length === 1 ? lines[0] : `stack(\n  ${lines.join(',\n  ')}\n)`;
  return { code: cycles > 1 ? `${body}.slow(${cycles})` : body, report, empty: false };
}

// the whole grab: { kind: 'notes' | 'hits' | 'mixed' | 'empty', take, hits, report, line }
export function grabFrom(rec, { bpm = 120, beatsPerBar = 4, grid = 24 } = {}) {
  const t = recordToTake(rec, { bpm, beatsPerBar, grid }), h = recordToHits(rec);
  const notes = t.take.events.length, kind = notes && !h.empty ? 'mixed' : notes ? 'notes' : !h.empty ? 'hits' : 'empty';
  const cyc = rec.span.to - rec.span.from, bits = [];
  if (notes) bits.push(`${notes} note${notes === 1 ? '' : 's'}`);
  if (!h.empty) bits.push(`${h.report.hits} hit${h.report.hits === 1 ? '' : 's'} of ${h.report.sounds.join(', ')}`);
  const line = kind === 'empty' ? `Nothing plays in these ${cyc} cycles.` : `${bits.join(' and ')} over ${cyc} cycle${cyc === 1 ? '' : 's'}`;
  return { kind, take: t.take, takeReport: t.report, hits: h, line };
}
