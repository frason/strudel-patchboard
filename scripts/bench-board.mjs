// Whole-board cost in Node: compile, guard, one 4-cycle reading of the board's code, and a 32-cycle form map, for the library boards and some deliberately heavy ones.
//   node --import ./scripts/stub-loader.mjs scripts/bench-board.mjs     (npm run bench:board)
// Node numbers, not browser numbers: they show which shapes are expensive and compare before and after a change. Median of 5 for the quick steps, one run for the map.
import { readFileSync, readdirSync } from 'node:fs';
import { compile } from '../src/compile.js';
import { guardCode } from '../src/guard.js';
import { queryEvents } from '../src/snapshot.js';
import { buildFormMap } from '../src/formmap.js';
import { makeNode, normalize, expansionCost } from '../src/graph.js';
import { loadLibrary } from '../src/library.js';

const files = Object.fromEntries(readdirSync(new URL('../library/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(readFileSync(new URL('../library/' + f, import.meta.url), 'utf8'))]));
const boards = loadLibrary(files).entries.map((e) => [`library: ${e.id}`, e.graph]);
const wire = (g, a, b, port = 'in') => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
const takeBoard = (n, len = 0) => { const t = makeNode('take', 0, 0, { grid: 12, beats: 4, bpm: 120, len, events: Array.from({ length: n }, (_, i) => ({ t: i / 4, d: 0.25, n: 48 + (i % 12), v: 0.7 })) }), s = makeNode('synth', 0, 0, { wave: 'sine' }), o = makeNode('output', 0, 0), g = { v: 1, nodes: [t, s, o], wires: [] }; wire(g, t, s); wire(g, s, o); normalize(g); return g; };
const fanout = (depth) => { const src = makeNode('codesource', 0, 0, { code: 's("bd")' }), o = makeNode('output', 0, 0), g = { v: 1, nodes: [src, o], wires: [] }; let p = src; for (let i = 0; i < depth; i++) { const n = makeNode('stack', 0, 0); g.nodes.push(n); wire(g, p, n, 'in1'); wire(g, p, n, 'in2'); p = n; } wire(g, p, o); normalize(g); return g; };
const chain = (len) => { const src = makeNode('codesource', 0, 0, { code: 'note("c3*8").s("sawtooth")' }), o = makeNode('output', 0, 0), g = { v: 1, nodes: [src, o], wires: [] }; let p = src; for (let i = 0; i < len; i++) { const n = makeNode(i % 3 === 0 ? 'fast' : i % 3 === 1 ? 'rev' : 'late', 0, 0); g.nodes.push(n); wire(g, p, n); p = n; } wire(g, p, o); normalize(g); return g; };
boards.push(['take 600 notes', takeBoard(600)], ['take 2000 notes (the cap)', takeBoard(2000)], ['take 2000 notes, len 64 beats', takeBoard(2000, 64)], ['fan-out depth 8 (255 writings)', fanout(8)], ['fan-out depth 11 (4095 writings)', fanout(11)], ['chain of 30 transforms', chain(30)], ['chain of 120 transforms', chain(120)]);

const med = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log('board'.padEnd(36), 'paths'.padStart(6), 'chars'.padStart(8), 'compile'.padStart(8), 'guard'.padStart(7), 'read 4cy'.padStart(9), 'events'.padStart(7), 'map 32cy'.padStart(9));
await queryEvents('$: note(60)', { to: 1 });
let worst = 0;
for (const [name, g] of boards) {
  const cost = expansionCost(g), cs = [], gs = []; let r;
  for (let i = 0; i < 5; i++) { let t = performance.now(); r = compile(g); cs.push(performance.now() - t); t = performance.now(); var bad = guardCode(r.code); gs.push(performance.now() - t); }
  if (r.refused || bad) { console.log(name.padEnd(36), String(cost).padStart(6), String(r.code.length).padStart(8), med(cs).toFixed(1).padStart(8), med(gs).toFixed(1).padStart(7), '  refused: ' + (bad || r.issues[0]?.msg.slice(0, 50))); continue; }
  const rs = []; let n = 0; for (let i = 0; i < 5; i++) { const t = performance.now(); const rec = await queryEvents(r.code, { from: 0, to: 4 }); rs.push(performance.now() - t); n = rec.events.length; }
  const t1 = performance.now(); await buildFormMap(g, { cycles: 32 }); const mapMs = performance.now() - t1;
  worst = Math.max(worst, ...rs);
  console.log(name.padEnd(36), String(cost).padStart(6), String(r.code.length).padStart(8), med(cs).toFixed(1).padStart(8), med(gs).toFixed(1).padStart(7), med(rs).toFixed(1).padStart(9), String(n).padStart(7), mapMs.toFixed(0).padStart(9));
}
console.log('slowest single 4-cycle reading: ' + worst.toFixed(0) + ' ms');
process.exit(0);
