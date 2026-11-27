// The event record: what a pattern plays over a stretch of cycles, kept exactly enough to be inspected, compared and turned into other things (a Take, a drum pattern).
// This is the one contract that the cable x-ray, Grab, Bake and the form map share (docs/ROADMAP.md section 8, change 3; handoff 0001, finding F3).
//
//   record = { v: 1, kind, span: { from, to }, revision, engine, context, events: [event], warnings: [text] }
//   event  = { at: [n, d], dur: [n, d], carry?: 'in' | 'out' | 'both', controls: { s, note, n, gain, ... } }
//
// - Positions are exact fractions of a cycle ([numerator, denominator]), never rounded floats: a triplet stays 1/3.
// - `dur` is the event's SLOT in the pattern (its whole), not how long it sounds: the clip (note length multiplier), the release and every other control stay in `controls`. `gateOf(event)` gives the
//   effective note length (slot times clip) and the release is never added to it.
// - `controls` keeps every number, text and boolean the pattern resolved for that event (filters, pan, orbit, release ...), and short lists of numbers or text (Harmonics partials). Nothing is thrown away because
//   a picture did not need it; whatever cannot be kept (functions, nested objects) is counted in `warnings`.
// - `span` is the queried range, `revision` identifies the code that was queried, `engine` the Strudel build, `context` what else the answer depends on (tempo, slider values).
// - `kind` says where the events come from: 'queried' (asked of the live pattern), 'inferred' (estimated from audio) or 'corrected' (edited by hand), so tools can treat them differently.
// - `carry` marks an event that began before the span ('in') or ends after it ('out'): it is reported, never silently cut. An event is an ATTACK: later fragments of one event that only change a control part-way
//   through (velocity ".2 .8") are not new attacks and are folded into it (their count is in `warnings`).
// Converting to something with fewer features (a Take) reports every loss in a `report`; it never claims to be exact when it is not.
// Plain functions, no DOM: tested without a browser.
import { quantizeTake, takeToPattern } from './takecode.js';
import { cleanTakeEvents, TAKE_MAX_EVENTS } from './validate.js';

export const EVENTS_V = 1;
export const ENGINE_ID = '@strudel/web 1.3.0 (core 1.2.6)';

// a Strudel fraction (numerator n, denominator d, sign s; BigInts) as a [numerator, denominator] pair of plain numbers. Exact while both fit a safe integer; otherwise approximate and said so (`exact` false).
const SAFE = (x) => { const b = BigInt(x); return b >= -9007199254740991n && b <= 9007199254740991n; };
export function pairOf(f) {
  if (f && typeof f === 'object' && 'n' in f) {
    if (SAFE(f.n) && SAFE(f.d)) return { p: [(Number(f.s) || 1) * Number(f.n), Number(f.d)], exact: true };
    return { p: [Math.round(((Number(f.s) || 1) * Number(f.n) / Number(f.d)) * 1e6), 1e6], exact: false };
  }
  return { p: [Math.round(Number(f) * 1e6), 1e6], exact: false };
}
export const pair = (f) => pairOf(f).p;
export const num = ([n, d]) => n / d;

