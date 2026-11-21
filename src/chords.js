// Chord names. Pure data and helpers (no Strudel import), so they run in the tests too.
import { SCALES, NOTE_NAMES } from './modules.js';

export const ROOT_NAMES = NOTE_NAMES.map((n) => n.toUpperCase());
// [symbol Strudel understands, plain-English name]
export const CHORD_QUALITIES = [
  ['', 'major'], ['m', 'minor'], ['7', 'dominant 7'], ['^7', 'major 7'], ['m7', 'minor 7'], ['m7b5', 'half-diminished'],
  ['o', 'diminished'], ['o7', 'diminished 7'], ['aug', 'augmented'], ['sus', 'suspended'], ['6', 'major 6'],
  ['9', 'dominant 9'], ['^9', 'major 9'], ['m9', 'minor 9'], ['7b9', '7 flat 9'],
];
export const EXTENSIONS = [['', 'triad'], ['7', '7th'], ['9', '9th']];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const mod = (a, b) => ((a % b) + b) % b;
// semitones above the tonic of scale step k (k may be negative or beyond one octave)
const absSemis = (iv, k) => iv[mod(k, iv.length)] + 12 * Math.floor(k / iv.length);

function parts(key, i) {
  const iv = SCALES[key.scale] || SCALES.major;
  const rootAbs = absSemis(iv, i);
  const third = absSemis(iv, i + 2) - rootAbs, fifth = absSemis(iv, i + 4) - rootAbs, seventh = absSemis(iv, i + 6) - rootAbs;
  const rootPc = (NOTE_NAMES.indexOf(key.root.toLowerCase()) + rootAbs) % 12;
  return { third, fifth, seventh, root: ROOT_NAMES[mod(rootPc, 12)] };
}
function triadOf({ third, fifth }) {
  if (third === 3 && fifth === 6) return 'o';
  if (third === 4 && fifth === 8) return 'aug';
  if (third === 3) return 'm';
  if (third === 4) return '';
  return third < 4 ? 'm' : '';
}

// chord symbol for scale degree d = {i, ext} in a key, e.g. ({root:'C',scale:'major'}, {i:1, ext:'7'}) -> 'Dm7'
export function chordSymbol(key, d) {
  if (!key || !d) return null;
  const p = parts(key, d.i);
  const tri = triadOf(p);
  let q = tri;
  if (d.ext === '7' || d.ext === '9') {
    const nine = d.ext === '9';
    if (tri === '') q = p.seventh === 11 ? (nine ? '^9' : '^7') : (nine ? '9' : '7');
    else if (tri === 'm') q = nine ? 'm9' : 'm7';
    else if (tri === 'o') q = p.seventh === 9 ? 'o7' : 'm7b5';
  }
  return p.root + q;
}
// 'ii', 'V', 'vii°' ...
export function romanName(key, d) {
  if (!key || !d) return '';
  const iv = SCALES[key.scale] || SCALES.major;
  if (iv.length !== 7) return String(d.i + 1);
  const tri = triadOf(parts(key, d.i));
  const r = ROMAN[mod(d.i, 7)];
  const base = tri === 'm' || tri === 'o' ? r.toLowerCase() : r;
  return base + (tri === 'o' ? '°' : tri === 'aug' ? '+' : '') + (d.ext === '7' ? '7' : d.ext === '9' ? '9' : '');
}
export const degreeCount = (key) => (SCALES[key.scale] || SCALES.major).length;
export const chordHas = (c, deg) => (deg ? !!c.d : !!c.sym);

export const ARP_STYLES = [['0 1 2', 'up'], ['2 1 0', 'down'], ['0 1 2 1', 'up and down'], ['0 2 1 2', 'weave'], ['0 [1 2]', 'up, quick end'], ['custom', 'custom…']];

// ---- chord shapes (which notes a chord uses) ----
export const QUALITY_INTERVALS = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], '^7': [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], o: [0, 3, 6], o7: [0, 3, 6, 9],
  aug: [0, 4, 8], sus: [0, 5, 7], 6: [0, 4, 7, 9], 9: [0, 4, 7, 10, 14], '^9': [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], '7b9': [0, 4, 7, 10, 13],
};
// Strudel reads Eb, Db, Bb ... as well as D#, C#, A#. The chord module names its roots with sharps, so a flat root is written as the same note with a sharp (Ebm is D#m).
const FLAT = { Cb: 'B', Db: 'C#', Eb: 'D#', Fb: 'E', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
export const sharpSym = (sym) => String(sym ?? '').replace(/^([A-G])b/, (m) => FLAT[m] ?? m);
export function parseChord(sym) {
  const m = /^([A-G]#?)(.*)$/.exec(sharpSym(sym));
  return m ? { root: m[1], q: m[2] } : null;
}
// semitones above C for each note of the chord, e.g. 'Am7' -> [9, 12, 16, 19]
export function chordSemis(sym) {
  const p = parseChord(sym);
  if (!p) return [];
  const rootPc = ROOT_NAMES.indexOf(p.root);
  return (QUALITY_INTERVALS[p.q] || QUALITY_INTERVALS['']).map((i) => rootPc + i);
}
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const chordNoteNames = (sym) => chordSemis(sym).map((s) => NAMES_SHARP[s % 12]);

// ---- progression presets (as scale degrees) ----
export const PRESETS = [
  { id: 'pop', name: 'Pop', degrees: [0, 4, 5, 3] },
  { id: 'home', name: 'Home', degrees: [0, 3, 4, 0] },
  { id: 'turnaround', name: 'Turnaround', degrees: [0, 5, 1, 4] },
  { id: 'sad', name: 'Sad', degrees: [5, 3, 0, 4] },
  { id: 'andalusian', name: 'Andalusian', degrees: [0, 6, 5, 4] },
  { id: 'canon', name: 'Canon', degrees: [0, 4, 5, 2, 3, 0, 3, 4] },
];
const C_MAJOR = { root: 'C', scale: 'major' };
export const presetRoman = (p) => p.degrees.map((i) => romanName(C_MAJOR, { i, ext: '' })).join(' ');
// cells for a preset: chord names in C major (used when no Key is plugged in) plus the degrees (used when one is)
export const presetCells = (p, ext = '') => p.degrees.map((i) => ({ sym: chordSymbol(C_MAJOR, { i, ext }), d: { i, ext }, len: 1 }));
