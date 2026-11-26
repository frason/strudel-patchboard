// Builds tools/test-board.patchboard.json: one board that exercises the newer features, in labelled groups, so each can be tried on its own.
//   node --import ./scripts/stub-loader.mjs scripts/make-test-board.mjs
// It is also the last lesson in the Learn menu (src/featuretest.js). Open the file in the app with Import -> Choose a file. Every group starts muted except two (so something plays); unmute a group with the speaker button on its frame.
import { writeFileSync } from 'node:fs';
import { makeNode, emptyGraph, validateShape, normalize } from '../src/graph.js';
import { cleanParams } from '../src/validate.js';
import { compile } from '../src/compile.js';
import { guardCode } from '../src/guard.js';

const g = emptyGraph(); g.groups = [];
const mk = (type, x, y, p = {}) => { const n = makeNode(type, x, y, cleanParams(type, { ...makeNode(type, 0, 0).params, ...p })); g.nodes.push(n); return n; };
const wire = (a, b, port = 'in') => g.wires.push({ id: 'tw' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
const out = mk('output', 0, 0, { bpm: 120, beats: 4 });
let row = 0;
// a group: a title, whether it starts muted, and a function that builds its chain and returns the node that goes to the Output plus the sound sources (to mute)
function group(name, { on = false } = {}, build) {
  const y = row++ * 520, before = g.nodes.length;
  const { head, sources } = build(y);
  wire(head, out);
  const members = g.nodes.slice(before).map((n) => n.id);
  if (!on) for (const s of sources) s.muted = true;
  g.groups.push({ id: 'tg' + g.groups.length, name, nodes: members, collapsed: false });
}
const X = (i) => 340 + i * 340;

group('1  Mask + When  (plays)', { on: true }, (y) => {
  const a = mk('notetext', X(0), y, { text: 'c3 e3 g3 b3 c4 b3 g3 e3' }), m = mk('mask', X(1), y, { pat: '1 0 1 1' }), w = mk('when', X(2), y, { pat: '<0 0 0 1>', fn: 'rev' }), s = mk('synth', X(3), y, { wave: 'sawtooth', lpf: 1400 });
  wire(a, m); wire(m, w); wire(w, s); return { head: s, sources: [s] };
});
group('2  Iter  (plays)', { on: true }, (y) => {
  const a = mk('notetext', X(0), y, { text: 'c4 d4 e4 g4' }), it = mk('iter', X(1), y, { n: 4, mode: 'iter' }), s = mk('synth', X(2), y, { wave: 'triangle', gain: 0.8 });
  wire(a, it); wire(it, s); return { head: s, sources: [s] };
});
group('3  Add notes, Superimpose, Off', {}, (y) => {
  const a = mk('notetext', X(0), y, { text: 'c3 g3 e3 c3' }), ad = mk('addnotes', X(1), y, { pat: '<0 3 7>' }), su = mk('superimpose', X(2), y, { fn: 'up12' }), of = mk('off', X(3), y, { t: 0.125, fn: 'up7' }), s = mk('synth', X(4), y, { wave: 'triangle', gain: 0.6 });
  wire(a, ad); wire(ad, su); wire(su, of); wire(of, s); return { head: s, sources: [s] };
});
group('4  Jux  (use headphones)', {}, (y) => {
  const a = mk('notetext', X(0), y, { text: 'c3 e3 g3' }), j = mk('jux', X(1), y, { width: 1, fn: 'rev' }), s = mk('synth', X(2), y, { wave: 'square', lpf: 1800, gain: 0.5 });
  wire(a, j); wire(j, s); return { head: s, sources: [s] };
});
group('5  Loop at + Chop  (a break)', {}, (y) => {
  const sa = mk('sample', X(0), y, { name: 'breaks' }), lp = mk('loopat', X(1), y, { n: 2 }), ch = mk('chop', X(2), y, { n: 8, mode: 'chop' });
  wire(sa, lp); wire(lp, ch); return { head: ch, sources: [sa] };
});
group('6  Echo on drums', {}, (y) => {
  const ri = mk('hitpattern', X(0), y, { text: 'x ~ ~ x ~ ~ x ~' }), sa = mk('sample', X(1), y, { name: 'sd', bank: 'RolandTR909' }), ec = mk('echo', X(2), y, { times: 3, time: 0.125, fb: 0.5 });
  wire(ri, sa); wire(sa, ec); return { head: ec, sources: [sa] };
});
group('7  Slow with two cables into one input', {}, (y) => {
  const a = mk('notetext', X(0), y, { text: 'c3 e3 g3 b3' }), b = mk('notetext', X(0), y + 200, { text: 'g2 d3' }), sl = mk('slow', X(1), y + 90, { n: 2 }), s = mk('synth', X(2), y + 90, { wave: 'sawtooth', lpf: 900, gain: 0.7 });
  wire(a, sl); wire(b, sl); wire(sl, s); return { head: s, sources: [s] };
});
group('8  Fast with two cables into one input', {}, (y) => {
  const a = mk('notetext', X(0), y, { text: 'c4 g4' }), b = mk('notetext', X(0), y + 200, { text: 'e4 b4' }), fa = mk('fast', X(1), y + 90, { n: 2 }), s = mk('synth', X(2), y + 90, { wave: 'triangle', gain: 0.6 });
  wire(a, fa); wire(b, fa); wire(fa, s); return { head: s, sources: [s] };
});
group('9  Chords with flats (Eb minor) + DJ filter warning', {}, (y) => {
  const ch = mk('chords', X(0), y, { steps: 4, mode: 'turns', cells: [{ sym: 'D#m', d: null, len: 1 }, { sym: 'C#', d: null, len: 1 }, { sym: 'G#m7', d: null, len: 1 }, { sym: 'A#7', d: null, len: 1 }] }), s = mk('synth', X(1), y, { wave: 'supersaw', lpf: 2500, gain: 0.4 }), dj = mk('djf', X(2), y, { amount: 0.5 }), wv = mk('wave', X(2), y + 220, { shape: 'sine', min: 0.3, max: 0.7, slow: 8 });
  wire(ch, s); wire(s, dj); g.wires.push({ id: 'tw-wave', from: { node: wv.id, port: 'out' }, to: { node: dj.id, port: 'p:amount' } });
  return { head: dj, sources: [s] };
});

out.x = 2150; out.y = Math.floor(row / 2) * 520;   // the Output on the right, so the cables run left to right
normalize(g); validateShape(g);
const r = compile(g), bad = guardCode(r.code);
if (bad) { console.error('the guard refuses the test board:', bad); process.exit(1); }
writeFileSync(new URL('../tools/test-board.patchboard.json', import.meta.url), JSON.stringify(g, null, 1));
// the same board as the last lesson ("34 · Feature test"): plain data in src/featuretest.js, like lesson 30's whole song
writeFileSync(new URL('../src/featuretest.js', import.meta.url), "// The Feature test lesson's board (generated by scripts/make-test-board.mjs; do not edit by hand): nine labelled groups that try the newer modules and features.\nexport default " + JSON.stringify(g) + ";\n");
console.log(`wrote tools/test-board.patchboard.json: ${g.nodes.length} modules, ${g.wires.length} cables, ${g.groups.length} groups`);
console.log('compile issues:', r.issues.map((i) => i.msg.slice(0, 90)));
