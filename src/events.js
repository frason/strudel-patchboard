// The event record: what a pattern plays over a stretch of cycles, kept exactly enough to be inspected, compared and turned into other things (a Take, a drum pattern).
// This is the one contract that the cable x-ray, Grab, Bake and the form map share (docs/ROADMAP.md section 8, change 3; handoff 0001, finding F3).
//
//   record = { v: 1, kind, span: { from, to }, revision, engine, context, events: [event], warnings: [text] }
//   event  = { at: [n, d], dur: [n, d], carry?: 'in' | 'out' | 'both', controls: { s, note, n, gain, ... } }
//
// - Positions are exact fractions of a cycle ([numerator, denominator]), never rounded floats: a triplet stays 1/3.
// - `dur` is the length of the event itself (its gate). The release, the clip and every other control stay in `controls`, so gate and audio tail are never mixed up.
// - `controls` keeps every number, text and boolean the pattern resolved for that event (filters, pan, orbit, release ...). Nothing is thrown away because a picture did not need it.
// - `span` is the queried range, `revision` identifies the code that was queried, `engine` the Strudel build, `context` what else the answer depends on (tempo, slider values).
// - `kind` says where the events come from: 'queried' (asked of the live pattern), 'inferred' (estimated from audio) or 'corrected' (edited by hand), so tools can treat them differently.
// - `carry` marks an event that began before the span ('in') or ends after it ('out'): it is reported, never silently cut.
// Converting to something with fewer features (a Take) reports every loss in a `report`; it never claims to be exact when it is not.
// Plain functions, no DOM: tested without a browser.
import { quantizeTake } from './takecode.js';

export const EVENTS_V = 1;
export const ENGINE_ID = '@strudel/web 1.3.0 (core 1.2.6)';

// a Strudel fraction (n, d, sign s) as an exact [numerator, denominator] pair
export const pair = (f) => (f && typeof f === 'object' && 'n' in f ? [(Number(f.s) || 1) * Number(f.n), Number(f.d)] : [Math.round(Number(f) * 1e6), 1e6]);   // Strudel's fractions hold BigInts: plain numbers here, so a record is ordinary JSON
export const num = ([n, d]) => n / d;

// a short stable identifier for a piece of code (FNV-1a, 32 bits): enough to tell revisions apart, not a security hash
export function revisionOf(code) {
  let h = 0x811c9dc5;
  const s = String(code);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const keepValue = (v) => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string' || typeof v === 'boolean';
// the plain controls of one event value (functions, nested objects and the drawing-only colour are left out; the count left out is reported)
export function controlsOf(value) {
  const controls = {}; let left = 0;
  const v = value && typeof value === 'object' ? value : { value };
  for (const [k, x] of Object.entries(v)) { if (k === 'color') continue; if (keepValue(x)) controls[k] = x; else left++; }
  return { controls, left };
}

// haps: Strudel haps from queryArc(from, to). Only events that BEGIN inside the span count as events; events that began earlier are reported as carry-in.
export function recordFromHaps(haps, { from, to, code = '', kind = 'queried', context = {}, engine = ENGINE_ID } = {}) {
  const events = [], warnings = []; let dropped = 0, nested = 0;
  for (const h of haps) {
    if (!h.whole) { dropped++; continue; }   // a continuous signal has no beginning: it is not an event
    const at = pair(h.whole.begin), end = pair(h.whole.end), dur = pair(h.whole.end.sub(h.whole.begin));
    const startsBefore = num(at) < from, endsAfter = num(end) > to, { controls, left } = controlsOf(h.value);
    nested += left;
    const e = { at, dur, controls };
    if (startsBefore || endsAfter) e.carry = startsBefore && endsAfter ? 'both' : startsBefore ? 'in' : 'out';
    events.push(e);
  }
  events.sort((a, b) => num(a.at) - num(b.at) || String(a.controls.note ?? a.controls.s ?? '').localeCompare(String(b.controls.note ?? b.controls.s ?? '')));
  if (nested) warnings.push(`${nested} control value${nested === 1 ? '' : 's'} that are not plain numbers or text were left out`);
  if (dropped) warnings.push(`${dropped} value${dropped === 1 ? '' : 's'} without a beginning (continuous signals) were left out`);
  return { v: EVENTS_V, kind, span: { from, to }, revision: revisionOf(code), engine, context, events, warnings };
}

// ---- reading a record ----
export const onsets = (rec) => rec.events.filter((e) => e.carry !== 'in' && e.carry !== 'both');   // events that begin inside the span
export const bounds = (rec) => ({ carryIn: rec.events.filter((e) => e.carry === 'in' || e.carry === 'both').length, carryOut: rec.events.filter((e) => e.carry === 'out' || e.carry === 'both').length });

// ---- converting to a Take (notes) ----
// The note of an event as a MIDI number, or null when it has none (a sample hit has no note).
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function midiOfControl(c) {
  const x = c.note ?? null;
  if (typeof x === 'number' && Number.isFinite(x)) return Math.round(x);
  const m = /^([a-gA-G])([#bs]*)(-?\d+)?$/.exec(String(x ?? ''));
  if (!m) return null;
  let semi = PC[m[1].toLowerCase()]; for (const ch of m[2]) semi += ch === '#' || ch === 's' ? 1 : -1;
  return 12 * ((m[3] === undefined ? 3 : Number(m[3])) + 1) + semi;
}
// rec -> { take: { bpm, beatsPerBar, events: [{ t, d, n, v }] }, report }. beats = cycle position * beatsPerBar. Nothing is hidden: the report lists what the Take cannot hold.
export function recordToTake(rec, { bpm = 120, beatsPerBar = 4, grid = 0 } = {}) {
  const events = [], report = { lossless: true, noNote: 0, carry: 0, controlsLost: new Set(), shortened: 0, snapped: 0, maxSnapBeats: 0 };
  const lose = (k) => report.controlsLost.add(k);
  for (const e of rec.events) {
    if (e.carry) report.carry++;
    const n = midiOfControl(e.controls);
    if (n === null || n < 0 || n > 127) { report.noNote++; continue; }
    for (const k of Object.keys(e.controls)) if (!['note', 'n', 's', 'gain', 'velocity'].includes(k)) lose(k);
    const v = Math.min(1, Math.max(0.1, (typeof e.controls.velocity === 'number' ? e.controls.velocity : 1) * (typeof e.controls.gain === 'number' ? Math.min(1, e.controls.gain) : 1)));
    events.push({ t: num(e.at) * beatsPerBar, d: Math.max(0.05, num(e.dur) * beatsPerBar), n, v: Math.round(v * 100) / 100 });
  }
  const take = { bpm, beatsPerBar, events };
  if (grid) {   // snapping for editing is a choice, and it is measured
    const q = quantizeTake(take, { grid });
    report.shortened = q.shortened;
    for (const ev of events) { const err = Math.abs(ev.t * grid - Math.round(ev.t * grid)) / grid; if (err > 1e-9) { report.snapped++; report.maxSnapBeats = Math.max(report.maxSnapBeats, err); } }
  }
  report.controlsLost = [...report.controlsLost].sort();
  report.maxSnapBeats = Math.round(report.maxSnapBeats * 1e4) / 1e4;
  report.lossless = !(report.noNote || report.controlsLost.length || report.shortened || report.snapped);
  return { take, report };
}
