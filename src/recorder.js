// Recording a take: notes arriving with timestamps become events in beats, ready for takecode.js.
// Everything here is plain functions, so it is tested without a browser or a keyboard.
//   take = { bpm, beatsPerBar, events: [{ t, d, n, v }] }   t and d in beats from the first beat of the take, n a MIDI note, v 0 to 1
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// zeroMs is the moment of beat 0 (the end of the count-in), on the same clock as the timestamps given to noteOn and noteOff.
export function createRecorder({ bpm = 120, beatsPerBar = 4, zeroMs = 0, maxBeats = 4096 } = {}) {
  const open = new Map(), events = [];
  const beat = (ms) => ((ms - zeroMs) / 60000) * bpm;
  const close = (n, ms) => {
    const o = open.get(n); if (!o) return;
    open.delete(n);
    events.push({ t: o.t, d: Math.max(0.05, Math.min(beat(ms), maxBeats) - o.t), n, v: o.v });
  };
  return {
    noteOn(n, velocity, ms) {
      if (!Number.isInteger(n) || n < 0 || n > 127) return;
      const t = beat(ms);
      if (t < -0.5 || t > maxBeats) return;            // from before the count-in ended, or past the end: not part of the take
      if (open.has(n)) close(n, ms);
      open.set(n, { t: Math.max(0, t), v: clamp(velocity > 1 ? velocity / 127 : velocity, 0.1, 1) });
    },
    noteOff(n, ms) { close(n, ms); },
    // the notes so far, including the ones still held (they grow until released)
    peek(ms) { return [...events, ...[...open].map(([n, o]) => ({ t: o.t, d: Math.max(0.05, beat(ms) - o.t), n, v: o.v }))]; },
    held: () => open.size,
    stop(ms) { for (const n of [...open.keys()]) close(n, ms); return { bpm, beatsPerBar, events: events.slice().sort((a, b) => a.t - b.t || a.n - b.n) }; },
    beat,
  };
}

// The computer keyboard as a one-octave piano: a w s e d f t g y h u j k o l p ; (z and x shift the octave).
const KEYS = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
export const keyToNote = (key, octave = 4) => (Object.prototype.hasOwnProperty.call(KEYS, key) ? 12 * (octave + 1) + KEYS[key] : null);

// Add an imported board (its own Output left out) under what the board already has, and plug its end into the board's Output.
export function mergeGraph(cur, g) {
  const curOut = cur.nodes.find((n) => n.type === 'output'), out = g.nodes.find((n) => n.type === 'output');
  const dy = Math.max(0, ...cur.nodes.map((n) => Number(n.y) || 0)) + 360, have = new Set(cur.nodes.map((n) => n.id));
  const added = [];
  for (const n of g.nodes) {
    if (curOut && out && n.id === out.id) continue;
    if (have.has(n.id)) throw new Error('duplicate module id');
    n.y = (Number(n.y) || 0) + dy; cur.nodes.push(n); added.push(n.id);
  }
  for (const w of g.wires) {
    if (curOut && out && w.to.node === out.id) w.to.node = curOut.id;
    cur.wires.push(w);
  }
  return added;
}
