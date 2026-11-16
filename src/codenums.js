// Which numbers in the compiled code belong to a knob, and what an edit of one of them does to the board. Pure: no editor, no DOM.
import { MODULES } from './modules.js';
import { nodeById } from './graph.js';

// Which numbers can be edited: the single plain number in a knob's call, e.g. .lpf(800), .room(0.4), the value in slider(0.5, 0, 1), the tempo in setcpm(120/4)
const NUM = String.raw`(-?\d*\.?\d+)`;
const NUM_PATTERNS = [
  new RegExp(String.raw`^\.[A-Za-z_]\w*\(\s*${NUM}\s*\)$`),
  new RegExp(String.raw`^slider\(\s*${NUM}\s*,`),
  new RegExp(String.raw`^setcpm\(\s*(\d+(?:\.\d+)?)\s*/`),
  new RegExp(String.raw`^\.(?:every|sometimesBy|ribbon|swingBy)\(\s*${NUM}\s*,`),
  new RegExp(String.raw`^irand\(\s*(\d+)\s*\)`),
];
function numberIn(text) {
  for (const re of NUM_PATTERNS) {
    const m = re.exec(text);
    if (m) { const at = text.indexOf(m[1], text.indexOf('(') + 1); return [at, at + m[1].length]; }
  }
  return null;
}
export function editableNumbers(res) {
  const out = [];
  for (const s of res.segments) {
    if (s.role !== 'knob' || !s.node || !s.key) continue;
    const call = res.code.slice(s.from, s.to), r = numberIn(call);
    if (r) out.push({ from: s.from + r[0], to: s.from + r[1], seg: s, call });
  }
  return out;
}

// A typed value for a number in the code -> the change to make on the board: { id, key, value }, or null when it is not an editable knob.
// The value is kept inside the knob's range, and whole-number knobs are rounded, so a pasted or typed number can never leave the knob's range.
export function numberTarget(g, seg, call, value) {
  const n = nodeById(g, seg.node);
  if (!n || !Number.isFinite(value)) return null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v)), r4 = (v) => Number(v.toFixed(4));
  if (n.type === 'mixer' && seg.key === 'strips') {   // .postgain(x) and .pan(x) on a part are that strip's fader and pan
    const isPan = /^\.pan\(/.test(call), f = isPan ? 'pan' : 'vol';
    const strips = (n.params.strips || []).map((s) => ({ vol: 1, pan: 0.5, mute: false, solo: false, ...s }));
    if (!strips[seg.step]) return null;
    strips[seg.step] = { ...strips[seg.step], [f]: r4(clamp(value, 0, isPan ? 1 : 1.5)) };
    return { id: n.id, key: 'strips', value: strips };
  }
  const spec = MODULES[n.type]?.params.find((p) => p.key === seg.key);
  if (!spec || spec.kind !== 'knob') return null;
  let lo = spec.min, hi = spec.max;
  if (spec.dyn) { lo = Number(n.params.min); hi = Number(n.params.max); }
  if (n.type === 'macro') { lo = 0; hi = 1; }
  const step = spec.step || 0.01;
  let next = value;
  if (Number.isInteger(step) && step >= 1) next = Math.round(next);
  return { id: n.id, key: seg.key, value: r4(clamp(next, lo, hi)) };
}
