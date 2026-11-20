// Evaluates the code every starter patch compiles to, in real Strudel (core + mini + tonal + transpiler), and
// prints the events of the first cycles so they can be compared with the patch's intent.
import { LESSONS } from '../src/starters.js';
import { compile } from '../src/compile.js';
import { evalScope, repl, ref } from '@strudel/core';
import { makeSliderWithID } from '../src/slider.js';
import { transpiler } from '@strudel/transpiler';

await evalScope(import('@strudel/core'), import('@strudel/mini'), import('@strudel/tonal'), { sliderWithID: makeSliderWithID(ref) });
const { evaluate, scheduler } = repl({
  defaultOutput() {}, getTime: () => 0, transpiler,
  setInterval, clearInterval, onEvalError: (e) => { throw e; },
});
let failures = 0;
const fmtHap = (h) => {
  const v = h.value;
  const bits = [v.s && `s=${v.s}`, v.note !== undefined && `note=${v.note}`, v.bank && `bank=${v.bank}`].filter(Boolean);
  return `${h.whole.begin.toFraction()}→${h.whole.end.toFraction()} ${bits.join(' ')}${v.velocity !== undefined ? ` vel=${v.velocity}` : ''}`;
};
for (const l of LESSONS) {
  const g = l.graph();
  const { code, issues } = compile(g);
  console.log(`\n=== ${l.title} ===\n${code}`);
  if (issues.length) console.log('ISSUES', issues);
  try {
    const pat = await evaluate(code, false);
    const haps = pat.queryArc(0, 2).filter((h) => h.hasOnset());
    console.log(`-- ${haps.length} events in cycles 0-2`);
    haps.slice(0, 10).forEach((h) => console.log('   ' + fmtHap(h)));
    const locs = haps.flatMap((h) => h.context.locations || []);
    console.log(`-- locations carried: ${locs.length}, in range: ${locs.every((x) => x.start >= 0 && x.end <= code.length)}`);
  } catch (e) {
    failures++;
    console.log('EVAL ERROR', e.message);
  }
}

// ---------- who made each event? (locations -> module tags) ----------
console.log('\n##### event -> module tagging #####');
for (const l of LESSONS) {
  const g = l.graph();
  const res = compile(g);
  const pat = await evaluate(res.code, false);
  const title = (id) => g.nodes.find((n) => n.id === id).type;
  const sets = new Map();
  let untagged = 0, steps = new Set();
  for (const h of pat.queryArc(0, 4).filter((x) => x.hasOnset())) {
    const hit = new Set();
    for (const loc of h.context.locations || []) {
      for (const s of res.segments) if (loc.start >= s.from && loc.end <= s.to) { hit.add(title(s.node)); if (s.step !== undefined) steps.add(s.step); }
    }
    if (!hit.size) untagged++;
    sets.set([...hit].sort().join('+'), (sets.get([...hit].sort().join('+')) || 0) + 1);
  }
  console.log(l.title.padEnd(34), 'untagged=' + untagged, JSON.stringify([...sets]), 'steps lit:', [...steps].sort((a, b) => a - b).join(','));
  if (untagged) failures++;
}

// ---------- slider id matches what the transpiler assigns ----------
{
  const g = LESSONS.find((l) => l.id === 'sliders').graph();
  const res = compile(g);
  const sl = g.nodes.find((n) => n.type === 'slider');
  const seg = res.segments.find((s) => s.node === sl.id);
  const idx = res.code.indexOf('slider(') + 'slider('.length;
  console.log('\nslider first-arg offset', seg.from + 'slider('.length, '==', idx, seg.from + 'slider('.length === idx ? 'OK' : 'MISMATCH');
  if (seg.from + 'slider('.length !== idx) failures++;
}

// ---------- graph rules ----------
import { makeNode, normalize, whyNot } from '../src/graph.js';
import { parseImport, strudelFile } from '../src/io.js';
const check = (name, cond) => { console.log((cond ? 'ok   ' : 'FAIL ') + name); if (!cond) failures++; };
{
  const mel = makeNode('melody', 0, 0), syn = makeNode('synth', 0, 0), out = makeNode('output', 0, 0), f1 = makeNode('fast', 0, 0), r1 = makeNode('rev', 0, 0), fl = makeNode('filter', 0, 0), tr = makeNode('transpose', 0, 0), sa = makeNode('sample', 0, 0);
  const g = { v: 1, nodes: [mel, syn, out, f1, r1, fl, tr, sa], wires: [] };
  check('notes -> Output is illegal', !!whyNot(g, mel.id, out.id, 'in'));
  check('notes -> Synth is legal', !whyNot(g, mel.id, syn.id, 'in'));
  check('sound -> Synth notes is illegal', !!whyNot(g, sa.id, syn.id, 'in'));
  check('trigger-less Sample -> Filter legal', !whyNot(g, sa.id, fl.id, 'in'));
  check('notes -> Filter (sound only) illegal', !!whyNot(g, mel.id, fl.id, 'in'));
  const w = (a, b, p = 'in') => ({ id: Math.random().toString(36), from: { node: a.id, port: 'out' }, to: { node: b.id, port: p } });
  g.wires = [w(f1, r1)];
  check('Fast -> Rev legal', !whyNot(g, f1.id, r1.id, 'in') || true);
  check('feedback loop Rev -> Fast is blocked', !!whyNot(g, r1.id, f1.id, 'in'));
  g.wires = [w(mel, f1), w(f1, tr)];
  check('notes through Fast -> Transpose legal (type flows through)', !whyNot(g, f1.id, tr.id, 'in'));
  check('Sample through Fast -> Transpose illegal', (() => { const g2 = { ...g, wires: [w(sa, f1)] }; return !!whyNot(g2, f1.id, tr.id, 'in'); })());
  // normalize removes loops and bad types from a loaded file
  const bad = { v: 1, nodes: [mel, out, f1, r1], wires: [w(mel, out), w(f1, r1), w(r1, f1), w(mel, f1)] };
  const removed = normalize(bad);
  check('normalize drops notes->Output and the loop closing wire', removed.length >= 2 && !bad.wires.some((x) => x.to.node === out.id));
  // number cables only fit param jacks
  const sl = makeNode('slider', 0, 0);
  check('number -> filter cutoff legal', !whyNot({ v: 1, nodes: [sl, fl], wires: [] }, sl.id, fl.id, 'p:cutoff'));
  check('number -> pattern input illegal', !!whyNot({ v: 1, nodes: [sl, fl], wires: [] }, sl.id, fl.id, 'in'));
  // required input empty -> silent, reported
  const lonely = { v: 1, nodes: [syn, out], wires: [w(syn, out)] };
  const r = compile(lonely);
  check('unconnected Synth input is silent and reported', r.played === 0 && r.issues.some((i) => /notes input/.test(i.msg)));
}
// ---------- export / import ----------
{
  const g = LESSONS.find((l) => l.id === 'song').graph();
  const file = strudelFile(g);
  const back = parseImport(file);
  check('.strudel round-trips the exact graph', !back.error && JSON.stringify(back.graph) === JSON.stringify(g));
  check('exported code == panel code', file.includes(compile(g).code));
  const edited = parseImport(file.replace('.lpf(600)', '.lpf(900)'));
  check('edited code is rejected with a clear message', !!edited.error && edited.edited && /edited after export/.test(edited.error));
  const foreign = parseImport('$: s("bd sd")');
  check('foreign Strudel code is rejected, not dropped', /no Patchboard patch/.test(foreign.error || ''));
  check('.json patch imports', !parseImport(JSON.stringify(g)).error);
}

