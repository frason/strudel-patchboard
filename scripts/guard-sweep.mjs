// Every module, every setting at its extremes: whatever the compiler writes, the playback guard must accept. Run: npm run test:guard
import { MODULES, portsOf } from '../src/modules.js';
import { emptyGraph, makeNode, normalize } from '../src/graph.js';
import { compile } from '../src/compile.js';
import { guardCode } from '../src/guard.js';

const bad = new Map(); let runs = 0;
const wire = (g, a, b, port = 'in') => g.wires.push({ id: 'w' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
const variants = (type) => {
  const def = MODULES[type], out = [{}];
  for (const p of def.params || []) {
    const vals = [];
    if (p.kind === 'knob' || p.kind === 'num') vals.push(p.min, p.max, p.def);
    else if (p.kind === 'toggle') vals.push(true, false);
    else if (p.kind === 'select') vals.push(...(p.options || []).slice(0, 12).map((o) => (Array.isArray(o) ? o[0] : o)));
    else continue;
    for (const v of vals) if (v !== undefined) out.push({ [p.key]: v });
  }
  return out;
};
const sources = ['melody', 'sample', 'rhythm', 'randnotes', 'chords', 'instrument', 'synth'].filter((t) => MODULES[t]);
for (const type of Object.keys(MODULES)) {
  for (const v of variants(type)) {
    for (const srcType of sources) {
      const g = emptyGraph(), N = (t, p = {}) => { const n = makeNode(t, 0, 0, p); g.nodes.push(n); return n; };
      const src = N(srcType), mid = type === srcType || type === 'output' ? null : N(type, v), out = N('output');
      if (type === 'output') Object.assign(out.params, v);
      let head = src;
      if (mid) { wire(g, head, mid); head = mid; }
      if (srcType === 'melody' || srcType === 'randnotes' || srcType === 'chords') { const syn = N('synth', { wave: 'sawtooth' }); wire(g, head, syn); head = syn; }
      wire(g, head, out);
      normalize(g);
      let code; try { code = compile(g).code; } catch { continue; }
      if (!code || !/\$:/.test(code)) continue;
      runs++;
      const why = guardCode(code);
      if (why) { const k = `${type}: ${why}`; if (!bad.has(k)) bad.set(k, JSON.stringify(v)); }
    }
  }
}
// signals plugged into every knob that accepts a cable, and the modules that take several inputs
for (const type of Object.keys(MODULES)) {
  const knobs = (MODULES[type].params || []).filter((p) => p.wire);
  for (const sig of ['slider', 'wave', 'random', 'macro'].filter((t) => MODULES[t])) {
    for (const k of knobs) {
      const g = emptyGraph(), N = (t, p = {}) => { const n = makeNode(t, 0, 0, p); g.nodes.push(n); return n; };
      const src = N('melody'), syn = N('synth', { wave: 'sawtooth' }), mid = type === 'output' ? null : N(type), out = N('output'), s = N(sig);
      wire(g, src, syn); let head = syn; if (mid) { wire(g, head, mid); head = mid; }
      wire(g, head, out); wire(g, s, mid || out, 'p:' + k.key);
      normalize(g);
      let code; try { code = compile(g).code; } catch { continue; }
      if (!code || !/\$:/.test(code)) continue;
      runs++;
      const why = guardCode(code);
      if (why) { const key = `${type} + ${sig} on ${k.key}: ${why}`; if (!bad.has(key)) bad.set(key, ''); }
    }
  }
}
for (const type of ['stack', 'cat', 'arrange', 'mixer', 'duck', 'every', 'sometimes', 'euclid']) {
  if (!MODULES[type]) continue;
  const g = emptyGraph(), N = (t, p = {}) => { const n = makeNode(t, 0, 0, p); g.nodes.push(n); return n; };
  const a = N('sample', { name: 'bd' }), b = N('sample', { name: 'hh*4' }), c = N('sample', { name: 'cp' }), mid = N(type), out = N('output');
  const ports = portsOf(mid).filter((p) => p.dir === 'in' || p.kind === 'in' || !p.id.startsWith('p:')).map((p) => p.id);
  wire(g, a, mid, ports[0] || 'in'); wire(g, b, mid, ports[1] || 'in'); wire(g, c, mid, ports[2] || 'in'); wire(g, mid, out);
  normalize(g);
  let code; try { code = compile(g).code; } catch { continue; }
  if (!code || !/\$:/.test(code)) continue;
  runs++;
  const why = guardCode(code);
  if (why) bad.set(`${type} with several inputs: ${why}`, '');
}
console.log(`${runs} compiled patches checked`);
for (const [k, v] of bad) console.log('REFUSED', k, 'with', v);
console.log(bad.size ? `FAIL ${bad.size} kinds of compiled code are refused by the guard` : 'ok   the guard accepts everything the compiler writes');
process.exit(bad.size ? 1 : 0);