// a short stable identifier for a piece of code (FNV-1a, 32 bits): enough to tell revisions apart, not a security hash
export function revisionOf(code) {
  let h = 0x811c9dc5;
  const s = String(code);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const MAX_LIST = 64, MAX_EVENTS = 50000;
const keepScalar = (v) => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string' || typeof v === 'boolean';
const keepList = (v) => Array.isArray(v) && v.length <= MAX_LIST && v.every(keepScalar);   // Harmonics partials and the like: short lists of plain values
// the plain controls of one event value (functions, nested objects and the drawing-only colour are left out; the count left out is reported)
export function controlsOf(value) {
  const controls = {}; let left = 0;
  const v = value && typeof value === 'object' ? value : { value };
  for (const [k, x] of Object.entries(v)) { if (k === 'color') continue; if (keepScalar(x)) controls[k] = x; else if (keepList(x)) controls[k] = x.slice(); else left++; }
  return { controls, left };
}

// haps: Strudel haps from queryArc(from, to). An event is an ATTACK: a hap that begins an event inside the span, or the first fragment of an event carried in from before it.
// Later fragments (a control changing part-way through an event) are folded into the event they belong to.
export function recordFromHaps(haps, { from, to, code = '', kind = 'queried', context = {}, engine = ENGINE_ID } = {}) {
  const events = [], warnings = []; let dropped = 0, nested = 0, folded = 0, inexact = 0, cut = 0;
  for (const h of haps) {
    if (!h.whole) { dropped++; continue; }   // a continuous signal has no beginning: it is not an event
    const partBegin = num(pair(h.part.begin)), wholeBegin = num(pair(h.whole.begin));
    const attack = h.hasOnset(), carriedFirst = !attack && wholeBegin < from - 1e-12 && Math.abs(partBegin - from) < 1e-9;
    if (!attack && !carriedFirst) { folded++; continue; }
    if (events.length >= MAX_EVENTS) { cut++; continue; }
    const a = pairOf(h.whole.begin), end = pairOf(h.whole.end), d = pairOf(h.whole.end.sub(h.whole.begin));
    if (!a.exact || !end.exact || !d.exact) inexact++;
    const at = a.p, dur = d.p, startsBefore = num(at) < from - 1e-12, endsAfter = num(end.p) > to + 1e-12, { controls, left } = controlsOf(h.value);
    nested += left;
    const e = { at, dur, controls };
    if (startsBefore || endsAfter) e.carry = startsBefore && endsAfter ? 'both' : startsBefore ? 'in' : 'out';
    events.push(e);
  }
  events.sort((x, y) => num(x.at) - num(y.at) || String(x.controls.note ?? x.controls.s ?? '').localeCompare(String(y.controls.note ?? y.controls.s ?? '')));
  if (nested) warnings.push(`${nested} control value${nested === 1 ? '' : 's'} that are not plain numbers, text or short lists were left out`);
  if (dropped) warnings.push(`${dropped} value${dropped === 1 ? '' : 's'} without a beginning (continuous signals) were left out`);
  if (folded) warnings.push(`${folded} later piece${folded === 1 ? '' : 's'} of events (a control changing part-way through) were folded into the event they belong to; their controls are those at its start`);
  if (inexact) warnings.push(`${inexact} position${inexact === 1 ? '' : 's'} were too large to keep as exact fractions and are approximate`);
  if (cut) warnings.push(`only the first ${MAX_EVENTS} events were kept (${cut} more were left out)`);
  return { v: EVENTS_V, kind, span: { from, to }, revision: revisionOf(code), engine, context, events, warnings };
}

// ---- reading a record ----
export const onsets = (rec) => rec.events.filter((e) => e.carry !== 'in' && e.carry !== 'both');   // events that begin inside the span
export const bounds = (rec) => ({ carryIn: rec.events.filter((e) => e.carry === 'in' || e.carry === 'both').length, carryOut: rec.events.filter((e) => e.carry === 'out' || e.carry === 'both').length });
// how long the event sounds as a note: its slot times the clip (note length) when there is one. The release is a separate tail and is never added.
export const gateOf = (e) => num(e.dur) * (typeof e.controls.clip === 'number' && e.controls.clip >= 0 ? e.controls.clip : 1);

// ---- converting to a Take (notes) ----
// The note of an event as a (possibly fractional) MIDI number, or null when it has none (a sample hit has no note).
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function midiExact(c) {
  const x = c.note ?? null;
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  const m = /^([a-gA-G])([#bs]*)(-?\d+)?$/.exec(String(x ?? ''));
  if (!m) return null;
  let semi = PC[m[1].toLowerCase()]; for (const ch of m[2]) semi += ch === '#' || ch === 's' ? 1 : -1;
  return 12 * ((m[3] === undefined ? 3 : Number(m[3])) + 1) + semi;
}
export const midiOfControl = (c) => { const m = midiExact(c); return m === null ? null : Math.round(m); };

// rec -> { take: { bpm, beatsPerBar, events: [{ t, d, n, v }] }, report }.
// The Take starts at the start of the span (beat 0 is span.from): events carried in are clipped to it, events that run past the end are clipped to it, and both are counted.
// A note keeps its pitch, its slot-times-clip length and its loudness; whatever a Take cannot hold is counted in the report, so `lossless` is only true when nothing at all was lost:
//   noNote (sample hits), silent (gain or velocity 0: a Take has no silent notes), clipped (cut at the span), detuned (fractional pitch rounded), tooShort (under 0.05 beat),
//   dynamicsClamped (loudness above 1 or below 0.1), controlsLost (every control the Take does not carry, sound names included), snap (how far notes are from the grid they will be written on),
//   emitted (what writing the Take as a pattern would still change: overlaps shortened, simultaneous notes merged to one velocity).
// The Take carries `length` (the span in beats) so a rest at the end is kept; a span that is not whole bars is counted as spanPadded. Numbers closer than floating-point noise (1e-6 of a cent, 1e-9 of loudness, a millionth of a grid step) are treated as equal: that is the one tolerance, and it is not an audible one.
// `exactNotes` is the narrower promise: pitch, timing and loudness of every note kept, whatever else a Take cannot hold (the sound name, filters).
// `grid` is the grid the Take will be written on (default 24, the finest the writer uses); the returned Take is never snapped, the report says what snapping would do.
export function recordToTake(rec, { bpm = 120, beatsPerBar = 4, grid = 24 } = {}) {
  const from = rec.span.from, to = rec.span.to, events = [], lost = new Set(), sounds = new Set();
  const report = { lossless: true, exactNotes: true, noNote: 0, silent: 0, clipped: 0, detuned: 0, maxCents: 0, tooShort: 0, dynamicsClamped: 0, dynamicsChanged: 0, pitchOverridden: 0, badValues: 0, spanPadded: 0, controlsLost: [], sounds: [], snap: { grid, snapped: 0, maxSnapBeats: 0, preview: true }, emitted: { shortened: 0, dropped: 0, merged: 0, changed: 0, extra: 0 }, storage: { dropped: 0, changed: 0, limit: TAKE_MAX_EVENTS }, warnings: rec.warnings.slice() };
  for (const e of rec.events) {
    const exact = midiExact(e.controls);
    if (exact === null || Math.round(exact) < 0 || Math.round(exact) > 127) { report.noNote++; continue; }
    const badType = ['note', 'gain', 'velocity', 'clip'].filter((k) => k in e.controls && typeof e.controls[k] !== 'number' && !(k === 'note' && typeof e.controls[k] === 'string'));
    if (badType.length) { report.badValues++; for (const k of badType) lost.add(k); }   // a gain, velocity or clip that is not a number (false, "foo") is not turned into a default: it is reported
    const vel = typeof e.controls.velocity === 'number' ? e.controls.velocity : 1, gain = typeof e.controls.gain === 'number' ? e.controls.gain : 1, loud = vel * gain;
    if (!(loud > 0)) { report.silent++; continue; }
    const t0 = Math.max(num(e.at), from), t1 = Math.min(num(e.at) + gateOf(e), to);
    if (t0 > num(e.at) + 1e-12 || t1 < num(e.at) + gateOf(e) - 1e-12) report.clipped++;
    if (!(t1 > t0)) { report.clipped++; continue; }
    const cents = Math.abs(exact - Math.round(exact)) * 100; if (cents > 1e-6) { report.detuned++; report.maxCents = Math.max(report.maxCents, Math.round(cents * 100) / 100); }   // any difference counts: there is no "small enough to ignore"
    if ('freq' in e.controls && 'note' in e.controls) report.pitchOverridden++;   // a freq control sets the heard pitch over the note field
    const dBeats = (t1 - t0) * beatsPerBar; if (dBeats < 0.05) report.tooShort++;
    if (loud > 1 || loud < 0.1) report.dynamicsClamped++;
    const v = Math.round(Math.min(1, Math.max(0.1, loud)) * 100) / 100; if (Math.abs(v - loud) > 1e-9) report.dynamicsChanged++;   // clamped or rounded to two places
    for (const k of Object.keys(e.controls)) if (!['note', 'gain', 'velocity', 'clip'].includes(k)) lost.add(k);
    if (typeof e.controls.s === 'string') sounds.add(e.controls.s);
    events.push({ t: (t0 - from) * beatsPerBar, d: Math.max(0.05, dBeats), n: Math.round(exact), v });
  }
  const spanBars = to - from, take = { bpm, beatsPerBar, events, length: spanBars * beatsPerBar };   // the length of the capture, so silence at the end stays
  if (Math.abs(spanBars - Math.round(spanBars)) > 1e-9) report.spanPadded++;   // the written loop is whole bars: a span of 2.5 cycles comes out as 3
  for (const ev of events) { const err = Math.abs(ev.t * grid - Math.round(ev.t * grid)) / grid; if (err > 1e-9) { report.snap.snapped++; report.snap.maxSnapBeats = Math.max(report.snap.maxSnapBeats, err); } }
  report.snap.maxSnapBeats = Math.round(report.snap.maxSnapBeats * 1e4) / 1e4;
  // what writing the Take as a pattern really does: compare the notes the writer emits (after snapping starts AND ends, lanes, merging, and section cuts) with the Take's notes, one for one
  const q = quantizeTake(take, { grid }), w = takeToPattern(take, { grid }), tally = new Map(), key = (a, b, n, v) => [a, b, n, v].map((x) => Math.round(x * 1e6)).join(':');
  report.emitted.shortened = q.shortened; report.emitted.dropped = q.dropped;
  for (const ev of events) { const k = key(ev.t * grid, (ev.t + ev.d) * grid, ev.n, ev.v); tally.set(k, (tally.get(k) || 0) + 1); }
  for (const st of w.debugSteps) for (const n of st.notes) { const k = key(st.s, st.s + st.dur, n, Math.round(st.vel * 100) / 100), c = tally.get(k) || 0; if (c > 0) tally.set(k, c - 1); else report.emitted.extra++; }
  for (const c of tally.values()) report.emitted.changed += c;   // Take notes with no identical emitted note
  report.emitted.merged = Math.max(0, events.length - w.debugSteps.reduce((m, st) => m + st.notes.length, 0));   // notes that became fewer on the way out
  // what the Take module keeps (validate.js cleanTakeEvents: at most TAKE_MAX_EVENTS notes, positions to a thousandth of a beat): writing THOSE notes must give the same pattern, or the capture is not what is stored
  const kept = cleanTakeEvents(events); report.storage.dropped = events.length - kept.length;
  if (!report.storage.dropped) { const ws = takeToPattern({ ...take, events: kept }, { grid }).debugSteps, sk = (st) => [st.s, st.dur, st.notes.join('+'), Math.round(st.vel * 100)].join(':'), seen = new Map(); for (const st of w.debugSteps) seen.set(sk(st), (seen.get(sk(st)) || 0) + 1); for (const st of ws) { const c = seen.get(sk(st)) || 0; if (c > 0) seen.set(sk(st), c - 1); else report.storage.changed++; } }
  report.controlsLost = [...lost].sort(); report.sounds = [...sounds].sort();
  report.maxSnapBeats = report.snap.maxSnapBeats; report.snapped = report.snap.snapped;   // the same numbers at the top, for the callers that already read them
  report.exactNotes = !(report.noNote || report.silent || report.clipped || report.detuned || report.tooShort || report.dynamicsChanged || report.pitchOverridden || report.badValues || report.spanPadded || report.snap.snapped || report.storage.dropped || report.storage.changed || report.emitted.shortened || report.emitted.dropped || report.emitted.merged || report.emitted.changed || report.emitted.extra);
  report.lossless = report.exactNotes && !report.controlsLost.length && !report.sounds.length && !report.warnings.length;
  return { take, report };
}