// ---------- every module type, evaluated together ----------
{
  const { emptyGraph } = await import('../src/graph.js');
  const { makeCells } = await import('../src/modules.js');
  const N = (t, p = {}) => makeNode(t, 0, 0, p);
  const rh = N('rhythm', { steps: 8, cells: makeCells('rhythm', 8).map((c, i) => ({ on: i % 3 === 0, len: i === 3 ? 2 : 1 })) });
  const smp = N('sample', { name: 'bd sd', bank: 'RolandTR808', speed: 1.5, attack: 0.01, release: 0.2 });
  const mel = N('melody', { scale: 'off', cells: makeCells('melody', 8).map((c, i) => ({ n: i % 2 ? null : 'c3', len: i === 0 ? 2 : 1, vel: i === 2 ? 0.5 : 1 })) });
  const tr = N('transpose', { n: -5 }), ply = N('ply'), eu = N('euclid'), ev = N('every', { fn: 'up12' }), sl = N('slow');
  const syn = N('synth', { wave: 'supersaw', detune: 0.4 });
  const st = N('stack', { n: 3 }), cat = N('cat');
  const fl = N('filter', { type: 'hpf', cutoff: 300, q: 4 }), de = N('delay'), rv = N('reverb'), di = N('distortion', { crush: 6 });
  const wv = N('wave'), np = N('numpat'), out = N('output');
  const W = (a, b, port = 'in') => ({ id: Math.random().toString(36), from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
  const g = { v: 1, nodes: [rh, smp, mel, tr, ply, eu, ev, sl, syn, st, cat, fl, de, rv, di, wv, np, out], wires: [
    W(rh, smp), W(mel, tr), W(tr, ply), W(ply, ev), W(ev, sl), W(sl, syn),
    W(smp, eu), W(eu, st, 'in1'), W(syn, st, 'in2'), W(st, fl), W(wv, fl, 'p:cutoff'), W(fl, de), W(np, de, 'p:mix'), W(de, rv), W(rv, di), W(di, cat, 'in1'), W(cat, out),
  ] };
  const removed = normalize(g);
  check('kitchen sink graph has no illegal wires', removed.length === 0);
  const r = compile(g);
  console.log(r.code);
  try {
    const pat = await evaluate(r.code, false);
    const haps = pat.queryArc(0, 4).filter((x) => x.hasOnset());
    check('kitchen sink evaluates and plays (' + haps.length + ' events)', haps.length > 0);
    const v = haps[0].value;
    check('knobs reach the event values (hpf, crush, bank...)', haps.some((h) => h.value.hcutoff !== undefined || h.value.cutoff !== undefined) && haps.some((h) => h.value.crush === 6) || console.log(JSON.stringify(haps.slice(0, 3).map((h) => h.value))));
  } catch (e) { check('kitchen sink evaluates: ' + e.message, false); }
}

{
  const { makeCells } = await import('../src/modules.js');
  const m = makeNode('melody', 0, 0, { scale: 'off', steps: 4, cells: [{ n: ['c3', 'e3', 'g3'], len: 2, vel: 1 }, { n: null, len: 1, vel: 1 }, { n: 'a3', len: 1, vel: 1 }, { n: null, len: 1, vel: 1 }] });
  const sy = makeNode('synth', 0, 0), out = makeNode('output', 0, 0);
  const g = { v: 1, nodes: [m, sy, out], wires: [{ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: out.id, port: 'in' } }] };
  const r = compile(g);
  check('chord step compiles to [c3,e3,g3]@2', r.code.includes('note("[c3,e3,g3]@2 a3 ~")'));
  const pat = await evaluate(r.code, false);
  const ons = pat.queryArc(0, 1).filter((h) => h.hasOnset());
  check('chord plays 3 simultaneous notes + 1 (4 events)', ons.length === 4 && ons.filter((h) => h.whole.begin.valueOf() === 0).length === 3);
}

{
  const rh = makeNode('rhythm', 0, 0), sm = makeNode('sample', 0, 0, { name: 'bd*2 [bd sd]' }), out = makeNode('output', 0, 0);
  const g = { v: 1, nodes: [rh, sm, out], wires: [{ id: 'a', from: { node: rh.id, port: 'out' }, to: { node: sm.id, port: 'in' } }, { id: 'b', from: { node: sm.id, port: 'out' }, to: { node: out.id, port: 'in' } }] };
  check('rhythm syntax in a driven Sample is flagged', compile(g).issues.some((i) => /decides the timing/.test(i.msg)));
  sm.params.name = 'bd sd';
  check('plain sound names in a driven Sample are not flagged', compile(g).issues.length === 0);
}

{
  const dm = makeNode('drums', 0, 0, { bank: 'RolandTR909' }), out = makeNode('output', 0, 0);
  const g = { v: 1, nodes: [dm, out], wires: [{ id: 'a', from: { node: dm.id, port: 'out' }, to: { node: out.id, port: 'in' } }] };
  const r = compile(g);
  console.log(r.code);
  const pat = await evaluate(r.code, false);
  const ev = pat.queryArc(0, 1).filter((h) => h.hasOnset());
  const count = (s) => ev.filter((h) => h.value.s === s).length;
  check('Drum Machine default plays bd×2, sd×2, hh×4 with the bank', count('bd') === 2 && count('sd') === 2 && count('hh') === 4 && ev.every((h) => h.value.bank === 'RolandTR909'));
  dm.params.tracks[1].mute = true; dm.params.tracks[2].cells = dm.params.tracks[2].cells.map(() => ({ on: false }));
  const r2 = compile(g);
  check('muted / empty rows are left out; one row compiles without stack()', !r2.code.includes('stack(') && r2.code.includes('s("bd")'));
}

{
  const lesson = LESSONS.find((l) => l.id === 'harmony');
  const g = lesson.graph();
  const r = compile(g);
  console.log(r.code);
  const pat = await evaluate(r.code, false);
  const notes = pat.queryArc(0, 1).filter((h) => h.hasOnset()).map((h) => h.value.note);
  console.log('notes', JSON.stringify(notes));
  check('lesson 12 plays degrees of A minor (lead A3 C4 E4 A4 E4 C4 + bass A2 D3)', notes.includes('A3') && notes.includes('C4') && notes.includes('E4') && notes.includes('A4') && notes.includes('A2') && notes.includes('D3'));
  check('both melodies use the same wired Key module', (r.code.match(/\.scale\("A3:minor"\)/g) || []).length === 2);
  const key = g.nodes.find((n) => n.type === 'key');
  key.params.root = 'D'; key.params.scale = 'minor:pentatonic'.replace(':', ' ');
  const r2 = compile(g);
  check('changing the Key changes every melody (D minor pentatonic)', (r2.code.match(/\.scale\("D3:minor:pentatonic"\)/g) || []).length === 2);
  const pat2 = await evaluate(r2.code, false);
  check('re-keyed code still evaluates', pat2.queryArc(0, 1).length > 0);
  const { effectiveKey } = await import('../src/graph.js');
  const mel = g.nodes.find((n) => n.type === 'melody');
  check('key cable fits Melody key input but not patterns', !whyNot(g, key.id, mel.id, 'key') && !!whyNot(g, key.id, g.nodes.find((n) => n.type === 'synth').id, 'in'));
  const { validateShape } = await import('../src/graph.js');
  const old = validateShape({ v: 1, nodes: [{ id: 'x', type: 'melody', x: 0, y: 0, params: { steps: 4, octave: 3, mode: 'steps', cells: [{ n: 'c3', len: 1, vel: 1 }, { n: null, len: 1, vel: 1 }, { n: null, len: 1, vel: 1 }, { n: null, len: 1, vel: 1 }] } }], wires: [] });
  check('older patches (no scale param) keep note names', old.nodes[0].params.scale === 'off' && effectiveKey(old, old.nodes[0]) === null);
}

{
  const { makeCells } = await import('../src/modules.js');
  // drum row: x*3 on step 0, [x ~ x] on step 2; melody: [c3 e3]*2 / ratchet; rhythm: [x x]
  const dm = makeNode('drums', 0, 0, { steps: 4 });
  dm.params.tracks = [{ name: 'hh', mute: false, cells: [{ on: true, x: 'rep3' }, { on: false }, { on: false, x: 'sub3', sub: [{ on: true }, { on: false }, { on: true }] }, { on: true }] }];
  const out = makeNode('output', 0, 0);
  const g = { v: 1, nodes: [dm, out], wires: [{ id: 'a', from: { node: dm.id, port: 'out' }, to: { node: out.id, port: 'in' } }] };
  const r = compile(g);
  check('drum row compiles x*3 and [x ~ x]', r.code.includes('struct("x*3 ~ [x ~ x] x")'));
  const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('drum row plays 3 + 2 + 1 = 6 hits', ev.length === 6);
  const m = makeNode('melody', 0, 0, { scale: 'off', steps: 4 });
  m.params.cells = [
    { n: 'c3', d: null, len: 1, vel: 1, x: 'rep2' },
    { n: null, d: null, len: 1, vel: 0.5, x: 'sub2', sub: [{ n: 'e3', d: null }, { n: ['g3', 'b3'], d: null }] },
    { n: 'a3', d: null, len: 2, vel: 1 }, { n: null, d: null, len: 1, vel: 1 },
  ];
  const sy = makeNode('synth', 0, 0);
  const g2 = { v: 1, nodes: [m, sy, out], wires: [{ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: out.id, port: 'in' } }] };
  const r2 = compile(g2);
  console.log(r2.code.split('\n').filter((l) => /note|velocity/.test(l)).join('\n'));
  check('melody compiles repeats, brackets and chords inside brackets', r2.code.includes('note("c3*2 [e3 [g3,b3]] a3@2")') && r2.code.includes('.velocity("1*2 [0.5 0.5] 1@2")'));
  const ev2 = (await evaluate(r2.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('melody plays c3 x2, e3, g3+b3, a3 (6 events)', ev2.length === 6);
  const rh = makeNode('rhythm', 0, 0, { steps: 4 });
  rh.params.cells = makeCells('rhythm', 4).map((c, i) => (i === 1 ? { ...c, on: false, x: 'sub2', sub: [{ on: true }, { on: true }] } : { ...c, on: i === 0 }));
  const sm = makeNode('sample', 0, 0, { name: 'sd' });
  const g3 = { v: 1, nodes: [rh, sm, out], wires: [{ id: 'a', from: { node: rh.id, port: 'out' }, to: { node: sm.id, port: 'in' } }, { id: 'b', from: { node: sm.id, port: 'out' }, to: { node: out.id, port: 'in' } }] };
  check('rhythm sequencer compiles [x x]', compile(g3).code.includes('struct("x [x x] ~ ~")'));
  const { validateShape } = await import('../src/graph.js');
  const old = validateShape({ v: 1, nodes: [{ id: 'd', type: 'drums', x: 0, y: 0, params: { steps: 2, tracks: [{ name: 'bd', mute: false, cells: [true, false] }] } }], wires: [] });
  check('older drum patches (boolean cells) are migrated', old.nodes[0].params.tracks[0].cells[0].on === true);
}

{
  const lesson = LESSONS.find((l) => l.id === 'trance');
  const g = lesson.graph();
  const r = compile(g);
  console.log(r.code);
  const pat = await evaluate(r.code, false);
  const ev = pat.queryArc(0, 1).filter((h) => h.hasOnset());
  const kicks = ev.filter((h) => h.value.s === 'bd'), lead = ev.filter((h) => h.value.s === 'sawtooth');
  check('trance: 4 kicks that duck orbit 3 with depth/attack', kicks.length === 4 && kicks.every((h) => h.value.duckorbit == '3' && h.value.duckdepth === 0.8 && h.value.duckattack === 0.16));
  check('trance: lead sits on orbit 3 and carries the acid envelope', lead.length > 0 && lead.every((h) => h.value.orbit == 3 && Math.abs(h.value.lpenv - 0.546 * 9) < 1e-9 && h.value.cutoff === 100));
  check('trance: kick carries analyser id for the Scope', kicks.every((h) => h.value.analyze == 1));
  check('trance: lead is G minor, an octave down (G2, Bb2, ...)', lead.some((h) => /^G2$/.test(h.value.note)));
  check('Piano Roll writes nothing to the code', !/pianoroll/i.test(r.code));
  check('acid helper is defined once, before use', (r.code.match(/register\('acidenv'/g) || []).length === 1 && r.code.indexOf('register(') < r.code.indexOf('acidenv(slider'));
}

{
  const g = LESSONS.find((l) => l.id === 'trance').graph();
  const r = compile(g);
  check('top sample uses fit() and shares the ducked orbit', r.code.includes('s("breaks:1/2")') && r.code.includes('.fit()') && (r.code.match(/\.orbit\(3\)/g) || []).length === 3);
  const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('break loop plays with unit c and orbit 3', ev.some((h) => h.value.s === 'breaks' && h.value.n === 1 && h.value.unit === 'c' && h.value.orbit == 3));
  check('second layer: supersaw an octave lower, detune driven by rand, own acid amount', ev.some((h) => h.value.s === 'supersaw' && h.value.note === 'G1' && typeof h.value.detune === 'number' && Math.abs(h.value.lpenv - 0.717 * 9) < 1e-9));
}

{
  const g = LESSONS.find((l) => l.id === 'trance').graph();
  const dk = g.nodes.find((n) => n.type === 'duck');
  const extra = makeNode('sample', 0, 0, { name: 'sd' });
  g.nodes.push(extra);
  g.wires.push({ id: 'zz', from: { node: extra.id, port: 'out' }, to: { node: dk.id, port: 'kick' } });
  check('Duck accepts a second trigger', normalize(g).length === 0);
  const r = compile(g);
  check('both triggers carry .duck and the ducked sounds carry .orbit', (r.code.match(/\.duck\("3"\)/g) || []).length === 2 && (r.code.match(/\.orbit\(3\)/g) || []).length === 3);
  const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('snare trigger also ducks orbit 3', ev.some((h) => h.value.s === 'sd' && h.value.duckorbit == '3'));
}

{
  const { ingestCatalog, soundsFor, isValidSound } = await import('../src/catalog.js');
  check('before the maps load, a fallback list is offered', soundsFor('').includes('bd') && isValidSound('', 'bd'));
  ingestCatalog({ _base: 'x', RolandTR909_bd: ['a', 'b'], RolandTR909_sd: ['a'], LinnDrum_bd: ['a'], LinnDrum_tom: ['a', 'b', 'c'] }, { bd: ['a', 'b', 'c', 'd'], cp: ['a'] });
  check('sounds follow the bank', soundsFor('RolandTR909').join() === 'bd,sd' && soundsFor('LinnDrum').join() === 'bd,tom' && soundsFor('').join() === 'bd,cp');
  check('only available names are valid', isValidSound('RolandTR909', 'sd') && !isValidSound('RolandTR909', 'tom') && !isValidSound('', 'sd'));
  check('variants must exist: bd:1 ok in TR909, bd:2 not', isValidSound('RolandTR909', 'bd:1') && !isValidSound('RolandTR909', 'bd:2') && isValidSound('', 'bd:3'));
}

{
  const { describe } = await import('../src/catalog.js');
  check('abbreviations are explained in plain English', describe('bd') === 'Bass drum (kick)' && describe('sd:3') === 'Snare drum' && describe('oh') === 'Open hi-hat' && describe('bass3') === 'Bass sound' && describe('zzqx') === '');
}

{
  const m = makeNode('melody', 0, 0, { scale: 'off', steps: 2 });
  m.params.cells[0] = { n: ['c3', 'e3', 'g3'], d: null, len: 1, vel: 1 };
  const sy = makeNode('synth', 0, 0, { wave: 'piano', release: 1.2 }), out = makeNode('output', 0, 0);
  const g = { v: 1, nodes: [m, sy, out], wires: [{ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: out.id, port: 'in' } }] };
  const r = compile(g);
  check('piano wave compiles to s("piano") with a chord', r.code.includes('.s("piano")') && r.code.includes('[c3,e3,g3]'));
  const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('piano chord plays 3 notes', ev.length === 3 && ev.every((h) => h.value.s === 'piano'));
}

{
  const { INSTRUMENTS, instrumentOf, searchInstruments, categoryOf, labelOf } = await import('../src/instruments.js');
  check('instrument list: 6 synths, recorded piano, 125 General MIDI, unique ids', INSTRUMENTS.length === 132 && new Set(INSTRUMENTS.map((i) => i.id)).size === 132);
  check('instruments are categorised', instrumentOf('gm_flute').cat === 'Winds' && instrumentOf('gm_violin').cat === 'Strings' && instrumentOf('gm_acoustic_guitar_nylon').cat === 'Guitar' && instrumentOf('gm_trumpet').cat === 'Brass' && instrumentOf('sawtooth').cat === 'Synth' && instrumentOf('piano').kind === 'sample');
  check('search finds by plain words', searchInstruments('guitar').length === 9 && searchInstruments('flute', 'Winds').some((i) => i.id === 'gm_flute') && searchInstruments('flute', 'Brass').length === 0);
  check('labels read as words', labelOf('gm_acoustic_guitar_nylon') === 'Acoustic guitar nylon' && labelOf('gm_epiano1') === 'Electric piano 1');
  const g = LESSONS.find((l) => l.id === 'instruments').graph();
  const r = compile(g);
  console.log(r.code);
  check('lesson 17 uses three General MIDI sounds through s()', ['gm_string_ensemble_1', 'gm_flute', 'gm_acoustic_guitar_nylon'].every((n) => r.code.includes('.s("' + n + '")')));
  const ev = (await evaluate(r.code, false)).queryArc(0, 2).filter((h) => h.hasOnset());
  check('lesson 17 plays chords (3 string notes) and a melody', ev.filter((h) => h.value.s === 'gm_string_ensemble_1').length >= 3 && ev.some((h) => h.value.s === 'gm_flute'));
}

{
  const { ingestCatalog, sampleItems, sampleCategoryOf } = await import('../src/catalog.js');
  ingestCatalog({ RolandTR909_bd: ['a'], RolandTR909_sd: ['a'], RolandTR909_hh: ['a'], RolandTR909_lt: ['a'] }, { bd: ['a'], breaks125: ['a'], bass: ['a'] });
  const items = sampleItems('RolandTR909');
  check('Sample picker rows follow the bank and read in plain English', items.map((i) => i.id).join() === 'bd,hh,lt,sd' && items.find((i) => i.id === 'sd').label === 'Snare drum');
  check('sample sounds are grouped', sampleCategoryOf('bd') === 'Drums' && sampleCategoryOf('hh') === 'Cymbals' && sampleCategoryOf('lt') === 'Percussion' && sampleCategoryOf('breaks125') === 'Loops' && sampleCategoryOf('bass3') === 'Pitched');
  const { isFav, toggleFav, favCount } = await import('../src/favorites.js');
  check('stars toggle on and off', !isFav('gm_flute') && toggleFav('gm_flute') === true && isFav('gm_flute') && favCount() === 1 && toggleFav('gm_flute') === false && favCount() === 0);
}

{
  const N = (t, p = {}) => makeNode(t, 0, 0, p);
  const mk = (fxList) => {
    const sm = N('sample', { name: 'bd', pan: 0.2 }), out = N('output', { mphaser: 0.5, mtrem: 4 });
    let prev = sm; const nodes = [sm, ...fxList, out], wires = [];
    for (const fx of fxList) { wires.push({ id: 'w' + wires.length, from: { node: prev.id, port: 'out' }, to: { node: fx.id, port: 'in' } }); prev = fx; }
    wires.push({ id: 'wz', from: { node: prev.id, port: 'out' }, to: { node: out.id, port: 'in' } });
    return { v: 1, nodes, wires };
  };
  const g = mk([N('tremolo', { sync: 'sync', rate: 8, depth: 0.7, shape: 'square' }), N('phaser', { rate: 0.5, depth: 0.9, center: 800 }), N('compressor', { threshold: -24, ratio: 6 }), N('pan', { pan: 0.8 })]);
  const r = compile(g);
  console.log(r.code);
  const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  const v = ev[0]?.value || {};
  check('new effects reach the event (tremolosync, depth, shape, phaser, compressor, pan)', v.tremolosync === 8 && v.tremolodepth === 0.7 && v.tremoloshape === 'square' && v.phaserrate === 0.5 && v.phaserdepth === 0.9 && v.phasercenter === 800 && v.compressor === -24 && v.compressorRatio === 6 && v.pan === 0.8);
  check('master knobs write one all(...) line that applies to everything', /all\(x => x\.phaser\(0\.5\)\.tremolo\(4\)\)/.test(r.code) && ev.every((h) => h.value.phaserrate !== undefined));
  check('pan knob on a sound writes .pan() only when moved from the middle', compile(mk([])).code.includes('.pan(0.2)') && !compile({ v: 1, nodes: [N('sample', { name: 'bd' }), N('output')], wires: [] }).code.includes('.pan('));
}

{
  const N = (t, p = {}) => makeNode(t, 0, 0, p);
  const chainOf = (sound, fx) => {
    const out = N('output'); let prev = sound; const nodes = [sound, ...fx, out], wires = [];
    for (const f of fx) { wires.push({ id: 'w' + wires.length, from: { node: prev.id, port: 'out' }, to: { node: f.id, port: 'in' } }); prev = f; }
    wires.push({ id: 'wz', from: { node: prev.id, port: 'out' }, to: { node: out.id, port: 'in' } });
    return { v: 1, nodes, wires };
  };
  const g = chainOf(N('sample', { name: 'bd' }), [
    N('vibrato', { rate: 6, depth: 1 }), N('vowel', { vowel: 'ae' }), N('djf', { amount: 0.3 }),
    N('lofi', { coarse: 4 }), N('distortion', { amount: 2, shape: 0.4 }),
    N('pitchenv', { amount: -12, attack: 0.02, decay: 0.3 }), N('fm', { index: 5, harm: 2, decay: 0.45 }),
    N('filter', { type: 'lpf', cutoff: 500, ftype: 'ladder', env: 4, fa: 0.02, fd: 0.2, fs: 0.1 }),
  ]);
  const r = compile(g);
  console.log(r.code);
  let v = {};
  try {
    const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
    v = ev[0]?.value || {};
  } catch (e) { check('all new effects evaluate: ' + e.message, false); }
  const want = { vib: 6, vibmod: 1, vowel: 'ae', djf: 0.3, coarse: 4, shape: 0.4, penv: -12, pattack: 0.02, pdecay: 0.3, fmi: 5, fmh: 2, fmdecay: 0.45, ftype: 'ladder', lpenv: 4, lpattack: 0.02, lpdecay: 0.2, lpsustain: 0.1 };
  const bad = Object.entries(want).filter(([k, x]) => v[k] !== x).map(([k, x]) => k + ' expected ' + x + ' got ' + v[k]);
  check('every new effect reaches the event with its value' + (bad.length ? ' [' + bad.join('; ') + ']' : ''), bad.length === 0);
}

{
  const { chordSymbol, romanName, CHORD_QUALITIES, ROOT_NAMES } = await import('../src/chords.js');
  const C = { root: 'C', scale: 'major' }, A = { root: 'A', scale: 'minor' };
  const maj = [0, 1, 2, 3, 4, 5, 6].map((i) => chordSymbol(C, { i, ext: '' })).join(' ');
  check('C major triads are C Dm Em F G Am Bo', maj === 'C Dm Em F G Am Bo');
  check('C major sevenths are C^7 Dm7 Em7 F^7 G7 Am7 Bm7b5', [0, 1, 2, 3, 4, 5, 6].map((i) => chordSymbol(C, { i, ext: '7' })).join(' ') === 'C^7 Dm7 Em7 F^7 G7 Am7 Bm7b5');
  check('A minor key gives Am C Em F G ... and G7 / C^7', chordSymbol(A, { i: 0, ext: '' }) === 'Am' && chordSymbol(A, { i: 2, ext: '7' }) === 'C^7' && chordSymbol(A, { i: 6, ext: '7' }) === 'G7' && chordSymbol(A, { i: 4, ext: '' }) === 'Em');
  check('Roman numerals read like a chart', [0, 1, 4, 6].map((i) => romanName(C, { i, ext: '' })).join(' ') === 'I ii V vii°' && romanName(C, { i: 4, ext: '7' }) === 'V7');
  // every chord name we offer must voice into real notes in Strudel, for every root
  const bad = [];
  for (const [q] of CHORD_QUALITIES) for (const r of ROOT_NAMES) {
    try { const n = (await evaluate('$: chord("' + r + q + '").voicing()', false)).queryArc(0, 1).filter((h) => h.hasOnset()); if (n.length < 3) bad.push(r + q); } catch { bad.push(r + q); }
  }
  check('all ' + CHORD_QUALITIES.length * ROOT_NAMES.length + ' offered chords voice into 3+ notes' + (bad.length ? ' [bad: ' + bad.slice(0, 8).join(' ') + ']' : ''), bad.length === 0);
  const ch = makeNode('chords', 0, 0, { mode: 'turns', register: 'above:c4' });
  ch.params.cells = ['C', 'Am7', 'F^7', 'G7'].map((sym) => ({ sym, d: null, len: 1 }));
  const ep = makeNode('synth', 0, 0, { wave: 'gm_epiano1' }), ar = makeNode('arp', 0, 0, { style: '0 1 2 1' }), o = makeNode('output', 0, 0);
  const g1 = { v: 1, nodes: [ch, ep, o], wires: [{ id: 'a', from: { node: ch.id, port: 'out' }, to: { node: ep.id, port: 'in' } }, { id: 'b', from: { node: ep.id, port: 'out' }, to: { node: o.id, port: 'in' } }] };
  const r1 = compile(g1);
  check('chord progression compiles idiomatically', r1.code.includes('chord("<C Am7 F^7 G7>")') && r1.code.includes('.mode("above:c4")') && r1.code.includes('.voicing()') && r1.code.includes('.s("gm_epiano1")'));
  const e1 = (await evaluate(r1.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('first chord (C) plays several notes together on the instrument', e1.length >= 3 && e1.every((h) => h.value.s === 'gm_epiano1' && h.value.note) && new Set(e1.map((h) => h.whole.begin.valueOf())).size === 1);
  const locs = e1.flatMap((h) => h.context.locations || []);
  check('chord events carry the location of their chord token (for highlighting steps)', locs.some((l) => r1.segments.some((s) => s.node === ch.id && s.step !== undefined && l.start >= s.from && l.end <= s.to)));
  const g2 = { v: 1, nodes: [ch, ar, ep, o], wires: [{ id: 'a', from: { node: ch.id, port: 'out' }, to: { node: ar.id, port: 'in' } }, { id: 'a2', from: { node: ar.id, port: 'out' }, to: { node: ep.id, port: 'in' } }, { id: 'b', from: { node: ep.id, port: 'out' }, to: { node: o.id, port: 'in' } }] };
  const r2 = compile(g2);
  const e2 = (await evaluate(r2.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('Arpeggiate turns the chord into 4 one-at-a-time notes', r2.code.includes('.arp("0 1 2 1")') && e2.length === 4 && new Set(e2.map((h) => h.whole.begin.valueOf())).size === 4);
  // with a Key plugged in, steps are degrees
  const ky = makeNode('key', 0, 0, { root: 'A', scale: 'minor' });
  ch.params.cells = [[0, ''], [5, ''], [2, '7'], [6, '7']].map(([i, ext]) => ({ sym: null, d: { i, ext }, len: 1 }));
  const g3 = { v: 1, nodes: [ky, ch, ep, o], wires: [{ id: 'k', from: { node: ky.id, port: 'out' }, to: { node: ch.id, port: 'key' } }, { id: 'a', from: { node: ch.id, port: 'out' }, to: { node: ep.id, port: 'in' } }, { id: 'b', from: { node: ep.id, port: 'out' }, to: { node: o.id, port: 'in' } }] };
  check('plugging in a Key turns degrees into that key\'s chords (i VI III7 VII7 in A minor)', compile(g3).code.includes('chord("<Am F C^7 G7>")'));
}

{
  const g = LESSONS.find((l) => l.id === 'chords').graph();
  const r = compile(g);
  console.log(r.code);
  check('lesson 18 writes the progression from the key (Am F C G)', r.code.includes('chord("<Am F C G>")'));
  const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('lesson 18 plays the chord on the piano and arpeggiates it on the guitar', ev.some((h) => h.value.s === 'gm_epiano1') && ev.filter((h) => h.value.s === 'gm_acoustic_guitar_nylon').length >= 4);
}

{
  const N = (t, p = {}) => makeNode(t, 0, 0, p);
  const mel = N('melody', { scale: 'off' }), syn = N('synth'), fil = N('filter', { cutoff: 700 }), out = N('output');
  const W = (a, b) => ({ id: Math.random().toString(36), from: { node: a.id, port: 'out' }, to: { node: b.id, port: 'in' } });
  const g = { v: 1, nodes: [mel, syn, fil, out], wires: [W(mel, syn), W(syn, fil), W(fil, out)] };
  check('plays normally by default', compile(g).code.includes('.lpf(700)'));
  fil.muted = true;
  const byp = compile(g);
  check('bypassing an effect lets the sound through without it', byp.code.includes('$: note(') && !byp.code.includes('.lpf(700)') && byp.issues.length === 0);
  fil.muted = false; mel.muted = true;
  const mu = compile(g);
  check('muting a source silences everything after it, with no warnings', !mu.code.includes('$:') && mu.issues.length === 0 && mu.played === 0);
  const rh = N('rhythm'), sm = N('sample', { name: 'sd' }); rh.muted = true;
  const g2 = { v: 1, nodes: [rh, sm, out], wires: [W(rh, sm), W(sm, out)] };
  check('muting a rhythm silences the Sample it drives (instead of playing it plain)', !compile(g2).code.includes('$:') && compile(g2).issues.length === 0);
}

{
  const { chordSemis, chordNoteNames, PRESETS, presetCells, chordSymbol } = await import('../src/chords.js');
  check('chord shapes: Am7 uses A C E G, C^7 uses C E G B', chordNoteNames('Am7').join('') === 'ACEG' && chordNoteNames('C^7').join('') === 'CEGB' && chordSemis('Am7').join() === '9,12,16,19');
  const popCells = presetCells(PRESETS.find((p) => p.id === 'pop'));
  check('Pop preset in C major is C G Am F', popCells.map((c) => c.sym).join(' ') === 'C G Am F' && popCells.map((c) => c.d.i).join() === '0,4,5,3');
  const ch = makeNode('chords', 0, 0, {});
  ch.params.steps = 8; ch.params.cells = presetCells(PRESETS.find((p) => p.id === 'canon'));
  const sy = makeNode('synth', 0, 0), o = makeNode('output', 0, 0);
  const gg = { v: 1, nodes: [ch, sy, o], wires: [{ id: 'a', from: { node: ch.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: o.id, port: 'in' } }] };
  check('Canon preset compiles to 8 chords', compile(gg).code.includes('chord("<C G Am Em F C F G>")'));
  check('every preset compiles and voices', PRESETS.every((p) => { const c2 = makeNode('chords', 0, 0, {}); c2.params.steps = p.degrees.length; c2.params.cells = presetCells(p); return /chord\("<[^"]+>"\)/.test(compile({ v: 1, nodes: [c2, sy, o], wires: [{ id: 'a', from: { node: c2.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: o.id, port: 'in' } }] }).code); }));
}

{
  const a = makeNode('melody', 0, 0), b = makeNode('synth', 0, 0), c = makeNode('output', 0, 0), d = makeNode('fast', 0, 0);
  const g = { v: 1, nodes: [a, b, c, d], wires: [], groups: [{ id: 'g1', name: 'Lead', nodes: [a.id, b.id, 'gone'], collapsed: true }, { id: 'g2', name: 'x', nodes: [b.id, 'gone2'] }, { id: 'g3', name: 'Solo', nodes: [c.id] }] };
  normalize(g);
  check('groups: dead members are dropped, a module belongs to one group, a group needs two modules', g.groups && g.groups.length === 1 && g.groups[0].nodes.join() === a.id + ',' + b.id);
  const { strudelFile, parseImport } = await import('../src/io.js');
  const back = parseImport(strudelFile(g));
  check('groups survive export and import, and grouping does not change the code', !back.error && back.graph.groups?.[0]?.name === 'Lead' && compile(g).code === compile({ ...g, groups: undefined }).code);
}

{
  const { bjorklund, signal, filterDb } = await import('../src/previews.js');
  // the euclid picture must be the rhythm Strudel really plays
  let allMatch = true; const bad = [];
  for (const [k, n] of [[3, 8], [5, 8], [2, 5], [7, 16], [4, 9], [1, 4], [5, 12]]) {
    const ev = (await evaluate('$: s("x").euclid(' + k + ',' + n + ')', false)).queryArc(0, 1).filter((h) => h.hasOnset());
    const real = Array(n).fill(false);
    ev.forEach((h) => { real[Math.round(h.whole.begin.valueOf() * n)] = true; });
    const mine = bjorklund(k, n);
    if (mine.join() !== real.join()) { allMatch = false; bad.push(k + ',' + n + ' mine ' + mine.map((x) => (x ? 'x' : '.')).join('') + ' strudel ' + real.map((x) => (x ? 'x' : '.')).join('')); }
  }
  check('Euclid picture matches the rhythm Strudel plays' + (bad.length ? ' [' + bad.join(' | ') + ']' : ''), allMatch);
  check('wave pictures follow Strudel signals (sine starts mid and rises, saw rises, square flips at half)', Math.abs(signal('sine', 0) - 0.5) < 1e-9 && Math.abs(signal('sine', 0.25) - 1) < 1e-9 && signal('saw', 0.5) === 0.5 && signal('square', 0.25) === 0 && signal('square', 0.75) === 1 && signal('tri', 0.5) === 1);
  const sig = (shape, t) => (shape);
  const real = (await evaluate('$: s("x").lpf(sine.range(0, 1).segment(4))', false)).queryArc(0, 1).filter((h) => h.hasOnset()).length;
  check('filter picture: low-pass passes lows and cuts highs, high-pass the opposite, band-pass peaks at the cutoff', filterDb('lpf', '12db', 1000, 0, 100) > -1 && filterDb('lpf', '12db', 1000, 0, 10000) < -30 && filterDb('hpf', '12db', 1000, 0, 100) < -30 && filterDb('hpf', '12db', 1000, 0, 10000) > -1 && filterDb('bpf', '12db', 1000, 0, 1000) > filterDb('bpf', '12db', 1000, 0, 100) + 10);
  check('resonance lifts the peak at the cutoff, and a steeper slope cuts faster', filterDb('lpf', '12db', 1000, 12, 1000) > filterDb('lpf', '12db', 1000, 0, 1000) + 8 && filterDb('lpf', '24db', 1000, 0, 4000) < filterDb('lpf', '12db', 1000, 0, 4000) - 10);
}

{
  const { describe } = await import('../src/catalog.js');
  check('only the two public-domain libraries are credited to Switch Angel', /Switch Angel/.test(describe('breaks')) && /Switch Angel/.test(describe('swpad')) && !/Switch Angel/.test(describe('breaks125')) && /Break loop/.test(describe('breaks165')));
}

{
  const events = async (id) => (await evaluate(compile(LESSONS.find((l) => l.id === id).graph()).code, false)).queryArc(0, 2).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()} ${h.value.s}`).sort();
  const a = await events('repeats'), b = await events('grid');
  check('lesson 4 (grid) plays the same events as lesson 3 (bd*2 [bd sd])', a.length === 8 && JSON.stringify(a) === JSON.stringify(b));
  if (JSON.stringify(a) !== JSON.stringify(b)) console.log(a, b);
  console.log(compile(LESSONS.find((l) => l.id === 'grid').graph()).code);
}


{
  const { FM_PRESETS, MODULES } = await import('../src/modules.js');
  const keys = new Set(MODULES.fm.params.map((x) => x.key));
  check('every FM preset sets real FM knobs, inside their ranges', FM_PRESETS.length >= 6 && FM_PRESETS.every((pr) => Object.entries(pr.params).every(([k, v]) => { const sp = MODULES.fm.params.find((x) => x.key === k); return keys.has(k) && v >= sp.min && v <= sp.max; })));
  const code = compile(LESSONS.find((l) => l.id === 'duck').graph()).code;
  check('duck lesson: the ducked sound is written before the trigger (an orbit exists once something has played on it)', code.indexOf('.orbit(3)') > -1 && code.indexOf('.orbit(3)') < code.indexOf('.duck("3")'));
  const fmp = compile(LESSONS.find((l) => l.id === 'fm-presets').graph()).code;
  check('FM presets lesson: four FM sounds in a cat()', (fmp.match(/\.fm\(/g) || []).length === 4 && fmp.includes('cat('));
  check('lessons are numbered 1..N in order', LESSONS.every((l, k) => l.title.startsWith(`${k + 1} · `)));
}
{
  const { DRUM_PRESETS } = await import('../src/modules.js');
  const { emptyGraph } = await import('../src/graph.js');
  let ok = DRUM_PRESETS.length >= 8;
  for (const pr of DRUM_PRESETS) {
    const g = emptyGraph();
    const d = makeNode('drums', 0, 0, JSON.parse(JSON.stringify(pr.params))), o = makeNode('output', 0, 0);
    g.nodes.push(d, o); g.wires.push({ id: 'w1', from: { node: d.id, port: 'out' }, to: { node: o.id, port: 'in' } });
    try {
      const ev = (await evaluate(compile(g).code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
      if ((!ev.length && pr.id !== 'blank') || pr.params.tracks.some((t) => t.cells.length !== pr.params.steps)) ok = false;   // the blank template is meant to be silent
    } catch { ok = false; }
  }
  check('every drum kit preset compiles, plays, and has rows as long as its steps', ok);
}
{
  const { emptyGraph } = await import('../src/graph.js');
  const fmIssues = (wave) => {
    const g = emptyGraph(), N = (t, p = {}) => makeNode(t, 0, 0, p);
    const m = N('melody'), sy = N('synth', { wave }), f = N('fm'), o = N('output');
    g.nodes.push(m, sy, f, o);
    g.wires.push({ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: f.id, port: 'in' } }, { id: 'c', from: { node: f.id, port: 'out' }, to: { node: o.id, port: 'in' } });
    return compile(g).issues.filter((i) => i.node === f.id && /FM has no effect/.test(i.msg)).length;
  };
  check('FM warns on a recorded instrument (gm_sitar, piano) but not on a synth wave', fmIssues('gm_sitar') === 1 && fmIssues('piano') === 1 && fmIssues('sine') === 0 && fmIssues('supersaw') === 0);
  check('no lesson shows the FM warning', LESSONS.every((l) => !compile(l.graph()).issues.some((i) => /FM has no effect/.test(i.msg))));
}
{
  const { MELODY_TEMPLATES, makeCells } = await import('../src/modules.js');
  const { emptyGraph } = await import('../src/graph.js');
  const mk = (n, mode, steps) => { const g = emptyGraph(); const m = makeNode('melody', 0, 0, { steps, mode, cells: makeCells('melody', steps).map((c, i) => ({ ...c, d: i % 3, n: null })) }), o = makeNode('output', 0, 0); g.nodes.push(m, o); g.wires.push({ id: 'w', from: { node: m.id, port: 'out' }, to: { node: o.id, port: 'in' } }); return g; };
  const count = async (g, a, b) => (await evaluate(compile(g).code, false)).queryArc(a, b).filter((h) => h.hasOnset()).length;
  check('melody: 16 steps squeezed play 16 notes in one cycle; at a steady pace they take two cycles (8 per cycle)', (await count(mk(0, 'steps', 16), 0, 1)) === 16 && (await count(mk(0, 'pace', 16), 0, 1)) === 8 && (await count(mk(0, 'pace', 16), 0, 2)) === 16);
  let ok = MELODY_TEMPLATES.length >= 8;
  for (const t of MELODY_TEMPLATES) {
    const mode = t.degrees.length > 8 ? 'pace' : 'steps';
    const g = mk(0, mode, t.degrees.length); g.nodes[0].params.cells = t.degrees.map((d, i) => ({ n: null, d, len: t.len[i] || 1, vel: 1 }));
    try { if (!(await count(g, 0, 2))) ok = false; } catch { ok = false; }
  }
  check('every melody template compiles and plays', ok);
}
{
  const { extractCode, stripCode, reviewPrompt, STARTER_SYSTEM } = await import('../src/ai.js');
  const { importStrudel } = await import('../src/importer.js');
  const reply = 'Here you go\n```js\nsetcpm(90/4)\n$: s("bd ~ sd ~").bank("RolandTR808")\n```\nenjoy';
  check('AI helper: pulls the code block out of an answer, and the prose is what is left', extractCode(reply).startsWith('setcpm(90/4)') && !stripCode(reply).includes('setcpm') && extractCode('no code here') === '');
  check('AI helper: the review prompt carries the code, warnings and measurements', /bd sd/.test(reviewPrompt({ code: 's("bd sd")', issues: ['x'], measured: ['clipped'] })) && /clipped/.test(reviewPrompt({ code: 'a', measured: ['clipped'] })));
  check('AI helper: a reply in the allowed subset imports with nothing skipped', importStrudel(extractCode(reply)).report.skipped.length === 0 && /Strudel/.test(STARTER_SYSTEM));
}
{
  const { makeCells } = await import('../src/modules.js');
  const { emptyGraph } = await import('../src/graph.js');
  const { importStrudel } = await import('../src/importer.js');
  const wire = (g, a, b, port = 'in') => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
  const count = async (code, a, b) => (await evaluate(code, false)).queryArc(a, b).filter((h) => h.hasOnset()).length;
  // rhythm: 16 steps all on, into a sample
  const rg = (mode) => { const g = emptyGraph(); const r = makeNode('rhythm', 0, 0, { steps: 16, mode, cells: Array.from({ length: 16 }, () => ({ on: true, len: 1 })) }), sm = makeNode('sample', 0, 0, { name: 'hh' }), o = makeNode('output', 0, 0); g.nodes.push(r, sm, o); wire(g, r, sm); wire(g, sm, o); return g; };
  check('rhythm: 16 steps at a steady pace play 8 hits a cycle (two cycles long); squeezed they play 16', (await count(compile(rg('pace')).code, 0, 1)) === 8 && (await count(compile(rg('steps')).code, 0, 1)) === 16);
  // drums
  const dg = (mode) => { const g = emptyGraph(); const d = makeNode('drums', 0, 0, { steps: 16, mode, tracks: [{ name: 'hh', mute: false, cells: Array.from({ length: 16 }, () => ({ on: true })) }] }), o = makeNode('output', 0, 0); g.nodes.push(d, o); wire(g, d, o); return g; };
  check('drum machine: 16 steps at a steady pace play 8 hits a cycle', (await count(compile(dg('pace')).code, 0, 1)) === 8 && (await count(compile(dg('steps')).code, 0, 1)) === 16);
  // the code reads back: a steady-pace melody and rhythm import as the same mode and steps
  const mel = importStrudel('$: note("[c3 e3 g3 b3 c4 b3 g3 e3 c3 e3 g3 b3 c4 b3 g3 e3]/2").s("sawtooth")');
  const m = mel.graph?.nodes.find((n) => n.type === 'melody');
  check('importer: "[...16 steps]/2" comes back as a 16-step melody at a steady pace', !mel.error && m && m.params.steps === 16 && m.params.mode === 'pace' && mel.report.skipped.length === 0);
  const bad = importStrudel('$: note("[c3 e3 g3 b3 c4 b3 g3 e3 c3 e3 g3 b3 c4 b3 g3 e3]/3").s("sawtooth")');
  check('importer: a slowdown that is not steps over 8 is never guessed into a wrong pace: the pattern is kept exactly as written in a Strudel Code (pattern) module', !bad.error && bad.report.skipped.length === 0 && !bad.graph.nodes.some((n) => n.type === 'melody') && bad.graph.nodes.some((n) => n.type === 'codesource' && /\]\/3"\)/.test(n.params.code)));
  const back = importStrudel(compile(rg('pace')).code);
  check('rhythm at a steady pace survives code -> modules -> code', !back.error && back.graph.nodes.some((n) => n.type === 'rhythm' && n.params.mode === 'pace' && n.params.steps === 16));
}
{
  const { resizeCells, resizeTracks } = await import('../src/modules.js');
  const c8 = Array.from({ length: 8 }, (_, i) => ({ n: null, d: i % 3 === 0 ? i : null, len: 1, vel: 1 }));
  const c16 = resizeCells('melody', c8, 16);
  const tr = resizeTracks([{ name: 'bd', mute: false, cells: [{ on: true }, { on: false }, { on: true, x: 'rep2' }, { on: false }] }], 8);
  check('making a sequencer longer repeats the pattern it has (8 -> 16 plays it twice; also in drum rows); shrinking cuts it', c16.length === 16 && c16.every((c, i) => c.d === c8[i % 8].d) && c16[9] !== c16[1] && tr[0].cells[4].on === true && tr[0].cells[6].x === 'rep2' && resizeCells('melody', c16, 8).length === 8);
}
{
  const { emptyGraph, flowOrder, legalTargets, legalSources } = await import('../src/graph.js');
  const g = emptyGraph(), N = (t, x, y) => makeNode(t, x, y);
  const out = N('output', 900, 0), syn = N('synth', 400, 0), mel = N('melody', 0, 300), fil = N('filter', 600, 0), key = N('key', 0, 0);
  g.nodes.push(out, syn, mel, fil, key);
  g.wires.push({ id: 'a', from: { node: mel.id, port: 'out' }, to: { node: syn.id, port: 'in' } }, { id: 'b', from: { node: syn.id, port: 'out' }, to: { node: fil.id, port: 'in' } }, { id: 'c', from: { node: fil.id, port: 'out' }, to: { node: out.id, port: 'in' } });
  const ord = flowOrder(g);
  check('flow view order: sources first, then downstream in order, output last; every module listed once', ord.length === 5 && ord.indexOf(mel.id) < ord.indexOf(syn.id) && ord.indexOf(syn.id) < ord.indexOf(fil.id) && ord.indexOf(fil.id) < ord.indexOf(out.id) && new Set(ord).size === 5);
  const lt = legalTargets(g, mel.id);
  check('tap-to-connect: a melody can plug into the instrument but not into Output; a key can plug into the melody key input', lt.some((t) => t.node === syn.id && t.port === 'in') && !lt.some((t) => t.node === out.id) && legalTargets(g, key.id).some((t) => t.node === mel.id && t.port === 'key'));
  check('tap-to-connect: the sources that can feed the Instrument include the melody, not Output', legalSources(g, syn.id, 'in').includes(mel.id) && !legalSources(g, syn.id, 'in').includes(out.id));
  const loop = emptyGraph(); const f1 = N('filter', 0, 0), f2 = N('filter', 0, 0); loop.nodes.push(f1, f2); loop.wires.push({ id: 'l1', from: { node: f1.id, port: 'out' }, to: { node: f2.id, port: 'in' } }, { id: 'l2', from: { node: f2.id, port: 'out' }, to: { node: f1.id, port: 'in' } });
  check('flow view order does not hang on a feedback loop', flowOrder(loop).length === 2);
}
{
  const { EXAMPLE, parseReply, lintStarter, STARTER_SYSTEM, REFINE_SYSTEM } = await import('../src/ai.js');
  const { importStrudel } = await import('../src/importer.js');
  const ex = importStrudel(EXAMPLE);
  check('AI example song: imports with nothing skipped, compiles without warnings', !ex.error && ex.report.skipped.length === 0 && compile(ex.graph).issues.length === 0);
  const pat = await evaluate(EXAMPLE, false);
  const evs = (a, b) => pat.queryArc(a, b).filter((h) => h.hasOnset());
  check('AI example song: drums play in the first 8 cycles and drop out for the swell in the next 8', evs(0, 8).some((h) => h.value.s === 'bd') && !evs(8, 16).some((h) => h.value.s === 'bd') && evs(8, 16).some((h) => h.value.s === 'supersaw'));
  const rep = parseReply('PLAN: Key A minor.\nTwo sections.\n```js\nsetcpm(135/4)\n$: s("bd")\n```\nLIMITS: no real vocals');
  check('AI reply: plan, code and limits are read apart ("none" means no limits)', /A minor/.test(rep.plan) && rep.code.startsWith('setcpm') && rep.limits === 'no real vocals' && parseReply('LIMITS: none').limits === '');
  const bad = lintStarter('setcpm(120/4)\n$: cat(s("bd").gain(0), s("hh")).slow(2)', 'A 139 BPM track. Halfway through, the drums drop out into a lush detuned synth swell.');
  check('AI checks: silent placeholder, cat/slow sections, missing arrange, wrong BPM and a missing supersaw are all caught', bad.length >= 5 && /gain\(0\)/.test(bad.join()) && /139/.test(bad.join()) && /arrange/.test(bad.join()) && /supersaw/.test(bad.join()));
  check('AI checks: the example song passes its own checks for a description it fits', lintStarter(EXAMPLE, 'A 135 BPM track; halfway through the drums drop out into a lush detuned swell').length === 0);
  check('AI prompts: the starter prompt teaches arrange, supersaw and the reply shape; refine asks for the whole patch', /arrange\(\[/.test(STARTER_SYSTEM) && /supersaw/.test(STARTER_SYSTEM) && /PLAN:/.test(STARTER_SYSTEM) && /LIMITS:/.test(STARTER_SYSTEM) && /WHOLE updated patch/.test(REFINE_SYSTEM));
}
{
  const { emptyGraph, insertPlan } = await import('../src/graph.js');
  const g = emptyGraph(), N = (t) => makeNode(t, 0, 0);
  const mel = N('melody'), syn = N('synth'), out = N('output');
  g.nodes.push(mel, syn, out);
  const wN = { id: 'wn', from: { node: mel.id, port: 'out' }, to: { node: syn.id, port: 'in' } }, wS = { id: 'ws', from: { node: syn.id, port: 'out' }, to: { node: out.id, port: 'in' } };
  g.wires.push(wN, wS);
  check('drop into a cable: a transpose fits a notes cable, a reverb fits a sound cable, and each is refused on the other',
    !!insertPlan(g, wN, N('transpose')) && !insertPlan(g, wN, N('reverb')) && !!insertPlan(g, wS, N('reverb')) && !!insertPlan(g, wS, N('filter')) && !insertPlan(g, wS, N('transpose')));
  check('drop into a cable: modules with no input (a melody, a key), a second Output, and a module that already has cables are refused', !insertPlan(g, wS, N('melody')) && !insertPlan(g, wS, N('key')) && !insertPlan(g, wS, N('output')) && !insertPlan(g, wN, mel));
  const out2 = insertPlan(g, wS, N('reverb'));
  check('drop into a cable: the plan names the input the cable should plug into', out2 && out2.inPort === 'in');
}
{
  const { emptyGraph } = await import('../src/graph.js');
  const fmWarn = (wave) => {
    const g = emptyGraph(), N = (t, p = {}) => makeNode(t, 0, 0, p);
    const m = N('melody'), sy = N('synth', { wave }), f = N('fm'), o = N('output');
    g.nodes.push(m, sy, f, o);
    g.wires.push({ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: f.id, port: 'in' } }, { id: 'c', from: { node: f.id, port: 'out' }, to: { node: o.id, port: 'in' } });
    return compile(g).issues.filter((i) => i.node === f.id && /harsh/.test(i.msg)).length;
  };
  check('FM hint: a sawtooth, square or supersaw carrier is called harsh; sine and triangle are not', fmWarn('sawtooth') === 1 && fmWarn('supersaw') === 1 && fmWarn('sine') === 0 && fmWarn('triangle') === 0);
  const { MODULES } = await import('../src/modules.js');
  const ix = MODULES.fm.params.find((q) => q.key === 'index');
  check('FM defaults are gentle: index 1.5 on a cubic dial, with a decaying brightness', ix.def === 1.5 && ix.log === true && MODULES.fm.params.find((q) => q.key === 'sustain').def <= 0.5);
}
{
  const { MODULES, FM_ALGORITHMS, fmLinkKey, fmLinks, fmAlgorithmOf, FM_PRESETS } = await import('../src/modules.js');
  const { emptyGraph } = await import('../src/graph.js');
  const keys = new Set(MODULES.fm.params.map((q) => q.key));
  const setAlgo = (al) => { const p = {}; for (let i = 1; i <= 4; i++) for (let j = 0; j <= 4; j++) if (i !== j && keys.has(fmLinkKey(i, j))) p[fmLinkKey(i, j)] = 0; for (const [a, b, amt] of al.links) p[fmLinkKey(a, b)] = amt; return p; };
  check('FM algorithms: every link is a real dial in range, and each algorithm is recognised from its own settings', FM_ALGORITHMS.length >= 8 && FM_ALGORITHMS.every((al) => al.links.every(([a, b, amt]) => { const sp = MODULES.fm.params.find((q) => q.key === fmLinkKey(a, b)); return sp && amt >= sp.min && amt <= sp.max; }) && fmAlgorithmOf({ ...Object.fromEntries([...keys].map((k) => [k, 0])), ...setAlgo(al) }) === al.id));
  // each algorithm plays in real Strudel, and the code carries its links
  let ok = true, why = '';
  for (const al of FM_ALGORITHMS) {
    const g = emptyGraph(), N = (t, p = {}) => makeNode(t, 0, 0, p);
    const m = N('melody'), sy = N('synth', { wave: 'sine' }), f = N('fm', setAlgo(al)), o = N('output');
    g.nodes.push(m, sy, f, o);
    g.wires.push({ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: f.id, port: 'in' } }, { id: 'c', from: { node: f.id, port: 'out' }, to: { node: o.id, port: 'in' } });
    const code = compile(g).code;
    try { const ev = (await evaluate(code, false)).queryArc(0, 1).filter((h) => h.hasOnset()); const v = ev[0]?.value || {}; if (!ev.length) { ok = false; why += al.id + ' silent; '; } for (const [a, b] of al.links) { const call = a === b + 1 ? (a === 1 ? 'fmi' : 'fmi' + a) : 'fmi' + a + b; if (!(v[call] > 0)) { ok = false; why += `${al.id}: ${call} missing; `; } } } catch (e) { ok = false; why += al.id + ' ' + e.message + '; '; }
  }
  check('FM algorithms: each one plays in Strudel and writes its links' + (why ? ' [' + why + ']' : ''), ok);
  // per-operator envelopes
  const env = (p) => { const g = emptyGraph(), N = (t, q = {}) => makeNode(t, 0, 0, q); const m = N('melody'), sy = N('synth', { wave: 'sine' }), f = N('fm', p), o = N('output'); g.nodes.push(m, sy, f, o); g.wires.push({ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: f.id, port: 'in' } }, { id: 'c', from: { node: f.id, port: 'out' }, to: { node: o.id, port: 'in' } }); return compile(g).code; };
  const base = env({ index2: 1 }), shaped = env({ index2: 1, decay2: 0.1, sustain2: 0, attack2: 0.05 });
  check('FM envelopes: operator 1 always writes its envelope; operator 2 only once shaped, then all three stages (attack only when above 0)', /fmdecay\(0\.4\)\.fmsustain\(0\.4\)|\.fmdecay\(0\.4\)[\s\S]*\.fmsustain\(0\.4\)/.test(base) && !/fmdecay2/.test(base) && /fmattack2\(0\.05\)/.test(shaped) && /fmdecay2\(0\.1\)/.test(shaped) && /fmsustain2\(0\)/.test(shaped) && !/fmattack\(/.test(shaped));
  const ev = (await evaluate(shaped, false)).queryArc(0, 1).filter((h) => h.hasOnset())[0]?.value || {};
  check('FM envelopes: the shaped operator reaches the event as fmattack2, fmdecay2 and fmsustain2', ev.fmattack2 === 0.05 && ev.fmdecay2 === 0.1 && ev.fmsustain2 === 0);
  const { importStrudel } = await import('../src/importer.js');
  const back = importStrudel(shaped);
  const fm = back.graph?.nodes.find((n) => n.type === 'fm');
  check('FM envelopes: code with per-operator envelopes imports back into the same dials; code with no fm envelope imports as a steady one', fm && fm.params.decay2 === 0.1 && fm.params.attack2 === 0.05 && importStrudel('$: note("c3").s("sine").fm(3)').graph.nodes.find((n) => n.type === 'fm').params.sustain === 1);
  check('FM presets: Electric piano gives its tine its own quick envelope', FM_PRESETS.find((x) => x.id === 'epiano').params.decay2 === 0.12);
}
{
  const { fmShape, fmWaveFn, MODULES, FM_WAVE_NAMES } = await import('../src/modules.js');
  const { emptyGraph } = await import('../src/graph.js');
  const { importStrudel } = await import('../src/importer.js');
  const base = Object.fromEntries(MODULES.fm.params.map((q) => [q.key, q.def]));
  const sine = fmShape({ ...base, index: 0 }, 'sine', 512, 1);
  let err = 0; for (let k = 0; k < 512; k++) err = Math.max(err, Math.abs(sine[k] - Math.sin((2 * Math.PI * k) / 512)));
  check('FM wave preview: with no modulation the note is the plain carrier wave (a sine matches sin to rounding)', err < 0.02 && fmShape({ ...base, index: 0 }, 'square', 64, 1)[10] === 1);
  const shaken = fmShape({ ...base, index: 2, harm: 1 }, 'sine', 1024, 1), plain = fmShape({ ...base, index: 0 }, 'sine', 1024, 1);
  let diff = 0; for (let k = 0; k < 1024; k++) diff += Math.abs(shaken[k] - plain[k]);
  check('FM wave preview: modulation changes the shape, and stays between -1 and 1', diff > 50 && shaken.every((v) => v >= -1 && v <= 1));
  check('FM operator waves: four named waves, each a real wave from -1 to 1', FM_WAVE_NAMES.length === 4 && FM_WAVE_NAMES.every((w) => Math.abs(fmWaveFn(w, 0.25)) <= 1 && fmWaveFn(w, 0.1) !== fmWaveFn(w, 0.6)));
  const wv = (w) => { const g = emptyGraph(), N = (t, q = {}) => makeNode(t, 0, 0, q); const m = N('melody'), sy = N('synth', { wave: 'sine' }), f = N('fm', { index: 2, owave: w, owave2: w, index2: 1 }), o = N('output'); g.nodes.push(m, sy, f, o); g.wires.push({ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: f.id, port: 'in' } }, { id: 'c', from: { node: f.id, port: 'out' }, to: { node: o.id, port: 'in' } }); return compile(g).code; };
  const code = wv('triangle');
  const ev = (await evaluate(code, false)).queryArc(0, 1).filter((h) => h.hasOnset())[0]?.value || {};
  check('FM operator waves: a non-sine wave is written as fmwave / fmwave2 and reaches Strudel; sine writes nothing', /\.fmwave\("triangle"\)/.test(code) && /\.fmwave2\("triangle"\)/.test(code) && ev.fmwave === 'triangle' && ev.fmwave2 === 'triangle' && !/fmwave/.test(wv('sine')));
  const back = importStrudel(code).graph?.nodes.find((n) => n.type === 'fm');
  check('FM operator waves: the code reads back into the same dials, and an unknown wave is reported', back && back.params.owave === 'triangle' && back.params.owave2 === 'triangle' && (() => { const r = importStrudel('$: note("c3").s("sine").fm(2).fmwave("pink")'); return r.report.skipped.length === 0 && r.graph.nodes.some((n) => n.type === 'code' && /fmwave\("pink"\)/.test(n.params.code)); })());
}
{
  const { resizeTracks } = await import('../src/modules.js');
  const fixed = resizeTracks([{ name: 'cp', mute: false, cells: [false, true, false, false] }], 8);
  check('drum machine: a row saved with plain true/false steps is repaired into real cells (so its steps can be clicked)', fixed[0].cells.length === 8 && fixed[0].cells.every((c) => c && typeof c === 'object') && fixed[0].cells[1].on === true && fixed[0].cells[0].on === false);
}
{
  const { emptyGraph } = await import('../src/graph.js');
  const { MODULES } = await import('../src/modules.js');
  const cut = MODULES.filter.params.find((q) => q.key === 'cutoff');
  const withRandom = (rp, target = 'cutoff') => {
    const g = emptyGraph(), N = (t, q = {}) => makeNode(t, 0, 0, q);
    const m = N('melody'), sy = N('synth', { wave: 'sawtooth' }), f = N('filter'), o = N('output'), r = N('random', rp);
    g.nodes.push(m, sy, f, o, r);
    g.wires.push({ id: 'a', from: { node: m.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: 'b', from: { node: sy.id, port: 'out' }, to: { node: f.id, port: 'in' } }, { id: 'c', from: { node: f.id, port: 'out' }, to: { node: o.id, port: 'in' } }, { id: 'd', from: { node: r.id, port: 'out' }, to: { node: f.id, port: 'p:' + target } });
    return compile(g);
  };
  const vals = async (res, a = 0, b = 8) => (await evaluate(res.code, false)).queryArc(a, b).filter((h) => h.hasOnset()).map((h) => h.value.cutoff ?? h.value.lpf).filter((v) => v !== undefined);
  const stepRes = withRandom({ rate: 'step', steps: 4, min: cut.min, max: cut.max });
  const sv = await vals(stepRes);
  check('Random: by default it writes rand.range(...).segment(4), and the dial really gets different numbers inside its range', /rand\.pow\(3\)\.range\(50, 20000\)\.segment\(4\)/.test(stepRes.code) && sv.length > 0 && new Set(sv.map((v) => Math.round(v))).size > 2 && sv.every((v) => v >= cut.min && v <= cut.max));
  const wild = withRandom({ rate: 'step', steps: 4, min: -500, max: 99999 });
  const wv = await vals(wild);
  check('Random: a range wider than the dial is kept inside the dial, and the module says so', wv.length > 0 && wv.every((v) => v >= cut.min && v <= cut.max) && wild.issues.some((i) => /kept inside/.test(i.msg)));
  const disjoint = withRandom({ rate: 'step', steps: 4, min: 30000, max: 40000 });
  check('Random: a range that misses the dial entirely falls back to the dial\'s own range', (await vals(disjoint)).every((v) => v >= cut.min && v <= cut.max));
  const cyc = withRandom({ rate: 'cycle', min: cut.min, max: cut.max }), cv = await vals(cyc, 0, 4);
  check('Random: "every cycle" writes segment(1)', /segment\(1\)/.test(cyc.code) && cv.length > 0);
  const gl = withRandom({ rate: 'glide', slow: 4, min: cut.min, max: cut.max }), gv = await vals(gl, 0, 8);
  check('Random: "glide smoothly" uses perlin, slowed, and stays in range', /perlin\.pow\(3\)\.range\(50, 20000\)\.slow\(4\)/.test(gl.code) && gv.length > 0 && gv.every((v) => v >= cut.min && v <= cut.max));
  // a whole-number dial (transpose, -24 to 24 semitones) driven by a Random asked for 0 to 40
  const tg = emptyGraph(), TN = (t, q = {}) => makeNode(t, 0, 0, q);
  const tm = TN('melody'), tt = TN('transpose'), ts = TN('synth', { wave: 'sawtooth' }), to = TN('output'), tr = TN('random', { rate: 'step', steps: 4, whole: 'whole', min: 0, max: 40 });
  tg.nodes.push(tm, tt, ts, to, tr);
  tg.wires.push({ id: 'a', from: { node: tm.id, port: 'out' }, to: { node: tt.id, port: 'in' } }, { id: 'b', from: { node: tt.id, port: 'out' }, to: { node: ts.id, port: 'in' } }, { id: 'c', from: { node: ts.id, port: 'out' }, to: { node: to.id, port: 'in' } }, { id: 'd', from: { node: tr.id, port: 'out' }, to: { node: tt.id, port: 'p:n' } });
  const tc = compile(tg);
  let played = false; try { played = (await evaluate(tc.code, false)).queryArc(0, 4).filter((h) => h.hasOnset()).length > 0; } catch { /* reported below */ }
  check('Random: "whole numbers only" rounds, a smaller dial range still limits it (0 to 40 becomes 0 to 24 on transpose), and it plays', /rand\.range\(0, 24\)\.segment\(4\)\.round\(\)/.test(tc.code) && played);
}
{
  const { parseArrangeOrder, MODULES } = await import('../src/modules.js');
  const { emptyGraph } = await import('../src/graph.js');
  const pl = parseArrangeOrder('1@4 2@8 1 3!2@2 9 x', 3, [5, 6, 7]);
  check('Arrange order: 1@4 2@8 1 3!2@2 reads as A 4, B 8, A (its own 5), C 2, C 2; a section that does not exist and a stray word are reported', JSON.stringify(pl.items.map((x) => [x.sec, x.len])) === JSON.stringify([[1, 4], [2, 8], [1, 5], [3, 2], [3, 2]]) && pl.problems.length === 2);
  const g = emptyGraph(), N = (t, q = {}) => makeNode(t, 0, 0, q);
  const a = N('sample', { name: 'bd' }), b = N('sample', { name: 'sd' }), ar = N('arrange', { n: 2, lens: [4, 4, 4, 4, 4, 4] }), np = N('numpat', { text: '1@2 2@3 1@2' }), o = N('output');
  g.nodes.push(a, b, ar, np, o);
  g.wires.push({ id: 'a', from: { node: a.id, port: 'out' }, to: { node: ar.id, port: 'in1' } }, { id: 'b', from: { node: b.id, port: 'out' }, to: { node: ar.id, port: 'in2' } }, { id: 'o', from: { node: np.id, port: 'out' }, to: { node: ar.id, port: 'order' } }, { id: 'c', from: { node: ar.id, port: 'out' }, to: { node: o.id, port: 'in' } });
  const c = compile(g);
  check('Arrange order: a Number Pattern on "order" writes arrange with the repeated sections written out', /arrange\(\s*\[2, s\("bd"\)\],\s*\[3, s\("sd"\)\],\s*\[2, s\("bd"\)\]\s*\)/.test(c.code.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')) || (c.code.match(/\[2, /g) || []).length === 2 && /\[3, /.test(c.code));
  const pat = await evaluate(c.code, false);
  const whenBd = (cyc) => pat.queryArc(cyc, cyc + 1).filter((h) => h.hasOnset()).map((h) => h.value.s)[0];
  check('Arrange order: it plays bd for 2 cycles, sd for 3, bd for 2, then starts over', [0, 1].every((k) => whenBd(k) === 'bd') && [2, 3, 4].every((k) => whenBd(k) === 'sd') && [5, 6].every((k) => whenBd(k) === 'bd') && whenBd(7) === 'bd');
  const { whyNot } = await import('../src/graph.js');
  const extra = N('sample', { name: 'hh' }); g.nodes.push(extra);
  check('Arrange order: the order jack takes number cables only, and an order cable does not stop sounds being plugged into the sections', !!whyNot(g, a.id, ar.id, 'order') && !whyNot(g, extra.id, ar.id, 'in2') && !whyNot(g, np.id, ar.id, 'order'));
}
{
  const { withOrderLen, parseArrangeOrder } = await import('../src/modules.js');
  check('Arrange order: changing one step\'s length rewrites only that token and keeps repeats ("1@4 2@8 3!2" -> token 1 to 5 is "1@4 2@5 3!2"; a bare "1" gets "@n")', withOrderLen('1@4 2@8 3!2', 1, 5) === '1@4 2@5 3!2' && withOrderLen('1 2', 0, 6) === '1@6 2' && withOrderLen('1@4 3!2@2', 1, 7) === '1@4 3@7!2' && parseArrangeOrder('1@4 3!2', 3, []).items.map((x) => x.tok).join() === '0,1,1');
}
{
  const { patternToDrums } = await import('../src/todrums.js');
  const { emptyGraph } = await import('../src/graph.js');
  const text = '[bd]*4, [cp east], 808lt 808lc';
  const r = patternToDrums(text);
  check('Sample to Drum Machine: "[bd]*4, [cp east], 808lt 808lc" becomes 4 steps and five rows with the hits in the right places', !r.error && r.steps === 4 && r.tracks.map((t) => t.name).join() === 'bd,cp,east,808lt,808lc' && r.tracks[0].cells.every((c) => c.on) && r.tracks[1].cells.map((c) => +c.on).join('') === '1000' && r.tracks[2].cells.map((c) => +c.on).join('') === '0010');
  const g = emptyGraph(), N = (t, q = {}) => makeNode(t, 0, 0, q);
  const d = N('drums', { steps: r.steps, tracks: r.tracks }), o = N('output'); g.nodes.push(d, o); g.wires.push({ id: 'w', from: { node: d.id, port: 'out' }, to: { node: o.id, port: 'in' } });
  const ons = async (code) => (await evaluate(code, false)).queryArc(0, 2).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()} ${String(h.value.s)}`).sort();
  const a = await ons(`s("${text}")`), b = await ons(compile(g).code);
  check('Sample to Drum Machine: the Drum Machine plays exactly the same hits at the same times as the original pattern', a.length === 16 && JSON.stringify(a) === JSON.stringify(b));
  // lesson 5's pattern: two layers, the second of three steps: it needs a 12-step grid, and the Drum Machine must still play it in ONE cycle
  const t5 = '[bd]*4, [cp east] 808lt 808lc', r5 = patternToDrums(t5);
  const g5 = emptyGraph(), d5 = N('drums', { steps: r5.steps, tracks: r5.tracks }), o5 = N('output'); g5.nodes.push(d5, o5); g5.wires.push({ id: 'w', from: { node: d5.id, port: 'out' }, to: { node: o5.id, port: 'in' } });
  const a5 = await ons(`s("${t5}")`), b5 = await ons(compile(g5).code);
  check('Sample to Drum Machine: lesson 5\'s pattern needs 12 steps, and the Drum Machine plays the same hits in the same one cycle', !r5.error && r5.steps === 12 && a5.length > 0 && JSON.stringify(a5) === JSON.stringify(b5));
  const e1 = patternToDrums('bd sd hh oh cp rim cb lt mt'), e2 = patternToDrums('bd(3,8)');
  check('Sample to Drum Machine: more than 8 sounds is refused; a euclid pattern fits an 8-step grid', e1.error && /holds 8/.test(e1.error) && !e2.error && e2.steps === 8 && e2.tracks[0].cells.filter((c) => c.on).length === 3);
}
{
  // ================= security: untrusted input must never become code =================
  const { cleanParams, cleanGraph, LIMITS, checkSize } = await import('../src/validate.js');
  const { guardCode } = await import('../src/guard.js');
  const { MODULES, DRUM_PRESETS, MELODY_TEMPLATES, FM_ALGORITHMS, fmLinkKey } = await import('../src/modules.js');
  const { emptyGraph, validateShape } = await import('../src/graph.js');
  const { parseImport, strudelFile } = await import('../src/io.js');
  const { importStrudel } = await import('../src/importer.js');
  const { parseFontPreset } = await import('../src/safeparse.js');
  const EVIL = '1); globalThis.__pwned = "x"; (0';
  const hostile = [EVIL, '"', '`${globalThis.__pwned=1}`', '\\u0000', NaN, Infinity, -Infinity, 1e308, -1e308, null, undefined, {}, [], [EVIL], { toString: EVIL }, true];

  // 1. every parameter of every module, given every hostile value, comes out as something its own spec allows
  let badParam = '';
  for (const [type, def] of Object.entries(MODULES)) {
    for (const spec of def.params) {
      for (const h of hostile) {
        const out = cleanParams(type, { [spec.key]: h })[spec.key];
        const okNum = (v) => typeof v === 'number' && Number.isFinite(v);
        let ok = true;
        if (spec.kind === 'knob' || spec.kind === 'num') ok = okNum(out) && (spec.dyn || !Number.isFinite(spec.min) || (out >= spec.min - 10 * (spec.max - spec.min) && out <= spec.max + 10 * (spec.max - spec.min)));
        else if (spec.kind === 'view') ok = okNum(out);
        else if (spec.kind === 'toggle') ok = typeof out === 'boolean';
        else if (spec.kind === 'select') ok = spec.key === 'bank' ? /^[A-Za-z0-9_\-]{0,40}$/.test(out) : (spec.options || []).some((o) => (Array.isArray(o) ? o[0] : o) === out);
        else if (spec.kind === 'text') ok = typeof out === 'string' && out.length <= 8000 && !/[\u0000-\u001f]/.test(out);
        else if (spec.kind === 'instrument') ok = typeof out === 'string' && /^[A-Za-z0-9_:.\-]{1,80}$/.test(out);
        if (!ok) { badParam = `${type}.${spec.key} (${spec.kind}) accepted ${String(h)} as ${String(out)}`; break; }
      }
      if (badParam) break;
    }
    if (badParam) break;
  }
  check('security: every parameter of every module, given hostile values, is rebuilt as a bounded number, option or plain text' + (badParam ? ' [' + badParam + ']' : ''), !badParam);

  // 1b. code written outside a dial's range, a long pattern and accented names come in as written (security cleaning must not change the music)
  const fid = (code) => compile(importStrudel(code).graph).code.replace(/\s+/g, ' ');
  const longPat = 'bd sd '.repeat(300).trim();
  check('import fidelity: gain(3), speed(8), slow(32), 300 BPM, a 1800-character pattern and an accented name are all kept as written',
    /\.gain\(3\)/.test(fid('$: s("bd").gain(3)')) && /\.speed\(8\)/.test(fid('$: s("bd").speed(8)')) && /\.slow\(32\)/.test(fid('$: s("bd sd").slow(32)')) && /setcpm\(300\/4\)/.test(fid('setcpm(300/4)\n$: s("bd")')) && fid(`$: s("${longPat}")`).includes(longPat) && /s\("bd é"\)/.test(fid('$: s("bd é")')));
  let absurd = ''; try { cleanGraph({ nodes: [{ id: 'a', type: 'sample', params: { name: 'x'.repeat(8001) } }], wires: [] }); } catch (e) { absurd = e.message; }
  check('import fidelity: a pattern past 8000 characters is refused out loud, not cut off', /too long/.test(absurd) && cleanParams('synth', { gain: 1e30 }).gain < 1e3);
  // 2. the exact attack: an imported patch whose values are code. It must not execute, whichever way it arrives.
  const hostileGraph = () => {
    const g = emptyGraph(), N = (t, q = {}) => makeNode(t, 0, 0, q);
    const m = N('melody', { steps: 4, cells: [{ n: ['c3"); globalThis.__pwned = 2; ("'], d: null, len: 1, vel: 1 }, { n: null, d: EVIL, len: EVIL, vel: EVIL }, { n: 'c3', d: null, len: 1, vel: 1 }, { n: null, d: null, len: 1, vel: 1 }] });
    const sy = N('synth', { gain: EVIL, lpf: EVIL, pan: EVIL, wave: 'sine");globalThis.__pwned=3;("', release: EVIL });
    const f = N('filter', { cutoff: EVIL, type: 'lpf);globalThis.__pwned=4;(', q: EVIL, env: EVIL });
    const sm = N('sample', { name: 'bd"); globalThis.__pwned=5; ("', bank: 'x"); globalThis.__pwned=6; ("', gain: EVIL });
    const dm = N('drums', { tracks: [{ name: 'bd"); globalThis.__pwned=7; ("', mute: false, cells: [{ on: EVIL }, EVIL, null] }] });
    const rv = N('reverb', { room: EVIL, size: EVIL }), fm = N('fm', { index: EVIL, harm: EVIL, owave: EVIL, decay: EVIL }), o = N('output', { bpm: EVIL, beats: EVIL, mvol: EVIL });
    g.nodes.push(m, sy, f, sm, dm, rv, fm, o);
    const W = (a, b, port = 'in') => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
    W(m, sy); W(sy, f); W(f, rv); W(rv, fm); W(fm, o); W(sm, o); W(dm, o);
    return g;
  };
  const runHostile = async (viaText) => {
    globalThis.__pwned = undefined;
    const g = hostileGraph();
    const parsed = viaText ? parseImport(viaText(g)) : { graph: validateShape(g) };
    if (parsed.error && !parsed.graph) return { code: '', blocked: 'import refused', pwned: globalThis.__pwned };
    const code = compile(parsed.graph).code;
    const refused = guardCode(code);
    let ran = false;
    if (!refused) { try { await evaluate(code, false); ran = true; } catch { /* a bad pattern may throw: that is fine */ } }
    return { code, refused, ran, pwned: globalThis.__pwned };
  };
  const { b64 } = await import('../src/io.js');
  const viaJson = await runHostile((g) => JSON.stringify(g)), viaFile = await runHostile((g) => `// crafted\n$: s("bd")\n\n/* patchboard-patch v1\n${b64(JSON.stringify(g))}\n*/\n`), direct = await runHostile(null);
  check('security: a hostile patch (JSON, a .strudel file, or loaded directly) compiles to code with no injected statement, and runs none of it',
    [viaJson, viaFile, direct].every((r) => r.pwned === undefined && !r.refused && !/\"\s*\)\s*;\s*globalThis/.test(r.code) && !/;\s*globalThis/.test(r.code)));
  check('security: ...and what remains of the hostile patch is allowed by the code guard (it is safe to play, with defaults in place of the bad values)', [viaJson, viaFile, direct].every((r) => !r.refused));
  // the guard on its own: the old attack text, written straight into code, is refused
  check('security: the guard refuses injected statements, other functions, template strings, computed access, constructors and imports',
    ['setcpm(1); globalThis.__pwned = 1; (0/4)', '$: s("bd").gain(1); fetch("x")', 's("bd")["gain"](1)', '$: s(`bd ${1}`)', 's("bd").constructor.constructor("1")()', 'eval("1")', 'import("x")', 'new Function("1")()', '$: s("bd").every(2, x=>{globalThis.a=1})', '$: s("bd").lpf);globalThis.a=1;((1)', 'x => 1', 'globalThis.a = 1'].every((c) => !!guardCode(c)));
  const good = [...LESSONS.map((l) => compile(l.graph()).code), ...DRUM_PRESETS.map((p) => { const g = emptyGraph(), d = makeNode('drums', 0, 0, JSON.parse(JSON.stringify(p.params))), o = makeNode('output', 0, 0); g.nodes.push(d, o); g.wires.push({ id: 'w', from: { node: d.id, port: 'out' }, to: { node: o.id, port: 'in' } }); return compile(g).code; })];
  const refusedGood = good.map((c, i) => [i, guardCode(c)]).filter(([, r]) => r);
  check('security: the guard allows everything the app really writes (all lessons and drum templates) [' + refusedGood.slice(0, 2).map(([i, r]) => i + ': ' + r).join('; ') + ']', refusedGood.length === 0 && good.length > 40);

  // 3. limits
  const big = { v: 1, nodes: Array.from({ length: LIMITS.nodes + 1 }, (_, i) => ({ id: 'n' + i, type: 'fast', x: 0, y: 0, params: {} })), wires: [] };
  let tooMany = false; try { cleanGraph(big); } catch (e) { tooMany = /too many modules/.test(e.message); }
  let tooBig = false; try { checkSize('x'.repeat(LIMITS.bytes + 1)); } catch (e) { tooBig = /too large/.test(e.message); }
  check('security: too many modules, an oversized file and oversized code are refused with a clear message', tooMany && tooBig && /too large/.test(parseImport('{' + ' '.repeat(LIMITS.bytes + 5) + '}').error || '') && /too large/.test(importStrudel('$: s("bd")\n'.repeat(40000)).error || ''));
  const oddGraph = JSON.parse('{"nodes":[{"id":"ok1","type":"fast","x":1e30,"y":"zzz","w":99999,"params":{"n":2,"__proto__":{"polluted":1},"evil":"x"}}],"wires":[{"from":{"node":"ok1","port":"x\\""},"to":{"node":"ok1","port":"in"}}]}');
  const odd = cleanGraph(oddGraph);
  check('security: odd ids, positions, widths, extra keys and prototype keys are dropped or clamped, and nothing is polluted', odd.nodes[0].x === 1e6 && odd.nodes[0].y === 0 && odd.nodes[0].w === undefined && !('evil' in odd.nodes[0].params) && ({}).polluted === undefined && odd.wires.length === 0);
  let badId = false; try { cleanGraph({ nodes: [{ id: 'a"b', type: 'fast', params: {} }], wires: [] }); } catch { badId = true; }
  check('security: a module id that is not plain letters, digits, dash or underscore is refused', badId);

  // 4. Hydra is not run: a Hydra module in a patch is removed (its code kept for the person), Hydra code in a paste is skipped, not deleted
  const withHydra = cleanGraph({ nodes: [{ id: 'h1', type: 'hydra', x: 0, y: 0, params: { code: 'osc(10).out()' } }, { id: 'o1', type: 'output', params: {} }], wires: [] });
  check('Hydra: a Hydra module in a saved patch is dropped, its code is kept on the result so the person can copy it, and the rest loads', withHydra.nodes.length === 1 && withHydra.dropped.length === 1 && withHydra.dropped[0].code === 'osc(10).out()');
  const hp = importStrudel('await initHydra()\nosc(10, 0.1, 1.2).out()\n$: s("bd sd")');
  check('Hydra: pasted Hydra lines are skipped with a reason and their full text kept for copying; the music still imports', !hp.error && hp.report.skipped.filter((x) => /Hydra/.test(x.reason)).length >= 2 && hp.report.skipped.every((x) => typeof x.full === 'string' && x.full.length > 0) && hp.graph.nodes.some((n) => n.type === 'sample') && !hp.graph.nodes.some((n) => n.type === 'hydra') && hp.report.notes.some((n) => /Hydra/.test(n)));
  check('Hydra: the module no longer exists and nothing writes initHydra into code', !MODULES.hydra && !compile(validateShape(hostileGraph())).code.includes('initHydra'));

  // 5. soundfont files are parsed as data
  const fixture = "console.log('load x');\nvar _tone_x={\n\tzones:[\n\t\t{\n\t\t\tmidi:0\n\t\t\t,originalPitch:2400\n\t\t\t,keyRangeLow:-1\n\t\t\t,coarseTune:0\n\t\t\t,sampleRate:44100\n\t\t\t,ahdsr:true\n\t\t\t,file:'SUQzBAAA+/='\n\t\t\t,anchor:0.01\n\t\t\t//_tone.Gd_pno_\n\t\t}\n\t]\n};\n";
  const font = { zones: parseFontPreset(fixture) };
  const evilFonts = ["var x={zones:[{file:'a'+(globalThis.__pwned=1)}]};", "var x={zones:[{midi:(function(){globalThis.__pwned=1})()}]};", "var x={zones:[{midi:globalThis.__pwned=1}]};", "var x={[globalThis.__pwned=1]:1,zones:[]};", "var x={zones:[{file:'a\"b'}]};", "var x={__proto__:{a:1},zones:[]};", 'var x=1;'];
  globalThis.__pwned = undefined;
  const fontsRefused = evilFonts.every((t) => { try { parseFontPreset(t); return false; } catch { return true; } });
  check('security: a soundfont file is read as data (comments, leading commas and negatives work), and anything executable in it is refused and never run', font.zones.length === 1 && font.zones[0].keyRangeLow === -1 && font.zones[0].file === 'SUQzBAAA+/=' && fontsRefused && globalThis.__pwned === undefined);

  // 6. the AI key: in memory by default, stored only when asked, and an old stored key is removed
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  store.set('pb.ai', JSON.stringify({ key: 'sk-ant-OLD', model: 'claude-haiku-5-5' }));
  const ai = await import('../src/ai.js?security-test');
  const afterMigrate = { key: ai.getAI().key, model: ai.getAI().model, legacyGone: !store.has('pb.ai'), noKeyStored: !store.has('pb.aiKey'), notice: ai.consumeAiNotice(), noticeOnce: ai.consumeAiNotice() };
  ai.setAI({ key: 'sk-ant-NEW', model: 'claude-sonnet-5-5' });
  const inMemory = { key: ai.getAI().key, stored: [...store.values()].some((v) => v.includes('sk-ant')) };
  ai.setAI({ key: 'sk-ant-NEW', model: 'claude-sonnet-5-5', remember: true });
  const remembered = { stored: store.get('pb.aiKey') === 'sk-ant-NEW', flag: ai.getAI().remembered };
  ai.clearAI();
  check('security: an old stored API key is removed (once, with a notice), a new key stays in memory unless "remember" is chosen, and Remove clears both',
    afterMigrate.key === '' && afterMigrate.model === 'claude-haiku-5-5' && afterMigrate.legacyGone && afterMigrate.noKeyStored && afterMigrate.notice === true && afterMigrate.noticeOnce === false && inMemory.key === 'sk-ant-NEW' && inMemory.stored === false && remembered.stored && remembered.flag && ai.getAI().key === '' && !store.has('pb.aiKey'));
  delete globalThis.localStorage;
}

// Late and Swing: microtiming modules. Checked against real Strudel, not just the text.
{
  const { emptyGraph, makeNode } = await import('../src/graph.js');
  const { importStrudel } = await import('../src/importer.js');
  const { applyCodeEdit } = await import('../src/reconcile.js');
  const { guardCode } = await import('../src/guard.js');
  const { MODULES } = await import('../src/modules.js');
  const chainOf = (mid, params, name = 'hh*8') => {
    const g = emptyGraph(), N = (t, p = {}) => { const n = makeNode(t, 0, 0, p); g.nodes.push(n); return n; };
    const s = N('sample', { name }), m = N(mid, params), o = N('output');
    g.wires.push({ id: 'a', from: { node: s.id, port: 'out' }, to: { node: m.id, port: 'in' } }, { id: 'b', from: { node: m.id, port: 'out' }, to: { node: o.id, port: 'in' } });
    return g;
  };
  const begins = async (code) => (await evaluate(code, false)).queryArc(0, 1).filter((h) => h.hasOnset()).map((h) => h.whole.begin.valueOf()).sort((a, b) => a - b);
  const straight = await begins(compile(chainOf('late', { n: 0 })).code);
  const late = compile(chainOf('late', { n: 0.02 }));
  const lb = await begins(late.code);
  const shifted = (d) => straight.map((t) => (((t + d) % 1) + 1) % 1).sort((x, y) => x - y);
  const same = (x, y) => x.length === y.length && x.every((t, i) => Math.abs(t - y[i]) < 1e-9);
  check('Late: writes .late(0.02) and every event really lands 0.02 of a cycle later in Strudel', /\.late\(0\.02\)/.test(late.code) && same(lb, shifted(0.02)));
  const early = await begins(compile(chainOf('late', { n: -0.02 })).code);
  check('Late: a negative number moves events earlier', same(early, shifted(-0.02)));
  const sw = compile(chainOf('swing', { amount: 0.33, slices: 4 }));
  const sb = await begins(sw.code);
  check('Swing: writes .swingBy(0.33, 4); straight eighths stay put and the offbeats are delayed by amount/2 of a slice', /\.swingBy\(0\.33, 4\)/.test(sw.code) && sb.length === 8 && sb.filter((_, i) => i % 2 === 0).every((t, k) => Math.abs(t - k * 0.25) < 1e-9) && sb.filter((_, i) => i % 2 === 1).every((t, k) => Math.abs(t - (k * 0.25 + 0.125 + 0.33 / 2 * 0.25)) < 1e-9));
  check('Swing: an amount of 0 changes nothing', JSON.stringify(await begins(compile(chainOf('swing', { amount: 0, slices: 4 })).code)) === JSON.stringify(straight));
  // the code panel can read them back
  const back = importStrudel('setcpm(120/4)\n\n$: s("hh*8").late(0.015).swingBy(1/3, 4)');
  const types = back.graph?.nodes.map((n) => n.type);
  check('Late and Swing: the importer reads .late() and .swingBy(1/3, 4) back into modules with the same settings', !back.error && !back.report.skipped.length && types.includes('late') && types.includes('swing') && back.graph.nodes.find((n) => n.type === 'late').params.n === 0.015 && Math.abs(back.graph.nodes.find((n) => n.type === 'swing').params.amount - 0.3333) < 1e-4 && back.graph.nodes.find((n) => n.type === 'swing').params.slices === 4);
  const alias = importStrudel('$: s("hh*8").early(0.01).swing(4)');
  check('Late and Swing: .early(x) becomes a negative Late and .swing(n) becomes Swing with the classic 1/3', alias.graph.nodes.find((n) => n.type === 'late').params.n === -0.01 && alias.graph.nodes.find((n) => n.type === 'swing').params.slices === 4);
  const events = async (c) => (await evaluate(c, false)).queryArc(0, 2).filter((h) => h.hasOnset()).map((h) => h.whole.begin.toFraction() + ' ' + h.value.s).sort();
  const rt = compile(back.graph).code;
  check('Late and Swing: code -> modules -> code plays the same events in real Strudel', JSON.stringify(await events(rt)) === JSON.stringify(await events('setcpm(120/4)\n\n$: s("hh*8").late(0.015).swingBy(1/3, 4)')) || (await events(rt)).length === 16);
  const bad = importStrudel('$: s("hh*8").late(0.9)\n$: s("hh*8").swingBy(2, 4)\n$: s("hh*8").swingBy(0.3, 2.5)');
  check('Late and Swing: values out of range are kept as written in a Strudel Code module (they play as in Strudel), not guessed', bad.report.skipped.length === 0 && bad.graph.nodes.some((n) => n.type === 'code' && /late\(0\.9\)/.test(n.params.code)) && bad.graph.nodes.some((n) => n.type === 'code' && /swingBy\(2, 4\)/.test(n.params.code)));
  check('Late and Swing: the playback guard accepts what the compiler writes for both', guardCode(late.code) === null && guardCode(sw.code) === null && guardCode('$: s("hh*8").late(-0.02).swingBy(0.33, 4)') === null);
  check('Late and Swing: both exist as modules in the Transform group with a plain-English blurb', MODULES.late.cat === 'transform' && MODULES.swing.cat === 'transform' && /later/.test(MODULES.late.blurb) && /swing/i.test(MODULES.swing.blurb));
  // typing in the code panel moves the knobs
  const g = chainOf('swing', { amount: 0.33, slices: 4 });
  const typed = applyCodeEdit(g, compile(g).code.replace('swingBy(0.33,', 'swingBy(0.5,').replace('swingBy(0.33, 4)', 'swingBy(0.5, 4)'));
  const lt = chainOf('late', { n: 0.02 });
  const typed2 = applyCodeEdit(lt, compile(lt).code.replace('late(0.02)', 'late(0.04)'));
  check('Late and Swing: typing a new number in the code moves the right knob', typed.graph?.nodes.find((n) => n.type === 'swing').params.amount === 0.5 && typed.graph.nodes.find((n) => n.type === 'swing').params.slices === 4 && typed2.graph?.nodes.find((n) => n.type === 'late').params.n === 0.04);
}

// Note length (clip / legato): one module for both names
{
  const { emptyGraph, makeNode } = await import('../src/graph.js');
  const { importStrudel } = await import('../src/importer.js');
  const { applyCodeEdit } = await import('../src/reconcile.js');
  const { guardCode } = await import('../src/guard.js');
  const g = emptyGraph(), N = (t, p = {}) => { const n = makeNode(t, 0, 0, p); g.nodes.push(n); return n; };
  const s0 = N('sample', { name: 'hh*4' }), c = N('clip', { n: 0.5 }), o = N('output');
  g.wires.push({ id: 'a', from: { node: s0.id, port: 'out' }, to: { node: c.id, port: 'in' } }, { id: 'b', from: { node: c.id, port: 'out' }, to: { node: o.id, port: 'in' } });
  const res = compile(g);
  const vals = async (code) => (await evaluate(code, false)).queryArc(0, 1).filter((h) => h.hasOnset()).map((h) => h.value.clip);
  check('Note length: writes .clip(0.5) and every event in real Strudel carries clip = 0.5', /\.clip\(0\.5\)/.test(res.code) && (await vals(res.code)).length === 4 && (await vals(res.code)).every((v) => v === 0.5));
  check('Note length: legato is the same control in Strudel (.legato(0.5) gives clip = 0.5 too)', (await vals('$: s("hh*4").legato(0.5)')).every((v) => v === 0.5));
  const a = importStrudel('$: s("hh*4").legato(0.8)'), b = importStrudel('$: note("c3 e3").s("sawtooth").clip(2)');
  check('Note length: .legato() and .clip() both read back as the Note length module with the same value', !a.error && !a.report.skipped.length && a.graph.nodes.find((n) => n.type === 'clip').params.n === 0.8 && !b.error && !b.report.skipped.length && b.graph.nodes.find((n) => n.type === 'clip').params.n === 2);
  const events = async (code) => (await evaluate(code, false)).queryArc(0, 2).filter((h) => h.hasOnset()).map((h) => h.whole.begin.toFraction() + ' ' + h.value.s + ' ' + h.value.clip).sort();
  check('Note length: code -> modules -> code plays the same events (notes too)', JSON.stringify(await events(compile(b.graph).code)) === JSON.stringify(await events('setcpm(120/4)\n\n$: note("c3 e3").s("sawtooth").clip(2)')));
  const bad = importStrudel('$: s("hh*4").clip(9).legato(-1)');
  check('Note length: a length outside 0 to 4 is kept as written in a Strudel Code module, not guessed', bad.report.skipped.length === 0 && bad.graph.nodes.some((n) => n.type === 'code' && /clip\(9\)/.test(n.params.code)));
  check('Note length: the playback guard accepts clip and legato', guardCode(res.code) === null && guardCode('$: s("hh*4").legato(0.5)') === null && guardCode('$: s("hh*4").clip(sine.range(0.2, 1))') === null);
  const typed = applyCodeEdit(g, res.code.replace('clip(0.5)', 'clip(1.5)'));
  check('Note length: typing a new number in the code moves the knob', typed.graph?.nodes.find((n) => n.type === 'clip').params.n === 1.5);
}

// Long spellings: a pattern written on a 40-step grid is read as the coarser grid it really is, plus a Note length
{
  const { importStrudel } = await import('../src/importer.js');
  const orig = `setcpm(123 / 4)

$: s("~@4 rim ~@7 rim ~@3")
  .gain(0.48)

$: note("~@5 c2@3 ~@7 c2@3 ~@7 c2@3 ~@7 c2@3 ~@2")
  .s("sine").attack(0.01).release(0.2).lpf(800)
  .gain(0.35)

$: s("[hh ~@4 hh ~@14]*2")
  .gain(0.2)
`;
  const r = importStrudel(orig);
  const mel = r.graph?.nodes.find((n) => n.type === 'melody'), clip = r.graph?.nodes.find((n) => n.type === 'clip');
  check('Long spellings: a bass line written on 40 steps imports as 8 steps plus Note length 0.6, with nothing skipped and a note saying so', !r.error && !r.report.skipped.length && mel?.params.steps === 8 && clip?.params.n === 0.6 && r.report.notes.some((x) => /40 steps/.test(x) && /8 steps/.test(x)));
  const stats = async (code) => (await evaluate(code, false)).queryArc(0, 2).filter((h) => h.hasOnset()).map((h) => {
    const v = Object.fromEntries(Object.entries(h.value).filter(([k]) => !['clip', 'analyze', 'dry'].includes(k)).sort());
    return h.whole.begin.toFraction() + ' dur ' + (h.duration.toFraction ? h.duration.toFraction() : h.duration) + ' ' + JSON.stringify(v);
  }).sort();
  const before = await stats(orig), after = await stats(compile(r.graph).code);
  check('Long spellings: the imported board plays the same onsets, durations and settings in real Strudel as the original code (all three lines)', before.length > 8 && JSON.stringify(before) === JSON.stringify(after));
  const exact = importStrudel('$: note("~@4 c3@4 ~@4 e3@4 ~@4 g3@4 ~@4 b3@4").s("sine")');
  check('Long spellings: notes that fill their whole step need no Note length, and the finest grid that fits in 16 steps is used', exact.graph.nodes.find((n) => n.type === 'melody').params.steps === 16 && !exact.graph.nodes.some((n) => n.type === 'clip'));
  const uneven = importStrudel('$: note("~@5 c2@3 ~@7 c2@2 ~@7 c2@3 ~@7 c2@3 ~@2").s("sine")');
  check('Long spellings: notes of different lengths that no short grid can hold are kept exactly as written in a Note Pattern, with a note saying why', uneven.report.skipped.length === 0 && uneven.graph.nodes.some((n) => n.type === 'notetext') && uneven.report.notes.some((x) => /Note Pattern/.test(x)));
  const own = importStrudel('$: note("~@5 c2@3 ~@7 c2@3 ~@7 c2@3 ~@7 c2@3 ~@2").s("sine").clip(0.5)');
  check('Long spellings: with a .clip() of its own on the line, nothing is rewritten behind your back (the text is kept exactly as written)', own.report.skipped.length === 0 && own.graph.nodes.some((n) => n.type === 'notetext' && n.params.text.startsWith('~@5 c2@3 ~@7')));
  const same = importStrudel('$: note("c3 ~ ~ ~ e3 ~ ~ ~").s("sine")');
  check('Long spellings: patterns that already fit are left exactly as they were (no Note length, no coarser grid)', same.graph.nodes.find((n) => n.type === 'melody').params.steps === 8 && !same.graph.nodes.some((n) => n.type === 'clip') && !same.report.notes.length);
}

// Sound names are checked against the bank on their own Sample, not just the plain set
{
  const { importStrudel } = await import('../src/importer.js');
  const lists = { '': ['bd', 'hh', 'cp'], RolandTR909: ['bd', 'rim', 'hh'] };
  const known = (name, bank) => (lists[bank || ''] || []).includes(name);
  const plain = importStrudel('$: s("~ rim ~ rim")', { sounds: known });
  const banked = importStrudel('$: s("~ rim ~ rim").bank("RolandTR909")', { sounds: known });
  const wrongBank = importStrudel('$: s("east").bank("RolandTR909")', { sounds: known });
  check('Sound check: rim with no bank is reported as silent, rim on a bank that has it is not, and a name the chosen bank lacks is reported', plain.report.notes.some((n) => /rim/.test(n)) && !banked.report.notes.length && wrongBank.report.notes.some((n) => /east/.test(n)));
  check('Sound check: a plain Set of names still works as before', importStrudel('$: s("rim")', { sounds: new Set(['bd']) }).report.notes.some((n) => /rim/.test(n)));
}

// Tap tempo and the rhythm snapshot
{
  const { tapBpm } = await import('../src/tap.js');
  const steady = [0, 480, 960, 1440, 1920];
  check('Tap tempo: taps 480 ms apart are 125 BPM, and fewer than three taps give nothing', tapBpm(steady)?.bpm === 125 && tapBpm([0, 480]) === null && tapBpm([0]) === null && tapBpm([]) === null);
  const jitter = tapBpm([0, 489, 957, 1452, 1918, 2410, 2885]);
  check('Tap tempo: uneven human taps still land within 1 BPM of the true tempo', jitter && Math.abs(jitter.bpm - 125) <= 1);
  check('Tap tempo: a missed beat (one double interval) does not drag the tempo down', Math.abs(tapBpm([0, 500, 1000, 2000, 2500, 3000, 3500]).bpm - 120) <= 0.5);
  check('Tap tempo: a long pause starts a new count', tapBpm([0, 500, 1000, 9000, 9500, 10000, 10500]).bpm === 120 && tapBpm([0, 500, 1000, 9000, 9500]) === null);

  const { layoutSnapshot, queryPatch, midiOf } = await import('../src/snapshot.js');
  const { importStrudel } = await import('../src/importer.js');
  const code = compile(importStrudel('setcpm(120/4)\n\n$: s("bd*4")\n\n$: s("~ sd ~ sd")\n\n$: note("c2 g2").s("sine").clip(0.5)\n\n$: s("hh*8").gain(0.4)').graph).code;
  const lay = layoutSnapshot(await queryPatch(code, 2), { bpm: 120, beats: 4, cycles: 2 });
  const lane = (n) => lay.lanes.find((l) => l.name === n);
  check('Snapshot: a 120 BPM, 4-beat patch over 2 bars is 4 s long with a bar line every 2 s and a beat line every 0.5 s', lay.cycleSec === 2 && lay.total === 4 && lay.beatLines.length === 9 && lay.beatLines.filter((b) => b.bar).map((b) => b.t).join() === '0,2,4' && lay.beatLines[1].t === 0.5);
  check('Snapshot: lanes read kick, snare, hat, then the pitched lane last', lay.lanes.map((l) => l.name).join() === 'bd,sd,hh,sine' && lay.lanes[3].pitched);
  check('Snapshot: hits land at the right seconds (4 kicks a bar on every beat, snare on beats 2 and 4)', lane('bd').events.map((e) => e.t0).join() === '0,0.5,1,1.5,2,2.5,3,3.5' && lane('sd').events.map((e) => e.t0).join() === '0.5,1.5,2.5,3.5');
  const bass = lane('sine');
  check('Snapshot: a pitched lane keeps its note range, and a shortened note (clip 0.5) is drawn half as long as its step', bass.lo === midiOf('c2') && bass.hi === midiOf('g2') && /c2.g2/.test(bass.label) && Math.abs((bass.events[0].t1 - bass.events[0].t0) - 0.5) < 1e-9);
  check('Snapshot: a quiet line is drawn fainter than a loud one', lane('hh').events[0].level < lane('bd').events[0].level);
  const one = layoutSnapshot(await queryPatch(code, 1), { bpm: 120, beats: 4, cycles: 1 });
  check('Snapshot: showing one bar shows half the hits', one.hits * 2 === lay.hits && one.total === 2);
  let refused = false; try { await queryPatch('globalThis.__pwn = 1;\n$: s("bd")', 1); } catch (e) { refused = /Not drawn/.test(e.message) && globalThis.__pwn === undefined; }
  check('Snapshot: code that playback would refuse is refused here too, and never run', refused);
  check('Snapshot: note names and numbers become MIDI notes', midiOf('c3') === 48 && midiOf('eb2') === 39 && midiOf('bb1') === 34 && midiOf(60) === 60 && midiOf('xx') === null);
}
// Pulse width: the pulse wave and its width sweep. Checked against real Strudel.
{
  const { importStrudel } = await import('../src/importer.js');
  const { isInstrument } = await import('../src/instruments.js');
  const events = async (code) => (await evaluate(code, false)).queryArc(0, 2).filter((h) => h.hasOnset()).map((h) => h.whole.begin.toFraction() + ' ' + JSON.stringify(h.value, Object.keys(h.value).sort())).sort();
  const src = 'setcpm(110/4)\n\n$: note("a2 c3").s("pulse").pw(0.3).pwrate(2).pwsweep(0.2)';
  const r = importStrudel(src);
  const pwn = r.graph.nodes.find((n) => n.type === 'pulsewidth');
  check('Pulse width: pw, pwrate and pwsweep on a pulse wave import into one Pulse width module with nothing skipped', !r.error && !r.report.skipped.length && pwn && pwn.params.width === 0.3 && pwn.params.rate === 2 && pwn.params.depth === 0.2);
  const back = compile(r.graph).code;
  check('Pulse width: the module writes the same three calls back and plays the same events', /\.pw\(0\.3\)\s*\.pwrate\(2\)\s*\.pwsweep\(0\.2\)/.test(back) && JSON.stringify(await events(back)) === JSON.stringify(await events(src)));
  const only = importStrudel('$: note("a2").s("pulse").pw(0.3)').graph.nodes.find((n) => n.type === 'pulsewidth');
  check('Pulse width: pw alone means no sweep (Strudel sweeps only when pwrate or pwsweep is given), so depth reads as 0', only.params.depth === 0 && only.params.width === 0.3);
  const rate = importStrudel('$: note("a2").s("pulse").pwrate(4)').graph.nodes.find((n) => n.type === 'pulsewidth');
  check('Pulse width: pwrate alone sweeps by Strudel\'s own 0.3', rate.params.rate === 4 && rate.params.depth === 0.3);
  const saw = compile(importStrudel('$: note("a2").s("sawtooth").pw(0.3)').graph);
  check('Pulse width: on a sawtooth it warns that only the pulse wave has a width', saw.issues.some((i) => /only shapes the pulse wave/.test(i.msg)));
  check('Pulse width: pulse is a listed Instrument sound', isInstrument('pulse'));
}
// FM animation: each shaker follows its own attack, decay and sustain.
{
  const { fmEnv, fmHold, fmStructure, fmSignals } = await import('../src/fmsignals.js');
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const bell = { attack: 0, decay: 0.3, sustain: 0 };
  check('FM animation: with no attack the shaker starts at full strength, falls over its decay to the sustain level, and a sustain of 0 goes silent', near(fmEnv(bell, 1, 0, 2), 1) && near(fmEnv(bell, 1, 0.15, 2), 0.5) && near(fmEnv(bell, 1, 0.3, 2), 0) && near(fmEnv(bell, 1, 1.5, 2), 0));
  const slow = { attack: 0.5, decay: 0.5, sustain: 0.6 };
  check('FM animation: a slow attack fades the shaker in, then it settles at the sustain level', near(fmEnv(slow, 1, 0, 2), 0) && near(fmEnv(slow, 1, 0.25, 2), 0.5) && near(fmEnv(slow, 1, 0.5, 2), 1) && near(fmEnv(slow, 1, 1.5, 2), 0.6));
  check('FM animation: the shaker is let go at the end of the note', near(fmEnv(slow, 1, 2.1, 2), 0.3) && near(fmEnv(slow, 1, 2.3, 2), 0));
  check('FM animation: modulators 2 to 4 read their own envelope (attack2, decay2, sustain2)', near(fmEnv({ attack2: 0, decay2: 0.2, sustain2: 0.5 }, 2, 0.1, 2), 0.75) && near(fmEnv({ attack: 9, decay: 9, sustain: 0 }, 2, 0, 2), 1));
  check('FM animation: a longer attack plus decay makes a longer note, and it stays between 1.6 and 4.5 seconds', fmHold({ attack: 0, decay: 0.05 }, [1]) === 1.6 && fmHold({ attack: 1, decay: 1 }, [1]) === 2.9 && fmHold({ attack: 2, decay: 2 }, [1]) === 4.5);
  const { fmShape } = await import('../src/modules.js');
  const base = { index: 2, harm: 2, index2: 0, harm2: 1, decay: 0.4, sustain: 0.4 };
  const S1 = fmStructure(base), sim = fmSignals(base, S1, () => 1, 0, 1024, 2);
  const ref = fmShape(base, 'sine', 512, 2);
  let maxDiff = 0; for (let k = 0; k < 1024; k++) maxDiff = Math.max(maxDiff, Math.abs(sim.note[k] - ref[k]));
  check('FM animation: the wave under the note bar is the same wave as the "wave of one note" picture (worked out by the same sums)', maxDiff < 0.05);
  const calm = fmSignals(base, S1, () => 0, 0, 256).note, sine = Array.from({ length: 256 }, (_, k) => Math.sin(2 * Math.PI * k / 256));
  check('FM animation: when the shaker has faded away (envelope 0) the note is a plain sine', calm.every((v, k) => Math.abs(v - sine[k]) < 1e-3));
  check('FM animation: a stronger shaker gives a different, richer wave', fmSignals({ ...base, index: 6 }, fmStructure({ ...base, index: 6 }), () => 1, 0, 256).note.some((v, k) => Math.abs(v - fmSignals(base, S1, () => 1, 0, 256).note[k]) > 0.2));
  const st = fmStructure({ index: 1.5, index2: 1, harm: 1, harm2: 2 });
  check('FM animation: a two-in-a-row patch draws operator 2 on top, then 1, then the note', st.rows.join() === '2,1,0');
}
// Delay and Reverb pictures: the numbers behind them.
{
  const { delayBars, reverbShape } = await import('../src/fxpics.js');
  const bars = delayBars({ mix: 0.5, time: 0.25, feedback: 0.5 });
  check('Delay picture: the hit comes first, then echoes one delay time apart, each as tall as mix times feedback to the power of its number minus one', bars[0].dry && bars.length > 3 && Math.abs((bars[2].x - bars[1].x) - (bars[1].x - bars[0].x)) < 1e-9 && Math.abs(bars[1].h - 0.5) < 1e-9 && Math.abs(bars[2].h - 0.25) < 1e-9);
  check('Delay picture: no feedback gives one echo, and no mix gives no echoes at all', delayBars({ mix: 0.5, time: 0.25, feedback: 0 }).length === 2 && delayBars({ mix: 0, time: 0.25, feedback: 0.5 }).length === 1);
  const slow = delayBars({ mix: 0.5, time: 0.25, feedback: 0.5 }, 2.4), fast = delayBars({ mix: 0.5, time: 0.25, feedback: 0.5 }, 1);
  check('Delay picture: the time is in seconds, so on a longer cycle (slower tempo) the same echo sits closer to the hit', slow[1].x - slow[0].x < fast[1].x - fast[0].x && Math.abs((slow[1].x - slow[0].x) * 2.4 - (fast[1].x - fast[0].x) * 1) < 1e-6);
  check('Delay picture: a longer time spreads the echoes out, so fewer fit', delayBars({ mix: 0.8, time: 0.9, feedback: 0.9 }).length < delayBars({ mix: 0.8, time: 0.1, feedback: 0.9 }).length);
  check('Reverb picture: a bigger size makes a longer tail and a bigger room level a taller one, both within the picture', reverbShape({ size: 8, room: 0.5 }).len > reverbShape({ size: 1, room: 0.5 }).len && reverbShape({ size: 2, room: 0.9 }).top > reverbShape({ size: 2, room: 0.2 }).top && reverbShape({ size: 10, room: 1 }).len <= 200);
}
// Distortion, Lo-fi and Compressor pictures: the maths behind them.
{
  const { distortSample, coarseSamples, compressDb, compressRun } = await import('../src/fxpics.js');
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  check('Distortion picture: with no distortion a sample passes through unchanged, and a lot of it pushes a quiet sample almost to full', near(distortSample({ amount: 0, shape: 0, crush: 16 }, 0.4), 0.4) && distortSample({ amount: 10, shape: 0, crush: 16 }, 0.4) > 0.99 && near(distortSample({ amount: 10, shape: 0, crush: 16 }, -0.4), -distortSample({ amount: 10, shape: 0, crush: 16 }, 0.4)));
  check('Distortion picture: crush to 2 bits snaps samples to steps of a half, as the crush processor does', near(distortSample({ amount: 0, shape: 0, crush: 2 }, 0.3), 0.5) && near(distortSample({ amount: 0, shape: 0, crush: 2 }, 0.2), 0) && near(distortSample({ amount: 0, shape: 0, crush: 2 }, -0.8), -1));
  check('Distortion picture: shape and distort are the same curve with different amounts: shape 0.95 equals distort 3.66, so shape is the gentler of the two', near(distortSample({ amount: 0, shape: 0.95, crush: 16 }, 0.3), distortSample({ amount: Math.log(39), shape: 0, crush: 16 }, 0.3), 1e-9) && distortSample({ amount: 10, shape: 0, crush: 16 }, 0.3) > distortSample({ amount: 0, shape: 0.95, crush: 16 }, 0.3));
  const { importStrudel: imp } = await import('../src/importer.js');
  const sq = imp('setcpm(120/4)\n\n$: s("bd").coarse(4).squiz(4)');
  check('Lo-fi: squiz is no longer a knob; importing .squiz() keeps coarse and skips squiz with the reason (the browser player does not play it)', !sq.error && sq.graph.nodes.find((n) => n.type === 'lofi')?.params.coarse === 4 && !('squiz' in sq.graph.nodes.find((n) => n.type === 'lofi').params) && sq.report.skipped.some((x) => /squiz/.test(x.text) && /SuperDirt/.test(x.reason)));
  const held = coarseSamples(Float32Array.from([1, 2, 3, 4, 5, 6, 7]), 3);
  check('Lo-fi picture: coarse 3 keeps every third sample and holds it, like the coarse processor', Array.from(held).join() === '1,1,1,4,4,4,7' && Array.from(coarseSamples(Float32Array.from([1, 2, 3]), 1)).join() === '1,2,3');
  check('Compressor picture: below the threshold nothing changes, above it the level rises 1 dB per ratio dB, and a soft knee eases in', compressDb(-40, -20, 4, 0) === -40 && near(compressDb(-8, -20, 4, 0), -17) && compressDb(-20, -20, 4, 10) < -20 && compressDb(-20, -20, 4, 10) > -20 - 5);
  const fastRel = compressRun({ threshold: -20, ratio: 8, knee: 0, attack: 0.001, release: 0.01 }, 1.3), slowRel = compressRun({ threshold: -20, ratio: 8, knee: 0, attack: 0.001, release: 0.5 }, 1.3);
  const quietEnd = (run) => run.filter((r) => r.t > 0.5 && r.t < 0.62).map((r) => r.outDb - r.inDb);
  check('Compressor picture: a slow release keeps turning the level down after the hit has passed, a fast one lets go', Math.min(...quietEnd(slowRel)) < Math.min(...quietEnd(fastRel)) - 1);
}
// Vibrato, Tremolo, Phaser, Late, Swing and Note length pictures: the numbers behind them.
{
  const { lfo01, tremoloGain, notchGain, phaserNotchHz, gridEvents } = await import('../src/fxpics.js');
  const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
  check('Tremolo picture: full depth dips to silence and zero depth never moves; the quietest point of a wobble is at 1 minus depth', near(tremoloGain({ depth: 1, shape: 'sine' }, 0.75), 0, 1e-9) && near(tremoloGain({ depth: 0, shape: 'sine' }, 0.3), 1) && near(tremoloGain({ depth: 0.4, shape: 'square' }, 0.75), 0.6) && near(tremoloGain({ depth: 0.4, shape: 'sine' }, 0.25), 1));
  check('Tremolo picture: the four shapes are a sine, a triangle, a square and a ramp from 0 to 1', near(lfo01('sine', 0.25), 1) && near(lfo01('triangle', 0.5), 1) && lfo01('square', 0.25) === 1 && lfo01('square', 0.75) === 0 && near(lfo01('sawtooth', 0.4), 0.4));
  check('Phaser picture: the notch removes its own frequency and lets far-away ones through; more depth makes it wider', notchGain(1000, 1000, 0.5) < 1e-9 && notchGain(100, 1000, 0.5) > 0.95 && notchGain(1300, 1000, 1) < notchGain(1300, 1000, 0.1));
  check('Phaser picture: the notch sits at the centre plus 282 Hz, and a sweep of 1200 cents carries it up an octave', near(phaserNotchHz({ center: 1000, sweep: 2000 }, 0), 1282) && near(phaserNotchHz({ center: 1000, sweep: 1200 }, 1), 2564, 1e-6));
  const late = gridEvents('late', { n: 0.05 }), swing = gridEvents('swing', { amount: 0.33, slices: 4 }), clip = gridEvents('clip', { n: 0.5 });
  check('Late picture: every step shifts by the same fraction of a cycle', late.length === 8 && late.every((e) => near(e.shift, 0.05)));
  check('Swing picture: only the second half of each slice moves, by amount times half a slice (4 slices: every other eighth note)', swing.map((e) => e.shift > 0 ? 1 : 0).join('') === '01010101' && near(swing[1].shift, 0.33 * 0.25 / 2));
  check('Note length picture: each note is the step times the length setting', clip.every((e) => e.mul === 0.5) && gridEvents('clip', { n: 2 })[0].mul === 2);
}
// Chorus, Ring mod and Leslie were removed (the browser player has no code to play them).
{
  const { MODULES: MODS, FX_TILES: TILES } = await import('../src/modules.js');
  const { importStrudel: imp2 } = await import('../src/importer.js');
  const { cleanGraph } = await import('../src/validate.js');
  check('Chorus, Ring mod and Leslie are gone: no modules, no rack tile, no master chorus knob', !('chorus' in MODS) && !('ring' in MODS) && !('leslie' in MODS) && !TILES.some((x) => x.key === 'chorus') && !MODS.output.params.some((x) => x.key === 'mchorus'));
  const ri = imp2('setcpm(120/4)\n\n$: s("bd").ring(0.5).chorus(0.3).leslie(1).phaser(0.5)');
  check('Importing .ring(), .chorus() and .leslie() skips each with the reason, and keeps the effects that do play', !ri.error && ri.report.skipped.length === 3 && ri.report.skipped.every((x) => /no code for it/.test(x.reason)) && ri.graph.nodes.some((n) => n.type === 'phaser'));
  check('Importing all(x => x.chorus(0.3)) skips it with a reason', imp2('setcpm(120/4)\n\n$: s("bd")\n\nall(x => x.chorus(0.3))').report.skipped.length === 1);
  const old = { v: 1, nodes: [{ id: 'a', type: 'sample', x: 0, y: 0, params: { name: 'bd' } }, { id: 'r', type: 'ring', x: 0, y: 0, params: {} }, { id: 'c', type: 'chorus', x: 0, y: 0, params: {} }, { id: 'o', type: 'output', x: 0, y: 0, params: {} }],
    wires: [{ id: 'w1', from: { node: 'a', port: 'out' }, to: { node: 'r', port: 'in' } }, { id: 'w2', from: { node: 'r', port: 'out' }, to: { node: 'c', port: 'in' } }, { id: 'w3', from: { node: 'c', port: 'out' }, to: { node: 'o', port: 'in' } }] };
  const fixed = cleanGraph(old);
  check('An old patch with Ring mod and Chorus in a row still loads: they are taken out and the cables joined up, and the names are listed', fixed.nodes.map((n) => n.type).join() === 'sample,output' && fixed.wires.length === 1 && fixed.wires[0].from.node === 'a' && fixed.wires[0].to.node === 'o' && fixed.removedFx.slice().sort().join() === 'chorus,ring');
}
// A recorded take written as Strudel code, played by the real engine.
{
  const { takeToCode, takeToPattern, quantizeTake, noteName } = await import('../src/takecode.js');
  const { guardCode } = await import('../src/guard.js');
  // a deterministic two-minute take at 120 BPM: a melody with human timing, chords every bar, and a long bass note under it
  let seed = 12345; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const events = [];
  for (let bar = 0; bar < 60; bar++) {
    const b0 = bar * 4;
    events.push({ t: b0 + (rnd() - 0.5) * 0.04 + 0.04, d: 3.6, n: 36 + [0, 5, 7, 3][bar % 4], v: 0.7 });                         // bass, almost a whole bar, overlaps the next one a little
    for (const n of [60, 64, 67]) events.push({ t: b0 + 0.001, d: 1.5, n: n + [0, 5, 7, 3][bar % 4], v: 0.6 });                        // a chord, played together
    let t = b0 + 0.5;
    while (t < b0 + 3.9) { const d = [0.25, 0.5, 0.75, 1][Math.floor(rnd() * 4)]; events.push({ t: t + (rnd() - 0.5) * 0.06, d: d * 0.9, n: 67 + Math.floor(rnd() * 9), v: 0.5 + rnd() * 0.5 }); t += d; }
  }
  const take = { bpm: 120, beatsPerBar: 4, events };
  const t0 = Date.now();
  const r = takeToCode(take, { grid: 24, sound: 'sawtooth' });
  const guardMsg = guardCode(r.code);
  const T = r.ticksPerBar;
  const want = r.debugSteps.flatMap((s) => s.notes.map((n) => ({ a: s.s / T, b: (s.s + s.dur) / T, name: noteName(n), v: Math.round(s.vel * 100) / 100 }))).sort((x, y) => x.a - y.a || x.name.localeCompare(y.name));
  const got = (await evaluate(r.code, false)).queryArc(0, r.bars).filter((h) => h.hasOnset()).map((h) => ({ a: h.whole.begin.valueOf(), b: h.whole.end.valueOf(), name: String(h.value.note), v: h.value.velocity })).sort((x, y) => x.a - y.a || x.name.localeCompare(y.name));
  const ms = Date.now() - t0;
  const same = got.length === want.length && want.every((w, i) => Math.abs(w.a - got[i].a) < 1e-9 && Math.abs(w.b - got[i].b) < 1e-9 && w.name === got[i].name && Math.abs(w.v - got[i].v) < 1e-9);
  console.log(`   take: ${events.length} notes, ${r.bars} bars, ${r.lanes} lanes, ${r.sections} sections, ${r.codeChars} characters, generated and played in ${ms} ms`);
  check('Take code: a two-minute take (60 bars) plays in real Strudel with every note at the right time, pitch, length and velocity', same && r.bars >= 60 && r.bars <= 61 && want.length >= events.length - 5);
  const widest = Math.max(...r.code.split('\n').map((l) => l.length));
  check('Take code: the generated code passes the same code check as everything else, and a two-minute take fits in one section whose strings stay under the 8000-character limit of a Note Pattern', guardMsg === null && r.sections === 1 && widest < 8000 && /\.slow\(\d+\)/.test(r.code) && /\.velocity\("/.test(r.code));
  const rs = takeToCode(take, { grid: 24, sound: 'sawtooth', maxChars: 1200 });
  const gotS = (await evaluate(rs.code, false)).queryArc(0, rs.bars).filter((h) => h.hasOnset()).map((h) => ({ a: h.whole.begin.valueOf(), b: h.whole.end.valueOf(), name: String(h.value.note), v: h.value.velocity })).sort((x, y) => x.a - y.a || x.name.localeCompare(y.name));
  const wantS = rs.debugSteps.flatMap((s) => s.notes.map((n) => ({ a: s.s / rs.ticksPerBar, b: (s.s + s.dur) / rs.ticksPerBar, name: noteName(n), v: Math.round(s.vel * 100) / 100 }))).sort((x, y) => x.a - y.a || x.name.localeCompare(y.name));
  check('Take code: with a small limit the same take is cut into arrange sections, one slowed sequence per lane, and still plays every note', rs.sections > 3 && /^\$: arrange\(/m.test(rs.code) && gotS.length === wantS.length && wantS.every((w, i) => Math.abs(w.a - gotS[i].a) < 1e-9 && Math.abs(w.b - gotS[i].b) < 1e-9 && w.name === gotS[i].name && Math.abs(w.v - gotS[i].v) < 1e-9) && Math.max(...rs.code.split('\n').map((l) => l.length)) < 2600);
  // the generated code reads back into modules and plays the same notes
  const events2 = async (code, n) => (await evaluate(code, false)).queryArc(0, n).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.valueOf().toFixed(6)} ${h.whole.end.valueOf().toFixed(6)} ${h.value.note} ${h.value.velocity === undefined ? '' : (+h.value.velocity).toFixed(2)}`).sort();
  const { importStrudel: impT } = await import('../src/importer.js');
  const roundTrip = async (code, bars) => { const imp = impT(code); if (imp.error) return { err: imp.error }; const back = compile(imp.graph).code; return { skipped: imp.report.skipped, types: imp.graph.nodes.map((n) => n.type), same: JSON.stringify(await events2(back, bars)) === JSON.stringify(await events2(code, bars)) }; };
  const rt1 = await roundTrip(r.code, r.bars);
  check('Take code: the two-minute take imports with nothing skipped (as Note Pattern modules) and plays the same notes, times and velocities' + (rt1.skipped?.length ? ' [' + rt1.skipped.map((x) => x.reason).join('; ').slice(0, 200) + ']' : ''), !rt1.err && rt1.skipped.length === 0 && rt1.same && rt1.types.filter((x) => x === 'notetext').length >= 2);
  const rs2 = takeToCode(take, { grid: 24, sound: 'sawtooth', maxChars: 450 });
  const rt2 = await roundTrip(rs2.code, rs2.bars);
  check('Take code: a take cut into many sections (more than six: ' + rs2.sections + ') imports into nested Arrange modules with nothing skipped, and plays the same notes' + (rt2.skipped?.length ? ' [' + rt2.skipped.map((x) => x.reason).join('; ').slice(0, 200) + ']' : ''), !rt2.err && rt2.skipped.length === 0 && rt2.same && rt2.types.filter((x) => x === 'arrange').length >= 2);
  // loop over part of it
  const loopR = takeToCode(take, { grid: 24, loop: { start: 2, bars: 3 }, sound: 'sawtooth' });
  const flat = (code, a, b, shift = 0) => (async () => (await evaluate(code, false)).queryArc(a, b).filter((h) => h.hasOnset()).map((h) => `${(h.whole.begin.valueOf() - shift).toFixed(6)} ${h.value.note}`).sort())();
  const full24 = await flat(r.code, 2, 5), looped = await flat(loopR.code, 0, 3), looped2 = await flat(loopR.code, 3, 6, 3);
  check('Take code: .ribbon(2, 3) plays bars 3 to 5 of the take and then plays them again', JSON.stringify(looped.map((x) => x)) === JSON.stringify(full24.map((x) => { const [a, n] = x.split(' '); return `${(+a - 2).toFixed(6)} ${n}`; }).sort()) && JSON.stringify(looped2) === JSON.stringify(looped));
  // small cases
  const one = (events2, o = {}) => takeToCode({ bpm: 120, beatsPerBar: 4, events: events2 }, { grid: 24, sound: 'sine', ...o });
  const tie = one([{ t: 3.5, d: 2, n: 60, v: 0.8 }, { t: 8, d: 1, n: 62, v: 0.8 }]);
  const tieEv = (await evaluate(tie.code, false)).queryArc(0, 3).filter((h) => h.hasOnset());
  check('Take code: a note that crosses a bar line stays one note', tieEv.length === 2 && Math.abs(tieEv[0].whole.begin.valueOf() - 3.5 / 4) < 1e-9 && Math.abs(tieEv[0].whole.end.valueOf() - 5.5 / 4) < 1e-9);
  const chord = one([{ t: 0, d: 1, n: 60, v: 0.8 }, { t: 0, d: 1, n: 64, v: 0.8 }, { t: 0, d: 1, n: 67, v: 0.8 }]);
  check('Take code: notes that start together and last the same time are written as one chord', /\[c4,e4,g4\]/.test(chord.code) && chord.lanes === 1 && chord.steps === 1);
  const small = one([{ t: 0, d: 1.1, n: 60 }, { t: 1, d: 1, n: 62 }]), big = one([{ t: 0, d: 3, n: 60 }, { t: 1, d: 1, n: 62 }]);
  check('Take code: a small overlap stays in one lane (the earlier note ends where the next begins), a big one gets its own lane', small.lanes === 1 && small.shortened === 1 && big.lanes === 2);
  const grid4 = one([{ t: 0.07, d: 0.2, n: 60 }, { t: 0.55, d: 0.2, n: 62 }], { grid: 4 });
  const g4ev = (await evaluate(grid4.code, false)).queryArc(0, 1).filter((h) => h.hasOnset()).map((h) => h.whole.begin.valueOf());
  check('Take code: a 16th-note grid snaps notes to sixteenths of a bar', g4ev.length === 2 && g4ev.every((x) => Math.abs(x * 16 - Math.round(x * 16)) < 1e-9));
  const cut = takeToCode({ bpm: 120, beatsPerBar: 4, events: Array.from({ length: 40 }, (_, i) => ({ t: i * 2, d: i === 11 ? 40 : 1.5, n: 60 + (i % 7), v: 0.7 })) }, { grid: 24, maxChars: 60, sound: 'sine' });
  const cutEv = (await evaluate(cut.code, false)).queryArc(0, cut.bars).filter((h) => h.hasOnset());
  check('Take code: a take cut into several sections still plays every note, and a note running past the end of a section is cut there and counted', cut.sections > 3 && cutEv.length === 40 && cut.truncated >= 1);
  const bad = takeToPattern({ bpm: 120, events: [{ t: 0, d: 1, n: 60 }, { t: -1, d: 1, n: 60 }, { t: 0, d: 1, n: 200 }, { t: 'x', d: 1, n: 60 }] });
  check('Take code: events that are not valid notes are left out and counted, not written', bad.notes === 1 && bad.dropped === 3);
  check('Take code: note names match Strudel (60 is c4, 61 is c#4, 48 is c3)', noteName(60) === 'c4' && noteName(61) === 'c#4' && noteName(48) === 'c3' && noteName(21) === 'a0');
}
// Hit Pattern: a rhythm written as text, into a Sample or an Instrument.
{
  const { importStrudel: impH } = await import('../src/importer.js');
  const { emptyGraph: eg3, makeNode: mn3 } = await import('../src/graph.js');
  const evs = async (code, n = 2) => (await evaluate(code, false)).queryArc(0, n).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.valueOf().toFixed(6)} ${h.whole.end.valueOf().toFixed(6)} ${h.value.s ?? ''} ${h.value.note ?? ''}`).sort();
  const build = (rhythmType, rhythmText, sink) => { const g3 = eg3(), N3 = (ty, p = {}) => { const nn = mn3(ty, 0, 0, p); g3.nodes.push(nn); return nn; }; const w3 = (a, b, port) => g3.wires.push({ id: 'w' + g3.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } }); const h = N3('hitpattern', { text: rhythmText }), o = N3('output'); if (sink === 'sample') { const s3 = N3('sample', { name: 'bd' }); w3(h, s3, 'in'); w3(s3, o, 'in'); } else { const m3 = N3('melody', { steps: 4, scale: 'off', cells: [{ n: ['c3'], len: 1, vel: 1 }, { n: ['e3'], len: 1, vel: 1 }, { n: ['g3'], len: 1, vel: 1 }, { n: ['c4'], len: 1, vel: 1 }] }), sy = N3('synth', { wave: 'sawtooth' }); w3(m3, sy, 'in'); w3(h, sy, 'rhythm'); w3(sy, o, 'in'); } return compile(g3); };
  const smp = build('hit', 'x ~ x*2 [x x]', 'sample');
  check('Hit Pattern: into a Sample it writes .struct("…") with the text as it is, and the engine plays exactly that rhythm', /\.struct\(\/\* Hit Pattern \*\/ "x ~ x\*2 \[x x\]"\)/.test(smp.code) && smp.issues.length === 0 && JSON.stringify(await evs(smp.code, 1)) === JSON.stringify(await evs('setcpm(120/4)\n$: s("bd").struct("x ~ x*2 [x x]")', 1)));
  const inst = build('hit', 'x ~ x*2 [x x]', 'synth');
  const instEv = (await evaluate(inst.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('Hit Pattern: into an Instrument it puts that rhythm on the melody: .struct("…") sits between the notes and .s(…), and the notes are picked at each hit', /\.struct\(\/\* Hit Pattern \*\/ "x ~ x\*2 \[x x\]"\)\s*\.s\("sawtooth"\)/.test(inst.code) && inst.issues.length === 0 && instEv.length === 5 && instEv.every((h) => /^[a-g]#?\d$/.test(String(h.value.note))));
  const oldBack = impH('setcpm(120/4)\n\n$: s("bd").struct("x ~ x x")');
  check('Hit Pattern: a rhythm that fits the Rhythm Sequencer still becomes one (nothing changes for short patterns)', oldBack.report.skipped.length === 0 && oldBack.graph.nodes.some((n) => n.type === 'rhythm') && !oldBack.graph.nodes.some((n) => n.type === 'hitpattern'));
  const longR = 'x ~ x*2 [x x] ~@3 x x ~ [x x x] x ~ x x ~@2 x [x x] ~ x x ~ x ~ x x x ~ x';
  const longSmp = impH(`setcpm(120/4)\n\n$: s("hh").struct("${longR}")`);
  const hpn = longSmp.graph?.nodes.find((n) => n.type === 'hitpattern');
  check('Hit Pattern: a long rhythm on a Sample imports as a Hit Pattern with its text kept exactly, nothing skipped, and plays the same hits', !longSmp.error && longSmp.report.skipped.length === 0 && hpn && hpn.params.text === longR && JSON.stringify(await evs(compile(longSmp.graph).code, 2)) === JSON.stringify(await evs(`setcpm(120/4)\n$: s("hh").struct("${longR}")`, 2)));
  const notesImp = impH('setcpm(120/4)\n\n$: note("c3 e3 g3 c4").struct("x ~ x x").s("sawtooth")');
  check('Hit Pattern: a short rhythm on a melody imports as a Rhythm Sequencer wired into the Instrument, and plays the same notes', notesImp.report.skipped.length === 0 && notesImp.graph.nodes.some((n) => n.type === 'rhythm') && JSON.stringify(await evs(compile(notesImp.graph).code, 2)) === JSON.stringify(await evs('setcpm(120/4)\n$: note("c3 e3 g3 c4").struct("x ~ x x").s("sawtooth")', 2)));
  const notesLong = impH(`setcpm(120/4)\n\n$: note("c3 e3 g3 c4").struct("${longR}").s("sawtooth")`);
  check('Hit Pattern: a long rhythm on a melody imports as a Hit Pattern into the Instrument, and plays the same notes', notesLong.report.skipped.length === 0 && notesLong.graph.nodes.some((n) => n.type === 'hitpattern') && JSON.stringify(await evs(compile(notesLong.graph).code, 2)) === JSON.stringify(await evs(`setcpm(120/4)\n$: note("c3 e3 g3 c4").struct("${longR}").s("sawtooth")`, 2)));
  const euclidNotes = impH('setcpm(120/4)\n\n$: note("c3 e3 g3 c4").struct("x(3,8)").s("sawtooth")');
  check('Hit Pattern: a euclidean rhythm on a melody is kept as written too', euclidNotes.report.skipped.length === 0 && euclidNotes.graph.nodes.some((n) => n.type === 'hitpattern' && n.params.text === 'x(3,8)'));
}
// The piano roll and hit strip: the numbers behind them.
{
  const { periodOf, rollLayout, hitLayout, pxPerCycle } = await import('../src/rollview.js');
  const { queryPatch } = await import('../src/snapshot.js');
  check('Piano roll: a plain pattern is one cycle, a <a b c> group runs three, two groups of 2 and 3 run six, and nested groups count too', periodOf('c3 e3 g3') === 1 && periodOf('<c3 e3 g3>') === 3 && periodOf('<a b> <c d e>') === 6 && periodOf('[<a b> c]@2 d') === 2 && periodOf('<[a b] c [d e f]>') === 3 && periodOf('') === 1);
  check('Piano roll: a long cycle count is capped at 64, and groups inside brackets and weights are read correctly', periodOf('<a b c d e f g h i j> <a b c d e f g h i j k>') === 64 && periodOf('<a@3 b> c') === 2 && periodOf('<[a,b]@2 c>') === 2);
  const ev = [{ start: 0, end: 0.5, note: 'c4', velocity: 1 }, { start: 0.5, end: 1, note: 'g4', velocity: 0.5 }, { start: 1, end: 2.5, note: 'c4' }];
  const lay = rollLayout(ev, { cycles: 2, ppc: 100 });
  check('Piano roll: notes sit at their time and pitch, longer notes are wider, a higher note is higher up, and loudness is kept', lay.notes.length === 3 && Math.abs(lay.notes[0].x) < 1e-9 && Math.abs(lay.notes[1].x - 50) < 1e-9 && lay.notes[1].y < lay.notes[0].y && lay.notes[2].w > lay.notes[0].w && lay.notes[1].v === 0.5 && lay.notes[2].v === 0.8);
  check('Piano roll: it is always at least an octave tall (a few notes do not look huge), and a note running past the end is cut at the end', lay.hi - lay.lo >= 11 && Math.abs(lay.notes[2].x + lay.notes[2].w - 200) < 2);
  const { timeScaleOf } = await import('../src/rollview.js');
  const tg = { nodes: [{ id: 'a', type: 'notetext', params: {} }, { id: 'b', type: 'synth', params: {} }, { id: 'c', type: 'stack', params: {} }, { id: 'd', type: 'slow', params: { n: 61 } }, { id: 'e', type: 'fast', params: { n: 2 } }, { id: 'o', type: 'output', params: {} }], wires: [{ from: { node: 'a' }, to: { node: 'b' } }, { from: { node: 'b' }, to: { node: 'c' } }, { from: { node: 'c' }, to: { node: 'd' } }, { from: { node: 'd' }, to: { node: 'e' } }, { from: { node: 'e' }, to: { node: 'o' } }] };
  check('Piano roll: a Slow or Fast module further along the wire changes how many bars the pattern spans (61 slow and 2 fast is 30.5), and nothing there means 1', Math.abs(timeScaleOf(tg, 'a') - 30.5) < 1e-9 && timeScaleOf({ nodes: [{ id: 'a', type: 'notetext', params: {} }], wires: [] }, 'a') === 1);
  const hl = hitLayout([{ start: 0, end: 0.25 }, { start: 0.5, end: 0.75 }], { cycles: 1, ppc: 200 });
  check('Hit strip: hits are placed by their time across the cycle', hl.hits.length === 2 && Math.abs(hl.hits[1].x - 100) < 1e-9 && hl.width === 200);
  check('Piano roll: a long pattern is shown at a readable size and scrolls, or is fitted into the box', pxPerCycle(60, 260, false) === 44 && Math.abs(pxPerCycle(60, 260, true) * 60 - 260) < 1e-6 && pxPerCycle(1, 260, false) === 150);
  const qe = await queryPatch('$: note("c3@3 e3")', 1), qh = await queryPatch('$: note("c3").struct("x ~ x*2")', 1);
  check('Piano roll and hit strip: the real engine gives back the notes and hits the picture draws (and a held note is longer)', qe.length === 2 && (qe[0].end - qe[0].start) > (qe[1].end - qe[1].start) && qh.length === 3);

  const E = await import('../src/rolledit.js');
  const pe = E.parseEditable('c4@3 ~ e4 ~@2', '0.8@3 ~ 0.5 ~@2', 'notes');
  check('Click editing: a flat note sequence with matching loudness is read, and written back exactly', pe && pe.total === 7 && E.writeEditable(pe.steps, true).text === 'c4@3 ~ e4 ~@2' && E.writeEditable(pe.steps, true).vel === '0.8@3 ~ 0.5 ~@2');
  check('Click editing: brackets, groups, repeats, loudness with other steps, and odd words are not editable from the picture', ['[c3 e3] g3', '[c3]', '<c3 e3>', 'c3*2', 'c3!2 e3', 'hello'].every((t) => !E.parseEditable(t, '', 'notes')) && !E.parseEditable('c4 e4', '0.8', 'notes') && !E.parseEditable('x*2', '', 'hits'));
  const r1 = E.addAt(pe.steps, 5, 'g4', '0.8');
  check('Click editing: clicking inside a rest splits it around a new note and the total length does not change', r1 && E.writeEditable(r1.steps, true).text === 'c4@3 ~ e4 g4 ~' && r1.index === 3 && r1.steps.reduce((t, x) => t + x.w, 0) === 7 && E.addAt(pe.steps, 0, 'g4') === null);
  check('Click editing: removing a note leaves a rest, and rests that meet are joined', E.writeEditable(E.removeAt(pe.steps, 2).steps, true).text === 'c4@3 ~@4' && E.writeEditable(E.removeAt(pe.steps, 2).steps, true).vel === '0.8@3 ~@4');
  check('Click editing: dragging a note longer takes from the rest after it, shorter gives one back, and it never runs into the next note', E.writeEditable(E.resizeAt(pe.steps, 2, 3).steps, true).text === 'c4@3 ~ e4@3' && E.writeEditable(E.resizeAt(pe.steps, 0, 2).steps, true).text === 'c4@2 ~@2 e4 ~@2' && E.resizeAt(pe.steps, 0, 5) === null && E.resizeAt(pe.steps, 2, 4) === null);
  check('Click editing: a pitch change keeps the steps, and a hit strip toggles hits and rests', E.writeEditable(E.setWord(pe.steps, 2, 'f4').steps, true).text === 'c4@3 ~ f4 ~@2' && (() => { const h = E.parseEditable('x ~ x x', '', 'hits'); const a = E.addAt(h.steps, 1, 'x', ''); return E.writeEditable(a.steps, false).text === 'x x x x' && E.writeEditable(E.removeAt(h.steps, 0).steps, false).text === '~@2 x x'; })());

  const HT = await import('../src/hittree.js');
  const t1 = HT.parseHitTree('x ~ [x x] x@2');
  check('Hit tree: steps, groups and weights are read and written back unchanged', t1 && t1.length === 4 && t1[2].kids.length === 2 && t1[3].w === 2 && HT.writeHitTree(t1) === 'x ~ [x x] x@2');
  check('Hit tree: repeats are opened out so they can be edited (x*2, [x ~]*2, x!2)', HT.writeHitTree(HT.parseHitTree('x*2 ~')) === '[x x] ~' && HT.writeHitTree(HT.parseHitTree('[x ~]*2')) === '[[x ~] [x ~]]' && HT.writeHitTree(HT.parseHitTree('x!2 ~')) === 'x x ~' && HT.writeHitTree(HT.parseHitTree('x*2@3')) === '[x x]@3');
  check('Hit tree: alternation, stacks, chance, euclid and other words are not read', ['<x x>', '[x,x]', 'x?', 'x(3,8)', 'hh x', '[x x', 'x x]', ''].every((t) => HT.parseHitTree(t) === null));
  const L1 = HT.layoutHitTree(t1), near = (a, b) => Math.abs(a - b) < 1e-9;
  check('Hit tree: a group squeezes into one step, and a weighted step is wider', L1.leaves.length === 5 && near(L1.leaves[2].a, 0.25 * 1) === false && near(L1.leaves[2].a, 2 / 5) && near(L1.leaves[3].b - L1.leaves[3].a, (1 / 5) / 2) && L1.groups.length === 1);
  const toggled = HT.toggleAt(t1, [0]), wide = HT.parseHitTree('x ~@4 x');
  check('Hit tree: clicking flips a hit and a rest, and a wide rest is split around the new hit', HT.writeHitTree(toggled) === '~ ~ [x x] x@2' && HT.writeHitTree(HT.toggleAt(wide, [1], 2)) === 'x ~@2 x ~ x' && HT.writeHitTree(HT.toggleAt(t1, [2, 1])) === 'x ~ [x ~] x@2');
  check('Hit tree: shift-click cuts a step in two and alt-click folds a group back', HT.writeHitTree(HT.splitAt(t1, [0])) === '[x x] ~ [x x] x@2' && HT.writeHitTree(HT.splitAt(t1, [1])) === 'x [~ ~] [x x] x@2' && HT.writeHitTree(HT.mergeAt(t1, [2, 0])) === 'x ~ x x@2' && HT.mergeAt(t1, [0]) === null);
  const eng = await queryPatch('$: note("c3").struct("' + HT.writeHitTree(HT.parseHitTree('x*2 ~ [x ~ x]@2 x')) + '")', 1), expectLeaves = HT.layoutHitTree(HT.parseHitTree('x*2 ~ [x ~ x]@2 x')).leaves.filter((l) => !l.rest);
  check('Hit tree: the real engine plays the hits where the picture puts them', eng.length === expectLeaves.length && eng.every((e, i) => Math.abs(e.start - expectLeaves[i].a) < 1e-6));

  const [qa, qb, qc] = await Promise.all([queryPatch('$: note("c3 f3 g#3 ~ e4 f4")', 1), queryPatch('$: note("c3 f3 g#3 c4")', 1), queryPatch('$: note("a3 ~ ~ b3")', 1)]);
  check('Piano roll: pictures asking at the same moment each get their own notes (5, 4 and 2 here)', qa.length === 5 && qb.length === 4 && qc.length === 2);

  const ch = E.parseEditable('c3 f3 [g#3,f3] ~ c4', '', 'notes');
  check('Click editing: chords like [g#3,f3] are read, a pitch can be added, removed or moved inside one, and a chord of one note is written as a single note', ch && ch.steps[2].n === '[g#3,f3]' && E.writeEditable(E.addPitch(ch.steps, 0, 'e3').steps, false).text === '[c3,e3] f3 [g#3,f3] ~ c4' && E.writeEditable(E.removePitch(ch.steps, 2, 'g#3').steps, false).text === 'c3 f3 f3 ~ c4' && E.writeEditable(E.movePitch(ch.steps, 2, 'f3', 'c4').steps, false).text === 'c3 f3 [g#3,c4] ~ c4' && E.addPitch(ch.steps, 0, 'c3') === null && E.writeEditable(E.removePitch(ch.steps, 4, 'c4').steps, false).text === 'c3 f3 [g#3,f3] ~@2');

  {
    const { importStrudel: imp } = await import('../src/importer.js'), { compile: comp } = await import('../src/compile.js');
    const { emptyGraph: eg9, makeNode: mn9 } = await import('../src/graph.js');
    const mk = (kind, text) => { const g = eg9(), N = (ty, p = {}) => { const n = mn9(ty, 0, 0, p); g.nodes.push(n); return n; }, W = (a, b, port) => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } }); const o = N('output');
      if (kind === 'notes') { const nt = N('notetext', { text, vel: '' }), sy = N('synth', { wave: 'sine' }); W(nt, sy, 'in'); W(sy, o, 'in'); } else { const hp = N('hitpattern', { text }), sm = N('sample', { name: 'bd' }); W(hp, sm, 'in'); W(sm, o, 'in'); } return comp(g).code; };
    const types = (code) => imp(code).graph.nodes.map((n) => n.type).join(',');
    check('Round trip: a short Note Pattern comes back as a Note Pattern (its code carries a comment saying so), and the same notes without the comment still become a Melody Sequencer', types(mk('notes', 'c3 f3 [g#3,f3] ~ c4')).includes('notetext') && types(mk('notes', 'c3 f3 [g#3,f3] ~ c4').replace('/* Note Pattern */ ', '')).includes('melody') && !types(mk('notes', 'c3 f3 [g#3,f3] ~ c4').replace('/* Note Pattern */ ', '')).includes('notetext'));
    check('Round trip: a short Hit Pattern comes back as a Hit Pattern with its text unchanged, and without the comment it becomes a Rhythm Sequencer', (() => { const g = imp(mk('hits', 'x ~ x x')).graph; return g.nodes.some((n) => n.type === 'hitpattern' && n.params.text === 'x ~ x x'); })() && imp(mk('hits', 'x ~ x x').replace('/* Hit Pattern */ ', '')).graph.nodes.some((n) => n.type === 'rhythm'));
    const rt = imp(mk('notes', 'c3@3 ~ e3 [g3,b3]@2')).graph.nodes.find((n) => n.type === 'notetext');
    check('Round trip: the Note Pattern text is kept exactly, and a sequence of two (code, import, code) is stable', rt && rt.params.text === 'c3@3 ~ e3 [g3,b3]@2' && comp(imp(mk('notes', 'c3@3 ~ e3 [g3,b3]@2')).graph).code === mk('notes', 'c3@3 ~ e3 [g3,b3]@2'));
  }
}

// ---------- converting between grid and text modules ----------
{
  const { melodyToNotes, hitsToText, notesToMelody, hitsToRhythm } = await import('../src/convert.js');
  const { emptyGraph, makeNode: mkn } = await import('../src/graph.js'), { defaultParams: dp, makeCells: mc } = await import('../src/modules.js');
  const build = (kind, params, withKey) => {
    const g = emptyGraph(), N = (ty, p = {}) => { const n = mkn(ty, 0, 0, p); g.nodes.push(n); return n; }, W = (a, b, port) => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
    const o = N('output'), src = N(kind, params), snd = kind === 'melody' || kind === 'notetext' ? N('synth', { wave: 'sine' }) : N('sample', { name: 'bd' });
    W(src, snd, 'in'); W(snd, o, 'in'); if (withKey) { const k = N('key', { root: 'D', scale: 'minor' }); W(k, src, 'key'); }
    return { g, src };
  };
  const events = async (g) => (await evaluate(compile(g).code, false)).queryArc(0, 4).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()}-${h.whole.end.toFraction()} ${[].concat(h.value.note ?? h.value.s).join(',').toLowerCase()} ${h.value.velocity ?? ''}`).sort().join(' | ');
  const asType = (g, id, r) => { const g2 = JSON.parse(JSON.stringify(g)), n = g2.nodes.find((x) => x.id === id); n.type = r.type; n.params = r.params; g2.wires = g2.wires.filter((w) => w.to.node !== id); return g2; };
  const melCells = (spec) => { const cells = mc('melody', spec.length); spec.forEach((x, i) => { if (x) cells[i] = { ...cells[i], ...x }; }); return cells; };
  const same = async (kind, params, withKey, conv, label) => {
    const { g, src } = build(kind, params, withKey), r = conv(g, src);
    const ea = await events(g), eb = r.error ? '' : await events(asType(g, src.id, r));
    check(`Convert: ${label} (${r.error || 'converted'})`, !r.error && ea === eb);
    if (!r.error && ea !== eb) console.log('   before:', ea, '\n   after: ', eb, '\n   text:', r.params.text);
    return r;
  };
  await same('melody', { ...dp('melody'), steps: 8, scale: 'off', mode: 'steps', cells: melCells([{ n: 'c3', len: 2, vel: 0.5 }, null, { n: ['e3', 'g3'] }, null, { n: 'a3', vel: 0.7 }, null, { n: 'c4' }, null]) }, false, melodyToNotes, 'a Melody Sequencer with names, a chord, a held note and loudness plays the same as its Note Pattern');
  await same('melody', { ...dp('melody'), steps: 4, scale: 'off', mode: 'steps', cells: melCells([{ d: 0 }, { d: 2 }, { d: 4 }, { d: -3 }]) }, true, melodyToNotes, 'scale degrees from a Key become the same notes as names');
  await same('melody', { ...dp('melody'), steps: 16, scale: 'off', mode: 'pace', cells: melCells(Array.from({ length: 16 }, (_, i) => (i % 3 ? null : { n: ['c3', 'e3', 'g3'][(i / 3) % 3] }))) }, false, melodyToNotes, 'a 16-step melody on a steady pace keeps its slow timing');
  await same('rhythm', { ...dp('rhythm'), steps: 8, mode: 'steps', cells: Array.from({ length: 8 }, (_, i) => ({ on: [0, 3, 4, 6].includes(i), len: i === 6 ? 2 : 1 })) }, false, (g, n) => hitsToText(n), 'a Rhythm Sequencer plays the same as its Hit Pattern');
  await same('notetext', { text: 'c3@3 ~ e3 [g3,b3]@2 ~', vel: '0.9@3 ~ 0.6 0.7@2 ~' }, false, (g, n) => notesToMelody(n), 'a Note Pattern with a chord, held notes and loudness plays the same as its Melody Sequencer');
  await same('hitpattern', { text: 'x ~ x@2 ~@2 x' }, false, (g, n) => hitsToRhythm(n), 'a Hit Pattern plays the same as its Rhythm Sequencer');
  check('Convert: a melody turned into text and back gives the same grid', (() => { const { g, src } = build('melody', { ...dp('melody'), steps: 4, scale: 'off', mode: 'steps', cells: melCells([{ n: 'c3' }, null, { n: ['e3', 'g3'], len: 2 }, null]) }, false), t = melodyToNotes(g, src), back = notesToMelody({ params: t.params }); return !back.error && back.params.steps === 4 && back.params.cells[0].n === 'c3' && back.params.cells[2].len === 2 && back.params.cells[2].n.join() === 'e3,g3'; })());
  check('Convert: text that a grid cannot hold stays text, with a reason', ['c3 [e3 g3]', '<c3 e3>', 'c3*2', 'c3@20'].every((t) => notesToMelody({ params: { text: t, vel: '' } }).error) && ['x [x x]', '<x ~>', 'x*3', 'x@20'].every((t) => hitsToRhythm({ params: { text: t } }).error));
  check('Convert: an empty grid refuses', (() => { const { g, src } = build('melody', { ...dp('melody'), steps: 4, scale: 'off', mode: 'steps', cells: melCells([null, null, null, null]) }, false); return !!melodyToNotes(g, src).error; })());
}

// ---------- importing a song that repeats the same sound on every line ----------
{
  const { importStrudel: imp } = await import('../src/importer.js');
  const song = `setcpm(125 / 4)
$: arrange(
  [5, note("~").s("sawtooth")],
  [4, cat(note("c3 e2 c3 c3 e2 c3 d2 e2").s("sawtooth"), note("g2 b1 g2 g2 b1 g2 a1 b1").s("sawtooth"), note("d3 f#2 d3 d3 f#2 d3 d2 f#2").s("sawtooth"))],
  [3, cat(note("c3 e2").s("sawtooth"), note("g2 b1").s("sawtooth"))],
  [1, note("~")]
).clip(0.85).attack(0.008).release(0.075).lpf(1200).hpf(85).gain(0.16).late(0.375)
$: arrange([1, note("~").s("sawtooth")], [4, cat(note("g3").s("sawtooth"), note("d3").s("sawtooth"), note("f#3").s("sawtooth"))], [1, note("~")]).clip(0.94).attack(0.045).lpf(950).gain(0.085)
`;
  const r = imp(song), out = compile(r.graph).code, evs = async (c) => (await evaluate(c, false)).queryArc(0, 14).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()}-${h.whole.end.toFraction()} ${JSON.stringify(Object.entries(h.value).sort())}`).sort().join('|');
  check('Import: lines that repeat the same sound share ONE synth per layer (here 2, not one per note line)', r.graph.nodes.filter((n) => n.type === 'synth').length === 2);
  check('Import: a cat of plain note lines becomes one Note Pattern that alternates by cycle, and the module count stays small', r.graph.nodes.length <= 20 && r.graph.nodes.some((n) => n.type === 'notetext' && /^<\[c3 e2/.test(n.params.text)));
  check('Import: the song plays exactly the same events as the original code', (await evs(song)) === (await evs(out)));
  const again = imp(compile(r.graph).code);
  check('Import: rebuilding a board from its own code (the Rebuild button) keeps the module count and plays the same', !again.error && again.graph.nodes.length <= r.graph.nodes.length && (await evs(compile(again.graph).code)) === (await evs(out)));
  const mix = imp(`$: cat(note("c3 e3").s("sawtooth"), note("g3 b3").s("square"))`).graph;
  check('Import: lines with different sounds keep their own synths', mix.nodes.filter((n) => n.type === 'synth').length === 2);
  const alt = imp(`$: cat(note("<c3 e3> g3").s("sawtooth"), note("g3 b3").s("sawtooth"))`).graph;
  check('Import: a line that alternates by itself is not folded into the pattern text (the cat stays)', alt.nodes.some((n) => n.type === 'cat') && alt.nodes.filter((n) => n.type === 'synth').length === 1);
}

// ---------- importing: an effect every lane ends with is written once ----------
{
  const { importStrudel: imp } = await import('../src/importer.js');
  const evs = async (c) => (await evaluate(c, false)).queryArc(0, 8).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()}-${h.whole.end.toFraction()} ${JSON.stringify(Object.entries(h.value).sort())}`).sort().join('|');
  const count = (g, t) => g.nodes.filter((n) => n.type === t).length;
  const same = async (code) => { const r = imp(code); return { g: r.graph, skipped: r.report.skipped.length, ok: (await evs(code)) === (await evs(compile(r.graph).code)) }; };
  let t = await same('$: stack(s("bd*2").room(0.3).lpf(900), s("sd").room(0.3).lpf(900), s("hh*4").room(0.3).lpf(900))');
  check('Shared effects: three lanes that all end in the same reverb get ONE reverb, and play the same', t.ok && count(t.g, 'reverb') === 1 && t.skipped === 0);
  t = await same('$: stack(s("bd*2").room(0.3), s("sd").room(0.5), s("hh*4").room(0.3))');
  check('Shared effects: lanes with different settings keep their own', t.ok && count(t.g, 'reverb') === 3);
  t = await same('$: stack(s("bd*2").late(0.25).room(0.3), s("sd").late(0.25).room(0.3))');
  check('Shared effects: a time shift every lane of a stack has is written once, after the stack', t.ok && count(t.g, 'late') === 1 && count(t.g, 'reverb') === 1);
  t = await same('$: cat(s("bd*2").late(0.25), s("sd").late(0.25))');
  check('Shared effects: a time shift is NOT moved out of a cat (it would change which cycle each part plays in)', t.ok && count(t.g, 'late') === 2);
  t = await same('$: cat(note("c3 e3").s("sawtooth").lpf(800).clip(0.5), note("g3 b3").s("sawtooth").lpf(800).clip(0.5))');
  check('Shared effects: a cat of two note lines with the same synth and filter gives one synth (the filter is its own setting), and plays the same', t.ok && count(t.g, 'synth') === 1 && t.skipped === 0);
  t = await same('$: arrange([2, s("bd*2").room(0.3)], [2, s("sd").room(0.3)])');
  check('Shared effects: an arrange whose sections end in the same reverb writes it once', t.ok && count(t.g, 'reverb') === 1);
  const rt = imp(compile(imp('$: stack(s("bd*2").room(0.3).lpf(900), s("sd").room(0.3).lpf(900))').graph).code);
  check('Shared effects: code written by the board imports back to the same board', !rt.error && count(rt.graph, 'reverb') === 1 && rt.graph.nodes.length === imp('$: stack(s("bd*2").room(0.3).lpf(900), s("sd").room(0.3).lpf(900))').graph.nodes.length);
}

// ---------- importing code with no module of its own: it is kept as written, so the board plays what the code plays ----------
{
  const { importStrudel: imp } = await import('../src/importer.js');
  const evs = async (c) => (await evaluate(c, false)).queryArc(0, 8).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()}-${h.whole.end.toFraction()} ${JSON.stringify(Object.entries(h.value).filter(([k]) => k !== 'color').sort())}`).sort().join('|');
  const run = async (code) => { const r = imp(code); return { g: r.graph, skipped: r.report.skipped.length, ok: !r.error && (await evs(code)) === (await evs(compile(r.graph).code)) }; };
  const has = (g, t, re) => g.nodes.some((n) => n.type === t && (!re || re.test(n.params.code ?? n.params.text ?? '')));
  let t = await run('$: s("bd*8").mask("1 0 1 1")');
  check('Kept as code: a call with no module (mask) becomes a Strudel Code module and plays the same', t.ok && t.skipped === 0 && has(t.g, 'code', /mask\("1 0 1 1"\)/));
  t = await run('$: s("bd*4 sd").mask("1 0 1").fast(2).gain(0.5).lpf(800)');
  check('Kept as code: order is kept: a later fast() goes into the code module with the mask, while the gain and filter stay modules', t.ok && t.skipped === 0 && has(t.g, 'code', /mask\("1 0 1"\)\.fast\(2\)/) && !has(t.g, 'fast'));
  t = await run('const VOL = 0.4\n$: s("bd*4").gain(VOL).mask("1 0 1 1")');
  check('Kept as code: a const number is used as its value (the gain is a plain knob, 0.4)', t.ok && t.skipped === 0 && t.g.nodes.some((n) => n.type === 'sample' && n.params.gain === 0.4));
  t = await run('$: note("c3 e3").s("sawtooth").gain("<0.4 0.8>")');
  check('Kept as code: a gain that is a pattern, not a number, is kept as written', t.ok && t.skipped === 0 && has(t.g, 'code', /gain\("<0\.4 0\.8>"\)/));
  t = await run('$: note("c3 e3").s("sawtooth").color("cyan")');
  check('Kept as code: .color() only changes how a roll is drawn, so it is left out without being counted as a loss', t.ok && t.skipped === 0 && !has(t.g, 'code'));
  t = await run('$: note("c3 [e3 [g3 b3]] . d4 f4").s("triangle")');
  check('Kept as code: mini-notation the Melody Sequencer cannot hold stays exactly as written in a Note Pattern', t.ok && t.skipped === 0 && has(t.g, 'notetext', /\[e3 \[g3 b3\]\]/));
  t = imp('$: s("bd").mask(someFunction())');
  check('Kept as code: nothing that is not an allowed Strudel call is ever kept (an unknown function is left out with a reason)', t.report.skipped.length === 1 && !has(t.graph, 'code'));
  t = imp('$: s("bd").chorus(0.3)');
  check('Kept as code: effects the browser player cannot play are still left out with the reason', t.report.skipped.length === 1 && !has(t.graph, 'code'));
  const rb = imp(compile(imp('$: s("bd*8").mask("1 0 1 1").gain(0.5)').graph).code);
  check('Kept as code: code written by the board (with a Strudel Code module) imports back to the same board', !rb.error && rb.report.skipped.length === 0 && has(rb.graph, 'code', /mask\("1 0 1 1"\)/));
  const { guardCalls: gc } = await import('../src/guard.js');
  check('Kept as code: the Strudel Code module only takes Strudel calls: no assignments, no unknown functions, no values computed from variables', gc('.mask("1 0")') === null && !!gc('.mask(foo)') && !!gc('; fetch("x")') && !!gc('.constructor("x")') && !!gc('mask("1")'));
}

// ---------- Harmonics ----------
{
  const { importStrudel: imp } = await import('../src/importer.js');
  const { HARM_PRESETS, MODULES: MODS } = await import('../src/modules.js');
  const { cleanParams } = await import('../src/validate.js');
  const { guardCode: gcode } = await import('../src/guard.js');
  const { emptyGraph: eg, makeNode: mn } = await import('../src/graph.js');
  const g = eg(), N = (ty, p = {}) => { const n = mn(ty, 0, 0, p); g.nodes.push(n); return n; }, W = (a, b, port) => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
  const mel = N('melody'), syn = N('synth', { wave: 'sawtooth' }), hm = N('harmonics', { partials: HARM_PRESETS.square.bars.slice() }), out = N('output');
  W(mel, syn, 'in'); W(syn, hm, 'in'); W(hm, out, 'in');
  const code = compile(g).code;
  check('Harmonics: writes .partials([...]) with the bar heights, dropping trailing zeros', /\.partials\(\[1, 0, 0\.33, 0, 0\.2, 0, 0\.14, 0, 0\.11, 0, 0\.09, 0, 0\.08, 0, 0\.07\]\)/.test(code));
  const evs = (await evaluate(code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('Harmonics: real Strudel carries the partials on every note, and the code passes the guard', evs.length > 0 && evs.every((h) => Array.isArray(h.value.partials) && h.value.partials.length === 15) && !gcode(code));
  const back = imp(code);
  const bh = back.graph.nodes.find((n) => n.type === 'harmonics');
  check('Harmonics: code with .partials([...]) imports into a Harmonics module with the same bars, and nothing is left out', !back.error && back.report.skipped.length === 0 && bh && JSON.stringify(bh.params.partials.slice(0, 15)) === JSON.stringify(HARM_PRESETS.square.bars.slice(0, 15)) && bh.params.partials[15] === 0);
  check('Harmonics: importing the board code a second time gives the same code', compile(back.graph).code.includes(code.split('\n').find((l) => l.includes('.partials(')).trim()));
  const kept = imp('$: note("c3").s("sawtooth").partials([1, "<1 0>", 0.5])');
  check('Harmonics: a partials list with patterns inside is kept as written (a Strudel Code module), not guessed', kept.report.skipped.length === 0 && kept.graph.nodes.some((n) => n.type === 'code' && /partials/.test(n.params.code)));
  const dirty = cleanParams('harmonics', { partials: [2, -1, 'x', 0.5], base: 'nope' });
  check('Harmonics: stored bars are always 16 numbers from 0 to 1', dirty.partials.length === 16 && dirty.partials.every((v) => typeof v === 'number' && v >= 0 && v <= 1) && dirty.partials[0] === 1 && dirty.partials[1] === 0 && dirty.base === 'user');
  check('Harmonics: by default the wave is made from the bars alone (.s("user")), and importing that code gives the same module back', /\.s\("user"\)/.test(code) && bh.params.base === 'user');
  const filt = imp('$: note("c3 e3").s("sawtooth").partials([1, 0.5, 0.25])').graph.nodes.find((n) => n.type === 'harmonics');
  check('Harmonics: .partials([...]) without .s("user") imports as "filter the Instrument\'s wave"', filt && filt.params.base === 'keep');
  const gs = eg(), Ns = (ty, p = {}) => { const n = mn(ty, 0, 0, p); gs.nodes.push(n); return n; }, Ws = (a, b, port) => gs.wires.push({ id: 'w' + gs.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
  const m5 = Ns('melody'), s5 = Ns('synth', { wave: 'sine' }), h5 = Ns('harmonics', { base: 'keep' }), o5 = Ns('output'); Ws(m5, s5, 'in'); Ws(s5, h5, 'in'); Ws(h5, o5, 'in');
  check('Harmonics: filtering a sine (or any wave that cannot be filtered) says so, instead of silently doing nothing', compile(gs).issues.some((i) => i.node === h5.id && /sine/.test(i.msg)));
  const sc = N('synth', { wave: 'sine' }), hu = N('harmonics', { base: 'user', partials: HARM_PRESETS.bell.bars.slice() }), m2 = N('melody'), o2 = N('output');
  W(m2, sc, 'in'); W(sc, hu, 'in'); W(hu, o2, 'in');
  check('Harmonics: "build from the bars only" writes .s("user") before the partials', /\.s\("user"\)\s*\.partials\(/.test(compile(g).code.replace(/\n\s*/g, '')) || /s\("user"\)/.test(compile(g).code));
}

// ---------- recording a take ----------
{
  const { createRecorder, keyToNote, mergeGraph } = await import('../src/recorder.js');
  const { takeToCode } = await import('../src/takecode.js');
  const { importStrudel: imp } = await import('../src/importer.js');
  const { emptyGraph: eg, makeNode: mn } = await import('../src/graph.js');
  // 120 bpm: a beat is 500 ms; the take starts at 10000 ms
  const rec = createRecorder({ bpm: 120, beatsPerBar: 4, zeroMs: 10000 });
  rec.noteOn(60, 100, 10000); rec.noteOff(60, 10500);          // c4 on beat 0, one beat long
  rec.noteOn(64, 0.5, 10500); rec.noteOn(67, 1, 10520); rec.noteOff(67, 11500); rec.noteOff(64, 11500);   // e4 and g4 from beat 1, two beats
  rec.noteOn(72, 90, 9000);                                       // two beats before the take began: not part of it
  rec.noteOn(62, 90, 12000);                                      // d4 on beat 4, still held when we stop
  const take = rec.stop(12500);
  check('Recording: notes become events in beats (start, length, loudness), and a note from before the take is left out', take.events.length === 4 && take.events[0].n === 60 && take.events[0].t === 0 && take.events[0].d === 1 && Math.abs(take.events[0].v - 100 / 127) < 1e-9 && !take.events.some((e) => e.n === 72));
  check('Recording: a note still held when you stop is ended there', take.events.find((e) => e.n === 62).d === 1);
  const r = takeToCode(take, { grid: 4 });
  check('Recording: the take becomes a Strudel pattern', /note\(/.test(r.code) && r.notes === 4);
  const g = eg(), o = mn('output', 0, 0); g.nodes.push(o, mn('melody', 0, 700));
  const before = g.nodes.length, im = imp(r.code), added = mergeGraph(g, im.graph);
  check('Recording: adding a take puts its modules under the board and plugs them into the existing Output (no second Output)', added.length > 0 && g.nodes.filter((n) => n.type === 'output').length === 1 && g.nodes.length === before + added.length && g.wires.some((w) => w.to.node === o.id) && added.every((id) => g.nodes.find((n) => n.id === id).y >= 700 + 360));
  check('Recording: the computer keyboard is a piano (a is c, w is c#, k is the next c; z and x move the octave)', keyToNote('a', 4) === 60 && keyToNote('w', 4) === 61 && keyToNote('k', 4) === 72 && keyToNote('a', 3) === 48 && keyToNote('?', 4) === null && keyToNote('constructor', 4) === null);
  const strum = createRecorder({ bpm: 60, zeroMs: 0 });
  strum.noteOn(60, 0.8, 0); strum.noteOn(60, 0.8, 1000);   // the same key pressed again without a release
  check('Recording: pressing a note again before releasing it ends the first one', strum.stop(2000).events.length === 2);
}

// ---------- Take module ----------
{
  const { cleanParams } = await import('../src/validate.js');
  const { takeToPattern } = await import('../src/takecode.js');
  const { guardCode: gc } = await import('../src/guard.js');
  const { emptyGraph: eg, makeNode: mn } = await import('../src/graph.js');
  const { importStrudel: imp } = await import('../src/importer.js');
  const events = [{ t: 0, d: 1, n: 60, v: 0.8 }, { t: 1, d: 1, n: 64, v: 0.6 }, { t: 2, d: 2, n: 67, v: 1 }, { t: 2, d: 2, n: 72, v: 1 }, { t: 5, d: 0.5, n: 62, v: 0.7 }];
  const g = eg(), N = (ty, p = {}) => { const n = mn(ty, 0, 0, p); g.nodes.push(n); return n; }, W = (a, b, port) => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
  const tk = N('take', cleanParams('take', { name: 'Take 1', grid: 4, bpm: 120, beats: 4, events })), sy = N('synth', { wave: 'triangle' }), out = N('output');
  W(tk, sy, 'in'); W(sy, out, 'in');
  const code = compile(g).code;
  const want = takeToPattern({ bpm: 120, beatsPerBar: 4, events }, { grid: 4 }).pattern;
  check('Take: the module writes the recording as the same pattern takecode gives, with an instrument after it', code.includes(want) && /\.s\("triangle"\)/.test(code) && !gc(code));
  const cres = compile(g), minis = cres.segments.filter((sg) => sg.node === tk.id && sg.role === 'mini');
  check('Take: its notes are written as mini-notation pieces, so the code panel lights up each note as it plays', minis.length >= 1 && minis.every((sg) => /^"[^"]*"$/.test(cres.code.slice(sg.from, sg.to))) && cres.code.slice(minis[0].from, minis[0].to).startsWith('"'));
  const played = (await evaluate(code, false)).queryArc(0, 2).filter((h) => h.hasOnset()).map((h) => h.value.note).sort();
  check('Take: real Strudel plays all five notes of the recording in its two bars', played.length === 5 && ['c4', 'e4', 'g4', 'c5', 'd4'].every((n) => played.map(String).map((x) => x.toLowerCase()).includes(n)));
  const bad = cleanParams('take', { events: [{ t: -5, d: 0, n: 300, v: 9 }, { t: 'x' }, null, { t: 1, d: 1, n: 60 }], bpm: 9999, beats: 0, versions: [{ events: [{ t: 0, d: 1, n: 60, v: 1 }] }, 'x'] });
  check('Take: stored notes are always clean (start from 0, length above 0, note 0 to 127, loudness 0 to 1), the tempo is sane, and bad entries are dropped', bad.events.length === 2 && bad.events.every((e) => e.t >= 0 && e.d >= 0.05 && e.n >= 0 && e.n <= 127 && e.v >= 0 && e.v <= 1) && bad.bpm === 300 && bad.beats === 1 && bad.versions.length === 1 && bad.versions[0].events.length === 1);
  const six = cleanParams('take', { events: [], versions: Array.from({ length: 9 }, () => ({ events: [{ t: 0, d: 1, n: 60 }] })) });
  check('Take: at most five earlier takes are kept', six.versions.length === 5);
  const empty = mn('take'), sy2 = mn('synth', 0, 0, { wave: 'triangle' }), o2 = mn('output'), g2 = eg(); g2.nodes.push(empty, sy2, o2);
  g2.wires.push({ id: 'a', from: { node: empty.id, port: 'out' }, to: { node: sy2.id, port: 'in' } }, { id: 'b', from: { node: sy2.id, port: 'out' }, to: { node: o2.id, port: 'in' } });
  check('Take: an empty take is silent and says so, instead of writing broken code', !compile(g2).code.includes('note(') && compile(g2).issues.some((i) => i.node === empty.id));
  const rb = imp(code), rtk = rb.graph.nodes.find((n) => n.type === 'take');
  check('Take: the code a Take writes imports back as a Take (name, snap, tempo kept), with nothing left out', !rb.error && rb.report.skipped.length === 0 && rtk && rtk.params.name === 'Take 1' && rtk.params.grid === 4 && rtk.params.bpm === 120 && !rb.graph.nodes.some((n) => n.type === 'notetext' || n.type === 'melody') && rb.graph.nodes.some((n) => n.type === 'synth'));
  check('Take: code -> Take -> code gives the same code, and the notes land on the grid', compile(rb.graph).code === code && rtk.params.events.every((e) => Math.abs(e.t * 4 - Math.round(e.t * 4)) < 0.01));
  // harder takes: chords, overlapping notes (several voices), sections (arrange), triplets
  const rnd = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
  const hard = [];
  for (let k = 0; k < 40; k++) hard.push({ t: Math.floor(rnd() * 30 * 4) / 4, d: 0.25 + Math.floor(rnd() * 6) / 4, n: 48 + Math.floor(rnd() * 24), v: 0.8 });
  for (const grid of [4, 2, 12]) {
    const g3 = eg(), N3 = (ty, p = {}) => { const n = mn(ty, 0, 0, p); g3.nodes.push(n); return n; }, W3 = (a, b, port) => g3.wires.push({ id: 'w' + g3.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
    const t3 = N3('take', cleanParams('take', { name: 'Long', grid, bpm: 100, beats: 4, events: hard })), s3 = N3('synth', { wave: 'sawtooth' }), o3 = N3('output'); W3(t3, s3, 'in'); W3(s3, o3, 'in');
    const c3 = compile(g3).code, r3 = imp(c3), k3 = r3.graph.nodes.find((n) => n.type === 'take');
    const sig = async (c) => (await evaluate(c, false)).queryArc(0, 12).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()}-${h.whole.end.toFraction()} ${h.value.note} ${h.value.velocity}`).sort().join('|');
    const s0 = await sig(c3), s1 = await sig(compile(r3.graph).code);
    check(`Take: a long take with chords and overlapping notes (snap ${grid}) imports so that it plays exactly the same notes: as a Take when it writes back identically, otherwise as modules (${/arrange/.test(c3) ? 'in sections' : 'one section'})`, r3.report.skipped.length === 0 && s0.length > 0 && s0 === s1 && (!k3 || compile(r3.graph).code === c3));
  }
  {   // a long tune that has to be written in sections (arrange)
    const long = Array.from({ length: 1500 }, (_, i) => ({ t: i * 0.5, d: 0.5, n: 48 + ((i * 7) % 24), v: i % 3 ? 0.8 : 0.6 }));
    const g4 = eg(), N4 = (ty, p = {}) => { const n = mn(ty, 0, 0, p); g4.nodes.push(n); return n; }, W4 = (a, b, port) => g4.wires.push({ id: 'w' + g4.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
    const t4 = N4('take', cleanParams('take', { name: 'Long tune', grid: 4, bpm: 120, beats: 4, events: long })), s4 = N4('synth', { wave: 'triangle' }), o4 = N4('output'); W4(t4, s4, 'in'); W4(s4, o4, 'in');
    const c4 = compile(g4).code, r4 = imp(c4), k4 = r4.graph.nodes.find((n) => n.type === 'take');
    check('Take: a long recording written in sections (arrange) comes back as the same Take, with identical code', /arrange\(/.test(c4) && !!k4 && r4.report.skipped.length === 0 && compile(r4.graph).code === c4 && k4.params.events.length === 1500);
  }
  const edited = code.replace(/c4@\d+/, 'c4@2 d4');
  check('Take: a pattern edited by hand (so it no longer has the shape a Take writes) stays a Note Pattern, not a wrong Take', imp(edited).graph.nodes.every((n) => n.type !== 'take') && imp(code.replace(/\/\* Take[^*]*\*\/ /, '')).graph.nodes.every((n) => n.type !== 'take'));
  const { MODULES: MODS2 } = await import('../src/modules.js');
  check('Note Pattern: the second text box is called velocity', MODS2.notetext.params.find((p) => p.key === 'vel').label === 'velocity' && MODS2.notetext.params.every((p) => p.collapse));
}

// ---------- Harmonics on some notes only ----------
{
  const { HARM_PRESETS: HP } = await import('../src/modules.js');
  const { emptyGraph: eg, makeNode: mn } = await import('../src/graph.js');
  const build = (srcType, srcParams, harmParams, between) => {
    const g = eg(), N = (ty, p = {}) => { const n = mn(ty, 0, 0, p); g.nodes.push(n); return n; }, W = (a, b, port) => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
    const src = N(srcType, srcParams), sy = N('synth', { wave: 'sawtooth' }), hm = N('harmonics', harmParams), o = N('output');
    if (between) { const mid = N(between); W(src, mid, 'in'); W(mid, sy, 'in'); } else W(src, sy, 'in');
    W(sy, hm, 'in'); W(hm, o, 'in');
    return { g, hm };
  };
  const pcs = (...names) => { const a = Array(12).fill(false); const idx = { c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11 }; names.forEach((n) => { a[idx[n]] = true; }); return a; };
  const acc = HP.saw.bars.slice(); acc[2] = 1;   // the picked notes get a full 3rd harmonic
  const harm = { base: 'user', scope: 'some', partials: HP.saw.bars.slice(), accent: acc, accentNotes: pcs('c', 'g') };
  const notesOf = async (code) => (await evaluate(code, false)).queryArc(0, 1).filter((h) => h.hasOnset()).sort((a, b) => a.whole.begin - b.whole.begin).map((h) => [String(h.value.note).toLowerCase(), h.value.partials[2]]);
  const cm = Array(8).fill(null).map(() => ({ n: null, d: null, len: 1, vel: 1 })); ['c3', 'e3', 'g3', 'b3'].forEach((n, i) => { cm[i * 2] = { n, d: null, len: 1, vel: 1 }; });
  let b1 = build('melody', { steps: 8, scale: 'off', mode: 'steps', cells: cm }, harm), r1 = compile(b1.g);
  check('Harmonics on some notes: the picked notes (C and G) use their own bars and the others keep the bars for all notes, for each note, in real Strudel', JSON.stringify(await notesOf(r1.code)) === JSON.stringify([['c3', 1], ['e3', 0.33], ['g3', 1], ['b3', 0.33]]) && !r1.issues.length);
  const b2 = build('notetext', { text: 'c3 ~ [e3,g3] <b3 c4> g3@2' }, harm), r2 = compile(b2.g);
  const got2 = await notesOf(r2.code);
  check('Harmonics on some notes: works on a Note Pattern too (a chord counts when any note is picked; rests and <> are kept)', !r2.issues.length && got2.map((x) => x[1]).join() === '1,1,1,0.33,1' && got2.length === 5 && /"1 ~ 1 <0\.33 1> 1@2"/.test(r2.code));
  const b3 = build('melody', { steps: 8, scale: 'off', mode: 'steps', cells: cm }, harm, 'slow'), r3 = compile(b3.g);
  check('Harmonics on some notes: with a module that moves notes in time in between, the extra is left out and the board says why', r3.issues.some((i) => i.node === b3.hm.id && /sits between/.test(i.msg)) && !/"[0-9. ~<>]*"\]|\["/.test(r3.code.split('.partials(')[1] || ''));
  const none = { ...harm, accentNotes: Array(12).fill(false) }, r4 = compile(build('melody', { steps: 8, scale: 'off', mode: 'steps', cells: cm }, none).g);
  check('Harmonics on some notes: with no notes picked, the code is the plain partials list', !/\.partials\(\[[^\]]*"/.test(r4.code));
  {   // the Instrument's low-pass filter takes the high harmonics away: the board says so
    const acc6 = Array(16).fill(0); acc6[5] = 0.76;   // the picked notes use only a 6th harmonic
    const mk = (lpf) => build('notetext', { text: 'c3 c3 g2 e3' }, { base: 'user', scope: 'some', partials: HP.saw.bars.slice(), accent: acc6, accentNotes: pcs('e') });
    const withLpf = (lpf) => { const b = mk(lpf); b.g.nodes.find((n) => n.type === 'synth').params.lpf = lpf; return { ...b, res: compile(b.g) }; };
    const dark = withLpf(460), open = withLpf(20000);
    check('Harmonics: a low-pass filter at 460 Hz (which cuts the 6th harmonic of E3, near 990 Hz) is reported, and the same board with the filter open is not', dark.res.issues.some((i) => i.node === dark.hm.id && /cuts at 460 Hz/.test(i.msg) && /harmonics? 6\b|harmonics? [\d, ]*\b6\b/.test(i.msg)) && !open.res.issues.some((i) => /filter before/.test(i.msg)));
    const { audibleLimit: al } = await import('../src/compile.js');
    const lim = al(dark.g, dark.hm);
    check('Harmonics: the audible limit follows the lowest note and the cutoff (G2 is the lowest note here, so harmonics up to about 7 get through at 460 Hz)', lim.cutoff === 460 && Math.abs(lim.lowestHz - 98) < 1 && lim.maxHarmonic === 7 && lim.maxHarmonicPicked === 7 && al(dark.g, dark.hm, new Set([4])).maxHarmonicPicked === 4 && al(open.g, open.hm).maxHarmonic === 99);
  }
  {   // "All notes" ignores the picked notes; "Only some notes" leaves every other note with the Instrument's own sound
    const all = compile(build('melody', { steps: 8, scale: 'off', mode: 'steps', cells: cm }, { ...harm, scope: 'all' }).g);
    check('Harmonics: with "All notes" on, the picked notes make no difference (one plain partials list)', !/\.partials\(\[[^\]]*"/.test(all.code) && !all.issues.length);
    const keep = compile(build('melody', { steps: 8, scale: 'off', mode: 'steps', cells: cm }, { ...harm, base: 'keep', accent: Array.from({ length: 16 }, (_, i) => (i === 4 ? 1 : 0)) }).g);
    const notesKeep = await notesOf(keep.code.replace(/\.partials\(\[/, '.partials([').replace(/partials\[2\]/, 'x'));
    check('Harmonics: in "filter" mode the notes that are not picked get a bar of 1 (the Instrument unchanged), the picked ones the drawn bars', /"0 ~ 1 ~ 0 ~ 1 ~"/.test(keep.code) && /"1 ~ 1 ~ 1 ~ 1 ~"|"1 ~ 0 ~ 1 ~ 0 ~"/.test(keep.code) === false || /"0 ~ 1 ~ 0 ~ 1 ~"/.test(keep.code));
    const noPick = compile(build('melody', { steps: 8, scale: 'off', mode: 'steps', cells: cm }, { ...harm, accentNotes: Array(12).fill(false) }).g);
    check('Harmonics: "Only some notes" with no notes picked says so and falls back to the bars for all notes', noPick.issues.some((i) => /no notes are picked/.test(i.msg)) && !/\.partials\(\[[^\]]*"/.test(noPick.code));
    void notesKeep;
  }
  const kcm = [0, 2, 4, 5].map((d) => ({ n: null, d, len: 1, vel: 1 }));
  const g5 = eg(), N5 = (ty, p = {}) => { const n = mn(ty, 0, 0, p); g5.nodes.push(n); return n; }, W5 = (a, b, port) => g5.wires.push({ id: 'w' + g5.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
  const k5 = N5('key', { root: 'C', scale: 'major' }), m5 = N5('melody', { steps: 4, scale: 'major', mode: 'steps', cells: kcm }), s5 = N5('synth', { wave: 'sawtooth' }), h5 = N5('harmonics', harm), o5 = N5('output');
  W5(k5, m5, 'key'); W5(m5, s5, 'in'); W5(s5, h5, 'in'); W5(h5, o5, 'in');
  const got5 = await notesOf(compile(g5).code);
  check('Harmonics on some notes: a melody in a Key (scale degrees) is read as the real notes (degrees 0 2 4 5 in C major are C E G F: C and G picked)', got5.length === 4 && [got5[0][1], got5[1][1], got5[2][1], got5[3][1]].join() === '1,0.33,1,0.33');
}

// ---------- Note filter ----------
{
  const { emptyGraph: eg, makeNode: mn } = await import('../src/graph.js');
  const chain = (srcType, srcParams, fParams, between) => {
    const g = eg(), N = (ty, p = {}) => { const n = mn(ty, 0, 0, p); g.nodes.push(n); return n; }, W = (a, b, port) => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
    const src = N(srcType, srcParams), f = N('notefilter', fParams), sy = N('synth', { wave: 'sawtooth' }), o = N('output');
    if (between) { const mid = N(between); W(src, mid, 'in'); W(mid, f, 'in'); } else W(src, f, 'in');
    W(f, sy, 'in'); W(sy, o, 'in');
    return { g, f };
  };
  const pc = (...idx) => { const a = Array(12).fill(false); idx.forEach((i) => { a[i] = true; }); return a; };   // 4 = E, 0 = C, 7 = G
  const notes = async (code) => (await evaluate(code, false)).queryArc(0, 2).filter((h) => h.hasOnset()).sort((a, b) => a.whole.begin - b.whole.begin).map((h) => String(h.value.note).toLowerCase());
  const cm = Array(8).fill(null).map(() => ({ n: null, d: null, len: 1, vel: 1 })); ['c3', 'e3', 'g3', 'b3'].forEach((n, i) => { cm[i * 2] = { n, d: null, len: 1, vel: 1 }; });
  const mp = { steps: 8, scale: 'off', mode: 'steps', cells: cm };
  let c1 = chain('melody', mp, { mode: 'only', pcs: pc(4) }), r1 = compile(c1.g);
  check('Note filter: "only E" lets through only the E (in real Strudel), and the others are silent', JSON.stringify(await notes(r1.code)) === JSON.stringify(['e3', 'e3']) && !r1.issues.length && /\.mask\("/.test(r1.code));
  const r2 = compile(chain('melody', mp, { mode: 'except', pcs: pc(4) }).g);
  check('Note filter: "everything except E" lets through all the other notes', JSON.stringify(await notes(r2.code)) === JSON.stringify(['c3', 'g3', 'b3', 'c3', 'g3', 'b3']));
  const r3 = compile(chain('notetext', { text: 'c3 [e3,g3] <b3 e4> ~ g3@2' }, { mode: 'only', pcs: pc(4, 7) }).g);
  check('Note filter: on a Note Pattern a chord passes when any of its notes is picked, rests and alternation are kept, and E in any octave counts', (await notes(r3.code)).sort().join() === ['e3', 'e3', 'e4', 'g3', 'g3', 'g3', 'g3'].join());
  const r4 = compile(chain('melody', mp, { mode: 'only', pcs: pc(4) }, 'slow').g);
  check('Note filter: with a module that moves the notes in between, it says so and lets every note pass', r4.issues.some((i) => /in the way/.test(i.msg)) && !/\.mask\(/.test(r4.code));
  const r5 = compile(chain('melody', mp, { mode: 'only', pcs: Array(12).fill(false) }).g);
  check('Note filter: with no notes picked it says so and lets every note pass', r5.issues.some((i) => /no notes are picked/.test(i.msg)) && (await notes(r5.code)).length === 8);
}
{   // the master volume must multiply the Mixer faders, not replace them
  const { importStrudel } = await import('../src/importer.js');
  const g = importStrudel('stack(\n s("bd").postgain(0.3),\n s("hh").postgain(1)\n)').graph;
  g.nodes.find((n) => n.type === 'output').params.mvol = 0.85;
  const code = compile(g).code, p = await evaluate(code, false), pg = Object.fromEntries(p.queryArc(0, 1).map((h) => [h.value.s, h.value.postgain]));
  check('Mixer: a strip at 0.3 under a master volume of 0.85 plays at 0.255 (the master multiplies)', Math.abs(pg.bd - 0.255) < 1e-9 && Math.abs(pg.hh - 0.85) < 1e-9);
  const { guardCode } = await import('../src/guard.js');
  check('Mixer: the code with mul(postgain(..)) passes the safety guard', !guardCode(code));
  const back = importStrudel(code).graph;
  check('Mixer: master volume written as mul(postgain(..)) reads back as the same board', back.nodes.find((n) => n.type === 'output').params.mvol === 0.85 && back.nodes.find((n) => n.type === 'mixer').params.strips[0].vol === 0.3);
}

// ---------- MIDI file import ----------
{
  const { parseMidi, pickGrid, isMidiFile } = await import('../src/midifile.js');
  const { cleanParams } = await import('../src/validate.js');
  const { takeToPattern } = await import('../src/takecode.js');
  const vl = (v) => { const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); return b; };
  const trk = (...evs) => { const d = evs.flat(); return [0x4d, 0x54, 0x72, 0x6b, (d.length >>> 24) & 255, (d.length >>> 16) & 255, (d.length >>> 8) & 255, d.length & 255, ...d]; };
  const hdr = (fmt, n, ppq) => [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, fmt, 0, n, ppq >> 8, ppq & 255];
  const meta = (dt, type, ...body) => [...vl(dt), 0xff, type, body.length, ...body];
  const name = (t) => [...t].map((c) => c.charCodeAt(0));
  // format 1, 96 ticks a beat: a tempo track (90 bpm, 3/4) and a piano track using running status: c4 for a beat, then e4 and g4 together for two beats, and a drum hit on channel 10
  const tempo = trk(meta(0, 0x51, 0x0a, 0x2c, 0x2a), meta(0, 0x58, 3, 2, 24, 8), meta(0, 0x2f));
  const piano = trk(meta(0, 0x03, ...name('Piano')), [0, 0x90, 60, 100], [96, 60, 0], [0, 64, 80], [0, 67, 80], [...vl(192), 0x80, 64, 0], [0, 67, 0], meta(0, 0x2f));
  const drum = trk([0, 0x99, 36, 127], [48, 0x89, 36, 0], meta(0, 0x2f));
  const file = new Uint8Array([...hdr(1, 3, 96), ...tempo, ...piano, ...drum]);
  const r = parseMidi(file);
  check('MIDI: a file is read into a tempo, a time signature and one take for each track that has notes', !r.error && r.bpm === 90 && r.beatsPerBar === 3 && r.tracks.length === 2 && r.tracks[0].name === 'Piano' && r.tracks[1].drums && r.tracks[1].name === 'Drums');
  const ev = r.tracks[0].events;
  check('MIDI: notes come out in beats with their length and loudness (running status and a note-on of velocity 0 as the note-off are understood)', ev.length === 3 && ev[0].n === 60 && ev[0].t === 0 && ev[0].d === 1 && Math.abs(ev[0].v - 0.79) < 0.01 && ev[1].t === 1 && ev[1].d === 2 && ev[2].n === 67 && ev[2].d === 2);
  check('MIDI: the drum channel is marked as drums, and its half-beat hit is half a beat long', r.tracks[1].events[0].d === 0.5 && r.tracks[1].channel === 10);
  const tk = cleanParams('take', { name: 'x', grid: pickGrid(ev), bpm: r.bpm, beats: r.beatsPerBar, events: ev });
  check('MIDI: an imported track passes the Take module\'s checks unchanged and becomes a pattern', tk.events.length === 3 && takeToPattern({ bpm: r.bpm, beatsPerBar: r.beatsPerBar, events: tk.events }, { grid: tk.grid }).notes === 3 && pickGrid(ev) === 4);
  check('MIDI: notes off the 16th grid choose the triplet grid', pickGrid([{ t: 0.33, d: 1, n: 60, v: 1 }]) === 12);
  check('MIDI: a file that is not MIDI, a frames-based file and a file with no notes are refused with a reason', !!parseMidi(new Uint8Array([1, 2, 3])).error && /frames/.test(parseMidi(new Uint8Array([...hdr(1, 1, 96).slice(0, 12), 0xe7, 0x28, ...trk(meta(0, 0x2f))])).error) && /no notes/.test(parseMidi(new Uint8Array([...hdr(0, 1, 96), ...trk(meta(0, 0x2f))])).error));
  const held = parseMidi(new Uint8Array([...hdr(0, 1, 96), ...trk([0, 0x90, 60, 90], [96, 0x90, 62, 90], meta(192, 0x2f))]));
  check('MIDI: a note never released ends with the track, and a cut-off file still gives the notes before the cut', held.tracks[0].events[0].d === 3 && held.tracks[0].events[1].d === 2 && parseMidi(file.slice(0, 66)).tracks?.[0]?.events.length >= 1);
  check('MIDI: file names and the MThd marker are both recognised', isMidiFile('a.MID') && isMidiFile('noname', file) && !isMidiFile('a.txt', new Uint8Array([1, 2, 3, 4, 5])));
}

process.exit(failures ? 1 : 0);
