// From a recorded take to Strudel code.
//
//   take = { bpm, beatsPerBar = 4, events: [{ t, d, n, v }] }     t and d in beats (quarter notes), n a MIDI note (60 = c4), v loudness 0 to 1
//
// How a take becomes a pattern (every piece below was checked in the real Strudel engine):
//   - Notes are snapped to a grid (`grid` steps per beat; 24 keeps triplets and 16ths exactly, 4 is plain 16ths).
//   - Notes that start together and last the same time become one chord step: [c3,e3,g3]@4.
//   - Notes that overlap are dealt into lanes (voices). One lane is one flat sequence, written with weights: c4@3 holds for three steps and ~@2 is a rest.
//     A lane is a single long sequence that is slowed to span the bars, so a note can cross any bar line and stay one note.
//   - A long take is cut into sections that each fit a readable size, joined by arrange([bars, section], ...). A note that crosses the end of a section is cut there.
//   - Loudness is a second string with the same shape, written as .velocity("...").
//   - A loop over part of the take is .ribbon(startBar, bars).
// Nothing here touches the page: it is plain functions, so it can be tested against the engine.
const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
export const noteName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const fmtNum = (v) => String(Math.round(v * 100) / 100);

// snap the notes to the grid, make chords, and deal the steps into lanes. Returns the steps with their final start and length (in grid steps).
export function quantizeTake(take, { grid = 24, overlap } = {}) {
  const bpb = Number(take.beatsPerBar) || 4, T = grid * bpb, tol = overlap ?? Math.max(1, Math.round(grid / 2));   // a note may run this far into the next one before it needs its own lane
  const groups = new Map();
  let dropped = 0;
  for (const e of take.events || []) {
    if (!(e && Number.isFinite(e.t) && Number.isFinite(e.d) && Number.isInteger(e.n) && e.n >= 0 && e.n <= 127) || e.t < 0) { dropped++; continue; }
    const s = Math.round(e.t * grid), dur = Math.max(1, Math.round((e.t + e.d) * grid) - s), key = s + ':' + dur;
    const g = groups.get(key) || { s, dur, notes: new Set(), vel: 0 };
    g.notes.add(e.n); g.vel = Math.max(g.vel, Number.isFinite(e.v) ? Math.min(1, Math.max(0, e.v)) : 0.8);
    groups.set(key, g);
  }
  const steps = [...groups.values()].map((g) => ({ s: g.s, dur: g.dur, notes: [...g.notes].sort((a, b) => a - b), vel: g.vel })).sort((a, b) => a.s - b.s || b.dur - a.dur || a.notes[0] - b.notes[0] || a.vel - b.vel);   // equal starts and lengths: lowest note first, so the same notes always give the same voices
  const lanes = []; let shortened = 0;
  for (const st of steps) {
    let placed = false;
    for (let li = 0; li < lanes.length && !placed; li++) {
      const last = lanes[li][lanes[li].length - 1], end = last.s + last.dur;
      if (end <= st.s) placed = true;
      else if (end - st.s <= tol && st.s - last.s >= 1) { last.dur = st.s - last.s; shortened++; placed = true; }   // a little overlap: end the earlier note where the next begins
      if (placed) { lanes[li].push(st); st.lane = li; }
    }
    if (!placed) { st.lane = lanes.length; lanes.push([st]); }
  }
  const total = Math.max(steps.reduce((m, s) => Math.max(m, s.s + s.dur), 0), Number.isFinite(take.length) && take.length > 0 ? Math.round(take.length * grid) : 0);   // an optional take.length (beats) keeps the rest at the end of a capture
  return { steps, lanes, T, grid, bars: Math.max(1, Math.ceil(total / T)), shortened, dropped };
}

const tokens = (stepsInSection, from, to) => {
  const out = []; let cur = from;
  for (const st of stepsInSection) {
    if (st.s > cur) out.push({ rest: true, w: st.s - cur });
    out.push({ rest: false, w: st.dur, st }); cur = st.s + st.dur;
  }
  if (cur < to) out.push({ rest: true, w: to - cur });
  return out;
};
const writeTokens = (toks, valueOf) => {
  let g = 0; for (const t of toks) g = gcd(g, t.w);
  g = g || 1;
  return toks.map((t) => { const w = t.w / g, base = t.rest ? '~' : valueOf(t.st); return w === 1 ? base : `${base}@${w}`; }).join(' ');
};
const chordText = (st) => (st.notes.length === 1 ? noteName(st.notes[0]) : `[${st.notes.map(noteName).join(',')}]`);

