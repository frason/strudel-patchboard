// Scores how well the importer turns real Strudel code into a board. Usage:
//   node --import ./scripts/stub-loader.mjs scripts/rubric.mjs <patterns.json | folder-of-.js-files> [--eval] [--list]
// The input is a JSON list of { id, code }, or a folder of .js files. Nothing in the input is run unless you pass --eval
// (which plays the original and the rebuilt code through real Strudel and compares every event: only use it on code you trust).
//
// The rubric, in order:
//   1. Fidelity   the board plays exactly the same events as the code (--eval), and nothing is dropped without a reason in the report
//   2. Coverage   how many parts of the code the importer could not turn into modules (fewer is better; each is listed with its reason)
//   3. Economy    as few modules as will do: no effect repeated with the same settings, and few modules for the amount of code
//   4. Readability  a long run of one-note lines is one pattern, not dozens of modules (the module count shows this)
import fs from 'fs';
import path from 'path';
import { importStrudel } from '../src/importer.js';
import { compile } from '../src/compile.js';

const args = process.argv.slice(2), input = args.find((a) => !a.startsWith('--')), doEval = args.includes('--eval'), list = args.includes('--list');
if (!input) { console.log('usage: rubric.mjs <patterns.json | folder> [--eval] [--list]'); process.exit(1); }
const corpus = fs.statSync(input).isDirectory()
  ? fs.readdirSync(input).filter((f) => f.endsWith('.js')).map((f) => ({ id: f.replace(/\.js$/, ''), code: fs.readFileSync(path.join(input, f), 'utf8') }))
  : JSON.parse(fs.readFileSync(input, 'utf8'));

const EFFECT = new Set(['reverb', 'distortion', 'clip', 'delay', 'filter', 'fast', 'slow', 'late', 'pitchenv', 'tremolo', 'transpose', 'pan', 'phaser', 'vibrato', 'lofi', 'djf', 'compressor', 'fm', 'fx', 'vowel', 'pulsewidth']);
let evaluate = null;
if (doEval) {
  const { evalScope, repl, ref } = await import('@strudel/core'), { transpiler } = await import('@strudel/transpiler'), { makeSliderWithID } = await import('../src/slider.js');
  await evalScope(import('@strudel/core'), import('@strudel/mini'), import('@strudel/tonal'), { sliderWithID: makeSliderWithID(ref) });
  evaluate = async (code) => { const r = repl({ defaultOutput() {}, getTime: () => 0, transpiler, setInterval, clearInterval, onEvalError: (e) => { throw e; } }); const p = await r.evaluate(code, false);
    return p.queryArc(0, 8).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()}-${h.whole.end.toFraction()} ${JSON.stringify(Object.entries(h.value).filter(([k]) => k !== 'color').sort())}`).sort().join('|'); };   // color only changes how a piano roll is drawn
}

const rows = [];
for (const d of corpus) {
  const row = { id: String(d.id).slice(0, 12), chars: d.code.length };
  let r;
  try { r = importStrudel(d.code); } catch (e) { row.crash = String(e.message).slice(0, 80); rows.push(row); continue; }
  if (r.error) { row.unreadable = r.error.slice(0, 80); rows.push(row); continue; }
  const g = r.graph, seen = new Set();
  row.modules = g.nodes.length; row.skipped = r.report.skipped.length;
  row.dupFx = g.nodes.filter((n) => { if (!EFFECT.has(n.type)) return false; const k = n.type + JSON.stringify(n.params); const dup = seen.has(k); seen.add(k); return dup; }).length;
  row.statements = Math.max(1, new Set(g.nodes.map((n) => n.__stmt).filter(Boolean)).size);
  if (evaluate && !row.skipped) { try { row.same = (await evaluate(d.code)) === (await evaluate(compile(g).code)); } catch (e) { row.same = null; row.evalError = String(e.message).slice(0, 60); } }
  rows.push(row);
}

const ok = rows.filter((r) => r.modules !== undefined), med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0), sum = (a) => a.reduce((t, x) => t + x, 0);
const pct = (n, d) => (d ? Math.round((100 * n) / d) + '%' : '-');
console.log(`\nBoards: ${rows.length}   read: ${ok.length}   unreadable: ${rows.filter((r) => r.unreadable).length}   crashed: ${rows.filter((r) => r.crash).length}`);
if (evaluate) console.log(`1. Fidelity   of the ${ok.filter((r) => !r.skipped).length} boards with nothing left out: same events as the code ${ok.filter((r) => r.same).length}   different ${ok.filter((r) => r.same === false).length}   could not be compared ${ok.filter((r) => !r.skipped && r.same === null).length}   (a board with parts left out plays differently by design, so it is not compared)`);
else console.log('1. Fidelity   (not measured: pass --eval to compare events on code you trust)');
console.log(`2. Coverage   boards with nothing left out: ${ok.filter((r) => !r.skipped).length} of ${ok.length} (${pct(ok.filter((r) => !r.skipped).length, ok.length)})   parts left out: ${sum(ok.map((r) => r.skipped))}`);
console.log(`3. Economy    modules: ${sum(ok.map((r) => r.modules))} in total, median ${med(ok.map((r) => r.modules))} per board, largest ${Math.max(0, ...ok.map((r) => r.modules))}`);
console.log(`              effects repeated with identical settings: ${sum(ok.map((r) => r.dupFx))} (${pct(sum(ok.map((r) => r.dupFx)), sum(ok.map((r) => r.modules)))} of all modules)   boards with none: ${ok.filter((r) => !r.dupFx).length}`);
console.log(`              modules per pattern line ($: block): median ${med(ok.map((r) => Math.round(r.modules / r.statements)))}`);
if (list) {
  console.log('\nlargest boards:');
  ok.sort((a, b) => b.modules - a.modules).slice(0, 12).forEach((r) => console.log(`  ${r.id.padEnd(13)} ${String(r.chars).padStart(6)} chars  ${String(r.modules).padStart(4)} modules  left out ${String(r.skipped).padStart(3)}  repeated effects ${String(r.dupFx).padStart(3)}${r.same === false ? '  DIFFERENT EVENTS' : ''}`));
  rows.filter((r) => r.crash || r.unreadable).forEach((r) => console.log(`  ${r.id.padEnd(13)} ${r.crash ? 'CRASH ' + r.crash : 'unreadable: ' + r.unreadable}`));
}
process.exit(rows.some((r) => r.crash) ? 1 : 0);
