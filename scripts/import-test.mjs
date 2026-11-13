// Round trip: every starter patch -> code -> importer -> code again; both must play the same events in real Strudel.
// Then every file in scripts/corpus/*.json ([{title, code}]) is imported and reported.
import fs from 'node:fs';
import { LESSONS } from '../src/starters.js';
import { compile } from '../src/compile.js';
import { importStrudel } from '../src/importer.js';
import { evalScope, repl, ref } from '@strudel/core';
import { makeSliderWithID } from '../src/slider.js';
import { transpiler } from '@strudel/transpiler';

await evalScope(import('@strudel/core'), import('@strudel/mini'), import('@strudel/tonal'), { sliderWithID: makeSliderWithID(ref) });
const { evaluate } = repl({ defaultOutput() {}, getTime: () => 0, transpiler, setInterval, clearInterval, onEvalError: (e) => { throw e; } });
// Hydra needs a browser: stand in with objects that accept any call
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
globalThis.initHydra = async () => {};
for (const k of ['osc', 'setResolution', 'src', 'noise', 'voronoi', 's0', 's1', 'time']) globalThis[k] = noop;
const FL = { db: 'c#', eb: 'd#', gb: 'f#', ab: 'g#', bb: 'a#' };
const events = async (code) => {
  const pat = await evaluate(code, false);
  return pat.queryArc(0, 12).filter((h) => h.hasOnset()).map((h) => `${h.whole.begin.toFraction()}-${h.whole.end.toFraction()} ` + JSON.stringify(Object.fromEntries(Object.entries(h.value).filter(([k]) => !['analyze', 'dry'].includes(k)).sort())))
    .map((x) => x.replace(/"(db|eb|gb|ab|bb)(\d)"/g, (_, a, o) => '"' + FL[a] + o + '"')).sort();
};
let bad = 0;
for (const l of LESSONS) {
  const { code } = compile(l.graph());
  const r = importStrudel(code);
  if (r.error) { bad++; console.log('FAIL', l.title, r.error); continue; }
  const code2 = compile(r.graph).code;
  let a, b;
  try { a = await events(code); b = await events(code2); } catch (e) { bad++; console.log('EVAL', l.title, e.message); continue; }
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  const sk = r.report.skipped.length;
  console.log(same && !sk ? 'ok  ' : 'DIFF', l.title, `${a.length} events`, sk ? `skipped ${sk}` : '');
  if (!same || sk) {
    bad++;
    r.report.skipped.forEach((s) => console.log('     skip', s.line, s.text, '--', s.reason));
    if (!same) { const sa = new Set(a), sb = new Set(b); console.log('     only original:', a.filter((x) => !sb.has(x)).slice(0, 3), '\n     only import:  ', b.filter((x) => !sa.has(x)).slice(0, 3)); console.log(code2); }
  }
}
const dir = new URL('./corpus/', import.meta.url).pathname;
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.txt')) : []) {
  const items = fs.readFileSync(dir + f, 'utf8').split(/^=====/m).filter(Boolean).map((b) => { const i = b.indexOf('\n'); return { title: b.slice(0, i), code: b.slice(i + 1) }; });
  const tally = { full: 0, partial: 0, none: 0, error: 0, evalfail: 0 };
  for (const it of items) {
    const r = importStrudel(it.code);
    if (r.error) { tally.error++; console.log('ERR ', it.title, r.error.slice(0, 80)); continue; }
    const sk = r.report.skipped.length;
    const k = r.empty ? 'none' : sk ? 'partial' : 'full';
    tally[k]++;
    try { await events(compile(r.graph).code); } catch (e) { tally.evalfail++; console.log('EVALFAIL', it.title, e.message.slice(0, 100)); }
    let eq = '';
    if (k === 'full') { try { const A = await events(it.code), B = await events(compile(r.graph).code); eq = A.length === B.length && A.every((x, i) => x === B[i]) ? ' (same events)' : ' (EVENTS DIFFER ' + A.length + ' vs ' + B.length + ')'; } catch (e) { eq = ' (orig eval: ' + e.message.slice(0, 50) + ')'; } }
    console.log(k.padEnd(7), it.title + eq);
    r.report.skipped.slice(0, 4).forEach((s) => console.log('        skip', s.line, s.text.slice(0, 60), '--', s.reason));
  }
  console.log(f, tally);
}
process.exit(bad ? 1 : 0);
