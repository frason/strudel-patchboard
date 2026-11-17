// Editing a pattern written as plain text, from clicks on its picture.
// Only flat sequences are editable: words separated by spaces, each a note name (c4), a hit (x) or a rest (~), with an optional weight (c4@3).
// Anything with brackets, < >, * / ! , ? and so on is left alone: the picture stays read-only and you edit the text.
// A step is { n: the word, v: its loudness word, w: its weight }. Positions are in weight units: "c4@3 ~ e4" is 5 units wide.
const N1 = '[a-g][#b]?-?\\d', NOTE = new RegExp(`^(${N1}|\\[${N1}(,${N1})+\\])$`, 'i'), HIT = /^(x|1)$/i, VEL = /^(\d*\.?\d+)$/;
const WORD = /^([^@\s]+)(?:@(\d+))?$/;
const MAX_UNITS = 256;

function words(text, ok) {
  const parts = String(text || '').trim().split(/\s+/).filter(Boolean), out = [];
  for (const p of parts) {
    const m = WORD.exec(p); if (!m) return null;
    const v = m[1]; if (!(v === '~' || ok.test(v))) return null;
    const w = m[2] === undefined ? 1 : Number(m[2]); if (!(w >= 1 && w <= MAX_UNITS)) return null;
    out.push({ v, w });
  }
  return out.length ? out : null;
}
// kind: 'notes' or 'hits'. Returns { steps, total } or null when this text cannot be edited from the picture.
export function parseEditable(text, vel, kind) {
  const base = words(text, kind === 'notes' ? NOTE : HIT); if (!base) return null;
  const steps = base.map((s) => ({ n: s.v, v: '~', w: s.w }));
  const v = String(vel || '').trim();
  if (kind === 'notes' && v) {
    const lv = words(v, VEL);
    if (!lv || lv.length !== base.length || lv.some((s, i) => s.w !== base[i].w)) return null;   // loudness must have exactly the same steps
    lv.forEach((s, i) => { steps[i].v = s.v; });
  } else if (kind === 'notes') steps.forEach((s) => { s.v = ''; });
  const total = steps.reduce((t, s) => t + s.w, 0);
  return total <= MAX_UNITS * 4 ? { steps, total, hasVel: kind === 'notes' && !!v } : null;
}
export function writeEditable(steps, hasVel) {
  const one = (k) => steps.map((s) => (s.w > 1 ? `${s[k]}@${s.w}` : s[k])).join(' ');
  return { text: one('n'), vel: hasVel ? one('v') : '' };
}

const isRest = (s) => s.n === '~';
const tidy = (steps) => {   // join rests that sit side by side
  const out = [];
  for (const s of steps) { const last = out[out.length - 1]; if (last && isRest(last) && isRest(s)) last.w += s.w; else out.push({ ...s }); }
  return out;
};
export function stepAt(steps, u) {   // the step covering unit u, with where it starts
  let a = 0;
  for (let i = 0; i < steps.length; i++) { if (u >= a && u < a + steps[i].w) return { i, start: a }; a += steps[i].w; }
  return null;
}
// put a note (or hit) of weight 1 at unit u, if u is a rest. Returns the new steps and the index of the new step, or null
export function addAt(steps, u, word, vel = '0.8') {
  const at = stepAt(steps, u); if (!at || !isRest(steps[at.i])) return null;
  const s = steps[at.i], before = u - at.start, after = s.w - before - 1, out = [];
  steps.forEach((x, i) => {
    if (i !== at.i) { out.push({ ...x }); return; }
    if (before > 0) out.push({ n: '~', v: '~', w: before });
    out.push({ n: word, v: vel === '' ? '' : vel, w: 1 });
    if (after > 0) out.push({ n: '~', v: '~', w: after });
  });
  return { steps: out, index: at.i + (before > 0 ? 1 : 0) };
}
// a note becomes a rest of the same length
export function removeAt(steps, i) {
  if (!steps[i] || isRest(steps[i])) return null;
  const out = steps.map((x) => ({ ...x })); out[i].n = '~'; if (out[i].v !== '') out[i].v = '~';
  return { steps: tidy(out) };
}
export function setWord(steps, i, word) {
  if (!steps[i] || isRest(steps[i]) || steps[i].n === word) return null;
  const out = steps.map((x) => ({ ...x })); out[i].n = word; return { steps: out };
}
// change the length of step i to w units: the next rest gives or takes the difference (the whole pattern keeps its length)
export function resizeAt(steps, i, w) {
  const s = steps[i]; if (!s || isRest(s) || !Number.isInteger(w) || w < 1 || w === s.w) return null;
  const out = steps.map((x) => ({ ...x })), d = w - s.w, nx = out[i + 1];
  if (d > 0) {
    if (!nx || !isRest(nx) || nx.w < d) return null;
    nx.w -= d; if (nx.w === 0) out.splice(i + 1, 1);
  } else if (nx && isRest(nx)) nx.w -= d;
  else out.splice(i + 1, 0, { n: '~', v: s.v === '' ? '' : '~', w: -d });
  out[i].w = w;
  return { steps: tidy(out) };
}

// chords: a step holds one note (c4) or several written [c4,e4,g4]
const mid = (w) => { const m = /^([a-g])([#b]?)(-?\d)$/i.exec(w); return m ? ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1)) : NaN; };
const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
const nm = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const notesOf = (word) => (word === '~' ? [] : String(word).replace(/^\[|\]$/g, '').split(','));
const wordOf = (list) => { const u = [...new Set(list.map(mid))].sort((a, b) => a - b).map(nm); return u.length === 0 ? '~' : u.length === 1 ? u[0] : `[${u.join(',')}]`; };
const withNotes = (steps, i, list) => { const out = steps.map((x) => ({ ...x })); out[i].n = wordOf(list); if (out[i].n === '~' && out[i].v !== '') out[i].v = '~'; return { steps: tidy(out) }; };
export function addPitch(steps, i, name) { const s = steps[i]; if (!s || isRest(s)) return null; const have = notesOf(s.n).map(mid); return have.includes(mid(name)) ? null : withNotes(steps, i, [...notesOf(s.n), name]); }
export function removePitch(steps, i, name) { const s = steps[i]; if (!s || isRest(s)) return null; return withNotes(steps, i, notesOf(s.n).filter((x) => mid(x) !== mid(name))); }
export function movePitch(steps, i, from, to) { const s = steps[i]; if (!s || isRest(s) || mid(from) === mid(to)) return null; const rest = notesOf(s.n).filter((x) => mid(x) !== mid(from)); return rest.map(mid).includes(mid(to)) ? null : withNotes(steps, i, [...rest, to]); }
