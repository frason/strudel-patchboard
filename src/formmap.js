// The form map: the shape of a song. One lane per voice, one cell per cycle, shaded by how much the voice plays there; patterns like <a b c>/16, mask("<0 0 1 1>/16") and arrange(...)
// show up as intros, drops and breaks. It reads each voice with the same offline query as the x-ray (snapshot.js), in chunks that give the page a moment to breathe between them.
// A voice is a module plugged into the Output (or into a Stack or Mixer that is). The query is of what the voice's module outputs: master volume and effects further along are not applied.
// Plain functions (the drawing takes a canvas): the reading and the counting are tested without a browser.
import { compileTap } from './compile.js';
import { queryEvents, MAX_RANGE } from './snapshot.js';
import { onsets, num, midiOfControl } from './events.js';
import { MODULES } from './modules.js';

export const MAP_LENGTHS = [16, 32, 64, 128];
const CHUNK = 4, VOICE_BUDGET_MS = 2500, MAX_VOICES = 24;

// the voices of a board: modules that feed the Output, looking through Stack and Mixer
export function voicesOf(graph) {
  const out = graph.nodes.find((n) => n.type === 'output'); if (!out) return [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n])), seen = new Set(), voices = [];
  const feeders = (id) => graph.wires.filter((w) => w.to.node === id && (w.to.port === 'in' || /^in\d*$/.test(w.to.port) || w.to.port === 'multi')).map((w) => byId.get(w.from.node)).filter(Boolean);
  const walk = (id, depth) => { for (const m of feeders(id)) { if (seen.has(m.id)) continue; seen.add(m.id); if ((m.type === 'stack' || m.type === 'mixer') && depth < 3) walk(m.id, depth + 1); else voices.push(m); } };
  walk(out.id, 0);
  const shown = voices.slice(0, MAX_VOICES); shown.omitted = voices.length - shown.length;   // voices beyond the limit are not read: the map says how many
  return shown;
}

// per-cycle counts of attacks, and the pitch range, from an event record
export function activityFromRecord(rec, from, cycles) {
  const counts = new Array(cycles).fill(0); let lo = Infinity, hi = -Infinity;
  for (const e of onsets(rec)) {
    const c = Math.floor(num(e.at) - from + 1e-9); if (c >= 0 && c < cycles) counts[c]++;
    const m = midiOfControl(e.controls); if (m !== null) { if (m < lo) lo = m; if (m > hi) hi = m; }
  }
  return { counts, lo: lo === Infinity ? null : lo, hi: hi === -Infinity ? null : hi, warnings: rec.warnings.filter((w) => /only the first|too large|left out/.test(w)) };
}

const breathe = () => new Promise((r) => setTimeout(r, 0));
// reads every voice over `cycles` cycles from `from`. onProgress(done, total) between chunks; `cancelled()` stops it. Returns { voices: [{ id, title, muted, counts, lo, hi, readCycles, note }], from, cycles }.
export async function buildFormMap(graph, { from = 0, cycles = 32, onProgress = () => {}, cancelled = () => false } = {}) {
  cycles = Math.max(1, Math.min(MAX_RANGE, Math.floor(cycles)));
  const vs = voicesOf(graph), res = { voices: [], from, cycles, omitted: vs.omitted || 0 }, total = Math.max(1, vs.length * Math.ceil(cycles / CHUNK)); let done = 0;
  for (const v of vs) {
    const row = { id: v.id, title: MODULES[v.type]?.title || v.type, muted: !!v.muted, counts: new Array(cycles).fill(0), lo: null, hi: null, readCycles: 0, note: '', incomplete: false };
    res.voices.push(row);
    if (v.muted) { row.note = 'muted'; done += Math.ceil(cycles / CHUNK); onProgress(done, total); continue; }
    const tap = compileTap(graph, v.id); if (tap.error) { row.note = tap.error; done += Math.ceil(cycles / CHUNK); continue; }
    let spent = 0; const reuse = {};   // the voice is evaluated once and read in pieces
    for (let c = 0; c < cycles; c += CHUNK) {
      if (cancelled()) return res;
      const t0 = performance.now();
      try {
        const rec = await queryEvents(tap.code, { from: from + c, to: from + Math.min(cycles, c + CHUNK), reuse }), a = activityFromRecord(rec, from + c, Math.min(CHUNK, cycles - c));
        a.counts.forEach((n, i) => { row.counts[c + i] = n; });
        if (a.lo !== null) { row.lo = row.lo === null ? a.lo : Math.min(row.lo, a.lo); row.hi = row.hi === null ? a.hi : Math.max(row.hi, a.hi); }
        if (a.warnings.length) { row.incomplete = true; if (!row.note) row.note = 'the read was cut or left things out, so some counts are lower than the truth'; }   // a capped read is not shown as a full one
        row.readCycles = Math.min(cycles, c + CHUNK);
      } catch (e) { row.note = 'could not be read: ' + String((e && e.message) || e).slice(0, 80); break; }
      spent += performance.now() - t0; done++; onProgress(done, total);
      if (spent > VOICE_BUDGET_MS && c + CHUNK < cycles) { row.note = `heavy to read: only the first ${row.readCycles} cycles are shown`; done += Math.ceil((cycles - c - CHUNK) / CHUNK); break; }
      await breathe();
    }
  }
  onProgress(total, total);
  return res;
}

