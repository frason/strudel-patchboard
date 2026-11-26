// How long does one x-ray / Grab query take for dense but admitted patterns?  node --import ./scripts/stub-loader.mjs scripts/bench-query.mjs
// This runs the real compile -> guard -> evaluate -> query -> record path in Node, so it measures the synchronous work a reading does on the page's thread (not browser timing: the
// browser is slower or faster by a factor that varies). Use it to see which shapes are expensive and to compare before and after a change.
import { queryEvents } from '../src/snapshot.js';
import { guardCode } from '../src/guard.js';
const CASES = [
  ['plain melody (8 notes)', '$: note("c3 e3 g3 b3 c4 b3 g3 e3").s("sawtooth")'],
  ['drums *16 x3 lines', '$: s("bd*16 hh*16 sd*16")'],
  ['drums fast(8).chop(64)', '$: s("hh*32").fast(8).chop(64)'],
  ['ply(8).chop(32) on 16 notes', '$: note("c3*16").ply(8).chop(32)'],
  ['4000 notes in a cycle', '$: note("c3*4000")'],
  ['superimpose + off + echo chain', '$: note("c3*16").superimpose(x=>x.add(12)).off(.125,x=>x.add(7)).echo(3,.125,.5)'],
  ['long Take (600 notes over 61 bars)', '$: note("' + Array.from({ length: 600 }, (_, i) => ['c3', 'e3', 'g3', 'b3'][i % 4]).join(' ') + '").slow(61)'],
];
const rounds = 5; let worstAll = 0;
console.log('case'.padEnd(40), 'events'.padStart(8), 'median ms'.padStart(10), 'worst ms'.padStart(9), '  guard');
await queryEvents('$: note(60)', { to: 1 });   // warm the evaluator
for (const [name, code] of CASES) {
  const g = guardCode(code); if (g) { console.log(name.padEnd(40), '   refused:', g); continue; }
  const ms = []; let n = 0;
  for (let i = 0; i < rounds; i++) { const t = { }, t0 = performance.now(); const rec = await queryEvents(code, { from: 0, to: 4, timing: t }); ms.push(performance.now() - t0); n = rec.events.length; }
  ms.sort((a, b) => a - b); worstAll = Math.max(worstAll, ms[ms.length - 1]);
  console.log(name.padEnd(40), String(n).padStart(8), ms[Math.floor(ms.length / 2)].toFixed(1).padStart(10), ms[ms.length - 1].toFixed(1).padStart(9), '  ok');
}
console.log('slowest single reading: ' + worstAll.toFixed(0) + ' ms (the x-ray pauses updates while music plays above 40 ms)');
process.exit(0);
