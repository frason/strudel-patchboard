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
// A sample is its bank + name + index: hits of one bank are written on their own lines with .bank("...") so they keep the sound they had. Whatever cannot be kept is counted in the report, never dropped quietly.
export function recordToHits(rec) {
  const from = rec.span.from, cycles = Math.max(1, Math.ceil(rec.span.to - rec.span.from - 1e-9)), hits = [];
  const report = { hits: 0, sounds: [], steps: 0, snapped: 0, merged: 0, gainLost: 0, spanPadded: Math.abs((rec.span.to - rec.span.from) - cycles) > 1e-9 ? 1 : 0, carried: 0, renamed: 0, indexLost: 0, controlsLost: [], warnings: rec.warnings.slice() };
  const lost = new Set();
  for (const e of onsets(rec)) {
    if (midiOfControl(e.controls) !== null || typeof e.controls.s !== 'string') continue;
    const base = mini(e.controls.s), bank = typeof e.controls.bank === 'string' ? mini(e.controls.bank) : '';
    const nv = e.controls.n, okIndex = typeof nv === 'number' && Number.isInteger(nv) && nv > 0;
    if (nv !== undefined && nv !== 0 && !okIndex) report.indexLost++;   // a negative, fractional or non-number index cannot be written as bd:3
    const name = base + (okIndex ? ':' + nv : '');
    if (!base) continue;
    if (base !== e.controls.s || (typeof e.controls.bank === 'string' && bank !== e.controls.bank)) report.renamed++;   // a name with characters the writer cannot keep is not the sample it was
    if (e.carry) report.carried++;
    const at = num(e.at) - from; if (at < -1e-9 || at >= cycles - 1e-9) continue;
    const g = typeof e.controls.gain === 'number' ? e.controls.gain : 1, v = typeof e.controls.velocity === 'number' ? e.controls.velocity : 1;
    if (Math.abs(g - 1) > 1e-9 || Math.abs(v - 1) > 1e-9) report.gainLost++;   // loudness of any kind (gain or velocity)
    for (const k of Object.keys(e.controls)) if (!['s', 'n', 'bank'].includes(k)) lost.add(k);
    hits.push({ name, bank, at });
  }
  report.controlsLost = [...lost].sort();
  if (!hits.length) return { code: '', report, empty: true };
  const steps = STEPS.find((st) => hits.every((x) => Math.abs(x.at * st - Math.round(x.at * st)) < 1e-6)) || 96;
  report.steps = steps;
  const byName = new Map();   // key: bank + name
  for (const x of hits) {
    let k = Math.round(x.at * steps); if (Math.abs(x.at * steps - k) > 1e-6) report.snapped++;
    k = Math.min(cycles * steps - 1, Math.max(0, k));
    const key = (x.bank ? x.bank + '|' : '') + x.name, row = byName.get(key) || { name: x.name, bank: x.bank, cells: new Map() };
    if (row.cells.has(k)) report.merged++; row.cells.set(k, true); byName.set(key, row);
  }
  const total = cycles * steps, lines = [];
  for (const row of [...byName.values()].sort((a, b) => (a.bank + '|' + a.name).localeCompare(b.bank + '|' + b.name))) {
    const toks = []; let rest = 0;
    const flush = () => { if (rest) { toks.push(rest === 1 ? '~' : `~@${rest}`); rest = 0; } };
    for (let k = 0; k < total; k++) { if (row.cells.has(k)) { flush(); toks.push(row.name); } else rest++; }
    flush();
    lines.push(`s("${toks.join(' ')}")${row.bank ? `.bank("${row.bank}")` : ''}`); report.hits += row.cells.size;
  }
  report.sounds = [...new Set([...byName.values()].map((r) => (r.bank ? r.bank + ' ' : '') + r.name))].sort();
  const body = lines.length === 1 ? lines[0] : `stack(\n  ${lines.join(',\n  ')}\n)`;
  return { code: cycles > 1 ? `${body}.slow(${cycles})` : body, report, empty: false };
}

// every way a grab differs from what was read, as plain sentences for the window (nothing the reports count may stay out of it)
export function lossesOf(r, rec) {
  const bits = [], tr = r.takeReport, hr = r.hits.report;
  if (r.take.events.length) {
    if (tr.clipped) bits.push(`${tr.clipped} note${tr.clipped === 1 ? '' : 's'} cut at the edge of the span`);
    if (tr.detuned) bits.push(`${tr.detuned} pitch${tr.detuned === 1 ? '' : 'es'} rounded to a semitone`);
    if (tr.silent) bits.push(`${tr.silent} silent note${tr.silent === 1 ? '' : 's'} left out`);
    if (tr.tooShort) bits.push(`${tr.tooShort} very short note${tr.tooShort === 1 ? '' : 's'} made longer`);
    if (tr.dynamicsClamped || tr.dynamicsChanged) bits.push(`${Math.max(tr.dynamicsClamped, tr.dynamicsChanged)} loudness value${Math.max(tr.dynamicsClamped, tr.dynamicsChanged) === 1 ? '' : 's'} kept within 0.1 to 1 and two places`);
    if (tr.badValues) bits.push(`${tr.badValues} note${tr.badValues === 1 ? '' : 's'} with a gain, velocity or clip that is not a number`);
    if (tr.pitchOverridden) bits.push(`${tr.pitchOverridden} note${tr.pitchOverridden === 1 ? '' : 's'} where a frequency sets the pitch, not the note`);
    if (tr.spanPadded) bits.push('the span is not a whole number of cycles, so the Take is padded to whole bars');
    if (tr.snap && tr.snap.snapped) bits.push(`${tr.snap.snapped} note${tr.snap.snapped === 1 ? '' : 's'} moved onto the grid`);
    if (tr.emitted.changed || tr.emitted.extra || tr.emitted.shortened || tr.emitted.dropped || tr.emitted.merged) bits.push('some notes change when written on the grid (shortened, merged or moved)');
    if (tr.storage.dropped) bits.push(`the Take keeps at most ${tr.storage.limit} notes, so ${tr.storage.dropped} would be lost: shorten the span`);
    else if (tr.storage.changed) bits.push('storing the notes (to a thousandth of a beat) changes how some are written');
    if (tr.controlsLost.length) bits.push(`a Take keeps pitch, timing and loudness only (not ${tr.controlsLost.slice(0, 6).join(', ')}${tr.controlsLost.length > 6 ? '…' : ''})`);
  }
  if (!r.hits.empty) {
    bits.push(`hits keep the sound (bank and sample number) and the starting time only, not how long they last${hr.gainLost ? ', nor their loudness' : ''}`);
    if (hr.snapped) bits.push(`${hr.snapped} hit${hr.snapped === 1 ? '' : 's'} moved onto a grid of ${hr.steps} per cycle`);
    if (hr.merged) bits.push(`${hr.merged} hit${hr.merged === 1 ? '' : 's'} that played at the same moment as another of the same sound became one`);
    if (hr.indexLost) bits.push(`${hr.indexLost} hit${hr.indexLost === 1 ? '' : 's'} with a sample number that cannot be written (left as the first sample)`);
    if (hr.renamed) bits.push(`${hr.renamed} sound name${hr.renamed === 1 ? '' : 's'} with characters that cannot be written`);
    if (hr.controlsLost.length) bits.push(`hits do not keep ${hr.controlsLost.slice(0, 6).join(', ')}${hr.controlsLost.length > 6 ? '…' : ''}`);
  }
  for (const w of (rec && rec.warnings) || []) bits.push(`the read itself says: ${String(w).slice(0, 160)}`);
  return bits;
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
