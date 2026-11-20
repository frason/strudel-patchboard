// Moving a pattern between the step-grid modules and the text modules, both ways, keeping what it plays.
//   Melody Sequencer -> Note Pattern   (always possible)
//   Rhythm Sequencer -> Hit Pattern    (always possible)
//   Note Pattern     -> Melody Sequencer (when the text is a flat list of up to 16 steps)
//   Hit Pattern      -> Rhythm Sequencer (same)
// Each function returns { type, params, note } or { error }.
import { stepText, degreeName } from './compile.js';
import { SCALES, NOTE_NAMES, noteRank, makeCells, defaultParams, fmt, cellNotes, stepHas } from './modules.js';
import { effectiveKey } from './graph.js';
import { parseEditable, notesOf } from './rolledit.js';

const mod = (a, b) => ((a % b) + b) % b;
const MAX_STEPS = 16;

// the steps of a grid module as the pieces of its text: each is { rest, cell, len, vel }
function tokensOf(p, deg, pitched) {
  const out = [];
  for (let i = 0; i < p.steps; i++) {
    const c = p.cells[i] || {}, len = Math.max(1, Math.min(c.len || 1, p.steps - i)), rest = !stepHas(c, deg, pitched);
    out.push({ step: i, rest, cell: c, len: rest ? 1 : len, vel: c.vel ?? 1 });
    i += (rest ? 1 : len) - 1;
  }
  return out;
}
const wrapOf = (p) => (p.mode === 'turns' ? ['<', '>'] : p.mode === 'pace' && p.steps > 8 ? ['[', `]/${fmt(p.steps / 8)}`] : ['', '']);
const join = (tokens, wrap, text) => wrap[0] + tokens.map(text).join(' ') + wrap[1];

export function melodyToNotes(g, node) {
  const p = node.params, key = effectiveKey(g, node);
  const names = (lf) => {
    const ns = cellNotes(lf, !!key);
    const named = key ? ns.map((d) => degreeName(key, d)) : ns.map(String);
    const sorted = named.slice().sort((a, b) => noteRank(a) - noteRank(b));
    return sorted.length === 0 ? '~' : sorted.length > 1 ? `[${sorted.join(',')}]` : sorted[0];
  };
  const tokens = tokensOf(p, !!key, true), wrap = wrapOf(p);
  if (!tokens.some((t) => !t.rest)) return { error: 'This melody has no notes yet, so there is nothing to convert.' };
  const text = join(tokens, wrap, (t) => stepText(t, names));
  const vel = tokens.some((t) => !t.rest && t.vel !== 1) ? join(tokens, wrap, (t) => stepText(t, (lf) => (cellNotes(lf, !!key).length ? fmt(t.vel) : '~'))) : '';
  return { type: 'notetext', params: { ...defaultParams('notetext'), text, vel }, note: `Now a Note Pattern${key ? ': the scale degrees were written out as note names, so it no longer follows a Key' : ''}.${wrap[0] === '[' ? ' The slow steady pace is written into the text as [ ... ]/n.' : ''}` };
}

export function hitsToText(node) {
  const p = node.params, tokens = tokensOf(p, false, false);
  if (!tokens.some((t) => !t.rest)) return { error: 'This rhythm has no hits yet, so there is nothing to convert.' };
  return { type: 'hitpattern', params: { ...defaultParams('hitpattern'), text: join(tokens, wrapOf(p), (t) => stepText(t, (lf) => (lf.on ? 'x' : '~'))) }, note: 'Now a Hit Pattern.' };
}

// the other way: only a flat list of at most 16 steps fits a grid
const unitsError = (kind) => `${kind} has brackets, repeats, alternation or more than ${MAX_STEPS} steps, which the step grid cannot hold. It stays as text.`;

export function notesToMelody(node) {
  const r = parseEditable(node.params.text, node.params.vel, 'notes');
  if (!r || r.total > MAX_STEPS) return { error: unitsError('This Note Pattern') };
  const cells = makeCells('melody', r.total);
  let at = 0, first = null;
  for (const s of r.steps) {
    if (s.n !== '~') {
      const ns = notesOf(s.n).map((x) => x.toLowerCase());
      first = first || ns[0];
      const v = Number(s.v);
      cells[at] = { n: ns.length > 1 ? ns : ns[0], d: null, len: s.w, vel: s.v === '' || !Number.isFinite(v) ? 1 : Math.max(0.1, Math.min(1, v)) };
    }
    at += s.w;
  }
  const octave = first ? Math.min(5, Math.max(1, Math.floor(noteRank(first) / 12))) : 3;
  return { type: 'melody', params: { ...defaultParams('melody'), steps: r.total, mode: 'steps', scale: 'off', octave, cells }, note: `Now a Melody Sequencer with ${r.total} steps.` };
}

export function hitsToRhythm(node) {
  const r = parseEditable(node.params.text, '', 'hits');
  if (!r || r.total > MAX_STEPS) return { error: unitsError('This Hit Pattern') };
  const cells = makeCells('rhythm', r.total);
  let at = 0;
  for (const s of r.steps) { if (s.n !== '~') cells[at] = { on: true, len: s.w }; at += s.w; }
  return { type: 'rhythm', params: { ...defaultParams('rhythm'), steps: r.total, mode: 'steps', cells }, note: `Now a Rhythm Sequencer with ${r.total} steps.` };
}

export const CONVERTERS = {
  melody: { label: '→ Note Pattern', title: 'Turn this into a Note Pattern: the same notes written as text, with no limit of 16 steps. You can turn it back while it stays a plain list of notes.', run: (g, n) => melodyToNotes(g, n) },
  rhythm: { label: '→ Hit Pattern', title: 'Turn this into a Hit Pattern: the same hits written as text, with no limit of 16 steps. You can turn it back while it stays a plain list of hits.', run: (g, n) => hitsToText(n) },
  notetext: { label: '→ Melody Sequencer', title: 'Turn this into a Melody Sequencer: a step grid you can click. Only possible while the text is a plain list of up to 16 steps.', run: (g, n) => notesToMelody(n) },
  hitpattern: { label: '→ Rhythm Sequencer', title: 'Turn this into a Rhythm Sequencer: a step grid you can click. Only possible while the text is a plain list of up to 16 steps.', run: (g, n) => hitsToRhythm(n) },
};
