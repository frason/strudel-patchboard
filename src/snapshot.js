// Rhythm snapshot: draw what a patch plays over a few bars as a picture, so the rhythm and the tempo can be read by eye (and shared).
//  queryPatch   evaluates the patch's code offline (no audio, nothing starts) and returns its events
//  layoutSnapshot  turns events into lanes and time positions (pure, tested without a browser)
//  drawSnapshot    paints a layout on a canvas
import { guardCode } from './guard.js';
import { exclusive } from './evallock.js';
import { makeSliderWithID } from './slider.js';
import { recordFromHaps } from './events.js';

let offline = null, queue = Promise.resolve();
const offlineSliders = {};   // the offline evaluator's own Slider values
// Evaluate compiled code without sound. Only code that passes the same guard as playback is ever run.
const initOffline = () => (async () => {
  // In the browser this uses the very same Strudel as the audio player (the one inside @strudel/web). A second copy would take the shared names (stack, note ...) from the
  // player on first use and break its next evaluation ("stack(...).p is not a function"). Node (the tests) has no player, so it uses the plain packages.
  const web = typeof window === 'undefined' ? null : await import('@strudel/web');
  if (web) {
    await web.evalScope(web);   // sliderWithID is not part of this: it is put in place only while a query runs (see below), so the player keeps its own
    return { ref: web.ref, setCpsFunc: web.setCpsFunc, repl: web.repl({ defaultOutput() {}, getTime: () => 0, transpiler: web.transpiler, setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a), onEvalError: (e) => { throw e; } }) };
  }
  const [core, mini, tonal, transpiler] = await Promise.all([import('@strudel/core'), import('@strudel/mini'), import('@strudel/tonal'), import('@strudel/transpiler')]);
  await core.evalScope(core, mini, tonal);
  return { ref: core.ref, setCpsFunc: core.setCpsFunc, repl: core.repl({ defaultOutput() {}, getTime: () => 0, transpiler: transpiler.transpiler, setInterval: (...a) => setInterval(...a), clearInterval: (...a) => clearInterval(...a), onEvalError: (e) => { throw e; } }) };
})();
// the raw haps of a stretch of cycles of this code (see evallock.js for why queries take turns)
export const MAX_RANGE = 256;
// The offline evaluator is a second Strudel "repl" in the same page, and building or evaluating with it rebinds names the player's code reads while it plays (the tempo hook `getCps`,
// setcpm, all, each, hush ...). Every query puts them back when it is done. The engine tells us how to read the player's own tempo (bindPlayerClock).
let playerCps = null;
export const bindPlayerClock = (fn) => { playerCps = fn; };
const SHARED = ['all', 'each', 'hush', 'cpm', 'setCps', 'setcps', 'setCpm', 'setcpm', 'compileKabel'];   // cycles one query may ask for
async function queryHaps(code, from, to, sliders = null, timing = null) {
  const refused = guardCode(code);
  if (refused) throw new Error('Not drawn: ' + refused);
  if (!(to > from) || to - from > MAX_RANGE) throw new Error(`Not drawn: a query may ask for 1 to ${MAX_RANGE} cycles at a time`);
  // one at a time: the engine keeps the pattern it just evaluated in one shared place, so two pictures asking together could be handed each other's notes
  // The audio engine and this offline evaluator share Strudel's global names. If the engine was still starting up when this ran, the names can briefly belong to a
  // half-built engine ("... .p is not a function"): build the offline evaluator again and ask once more before giving up.
  // The Slider values of a query live in a store of their own, and the global sliderWithID that the evaluated code calls is swapped in for the length of the query and put
  // back after: a picture or a download list must never reset a Slider (or replace the player's sliderWithID, which would cut the live Slider from the sound).
  const run = () => exclusive(async () => {
    if (!offline) offline = initOffline();   // built here, inside the turn: building it sets shared global names, which must never overlap a player evaluation
    const saved = globalThis.sliderWithID, keep = {}; for (const k of SHARED) keep[k] = globalThis[k];
    let o = null;
    try {
      o = await offline;
      const t0 = performance.now();   // the cost of the query itself: waiting for the turn and building the evaluator for the first time are not counted
      globalThis.sliderWithID = makeSliderWithID(o.ref, offlineSliders);
      try { o.repl.scheduler.setCps(0.5); } catch { /* the default tempo, so a patch that sets none is read the way the player reads it */ }
      const pat = await o.repl.evaluate(code, false);
      const applied = {};
      for (const [id, v] of Object.entries(sliders || {})) if (typeof v === 'number' && Number.isFinite(v)) { offlineSliders[id] = v; applied[id] = v; }   // a captured live value replaces the one in the code, for this query only; anything else is ignored and not reported as applied
      const cps = Number(o.repl.scheduler.cps) || 0.5;
      const haps = pat.queryArc(from, to, { _cps: cps });   // the tempo the player passes to every query (loopAt, speed ... read it), so the offline notes carry the same values
      if (timing) timing.ms = performance.now() - t0;
      return { haps, cps, applied };
    } finally {
      globalThis.sliderWithID = saved;
      for (const k of SHARED) if (keep[k] !== undefined) globalThis[k] = keep[k];
      if (o && playerCps && o.setCpsFunc) o.setCpsFunc(() => playerCps());   // the player's clock, not the offline one's
    }
  });
  const turn = queue.then(() => run().catch(async (e) => {
    if (!/is not a function|is not defined/.test(String((e && e.message) || e))) throw e;
    offline = null; await new Promise((r) => setTimeout(r, 400));
    return run();   // run() builds a fresh offline evaluator inside its own turn
  }));
  queue = turn.catch(() => {});
  return turn;
}