// the pattern for the whole take, without a sound or a tempo: arrange(...) or one slowed sequence
export function takeToPattern(take, opts = {}) {
  const { grid = 24, velocity = true, maxChars = 6500, loop = null } = opts;
  const q = quantizeTake(take, { grid, overlap: opts.overlap });
  const { T, lanes, bars } = q;
  // One section is a stretch of bars short enough that every string in it stays under `maxChars` (a Note Pattern module holds up to 8000 characters of text).
  // The size of each bar is estimated per lane to decide where the sections end, then every section is written and checked, and split again if it came out too long.
  const HARD = 7800;
  const cost = lanes.map(() => Array(bars).fill(0));
  lanes.forEach((lane, li) => { for (const st of lane) { const b = Math.min(bars - 1, Math.floor(st.s / T)); cost[li][b] += Math.max(chordText(st).length, fmtNum(st.vel).length) + 6; } });
  const writeSection = (a, b) => {
    const from = a * T, to = b * T, laneCode = []; let trunc = 0, widest = 0; const steps = [];
    for (const lane of lanes) {
      const inSec = lane.filter((s) => s.s >= from && s.s < to).map((s) => { if (s.s + s.dur > to) { trunc++; return { ...s, dur: to - s.s }; } return s; });
      if (!inSec.length) continue;
      steps.push(...inSec);
      const toks = tokens(inSec, from, to);
      const names = writeTokens(toks, chordText), vel = velocity ? writeTokens(toks, (s) => fmtNum(s.vel)) : '';
      widest = Math.max(widest, names.length, vel.length);
      laneCode.push(`note("${names}")` + (velocity ? `.velocity("${vel}")` : ''));
    }
    return { a, b, bars: b - a, laneCode, trunc, widest, steps };
  };
  const sectionsOut = [];
  const place = (a, b) => {
    const sec = writeSection(a, b);
    if (sec.widest > HARD && b - a > 1) { const mid = a + Math.ceil((b - a) / 2); place(a, mid); place(mid, b); } else sectionsOut.push(sec);
  };
  let b0 = 0;
  while (b0 < bars) {
    let b1 = b0 + 1; const sums = lanes.map((_, li) => cost[li][b0]);
    while (b1 < bars && lanes.every((_, li) => sums[li] + cost[li][b1] + 8 <= maxChars)) { lanes.forEach((_, li) => { sums[li] += cost[li][b1]; }); b1++; }
    place(b0, b1); b0 = b1;
  }
  let truncated = 0, chars = 0; const debugSteps = [];
  sectionsOut.forEach((sec, si) => { truncated += sec.trunc; chars += sec.laneCode.reduce((t, l) => t + l.length, 0); sec.steps.forEach((s) => debugSteps.push({ ...s, section: si })); });
  const built = sectionsOut;
  const sectionText = (s, indent) => {
    if (!s.laneCode.length) return 'silence';
    const body = s.laneCode.length === 1 ? s.laneCode[0] : `stack(\n${s.laneCode.map((l) => indent + '  ' + l).join(',\n')}\n${indent})`;
    return s.bars > 1 ? `${body}.slow(${s.bars})` : body;
  };
  let pattern;
  if (built.length === 1) pattern = sectionText(built[0], '');
  else pattern = `arrange(\n${built.map((s) => `  [${s.bars}, ${sectionText(s, '  ')}]`).join(',\n')}\n)`;
  if (loop && Number(loop.bars) > 0) pattern += `.ribbon(${Math.max(0, Math.round(loop.start || 0))}, ${Math.round(loop.bars)})`;
  return {
    pattern, grid, ticksPerBar: T, bars, lanes: lanes.length, sections: built.length, notes: q.steps.reduce((n, s) => n + s.notes.length, 0), steps: q.steps.length,
    shortened: q.shortened, truncated, dropped: q.dropped, chars, codeChars: pattern.length, debugSteps,
  };
}

// a whole program: the tempo, the pattern, and a sound
export function takeToCode(take, opts = {}) {
  const r = takeToPattern(take, opts);
  const bpb = Number(take.beatsPerBar) || 4, bpm = Number(take.bpm) || 120;
  const sound = opts.sound ? `.s("${String(opts.sound).replace(/[^A-Za-z0-9_:.-]/g, '')}")` : '';
  return { ...r, code: `setcpm(${fmtNum(bpm)}/${bpb})\n\n$: ${r.pattern}${sound}\n` };
}
