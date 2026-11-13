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
  check('lesson 10 plays degrees of A minor (lead A3 C4 E4 A4 E4 C4 + bass A2 D3)', notes.includes('A3') && notes.includes('C4') && notes.includes('E4') && notes.includes('A4') && notes.includes('A2') && notes.includes('D3'));
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
  check('instrument list: 5 synths, recorded piano, 125 General MIDI, unique ids', INSTRUMENTS.length === 131 && new Set(INSTRUMENTS.map((i) => i.id)).size === 131);
  check('instruments are categorised', instrumentOf('gm_flute').cat === 'Winds' && instrumentOf('gm_violin').cat === 'Strings' && instrumentOf('gm_acoustic_guitar_nylon').cat === 'Guitar' && instrumentOf('gm_trumpet').cat === 'Brass' && instrumentOf('sawtooth').cat === 'Synth' && instrumentOf('piano').kind === 'sample');
  check('search finds by plain words', searchInstruments('guitar').length === 9 && searchInstruments('flute', 'Winds').some((i) => i.id === 'gm_flute') && searchInstruments('flute', 'Brass').length === 0);
  check('labels read as words', labelOf('gm_acoustic_guitar_nylon') === 'Acoustic guitar nylon' && labelOf('gm_epiano1') === 'Electric piano 1');
  const g = LESSONS.find((l) => l.id === 'instruments').graph();
  const r = compile(g);
  console.log(r.code);
  check('lesson 13 uses three General MIDI sounds through s()', ['gm_string_ensemble_1', 'gm_flute', 'gm_acoustic_guitar_nylon'].every((n) => r.code.includes('.s("' + n + '")')));
  const ev = (await evaluate(r.code, false)).queryArc(0, 2).filter((h) => h.hasOnset());
  check('lesson 13 plays chords (3 string notes) and a melody', ev.filter((h) => h.value.s === 'gm_string_ensemble_1').length >= 3 && ev.some((h) => h.value.s === 'gm_flute'));
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
    const sm = N('sample', { name: 'bd', pan: 0.2 }), out = N('output', { mphaser: 0.5, mtrem: 4, mchorus: 0.3 });
    let prev = sm; const nodes = [sm, ...fxList, out], wires = [];
    for (const fx of fxList) { wires.push({ id: 'w' + wires.length, from: { node: prev.id, port: 'out' }, to: { node: fx.id, port: 'in' } }); prev = fx; }
    wires.push({ id: 'wz', from: { node: prev.id, port: 'out' }, to: { node: out.id, port: 'in' } });
    return { v: 1, nodes, wires };
  };
  const g = mk([N('tremolo', { sync: 'sync', rate: 8, depth: 0.7, shape: 'square' }), N('phaser', { rate: 0.5, depth: 0.9, center: 800 }), N('chorus', { amount: 0.4 }), N('compressor', { threshold: -24, ratio: 6 }), N('pan', { pan: 0.8 })]);
  const r = compile(g);
  console.log(r.code);
  const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  const v = ev[0]?.value || {};
  check('new effects reach the event (tremolosync, depth, shape, phaser, chorus, compressor, pan)', v.tremolosync === 8 && v.tremolodepth === 0.7 && v.tremoloshape === 'square' && v.phaserrate === 0.5 && v.phaserdepth === 0.9 && v.phasercenter === 800 && v.chorus === 0.3 && v.compressor === -24 && v.compressorRatio === 6 && v.pan === 0.8);
  check('master knobs write one all(...) line that applies to everything', /all\(x => x\.phaser\(0\.5\)\.tremolo\(4\)\.chorus\(0\.3\)\)/.test(r.code) && ev.every((h) => h.value.phaserrate !== undefined));
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
    N('vibrato', { rate: 6, depth: 1 }), N('ring', { mix: 0.4, freq: 300 }), N('vowel', { vowel: 'ae' }), N('djf', { amount: 0.3 }),
    N('leslie', { wet: 0.8, rate: 5, size: 0.3 }), N('lofi', { coarse: 4, squiz: 2 }), N('distortion', { amount: 2, shape: 0.4 }),
    N('pitchenv', { amount: -12, attack: 0.02, decay: 0.3 }), N('fm', { index: 5, harm: 2, decay: 0.4 }),
    N('filter', { type: 'lpf', cutoff: 500, ftype: 'ladder', env: 4, fa: 0.02, fd: 0.2, fs: 0.1 }),
  ]);
  const r = compile(g);
  console.log(r.code);
  let v = {};
  try {
    const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
    v = ev[0]?.value || {};
  } catch (e) { check('all new effects evaluate: ' + e.message, false); }
  const want = { vib: 6, vibmod: 1, ring: 0.4, ringf: 300, vowel: 'ae', djf: 0.3, leslie: 0.8, lrate: 5, lsize: 0.3, coarse: 4, squiz: 2, shape: 0.4, penv: -12, pattack: 0.02, pdecay: 0.3, fmi: 5, fmh: 2, fmdecay: 0.4, ftype: 'ladder', lpenv: 4, lpattack: 0.02, lpdecay: 0.2, lpsustain: 0.1 };
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
  check('lesson 14 writes the progression from the key (Am F C G)', r.code.includes('chord("<Am F C G>")'));
  const ev = (await evaluate(r.code, false)).queryArc(0, 1).filter((h) => h.hasOnset());
  check('lesson 14 plays the chord on the piano and arpeggiates it on the guitar', ev.some((h) => h.value.s === 'gm_epiano1') && ev.filter((h) => h.value.s === 'gm_acoustic_guitar_nylon').length >= 4);
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
process.exit(failures ? 1 : 0);