export async function queryPatch(code, cycles) {
  return (await queryHaps(code, 0, cycles)).haps.filter((h) => h.hasOnset()).map((h) => {
    const v = h.value || {}, begin = h.whole.begin.valueOf(), dur = h.duration.valueOf();
    return { start: begin, end: begin + dur, s: v.s, note: v.note, n: v.n, bank: v.bank, gain: v.gain, velocity: v.velocity };
  });
}


// The full event record (src/events.js) of cycles from..to: exact positions, every control, the span, the revision. For the cable x-ray, Grab and Bake.
// context.sliders ({ slider_id: value }) are live Slider values to use for this query; they are applied, and the record says which were.
export async function queryEvents(code, { from = 0, to = 4, kind = 'queried', context = {}, timing = null } = {}) {   // timing: an object that gets .ms, the milliseconds the query itself took inside its turn
  const r = await queryHaps(code, from, to, context.sliders, timing);
  return recordFromHaps(r.haps, { from, to, code, kind, context: { cps: r.cps, ...(context.sliders ? { sliders: r.applied } : {}) } });
}

const NOTE_INDEX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function midiOf(note) {
  if (typeof note === 'number') return note;
  const m = /^([a-gA-G])([#bs]*)(-?\d+)?$/.exec(String(note ?? ''));
  if (!m) return null;
  let semi = NOTE_INDEX[m[1].toLowerCase()];
  for (const ch of m[2]) semi += ch === '#' || ch === 's' ? 1 : -1;
  return semi + 12 * ((m[3] === undefined ? 3 : Number(m[3])) + 1);
}
export function noteName(midi) { return ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'][((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }

// the order drum lanes read in: low to high, then anything else, then the pitched lanes
const DRUM_ORDER = ['bd', 'sd', 'rim', 'cp', 'lt', 'mt', 'ht', 'hh', 'oh', 'cr', 'rd'];

// events: [{ start, end, s, note, bank, gain, velocity }] in cycles. Returns everything needed to draw, in seconds.
export function layoutSnapshot(events, { bpm, beats = 4, cycles = 2 }) {
  const cycleSec = (60 / bpm) * beats, total = cycles * cycleSec;
  const lanes = new Map();
  for (const e of events) {
    if (e.start >= cycles - 1e-9) continue;
    const pitched = e.note !== undefined && e.note !== null;
    const name = String(e.s ?? (pitched ? 'note' : e.n ?? 'sound'));
    const key = (pitched ? 'p:' : 'd:') + name + (e.bank && !pitched ? '@' + e.bank : '');
    if (!lanes.has(key)) lanes.set(key, { key, label: name + (e.bank && !pitched ? ' · ' + e.bank : ''), pitched, name, events: [] });
    const level = Math.max(0.15, Math.min(1, (e.gain ?? 1) * (e.velocity ?? 1)));
    lanes.get(key).events.push({ t0: e.start * cycleSec, t1: Math.min(e.end, cycles) * cycleSec, level, midi: pitched ? midiOf(e.note) : null });
  }
  const list = [...lanes.values()];
  const rank = (l) => (l.pitched ? 1000 : DRUM_ORDER.includes(l.name) ? DRUM_ORDER.indexOf(l.name) : 100);
  list.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  for (const l of list) {
    l.events.sort((a, b) => a.t0 - b.t0);
    if (l.pitched) {
      const ms = l.events.map((e) => e.midi).filter((m) => m !== null);
      l.lo = ms.length ? Math.min(...ms) : 0; l.hi = ms.length ? Math.max(...ms) : 0;
      l.label += ms.length ? ` · ${noteName(l.lo)}${l.hi > l.lo ? '–' + noteName(l.hi) : ''}` : '';
    }
  }
  const beatLines = []; const n = Math.round(cycles * beats);
  for (let i = 0; i <= n; i++) beatLines.push({ t: (i * 60) / bpm, bar: i % beats === 0, beat: (i % beats) + 1, barNo: Math.floor(i / beats) + 1 });
  return { bpm, beats, cycles, cycleSec, total, lanes: list, beatLines, hits: list.reduce((a, l) => a + l.events.length, 0) };
}

const KIND = { bd: '#ff9f4a', sd: '#ff7aa8', rim: '#ff7aa8', cp: '#ff7aa8', hh: '#64a0ff', oh: '#64a0ff', cr: '#64a0ff', rd: '#64a0ff', lt: '#e0c050', mt: '#e0c050', ht: '#e0c050' };
// Paint a layout. The canvas is sized here so the same picture comes out whatever the screen.
export function drawSnapshot(canvas, lay, { title = '' } = {}) {
  const W = 1600, LEFT = 190, RIGHT = 24, TOP = 78, BOTTOM = 46, drumH = 34, pitchH = 110, gap = 6;
  const H = TOP + lay.lanes.reduce((a, l) => a + (l.pitched ? pitchH : drumH) + gap, 0) + BOTTOM;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d'), px = (t) => LEFT + (t / lay.total) * (W - LEFT - RIGHT);
  c.fillStyle = '#14181d'; c.fillRect(0, 0, W, H);
  c.fillStyle = '#e6ebf0'; c.font = '600 22px system-ui, sans-serif'; c.textBaseline = 'alphabetic';
  c.fillText(`${+lay.bpm.toFixed(2)} BPM  ·  ${lay.beats} beats per bar  ·  ${lay.cycles} bar${lay.cycles === 1 ? '' : 's'}  ·  ${lay.total.toFixed(2)} s`, 20, 34);
  if (title) { c.fillStyle = '#8b98a6'; c.font = '14px system-ui, sans-serif'; c.fillText(title, 20, 56); }
  // lanes
  let y = TOP; const rows = [];
  for (const l of lay.lanes) { const h = l.pitched ? pitchH : drumH; rows.push([l, y, h]); y += h + gap; }
  const bodyBottom = y;
  rows.forEach(([l, y0, h], i) => { c.fillStyle = i % 2 ? '#181d23' : '#1b2128'; c.fillRect(LEFT, y0, W - LEFT - RIGHT, h); });
  // beat and bar lines
  for (const b of lay.beatLines) {
    const x = px(b.t);
    c.strokeStyle = b.bar ? 'rgba(120,230,230,.75)' : 'rgba(120,230,230,.22)'; c.lineWidth = b.bar ? 2 : 1;
    c.beginPath(); c.moveTo(x, TOP - 16); c.lineTo(x, bodyBottom); c.stroke();
    if (b.t < lay.total - 1e-9) { c.fillStyle = b.bar ? '#9ff' : '#6fa'; c.font = (b.bar ? '600 ' : '') + '13px system-ui, sans-serif'; c.fillText(b.bar ? `bar ${b.barNo}` : String(b.beat), x + 4, TOP - 20); }
  }
  // events and labels
  for (const [l, y0, h] of rows) {
    c.fillStyle = '#c9d2db'; c.font = '14px system-ui, sans-serif'; c.fillText(l.label.length > 24 ? l.label.slice(0, 23) + '…' : l.label, 14, y0 + h / 2 + 5);
    const colour = KIND[l.name] || (l.pitched ? '#b48cff' : '#7ad68b');
    for (const e of l.events) {
      // a drum hit is an onset: its step length says nothing about how long it sounds, so it is drawn as a short mark. A pitched note shows its real length.
      const x0 = px(e.t0), w = Math.max(3, px(l.pitched ? e.t1 : Math.min(e.t1, e.t0 + 0.12)) - x0 - 1);
      let ey = y0 + 4, eh = h - 8;
      if (l.pitched && e.midi !== null) { const span = Math.max(1, l.hi - l.lo); eh = 9; ey = y0 + h - 8 - 9 - ((e.midi - l.lo) / span) * (h - 26); }
      c.globalAlpha = 0.35 + 0.65 * e.level; c.fillStyle = colour; c.beginPath(); c.roundRect ? c.roundRect(x0, ey, w, eh, 3) : c.rect(x0, ey, w, eh); c.fill();
    }
    c.globalAlpha = 1;
  }
  // time axis
  c.strokeStyle = '#59636e'; c.fillStyle = '#8b98a6'; c.font = '13px system-ui, sans-serif'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(LEFT, bodyBottom + 4); c.lineTo(W - RIGHT, bodyBottom + 4); c.stroke();
  for (let s = 0; s <= Math.floor(lay.total + 1e-9); s++) { const x = px(s); c.beginPath(); c.moveTo(x, bodyBottom + 4); c.lineTo(x, bodyBottom + 10); c.stroke(); c.fillText(s + ' s', x - 8, bodyBottom + 26); }
  c.fillStyle = '#59636e'; c.font = '12px system-ui, sans-serif'; c.fillText('Strudel Patchboard', W - 150, H - 10);
}