// paints the map: lanes by voice, cells by cycle
export function drawFormMap(canvas, map, cssW) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), L = 130, R = 8, T = 18, LANE = 22, H = T + Math.max(1, map.voices.length) * LANE + 8, W = cssW;
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = '#0f1318'; c.fillRect(0, 0, W, H);
  const cw = (W - L - R) / map.cycles, max = Math.max(1, ...map.voices.flatMap((v) => v.counts));
  c.font = '10px system-ui, sans-serif'; c.textBaseline = 'middle';
  const step = map.cycles <= 16 ? 1 : map.cycles <= 32 ? 4 : 8;
  c.fillStyle = '#6a8a8a'; c.textAlign = 'left';
  for (let i = 0; i < map.cycles; i += step) c.fillText(String(map.from + i + 1), L + i * cw + 1, 8);
  map.voices.forEach((v, r) => {
    const y = T + r * LANE;
    c.textAlign = 'left'; c.fillStyle = v.muted ? '#566' : '#c9d2db'; c.fillText(v.title.slice(0, 18), 6, y + LANE / 2);
    for (let i = 0; i < map.cycles; i++) {
      const n = v.counts[i], x = L + i * cw;
      if (i >= v.readCycles && !v.muted) { c.fillStyle = '#161c22'; c.fillRect(x, y + 2, Math.max(1, cw - 1), LANE - 4); continue; }
      if (n > 0) { c.fillStyle = `rgba(180,140,255,${0.25 + 0.75 * Math.log2(1 + n) / Math.log2(1 + max)})`; c.fillRect(x, y + 2, Math.max(1, cw - 1), LANE - 4); }
      if (v.incomplete) { c.strokeStyle = '#ffb347'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 2.5, Math.max(1, cw - 2), LANE - 5); }   // drawn after the fill so a full-brightness cell keeps it, and on empty cells too: a cut read may have left out every note there
    }
  });
  return { H };
}

// plain words for the map (also its text alternative): in which cycles each voice STARTS notes. It counts attacks: a long held note, a note with zero gain or velocity and the tail of a sound are not "activity" here.
export function describeMap(map) {
  const text = map.voices.map((v) => {
    if (v.muted) return `${v.title}: muted.`;
    const runs = []; let start = -1;
    for (let i = 0; i <= v.readCycles; i++) { const on = i < v.readCycles && v.counts[i] > 0; if (on && start < 0) start = i; if (!on && start >= 0) { runs.push(start + 1 === i ? `${map.from + start + 1}` : `${map.from + start + 1}-${map.from + i}`); start = -1; } }
    return `${v.title}: ${runs.length ? 'starts notes in cycles ' + runs.join(', ') : 'starts no notes'}${v.note ? ' (' + v.note + ')' : ''}.`;
  }).join(' ');
  return text + (map.omitted ? ` ${map.omitted} more voice${map.omitted === 1 ? ' is' : 's are'} not shown (the map reads ${MAX_VOICES}).` : '');
}