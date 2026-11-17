// Strudel code -> patch. Reads ordinary Strudel scripts (the same JavaScript Strudel itself runs) and builds modules for
// what the module list can express. Anything else is reported with its line number and a reason: never silently dropped.
import { parse } from 'acorn';
import { makeNode, normalize, validateShape } from './graph.js';
import { parseMini, Unsupported } from './mini.js';
import { MODULES, SCALES, makeCells, EVERY_FNS, SOMETIMES_FNS, NOTE_NAMES } from './modules.js';
import { parseChord, QUALITY_INTERVALS, ARP_STYLES } from './chords.js';

class Skip extends Error {}

const pwGiven = new WeakMap();
const implicitSynths = new WeakSet();   // instruments the importer made only because a note pattern needs one: a later .s() on the whole stack can set their sound
// effects the code can name that the audio engine bundled with Patchboard has no code to play: skipped with a reason, never turned into a module that is silent
const NO_BROWSER_FX = { chorus: 'a chorus', ring: 'ring modulation', ringf: 'ring modulation', ringdf: 'ring modulation', leslie: 'a rotating-speaker effect', lrate: 'a rotating-speaker effect', lsize: 'a rotating-speaker effect' };
const SIGNALS = { sine: 'sine', saw: 'saw', tri: 'tri', square: 'square', rand: 'rand' };
const FLAT = { db: 'c#', eb: 'd#', gb: 'f#', ab: 'g#', bb: 'a#', cb: 'b', fb: 'e' };

// ---------- small helpers on the syntax tree ----------
const str = (n) => (n && n.type === 'Literal' && typeof n.value === 'string' ? n.value : n && n.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked : null);
function num(n) {
  if (!n) return null;
  if (n.type === 'Literal' && typeof n.value === 'number') return n.value;
  if (n.type === 'Literal' && typeof n.value === 'string' && /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(n.value)) return Number(n.value);
  if (n.type === 'UnaryExpression' && n.operator === '-') { const v = num(n.argument); return v === null ? null : -v; }
  if (n.type === 'BinaryExpression') {
    const a = num(n.left), b = num(n.right);
    if (a === null || b === null) return null;
    return { '+': a + b, '-': a - b, '*': a * b, '/': a / b }[n.operator] ?? null;
  }
  return null;
}
function unwrap(expr) {
  const calls = [];
  let cur = expr;
  while (cur.type === 'CallExpression' && cur.callee.type === 'MemberExpression' && !cur.callee.computed) {
    calls.unshift({ name: cur.callee.property.name, args: cur.arguments, node: cur, prop: cur.callee.property });
    cur = cur.callee.object;
  }
  return { root: cur, calls };
}
const rootName = (r) => (r.type === 'CallExpression' && r.callee.type === 'Identifier' ? r.callee.name : r.type === 'Identifier' ? r.name : null);

// "g:minor", "c#3:minor:pentatonic", "eb:major" -> {root:'G', scale:'minor', octave:3}
function parseScale(s) {
  const parts = s.trim().split(/[:\s]+/);
  const m = /^([a-gA-G])([#bs]*)(\d+)?$/.exec(parts[0]);
  if (!m) throw new Skip(`the scale "${s}" is not a plain key name`);
  let root = m[1].toLowerCase() + m[2].replace(/s/g, '#');
  if (root.length === 2 && root[1] === 'b') root = FLAT[root] || (() => { throw new Skip(`the key "${parts[0]}" is not supported`); })();
  const name = parts.slice(1).join(' ') || 'major';
  if (!SCALES[name]) throw new Skip(`the scale "${name}" is not one of the scales offered`);
  return { root: root.toUpperCase(), scale: name, octave: m[3] ? Number(m[3]) : 3 };
}
function noteName(w) {
  if (/^-?\d+(\.\d+)?$/.test(w)) { const m = Math.round(Number(w)); return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  const m = /^([a-gA-G])([#bs]?)(-?\d+)?$/.exec(w);
  if (!m) throw new Skip(`"${w}" is not a note name`);
  let n = m[1].toLowerCase() + (m[2] === 's' ? '#' : m[2]);
  if (n.length === 2 && n[1] === 'b') n = FLAT[n] || (() => { throw new Skip(`the note "${w}" is not supported`); })();
  return n + (m[3] ?? '3');
}

// ---------- mini-notation -> step cells ----------
function expand(items) {
  const out = [];
  for (const it of items) { const n = it.copies || 1; for (let i = 0; i < n; i++) out.push({ ...it, copies: undefined }); }
  return out;
}
// leaf of a step: a note (or chord) for the melody grid, a hit for the rhythm grid
function leafOf(it, kind) {
  if (it.rest || it.t === 'rest') return kind === 'melody' ? { pitches: [] } : { on: false };
  if (kind === 'rhythm') {
    if (it.t !== 'word') throw new Skip('a rhythm step must be x or ~');
    if (['x', '1', 't', 'true'].includes(it.v)) return { on: true };
    if (['0', 'f', 'false', '-'].includes(it.v)) return { on: false };
    throw new Skip(`"${it.v}" is not a hit (x) or a rest (~)`);
  }
  if (it.t === 'word') return { pitches: [it.v] };
  if (it.t === 'chord') return { pitches: it.notes };
  throw new Skip('a step that is not a note or a chord');
}
function cellsFromItems(items, kind, conv) {
  const cells = [];
  for (const it of expand(items)) {
    if (it.slow) throw new Skip('a slowdown (/n) inside a sequence');
    const weight = it.len || 1;
    let cell;
    if (it.t === 'sub') {
      const subs = expand(it.items);
      if (subs.length < 2 || subs.length > 4) throw new Skip('brackets with more than 4 steps inside are not supported');
      if (it.rep && subs.length * it.rep > 4) throw new Skip('a repeated bracket ([a b]*n) with more than 4 steps in all');
      const reps = it.rep || 1;
      const base = subs.map((s) => { if (s.rep || s.len || s.t === 'sub' || s.t === 'turns') throw new Skip('nested brackets or modifiers inside a bracket'); return conv(leafOf(s, kind)); });
      const leaves = Array.from({ length: reps }, () => base).flat();
      if (leaves.length < 2) throw new Skip('a bracket with a single step');
      cell = { ...(kind === 'melody' ? { n: null, d: null } : { on: false }), len: weight, x: 'sub' + leaves.length, sub: leaves };
    } else {
      if (it.t === 'turns') throw new Skip('<...> inside a sequence');
      if (it.rep > 4 && it.rep <= 16 && weight === 1) { // a long repeat like c6*8 is just that many steps in a row
        const flat = conv(leafOf(it, kind));
        for (let k = 0; k < it.rep; k++) cells.push({ ...flat, len: 1 });
        continue;
      }
      if (it.rep && (it.rep < 2 || it.rep > 16)) throw new Skip(`a repeat of ${it.rep} (only *2 to *16 are supported)`);
      if (it.rep > 4) throw new Skip(`a repeat of ${it.rep} with a length (@) on it`);
      const leaf = conv(leafOf(it, kind));
      cell = { ...leaf, len: weight };
      if (it.rep) cell.x = 'rep' + it.rep;
    }
    cells.push(cell);
    for (let k = 1; k < weight; k++) cells.push(kind === 'melody' ? { n: null, d: null, len: 1 } : { on: false, len: 1 });
  }
  return cells;
}
// A pattern written with long weights, like "~@5 c2@3 ~@7 c2@3 ...", can need more than 16 steps only because of how it is spelled.
// If every note starts on a coarser grid, and every note is the same fraction of its step long, the same notes and timing fit a grid of 16 steps
// or fewer plus a Note length (clip). Only used when the pattern would otherwise be skipped. Returns { items, clip, from, to } or null.
function coarsen(items, kind) {
  const seq = expand(items);
  if (seq.some((it) => it.t === 'sub' || it.t === 'turns' || it.rep || it.slow)) return null;
  const w = (it) => it.len || 1;
  const T = seq.reduce((a, it) => a + w(it), 0);
  if (T <= 16 || !Number.isInteger(T)) return null;
  const isRest = (it) => it.rest || it.t === 'rest' || (kind === 'rhythm' && it.t === 'word' && ['0', 'f', 'false', '-'].includes(it.v));
  const notes = []; let pos = 0;
  for (const it of seq) { if (!Number.isInteger(w(it))) return null; if (!isRest(it)) notes.push({ it, p: pos, d: w(it) }); pos += w(it); }
  if (!notes.length) return null;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const g = notes.reduce((a, n) => gcd(a, n.p), T);
  for (let u = 1; u <= g; u++) {
    if (g % u || T / u > 16) continue;
    const lens = notes.map((n) => Math.ceil(n.d / u)), ratios = notes.map((n, i) => n.d / (lens[i] * u));
    if (ratios.some((r) => Math.abs(r - ratios[0]) > 1e-9)) continue;
    const out = []; let cursor = 0;
    notes.forEach((n, i) => {
      const gap = (n.p - cursor) / u;
      if (gap > 0) out.push({ t: 'rest', rest: true, len: gap });
      out.push({ ...n.it, len: lens[i] > 1 ? lens[i] : undefined });
      cursor = n.p + lens[i] * u;
    });
    const tail = (T - cursor) / u;
    if (tail > 0) out.push({ t: 'rest', rest: true, len: tail });
    const clip = ratios[0];
    return { items: out, clip: Math.abs(clip - 1) < 1e-9 ? null : +clip.toFixed(4), from: T, to: T / u };
  }
  return null;
}
// whole-string parse: plain sequence, or one <...> (optionally *N: the N becomes a Fast module)
function readSteps(text, kind, conv, opts = {}) {
  let items;
  try { items = parseMini(text, { euclid: opts.euclid }); } catch (e) { if (e instanceof Unsupported) throw new Skip(e.message); throw e; }
  let mode = 'steps', fast = 1, slow = 1;
  if (items.length === 1 && items[0].t === 'sub' && items[0].slow) {   // "[ ...steps ]/2": a long loop at the pace of 8 steps a cycle
    const it = items[0];
    if (it.rep || it.len || it.copies) throw new Skip('a modifier on the whole [...]/n');
    slow = it.slow; items = it.items; mode = 'pace';
  } else if (items.length === 1 && items[0].t === 'turns') {
    mode = 'turns'; fast = items[0].rep || 1;
    if (items[0].len || items[0].copies) throw new Skip('a modifier on the whole <...>');
    items = items[0].items;
  } else if (items.some((i) => i.t === 'turns')) throw new Skip('<...> mixed with other steps');
  return { items, mode, fast, slow };
}
// a long loop's slowdown must be its step count over 8, or it is not the steady-pace mode
function paceMode(slow, mode, steps) {
  if (mode !== 'pace') return mode;
  if (steps <= 8 || Math.abs(slow - steps / 8) > 1e-9) throw new Skip(`a slowdown of /${slow} that is not the number of steps over 8 (${steps} steps)`);
  return 'pace';
}

// split a pattern string at commas that are not inside [] <> ()
function splitTop(t) {
  const out = []; let d = 0, cur = '';
  for (const ch of t) {
    if ('[<('.includes(ch)) d++; else if (']>)'.includes(ch)) d--;
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

// ---------- the importer ----------
// sounds: a Set of the plain sound names, or a function (name, bank) => boolean that knows each drum machine's own list
export function importStrudel(code, { sounds = null } = {}) {
  const report = { done: [], skipped: [], notes: [] };
  if (typeof code !== 'string') return { error: 'There is no code to read.' };
  if (code.length > 300_000) return { error: `This code is too large to read (${Math.round(code.length / 1000)} KB; the limit is 300 KB).` };
  const lines = code.split('\n');
  const lineText = (n) => (lines[n.loc.start.line - 1] || '').trim().slice(0, 110);
  let ast;
  try { ast = parse(code, { ecmaVersion: 2022, locations: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }); }
  catch (e) { return { error: `This is not valid JavaScript, so Strudel could not run it either: ${e.message}` }; }

  const nodes = [], wires = [], keys = new Map();
  let wid = 0, stmtNo = 0, acidDefined = false;
  const out = { bpm: 120, beats: 4, master: {}, masterSig: {} };
  const add = (type, params, stmt) => { const n = makeNode(type, 0, 0, params); n.__stmt = stmt; nodes.push(n); return n; };
  const wire = (a, b, port = 'in') => wires.push({ id: 'iw' + wid++, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
  const skip = (node, reason, text) => report.skipped.push({ line: node.loc.start.line, text: (text ?? lineText(node)), reason, full: code.slice(node.start, node.end).slice(0, 20000) });

  const keyFor = (root, scale, stmt) => { const k = root + ':' + scale; if (!keys.has(k)) keys.set(k, add('key', { root, scale }, -1)); return keys.get(k); };

  // a number argument, or a slider / signal that can drive a knob through a cable
  function valueArg(node, target, key) {
    const v = num(node);
    if (v !== null) return { value: v };
    const sig = signalArg(node);
    if (sig) {
      const spec = MODULES[target.type].params.find((p) => p.key === key);
      if (!spec || !spec.wire) throw new Skip(`${key} cannot be driven by a signal here`);
      return { signal: sig };
    }
    throw new Skip('this value is not a plain number or a slider/signal');
  }
  function signalArg(n) {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'slider') {
      const [v, lo, hi] = n.arguments.map(num);
      if (v === null) return null;
      return { kind: 'slider', value: v, min: lo ?? 0, max: hi ?? 1 };
    }
    {   // slider(v, 0, 1).range(lo, hi): what a Macro writes. It is read back as an ordinary slider that already sits on that range.
      const u = unwrap(n);
      if (u.root.type === 'CallExpression' && u.root.callee.type === 'Identifier' && u.root.callee.name === 'slider' && u.calls.length === 1 && u.calls[0].name === 'range') {
        const [v, a, b] = u.root.arguments.map(num), lo = num(u.calls[0].args[0]), hi = num(u.calls[0].args[1]);
        if (v !== null && lo !== null && hi !== null) { const a0 = a ?? 0, b0 = b ?? 1, f = b0 === a0 ? 0 : (v - a0) / (b0 - a0); return { kind: 'slider', value: +(lo + f * (hi - lo)).toFixed(4), min: lo, max: hi }; }
      }
    }
    const { root, calls } = unwrap(n);
    if (root.type === 'Identifier' && SIGNALS[root.name]) {
      let min = 0, max = 1, slow = 1;
      for (const c of calls) {
        if (c.name === 'range') { min = num(c.args[0]); max = num(c.args[1]); if (min === null || max === null) return null; }
        else if (c.name === 'slow') { slow = num(c.args[0]); if (slow === null) return null; }
        else if (c.name === 'fast') { const f = num(c.args[0]); if (f === null || f === 0) return null; slow = 1 / f; }
        else return null;
      }
      return { kind: 'wave', shape: SIGNALS[root.name], min, max, slow };
    }
    return null;
  }
  function setParam(target, key, node, stmt) {
    const r = valueArg(node, target, key);
    if (r.value !== undefined) { target.params[key] = r.value; return; }
    const s = r.signal;
    const src = s.kind === 'slider' ? add('slider', { value: s.value, min: s.min, max: s.max }, stmt) : add('wave', { shape: s.shape, min: s.min, max: s.max, slow: s.slow }, stmt);
    wire(src, target, 'p:' + key);
  }

  // methods that set one parameter on the sound maker itself (order does not matter in Strudel: they just set values)
  const SYNTH_P = { gain: 'gain', pan: 'pan', attack: 'attack', att: 'attack', decay: 'decay', dec: 'decay', sustain: 'sustain', sus: 'sustain', release: 'release', rel: 'release', lpf: 'lpf', cutoff: 'lpf', lp: 'lpf', lpq: 'lpq', resonance: 'lpq', detune: 'detune' };
  const SAMP_P = { gain: 'gain', pan: 'pan', speed: 'speed', attack: 'attack', att: 'attack', decay: 'decay', dec: 'decay', release: 'release', rel: 'release', lpf: 'lpf', cutoff: 'lpf', lp: 'lpf' };
  // effect modules: [module, parameter, extra fixed params]
  const FM_FX = { fm3: ['fm', 'index3'], fmh3: ['fm', 'harm3'], fm4: ['fm', 'index4'], fmh4: ['fm', 'harm4'], fm33: ['fm', 'fb3'], fm44: ['fm', 'fb4'] };
  for (const i of [1, 2, 3, 4]) for (const j of [0, 1, 2, 3, 4]) if (j !== i && i !== j + 1) FM_FX['fm' + i + j] = ['fm', 'r' + i + j];
  const FX = {
    ...FM_FX,
    delay: ['delay', 'mix'], delaytime: ['delay', 'time'], delayfeedback: ['delay', 'feedback'], delayfb: ['delay', 'feedback'],
    room: ['reverb', 'room'], roomsize: ['reverb', 'size'], size: ['reverb', 'size'], sz: ['reverb', 'size'], rsize: ['reverb', 'size'],
    distort: ['distortion', 'amount'], dist: ['distortion', 'amount'], crush: ['distortion', 'crush'], shape: ['distortion', 'shape'],
    tremolo: ['tremolo', 'rate'], trem: ['tremolo', 'rate'], tremolosync: ['tremolo', 'rate', { sync: 'sync' }], tremolodepth: ['tremolo', 'depth'], tremoloshape: ['tremolo', 'shape'],
    phaser: ['phaser', 'rate'], ph: ['phaser', 'rate'], phaserdepth: ['phaser', 'depth'], phasercenter: ['phaser', 'center'], phasersweep: ['phaser', 'sweep'],
    pw: ['pulsewidth', 'width'], pwrate: ['pulsewidth', 'rate'], pwsweep: ['pulsewidth', 'depth'],
    vib: ['vibrato', 'rate'], vibrato: ['vibrato', 'rate'], vibmod: ['vibrato', 'depth'],
    vowel: ['vowel', 'vowel'], djf: ['djf', 'amount'],
    coarse: ['lofi', 'coarse'],
    penv: ['pitchenv', 'amount'], pattack: ['pitchenv', 'attack'], pdecay: ['pitchenv', 'decay'],
    fmwave: ['fm', 'owave'], fmwave2: ['fm', 'owave2'], fmwave3: ['fm', 'owave3'], fmwave4: ['fm', 'owave4'], fmattack: ['fm', 'attack'], fmatt: ['fm', 'attack'], fmattack2: ['fm', 'attack2'], fmattack3: ['fm', 'attack3'], fmattack4: ['fm', 'attack4'], fmatt2: ['fm', 'attack2'], fmatt3: ['fm', 'attack3'], fmatt4: ['fm', 'attack4'], fmdecay2: ['fm', 'decay2'], fmdecay3: ['fm', 'decay3'], fmdecay4: ['fm', 'decay4'], fmdec2: ['fm', 'decay2'], fmdec3: ['fm', 'decay3'], fmdec4: ['fm', 'decay4'], fmsustain2: ['fm', 'sustain2'], fmsustain3: ['fm', 'sustain3'], fmsustain4: ['fm', 'sustain4'], fmsus2: ['fm', 'sustain2'], fmsus3: ['fm', 'sustain3'], fmsus4: ['fm', 'sustain4'], fmdec: ['fm', 'decay'], fmsus: ['fm', 'sustain'],
    fm: ['fm', 'index'], fmh: ['fm', 'harm'], fmdecay: ['fm', 'decay'], fmsustain: ['fm', 'sustain'], fms: ['fm', 'sustain'], fm2: ['fm', 'index2'], fm11: ['fm', 'fb1'], fm22: ['fm', 'fb2'], fmh2: ['fm', 'harm2'], acidenv: ['acid', 'amount'],
    hpf: ['filter', 'cutoff', { type: 'hpf' }], hp: ['filter', 'cutoff', { type: 'hpf' }], bpf: ['filter', 'cutoff', { type: 'bpf' }], bandf: ['filter', 'cutoff', { type: 'bpf' }],
    hpq: ['filter', 'q'], bpq: ['filter', 'q'], lpenv: ['filter', 'env'], lpattack: ['filter', 'fa'], lpa: ['filter', 'fa'], lpdecay: ['filter', 'fd'], lpd: ['filter', 'fd'], lpsustain: ['filter', 'fs'], lps: ['filter', 'fs'], ftype: ['filter', 'ftype'],
  };
  const STRING_PARAMS = new Set(['vowel', 'tremoloshape', 'ftype', 'fmwave', 'fmwave2', 'fmwave3', 'fmwave4']);
  const VIZ = new Set(['pianoroll', '_pianoroll', 'scope', '_scope', 'tscope', 'punchcard', '_punchcard', 'spiral', '_spiral', 'pitchwheel', '_pitchwheel']);
  const OTHER_VIZ = new Set(['spectrum', '_spectrum', 'fscope', '_fscope', 'color', 'viz', 'markcss']);

  function everyFn(node) {
    const s = code.slice(node.start, node.end).replace(/\s+/g, '');
    if (s === 'rev') return 'rev';
    const t = s.replace(/^\(?x\)?=>/, 'x=>');
    for (const [k, f] of Object.entries(EVERY_FNS)) if (t === f.code) return k;
    throw new Skip('every() with this function cannot be shown');
  }

  function sometimesFn(node) {
    const s = code.slice(node.start, node.end).replace(/\s+/g, '');
    if (s === 'rev') return 'rev';
    const t = s.replace(/^\(?x\)?=>/, 'x=>');
    for (const [k, f] of Object.entries(SOMETIMES_FNS)) if (t === f.code) return k;
    throw new Skip('sometimesBy() with this function cannot be shown');
  }
  // irand(7).segment(8): what a Random Notes module writes inside n(...)
  const isRandNotes = (e) => !!e && e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && !e.callee.computed && e.callee.property.name === 'segment'
    && e.callee.object.type === 'CallExpression' && e.callee.object.callee.type === 'Identifier' && e.callee.object.callee.name === 'irand';

  // ----- build one pattern (a chain of calls) -----
  function buildChain(expr, stmt, override = null) {
    let { root, calls } = unwrap(expr);
    for (let hop = 0; root.type === 'Identifier' && vars.has(root.name) && hop < 8; hop++) { const v = unwrap(vars.get(root.name)); root = v.root; calls = [...v.calls, ...calls]; }
    const name = rootName(root);
    if (override === null && (name === 'note' || name === 'n' || name === 's' || name === 'sound') && root.type === 'CallExpression') {
      const t0 = str(root.arguments[0]);
      const parts = t0 === null ? [] : splitTop(t0);
      if (parts.length > 1) {
        if (parts.length > 6) throw new Skip('more than 6 layers separated by commas');
        const kids = parts.map((p) => buildChain(expr, stmt, p));
        const sn = add('stack', { n: Math.max(2, kids.length) }, stmt);
        kids.forEach((k, j) => wire(k.head, sn, 'in' + (j + 1)));
        return { head: sn, sources: kids.flatMap((k) => k.sources), meta: kids[0].meta, extra: [] };
      }
    }
    const S = { stmt, kind: 'sound', root: null, sources: [], pre: [], fx: new Map(), filterTouched: false, viz: [], meta: { orbit: null, duck: null, analyze: null }, instrument: null, melody: null, keyNode: null, octShift: 0, extraHeads: [] };
    const fxFor = (type) => { if (!S.fx.has(type)) S.fx.set(type, { type, params: {}, signals: [] }); return S.fx.get(type); };

    // root
    if (name === 'n' && override === null && isRandNotes(root.arguments?.[0])) {
      const rn = root.arguments[0], K = num(rn.callee.object.arguments[0]), St = num(rn.arguments[0]);
      const sc = calls.find((c) => c.name === 'scale');
      if (K === null || St === null || !Number.isInteger(K) || !Number.isInteger(St) || K < 2 || K > 14 || St < 1 || St > 16) throw new Skip('irand(…).segment(…) with numbers outside 2–14 and 1–16');
      if (!sc || str(sc.args[0]) === null) throw new Skip('random notes without a plain .scale("C3:minor")');
      const k = parseScale(str(sc.args[0]));
      if (!(k.scale in SCALES)) throw new Skip(`the scale "${k.scale}" is not one of the scales offered`);
      const oct = k.octave ?? 3;
      if (oct < 1 || oct > 5) throw new Skip(`octave ${oct} (1 to 5 are supported)`);
      S.randNode = add('randnotes', { steps: St, range: K, octave: oct, loop: 0, root: k.root, scale: k.scale }, stmt);
      S.root = S.randNode; S.kind = 'notes'; S.lastRand = S.randNode.params;
      S.instrument = add('synth', { wave: 'triangle' }, stmt);
      S.sources.push(S.instrument);
    } else if (name === 'note' || name === 'n') {
      if (root.type !== 'CallExpression' || !root.arguments.length) throw new Skip(`${name}() needs a pattern string`);
      const text = override ?? str(root.arguments[0]);
      if (text === null) throw new Skip(`${name}() with something other than a plain pattern string`);
      let deg = false;
      if (name === 'n') {
        const sc = calls.find((c) => c.name === 'scale');
        if (!sc) throw new Skip('n() without .scale() picks sample numbers, not notes');
        const sctext = str(sc.args[0]);
        if (sctext === null) throw new Skip('scale() with something other than a plain key name');
        const k = parseScale(sctext);
        S.keyNode = keyFor(k.root, k.scale);
        S.octShift = (k.octave - 3) * 12;
        deg = true;
      }
      const { items, mode: mode0, fast, slow } = readSteps(text, 'melody', (leaf) => leaf);
      const conv = (leaf) => {
        const ps = leaf.pitches.map((w) => (deg ? (/^-?\d+$/.test(w) ? Number(w) : (() => { throw new Skip(`"${w}" is not a scale step number`); })()) : noteName(w)));
        return deg ? { n: null, d: ps.length ? ps : null } : { n: ps.length ? ps : null, d: null };
      };
      let cells = cellsFromItems(items, 'melody', conv), coarse = null;
      if (cells.length > 16 && mode0 === 'steps' && !calls.some((c) => c.name === 'clip' || c.name === 'legato')) {   // a long spelling of a simple pattern (see coarsen)
        const co = coarsen(items, 'melody');
        if (co) { coarse = co; cells = cellsFromItems(co.items, 'melody', conv); }
      }
      if (cells.length > 16 && !deg && name === 'note' && mode0 === 'steps' && text.length <= 8000) {   // too long or too fine for the step grid: keep it exactly as written, as a Note Pattern
        S.melody = add('notetext', { text, vel: '' }, stmt);
        S.root = S.melody;
        S.kind = 'notes';
        report.notes.push(`line ${root.loc.start.line}: this pattern has ${cells.length} steps, more than the Melody Sequencer holds, so it was kept as written in a Note Pattern module.`);
      } else {
      if (cells.length < 1 || cells.length > 16) throw new Skip(`${cells.length} steps (1 to 16 are supported${cells.length > 16 ? ', and no grid of 16 steps or fewer fits where these notes start and how long they last' : ''})`);
      cells.forEach((c) => { c.vel = 1; });
      const mode = paceMode(slow, mode0, cells.length);
      S.melody = add('melody', { steps: cells.length, mode, scale: 'off', cells, octave: 3 }, stmt);
      S.root = S.melody;
      S.kind = 'notes';
      if (fast !== 1) S.pre.push({ type: 'fast', params: { n: fast } });
      if (coarse) {
        if (coarse.clip !== null) S.pre.push({ type: 'clip', params: { n: coarse.clip } });
        report.notes.push(`line ${root.loc.start.line}: this pattern spells out ${coarse.from} steps, but every note starts on a coarser grid, so it was written as ${coarse.to} steps${coarse.clip !== null ? ` plus a Note length of ${coarse.clip}` : ''}. The notes and their timing are the same.`);
      }
      }
      S.instrument = add('synth', { wave: 'triangle' }, stmt);
      implicitSynths.add(S.instrument);
      S.sources.push(S.instrument);
    } else if (name === 'chord') {
      const text = str(root.arguments?.[0]);
      if (text === null) throw new Skip('chord() with something other than a plain pattern string');
      const { items, mode, fast } = readSteps(text, 'rhythm', (l) => l);
      void items;
      const parsed = parseMiniChords(text);
      S.root = add('chords', { steps: parsed.cells.length, mode: parsed.mode, cells: parsed.cells }, stmt);
      if (parsed.fast !== 1) S.pre.push({ type: 'fast', params: { n: parsed.fast } });
      S.kind = 'notes';
      S.instrument = add('synth', { wave: 'triangle' }, stmt);
      S.sources.push(S.instrument);
      void mode; void fast;
    } else if (name === 's' || name === 'sound') {
      const text = override ?? str(root.arguments?.[0]);
      if (text === null) throw new Skip(`${name}() with something other than a plain pattern string`);
      const sm = add('sample', { name: text }, stmt);
      S.root = sm; S.sources.push(sm);
    } else if (name === 'stack' || name === 'cat' || name === 'slowcat') {
      const args = root.arguments;
      if (!args.length) throw new Skip(`${name}() with nothing inside`);
      // stack(a.postgain(0.6), b.pan(0.2).postgain(1)) is what a Mixer writes: a trailing .postgain() / .pan() on each part becomes that strip's fader and pan
      const peel = (a) => {
        const st = { vol: 1, pan: 0.5, hasVol: false };
        let e = a;
        while (e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && !e.callee.computed && ['postgain', 'pan'].includes(e.callee.property.name) && e.arguments.length === 1 && num(e.arguments[0]) !== null) {
          if (e.callee.property.name === 'postgain') { st.vol = num(e.arguments[0]); st.hasVol = true; } else st.pan = num(e.arguments[0]);
          e = e.callee.object;
        }
        return { expr: e, st };
      };
      const peeled = args.map(peel);
      const useMixer = name === 'stack' && args.length <= 6 && peeled.some((p) => p.st.hasVol);
      const kids = [], stripSt = [];
      args.forEach((a, ai) => {
        try { kids.push(buildChain(useMixer ? peeled[ai].expr : a, stmt)); stripSt.push(peeled[ai].st); }
        catch (e) { if (e instanceof Skip) skip(a, e.message, code.slice(a.start, a.end).split('\n')[0].slice(0, 90)); else throw e; }
      });
      if (!kids.length) throw new Skip('nothing inside could be read');
      const duckKids = kids.filter((k) => k.meta.duck);
      if (name === 'stack' && duckKids.length) {
        const g = groupDuck(kids, stmt);
        S.root = g.head; S.extraHeads = g.extra; S.sources = kids.flatMap((k) => k.sources);
      } else {
        const heads = kids.map((k) => k.head);
        const type = name === 'stack' ? (useMixer ? 'mixer' : 'stack') : 'cat';
        let cur = heads;
        while (cur.length > 6) { const next = []; for (let i = 0; i < cur.length; i += 6) { const grp = cur.slice(i, i + 6); if (grp.length === 1) { next.push(grp[0]); continue; } const sn = add(type, { n: Math.max(2, grp.length) }, stmt); grp.forEach((h, j) => wire(h, sn, 'in' + (j + 1))); next.push(sn); } cur = next; }
        const sn = add(type, type === 'mixer' ? { n: Math.max(2, cur.length), strips: Array.from({ length: 6 }, (_, j) => ({ vol: stripSt[j]?.vol ?? 1, pan: stripSt[j]?.pan ?? 0.5, mute: false, solo: false })) } : { n: Math.max(2, cur.length) }, stmt);
        cur.forEach((h, j) => wire(h, sn, 'in' + (j + 1)));
        S.root = sn; S.sources = kids.flatMap((k) => k.sources);
        S.extraHeads = [];
      }
    } else if (name === 'arrange') {
      const args = root.arguments;
      if (!args.length) throw new Skip('arrange() with nothing inside');
      const secs = [];
      for (const a of args) {
        const where = code.slice(a.start, a.end).split('\n')[0].slice(0, 90);
        if (a.type !== 'ArrayExpression' || a.elements.length !== 2) { skip(a, 'an arrange() section that is not [cycles, pattern]', where); continue; }
        const len = num(a.elements[0]);
        if (len === null || !Number.isInteger(len) || len < 1 || len > 9999) { skip(a, `an arrange() section length of ${len ?? 'something that is not a number'} (modules take whole cycles from 1 to 9999)`, where); continue; }
        try { secs.push({ len, kid: buildChain(a.elements[1], stmt) }); }
        catch (e) { if (e instanceof Skip) skip(a, e.message, where); else throw e; }
      }
      if (!secs.length) throw new Skip('nothing inside could be read');
      // a module holds six sections: more than six are nested, six at a time (an arrange of arranges plays the same song)
      const arrangeNode = (grp) => {
        const node = add('arrange', { n: Math.max(2, grp.length), lens: [4, 4, 4, 4, 4, 4].map((d, i) => Math.min(9999, grp[i]?.len ?? d)) }, stmt);
        grp.forEach((g, j) => wire(g.head, node, 'in' + (j + 1)));
        return node;
      };
      let cur = secs.map((s2) => ({ len: s2.len, head: s2.kid.head }));
      while (cur.length > 6) {
        const next = [];
        for (let i = 0; i < cur.length; i += 6) { const grp = cur.slice(i, i + 6); next.push(grp.length === 1 ? grp[0] : { len: grp.reduce((t, g) => t + g.len, 0), head: arrangeNode(grp) }); }
        cur = next;
      }
      const an = arrangeNode(cur);
      S.root = an; S.sources = secs.flatMap((s2) => s2.kid.sources);
      S.extraHeads = [];
    } else if (name === 'silence') {
      throw new Skip('silence');
    } else if (root.type === 'Literal' || root.type === 'TemplateLiteral') {
      throw new Skip('start the pattern with note(), n(), s() or chord(); a bare string needs .note() or .s() in front');
    } else {
      throw new Skip(name ? `${name}() is not something modules can express` : 'this kind of expression');
    }

    const pending = [];
    const velocity = [];
    for (const c of calls) {
      try { applyCall(S, c, fxFor, pending, velocity); }
      catch (e) { if (e instanceof Skip) report.skipped.push({ line: c.prop.loc.start.line, text: `.${c.name}(…)  in  ${lineText(c.prop)}`, reason: e.message }); else throw e; }
    }
    // velocity pattern lines up with the melody's steps
    for (const v of velocity) {
      if (S.melody.type === 'notetext') { S.melody.params.vel = v.text.slice(0, 8000); continue; }   // a Note Pattern keeps its loudness pattern as text
      try {
        const { items } = readSteps(v.text, 'melody', (l) => l);
        const cells = S.melody.params.cells;
        // each loudness item covers as many steps as its weight (@n) or its long repeat, so match them to the notes by where they start
        const at = []; let pos = 0;
        for (const it of expand(items)) {
          const w = it.rep > 4 && (it.len || 1) === 1 ? it.rep : (it.len || 1);
          const val = it.t === 'word' ? Number(it.v) : (it.rest || it.t === 'rest') ? null : 1;
          for (let k = 0; k < w; k++) at[pos + k] = val;
          pos += w;
        }
        if (pos !== cells.length) throw new Skip('the velocity pattern does not line up with the notes');
        cells.forEach((c, i) => { if (at[i] !== null && at[i] !== undefined && Number.isFinite(at[i])) c.vel = Math.min(1, Math.max(0, at[i])); });
      } catch (e) { if (e instanceof Skip) report.skipped.push({ line: v.line, text: '.velocity(…)', reason: e.message }); else if (e instanceof Unsupported) report.skipped.push({ line: v.line, text: '.velocity(…)', reason: e.message }); else throw e; }
    }

    // assemble the chain: root -> [key] -> transformers -> instrument -> effects -> views
    const seq = [];
    const needsFilter = S.filterTouched;
    if (S.keyNode && S.melody) wire(S.keyNode, S.melody, 'key');
    if (S.octShift) S.pre.unshift({ type: 'transpose', params: { n: S.octShift } });
    for (const t of S.pre) seq.push(add(t.type, t.params, stmt));
    for (const p of pending) seq.push(p);
    if (S.kind === 'notes' && S.instrument) seq.push(S.instrument);
    for (const f of S.fx.values()) {
      if (f.type === 'fm' && !('decay' in f.params || 'sustain' in f.params || 'attack' in f.params)) f.params.sustain = 1;   // code with no fm envelope holds a steady brightness; the module's own default is a decaying one
      const nd = add(f.type, f.params, stmt);
      f.signals.forEach(([key, sig]) => { const sn = sig.kind === 'slider' ? add('slider', { value: sig.value, min: sig.min, max: sig.max }, stmt) : add('wave', { shape: sig.shape, min: sig.min, max: sig.max, slow: sig.slow }, stmt); wire(sn, nd, 'p:' + key); });
      seq.push(nd);
    }
    void needsFilter;
    if (S.meta.orbit != null) { const on = add('orbit', { n: Math.min(8, Math.max(1, Math.round(S.meta.orbit))) }, stmt); S.meta.orbitNode = on; seq.push(on); }
    if (S.meta.analyze) seq.push(add('scope', { style: 'wave' }, stmt));
    for (const v of S.viz) seq.push(add(v, v === 'scope' ? { style: 'wave' } : {}, stmt));
    let head = S.root;
    for (const nd of seq) { wire(head, nd, 'in'); head = nd; }
    return { head, sources: S.sources, meta: S.meta, extra: S.extraHeads };
  }

  function parseMiniChords(text) {
    let items, mode = 'steps', fast = 1;
    try { items = parseMini(text); } catch (e) { if (e instanceof Unsupported) throw new Skip(e.message); throw e; }
    if (items.length === 1 && items[0].t === 'turns') { mode = 'turns'; fast = items[0].rep || 1; items = items[0].items; }
    const cells = [];
    for (const it of expand(items)) {
      const w = it.len || 1;
      if (it.rep || it.t === 'sub' || it.t === 'turns' || it.t === 'chord') throw new Skip('chord() steps must be plain chord names');
      let cell;
      if (it.t === 'rest') cell = { sym: null, d: null, len: w };
      else {
        const pc = parseChord(it.v);
        if (!pc || !(pc.q in QUALITY_INTERVALS)) throw new Skip(`the chord "${it.v}" is not one of the kinds offered`);
        cell = { sym: it.v, d: null, len: w };
      }
      cells.push(cell);
      for (let k = 1; k < w; k++) cells.push({ sym: null, d: null, len: 1 });
    }
    if (cells.length < 1 || cells.length > 8) throw new Skip(`${cells.length} chords (1 to 8 are supported)`);
    return { cells, mode, fast };
  }

  function applyCall(S, c, fxFor, pending, velocity) {
    const n = c.name, a = c.args;
    const src = S.sources;
    const setOnSources = (key, node) => {
      const targets = src.filter((s) => (s.type === 'synth' ? SYNTH_P : SAMP_P)[n] === key);
      if (!targets.length) throw new Skip(`${n}() needs a sound to set it on`);
      targets.forEach((t) => setParam(t, key, node, S.stmt));
    };
    if (n !== 'ribbon' && n !== 'rib' && n !== 'scale') S.lastRand = null;   // a ribbon only belongs to the random module right before it
    if (n === 'scale') { if (S.keyNode || S.randNode) return; throw new Skip('scale() on something that is not an n() pattern'); }
    if (n === 'voicing') return;
    if (n === 'mode' && S.root?.type === 'chords') { const t = str(a[0]); if (t && ['above:c3', 'above:c4', 'above:c5'].includes(t)) { S.root.params.register = t; return; } throw new Skip('this voicing mode'); }
    if (n === 'anchor' || n === 'dict' || n === 'offset' || n === 'octaves') throw new Skip(`${n}() voicing setting`);
    if (n === 'velocity' && S.melody) { const t = str(a[0]); if (t === null) throw new Skip('velocity with something other than a pattern string'); velocity.push({ text: t, line: c.prop.loc.start.line }); return; }
    if (n === 's' || n === 'sound') {
      const t = str(a[0]);
      if (t === null) throw new Skip('a sound name that is not a plain string');
      if (S.kind === 'notes' && S.instrument) { if (/[\s,<>\[\]*~!@]/.test(t.trim())) throw new Skip('a sound pattern (several sounds)'); S.instrument.params.wave = t.trim(); implicitSynths.delete(S.instrument); return; }
      const plain = src.filter((x) => x.type === 'synth' && implicitSynths.has(x));
      if (plain.length) {   // stack(a, b, c).s("sawtooth"): the sound applies to every lane that was not given one
        if (/[\s,<>\[\]*~!@]/.test(t.trim())) throw new Skip('a sound pattern (several sounds)');
        plain.forEach((x) => { x.params.wave = t.trim(); implicitSynths.delete(x); });
        return;
      }
      throw new Skip('a second .s() on this pattern');
    }
    if (n === 'bank') { const t = str(a[0]); if (t === null) throw new Skip('bank with something other than a name'); const targets = src.filter((s) => s.type === 'sample'); if (!targets.length) throw new Skip('bank() needs a sample'); targets.forEach((s) => { s.params.bank = t; }); return; }
    if (n === 'fit') { src.filter((s) => s.type === 'sample').forEach((s) => { s.params.fit = 'on'; }); return; }
    if (n === 'struct') {
      const root = S.root;
      // a rhythm goes on a single sample (its rhythm input) or on a melody (the Instrument's rhythm input)
      const onNotes = !!(root && S.kind === 'notes' && S.instrument && ['melody', 'notetext', 'randnotes'].includes(root.type));
      if (!root || (root.type !== 'sample' && !onNotes)) throw new Skip('struct() only on a single sample or a melody');
      const target = onNotes ? S.instrument : root, port = onNotes ? 'rhythm' : 'in';
      // "x*8?0.4" (with an optional .ribbon(n, 1)): what a Random Rhythm module writes
      {
        let sa = a[0], loop = 0;
        if (sa && sa.type === 'CallExpression' && sa.callee.type === 'MemberExpression' && !sa.callee.computed && (sa.callee.property.name === 'ribbon' || sa.callee.property.name === 'rib') && num(sa.arguments[1]) === 1 && num(sa.arguments[0]) !== null) { loop = num(sa.arguments[0]); sa = sa.callee.object; }
        const rt = sa ? str(sa) : null, mm = rt === null ? null : /^x\*(\d+)(?:\?([0-9.]+))?$/.exec(rt.trim());
        if (mm) {
          const steps = Number(mm[1]), drop = mm[2] === undefined ? 0 : Number(mm[2]);
          if (steps >= 1 && steps <= 16 && drop >= 0 && drop <= 0.95 && Number.isInteger(loop) && loop >= 0 && loop <= 99) {
            const rr = add('randrhythm', { steps, density: +(1 - drop).toFixed(4), loop }, S.stmt);
            wire(rr, target, port);
            return;
          }
        }
      }
      const t = str(a[0]);
      if (t === null) throw new Skip('struct() with something other than a pattern string');
      let parsed = null;
      try { const rs = readSteps(t, 'rhythm', (l) => l, { euclid: true }); parsed = { ...rs, cells: rs.items.length === 1 && rs.items[0].euclid ? null : cellsFromItems(rs.items, 'rhythm', (l) => l) }; }
      catch (e) { if (!(e instanceof Skip)) throw e; parsed = { err: e.message }; }
      if (parsed.err || (parsed.cells && (parsed.cells.length < 1 || parsed.cells.length > 16)) || (onNotes && parsed.cells === null)) {   // too long or too fine for the Rhythm Sequencer: keep it exactly as written, as a Hit Pattern
        if (t.length > 8000) throw new Skip(parsed.err || `${parsed.cells.length} steps (1 to 16 are supported)`);
        const hp = add('hitpattern', { text: t }, S.stmt);
        wire(hp, target, port);
        report.notes.push(`line ${S.stmt?.loc?.start?.line ?? c.prop.loc.start.line}: this rhythm is more than the Rhythm Sequencer holds${parsed.err ? ` (${parsed.err})` : ` (${parsed.cells ? parsed.cells.length + ' steps' : 'a euclidean rhythm'})`}, so it was kept as written in a Hit Pattern module.`);
        return;
      }
      const { items, mode: mode0, fast, slow } = parsed;
      if (items.length === 1 && items[0].euclid && !onNotes) {
        const e = items[0].euclid;
        const rh = add('rhythm', { steps: 1, mode, cells: [{ on: true, len: 1 }] }, S.stmt);
        wire(rh, root, 'in');
        pending.push(null);
        pending.pop();
        S.pre.push({ type: 'euclid', params: { pulses: e[0], steps: e[1] } });
        void fast;
        return;
      }
      const cells = parsed.cells || cellsFromItems(items, 'rhythm', (l) => l);
      const mode = paceMode(slow, mode0, cells.length);
      const rh = add('rhythm', { steps: cells.length, mode, cells }, S.stmt);
      wire(rh, target, port);
      if (fast !== 1) S.pre.push({ type: 'fast', params: { n: fast } });
      return;
    }
    // transformers
    if (n === 'fast' || n === 'slow' || n === 'ply') { const v = num(a[0]); if (v === null) throw new Skip(`${n}() with something other than a plain number`); S.pre.push({ type: n, params: { n: v } }); return; }
    if (n === 'clip' || n === 'legato') { const v = num(a[0]); if (v === null) throw new Skip(`${n}() with something other than a plain number`); if (v < 0 || v > 4) throw new Skip(`${n}() with a length outside 0 to 4`); S.pre.push({ type: 'clip', params: { n: v } }); return; }
    if (n === 'late' || n === 'early') { const v = num(a[0]); if (v === null) throw new Skip(`${n}() with something other than a plain number`); if (Math.abs(v) > 0.5) throw new Skip(`${n}() by more than half a cycle`); S.pre.push({ type: 'late', params: { n: n === 'early' ? -v : v } }); return; }
    if (n === 'swingBy' || n === 'swing') {
      const amount = n === 'swing' ? 1 / 3 : num(a[0]), slices = n === 'swing' ? num(a[0]) : num(a[1]);
      if (amount === null || slices === null || amount < 0 || amount > 1 || !Number.isInteger(slices) || slices < 1 || slices > 16) throw new Skip(`${n}() with something other than ${n === 'swing' ? 'a whole number of slices from 1 to 16' : 'an amount from 0 to 1 and a whole number of slices from 1 to 16'}`);
      S.pre.push({ type: 'swing', params: { amount: +amount.toFixed(4), slices } }); return;
    }
    if (n === 'degradeBy') { const v = num(a[0]); if (v === null) throw new Skip('degradeBy() with something other than a plain number'); S.pre.push({ type: 'degrade', params: { n: v } }); return; }
    if (n === 'ribbon' || n === 'rib') {
      const k = num(a[0]), cyc = num(a[1]);
      if (!S.lastRand || k === null || cyc !== 1 || !Number.isInteger(k) || k < 1 || k > 99) throw new Skip('ribbon() other than ribbon(n, 1) right after a random module');
      S.lastRand.loop = k; S.lastRand = null; return;
    }
    if (n === 'shuffle' || n === 'scramble') {
      const v = num(a[0]);
      if (v === null || !Number.isInteger(v) || v < 2 || v > 16) throw new Skip(`${n}() with something other than a whole number from 2 to 16`);
      const e = { type: 'shuffle', params: { mode: n, n: v, loop: 0 } }; S.pre.push(e); S.lastRand = e.params; return;
    }
    if (n === 'sometimesBy' || n === 'sometimes') {
      const p0 = n === 'sometimes' ? 0.5 : num(a[0]), fnNode = n === 'sometimes' ? a[0] : a[1];
      if (p0 === null || p0 < 0 || p0 > 1 || !fnNode) throw new Skip(`${n}() with something other than a chance and a function`);
      const fn = sometimesFn(fnNode);
      if (SOMETIMES_FNS[fn]?.notesOnly && S.kind !== 'notes') throw new Skip('an octave jump in sometimesBy() only works on notes');
      const e = { type: 'sometimes', params: { p: p0, fn, loop: 0 } }; S.pre.push(e); S.lastRand = e.params; return;
    }
    if (n === 'rev') { S.pre.push({ type: 'rev', params: {} }); return; }
    if (n === 'transpose' || n === 'trans') { const v = num(a[0]); if (v === null) throw new Skip('transpose() with something other than a number'); if (S.kind !== 'notes') throw new Skip('transpose() only works on notes'); S.pre.push({ type: 'transpose', params: { n: v } }); return; }
    if (n === 'euclid') { const p = num(a[0]), st = num(a[1]); if (p === null || st === null) throw new Skip('euclid() with something other than numbers'); S.pre.push({ type: 'euclid', params: { pulses: p, steps: st } }); return; }
    if (n === 'every') { const k = num(a[0]); if (k === null) throw new Skip('every() with something other than a number'); S.pre.push({ type: 'every', params: { n: k, fn: everyFn(a[1]) } }); return; }
    if (n === 'arp') { const t = str(a[0]); if (t === null) throw new Skip('arp() with something other than a pattern string'); const st = ARP_STYLES.find(([v]) => v === t); S.pre.push({ type: 'arp', params: st ? { style: t } : { style: 'custom', custom: t } }); return; }
    // routing and views
    if (n === 'orbit' || n === 'o') { const v = num(a[0]); if (v === null) throw new Skip('orbit with something other than a number'); S.meta.orbit = v; return; }
    if (n === 'duck' || n === 'duckorbit') { const t = a[0] ? (num(a[0]) !== null ? String(num(a[0])) : str(a[0])) : null; if (!t) throw new Skip('duck() with something other than orbit numbers'); S.meta.duck = S.meta.duck || {}; S.meta.duck.targets = t.split(/[:,\s]+/).map(Number).filter(Number.isFinite); return; }
    if (n === 'duckdepth') { const v = num(a[0]); if (v === null) throw new Skip('duckdepth with something other than a number'); S.meta.duck = S.meta.duck || {}; S.meta.duck.depth = v; return; }
    if (n === 'duckattack' || n === 'duckatt') { const v = num(a[0]); if (v === null) throw new Skip('duckattack with something other than a number'); S.meta.duck = S.meta.duck || {}; S.meta.duck.attack = v; return; }
    if (n === 'analyze') { S.meta.analyze = true; return; }
    if (VIZ.has(n)) { S.viz.push(n.includes('scope') ? 'scope' : n.includes('punchcard') ? 'punchcard' : n.includes('spiral') ? 'spiral' : n.includes('pitchwheel') ? 'pitchwheel' : 'pianoroll'); return; }
    if (OTHER_VIZ.has(n)) throw new Skip(`${n}() is a visual that has no module (pianoroll, punchcard, spiral, pitchwheel and scope do)`);
    if (n === 'cpm' || n === 'cps') throw new Skip(`${n}() on one pattern (the tempo is set for the whole patch by the Output module)`);
    // gain and friends: parameters of the sound maker
    const synthKey = SYNTH_P[n], sampKey = SAMP_P[n];
    if (src.length && (src.some((s) => s.type === 'synth' && synthKey) || src.some((s) => s.type === 'sample' && sampKey))) {
      const targets = src.filter((s) => (s.type === 'synth' ? SYNTH_P : SAMP_P)[n]);
      targets.forEach((t) => setParam(t, (t.type === 'synth' ? SYNTH_P : SAMP_P)[n], a[0], S.stmt));
      return;
    }
    if (NO_BROWSER_FX[n]) throw new Skip(`${n}() is ${NO_BROWSER_FX[n]}: Strudel's browser player has no code for it, so Patchboard has no module for it`);
    if (n === 'squiz') throw new Skip('squiz() only works when the code is sent to SuperDirt: the browser player does not play it, so Patchboard has no module for it');
    // everything else becomes an effect module
    const fx = FX[n];
    if (fx) {
      const [type, key, fixed] = fx;
      const f = fxFor(type);
      if (type === 'pulsewidth') {   // Strudel sweeps only when pwrate or pwsweep is given: pwrate alone sweeps by 0.3, pwsweep alone swings at 1 Hz
        const g = pwGiven.get(f) || pwGiven.set(f, new Set()).get(f);
        g.add(n);
        const v = num(a[0]);
        if (v !== null) f.params[key] = v;
        else { const sig = signalArg(a[0]); if (sig) f.signals.push([key, sig]); else throw new Skip(`${n} with something other than a plain number, slider or signal`); }
        if (!g.has('pwsweep')) f.params.depth = g.has('pwrate') ? 0.3 : 0;
        if (!g.has('pwrate')) f.params.rate = 1;
        return;
      }
      Object.assign(f.params, fixed || {});
      if (['lpenv', 'lpattack', 'lpa', 'lpdecay', 'lpd', 'lpsustain', 'lps', 'ftype', 'hpq', 'bpq'].includes(n)) S.filterTouched = true;
      if (type === 'compressor') return;
      if (STRING_PARAMS.has(n)) { const t = str(a[0]); if (t === null) throw new Skip(`${n} with something other than a name`); if (/^fmwave/.test(n) && !['sine', 'triangle', 'sawtooth', 'square'].includes(t)) throw new Skip(`${n}("${t}"): modules offer sine, triangle, sawtooth and square`); f.params[key] = n === 'ftype' && /^\d$/.test(t) ? ['12db', 'ladder', '24db'][Number(t)] : t; return; }
      if (n === 'ftype') { const v = num(a[0]); f.params.ftype = ['12db', 'ladder', '24db'][v] ?? '12db'; return; }
      const v = num(a[0]);
      if (v !== null) { f.params[key] = v; return; }
      const sig = signalArg(a[0]);
      const spec = MODULES[type].params.find((p) => p.key === key);
      if (sig && spec && spec.wire) { f.signals.push([key, sig]); return; }
      throw new Skip(`${n} with something other than a plain number${spec && spec.wire ? ', slider or signal' : ''}`);
    }
    if (n === 'compressor') {
      const t = str(a[0]);
      const parts = (t || '').split(':').map(Number);
      if (!t || parts.length !== 5 || parts.some((x) => !Number.isFinite(x))) throw new Skip('compressor() needs "threshold:ratio:knee:attack:release"');
      Object.assign(fxFor('compressor').params, { threshold: parts[0], ratio: parts[1], knee: parts[2], attack: parts[3], release: parts[4] });
      return;
    }
    if (n === 'pan') { Object.assign(fxFor('pan').params, { pan: valueOrThrow(a[0]) }); return; }
    if (n === 'hush') return;
    throw new Skip(`${n}() is not something the modules can express`);
  }
  const valueOrThrow = (node) => { const v = num(node); if (v === null) throw new Skip('this value is not a plain number'); return v; };

  // sounds that duck: triggers carry duck(), ducked sounds sit on one of the target orbits
  function groupDuck(kids, stmt) {
    const triggers = kids.filter((k) => k.meta.duck);
    const targets = new Set(triggers.flatMap((k) => k.meta.duck.targets || []));
    const ducked = kids.filter((k) => !k.meta.duck && targets.has(k.meta.orbit));
    const rest = kids.filter((k) => !k.meta.duck && !targets.has(k.meta.orbit));
    const t0 = triggers[0].meta.duck;
    const orbit = [...targets].sort((a, b) => a - b)[0] ?? 3;
    const dropOrbit = (k) => { // the Duck module sets the orbit of the sounds it ducks, so their own Orbit module goes
      const on = k.meta.orbitNode; if (!on) return;
      const inW = wires.find((w) => w.to.node === on.id && w.to.port === 'in');
      if (!inW) return;
      wires.filter((w) => w.from.node === on.id).forEach((w) => { w.from = inW.from; });
      wires.splice(wires.indexOf(inW), 1);
      nodes.splice(nodes.indexOf(on), 1);
      if (k.head === on) k.head = nodes.find((x) => x.id === inW.from.node);
    };
    ducked.forEach(dropOrbit);
    const duck = add('duck', { orbit, depth: t0.depth ?? 0.8, attack: t0.attack ?? 0.16 }, stmt);
    triggers.forEach((k) => wire(k.head, duck, 'kick'));
    ducked.forEach((k) => wire(k.head, duck, 'lead'));
    if (!ducked.length) { report.notes.push('duck() found nothing on the target orbits to duck, so the Duck module has nothing to dip'); }
    if (targets.size > 1) report.notes.push(`duck("${[...targets].join(':')}") ducks several orbits; the Duck module puts all ducked sounds on orbit ${orbit}, which sounds the same`);
    return { head: duck, extra: rest.map((k) => k.head) };
  }

  const vars = new Map();
  let hydraSeen = false;
  const HYDRA_WHY = 'Hydra visuals do not run here (they are left out, not deleted: your code is unchanged, and Hydra runs in strudel.cc)';
  const HYDRA_ROOTS = new Set(['osc', 'noise', 'voronoi', 'gradient', 'shape', 'solid', 'src', 'render', 'setResolution', 'update', 'hush', 's0', 's1', 's2', 's3', 'o0', 'o1', 'o2', 'o3', 'a']);
  // ----- the statements -----
  const heads = [];     // {head, meta}
  for (const st of ast.body) {
    let expr = null, label = null;
    if (st.type === 'LabeledStatement') {
      label = st.label.name;
      if (/^_/.test(label)) { skip(st, 'a muted pattern (the name starts with _)', lineText(st)); continue; }
      if (st.body.type !== 'ExpressionStatement') { skip(st, 'a labelled statement that is not a pattern', lineText(st)); continue; }
      expr = st.body.expression;
    } else if (st.type === 'ExpressionStatement') {
      expr = st.expression;
      const inner = expr.type === 'AwaitExpression' ? expr.argument : expr;
      const hroot = inner.type === 'AssignmentExpression' ? (inner.left.type === 'Identifier' ? inner.left.name : inner.left.object?.name) : rootName(unwrap(inner).root) || (unwrap(inner).root.type === 'Identifier' ? unwrap(inner).root.name : null);
      if (inner.type === 'CallExpression' && inner.callee.type === 'Identifier' && inner.callee.name === 'initHydra') {
        hydraSeen = true;
        skip(st, HYDRA_WHY);
        continue;
      }
      if (hydraSeen && hroot && HYDRA_ROOTS.has(hroot)) { skip(st, HYDRA_WHY); continue; }
      const cn = expr.type === 'CallExpression' && expr.callee.type === 'Identifier' ? expr.callee.name : null;
      if (cn === 'setcpm' || cn === 'setCpm') {
        const a = expr.arguments[0];
        if (a && a.type === 'BinaryExpression' && a.operator === '/' && num(a.left) !== null && num(a.right) !== null) { out.bpm = num(a.left); out.beats = num(a.right); }
        else if (num(a) !== null) { out.bpm = num(a) * 4; out.beats = 4; }
        else skip(st, 'a tempo that is not a plain number');
        continue;
      }
      if (cn === 'setcps' || cn === 'setCps') { const v = num(expr.arguments[0]); if (v !== null) { out.bpm = Math.round(v * 60 * 4); out.beats = 4; } else skip(st, 'a tempo that is not a plain number'); continue; }
      if (cn === 'samples') { report.notes.push(`${lineText(st)}: the app loads its own sound libraries, so this line is ignored`); continue; }
      if (cn === 'register') {
        const nm = str(expr.arguments[0]);
        const body = expr.arguments[1] ? code.slice(expr.arguments[1].start, expr.arguments[1].end).replace(/\s+/g, '') : '';
        if (nm === 'acidenv' && body.includes('lpf(100)') && body.includes('lpenv(x*9)')) { acidDefined = true; continue; }
        skip(st, `a custom function "${nm}" cannot be turned into modules`); continue;
      }
      if (cn === 'hush' || cn === 'setGainCurve' || cn === 'initHydra' || cn === 'setcpm') { if (cn !== 'hush') skip(st, `${cn}() is not something modules can express`); continue; }
      if (cn === 'all') {
        try {
          const fn = expr.arguments[0];
          const body = fn && fn.type === 'ArrowFunctionExpression' ? fn.body : null;
          if (!body) throw new Skip('all() with something other than x => x.effect()');
          const { root, calls } = unwrap(body);
          if (!(root.type === 'Identifier')) throw new Skip('all() with something other than x => x.effect()');
          for (const c of calls) {
            const v = num(c.args[0]);
            const key = { phaser: 'mphaser', tremolo: 'mtrem', postgain: 'mvol' }[c.name];
            if (key && v !== null) out.master[key] = v;
            else if (key === 'mvol' && signalArg(c.args[0])) out.masterSig.mvol = { sig: signalArg(c.args[0]), stmt: st };   // a slider or wave riding the master volume
            else if (c.name === 'scope' || c.name === '_scope') report.notes.push('all(x => x.scope()) shows a scope: add a Scope module to see one');
            else if (OTHER_VIZ.has(c.name) || VIZ.has(c.name)) report.notes.push(`all(x => x.${c.name}()) is a visual and was ignored`);
            else throw new Skip(`all(x => x.${c.name}(…)) cannot be shown`);
          }
        } catch (e) { if (e instanceof Skip) skip(st, e.message); else throw e; }
        continue;
      }
    } else if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) {
        if (d.id.type === 'Identifier' && d.init && d.init.type === 'CallExpression') vars.set(d.id.name, d.init);
        else skip(st, 'a variable that is not a pattern');
      }
      continue;
    } else if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') {
      skip(st, 'a function definition cannot be turned into modules'); continue;
    } else if (st.type === 'EmptyStatement') continue;
    else { skip(st, `${st.type.replace(/Statement|Declaration/, '').toLowerCase()} code`); continue; }

    stmtNo++;
    try {
      const r = buildChain(expr, stmtNo);
      heads.push({ ...r, line: st.loc.start.line, text: lineText(st) });
    } catch (e) {
      if (e instanceof Skip) skip(st, e.message, lineText(st));
      else throw e;
    }
  }
  void acidDefined;
  if (hydraSeen) report.notes.push('Hydra (live visuals) does not run in Patchboard. Those lines were left out of the board but not deleted: use "Copy the skipped code", or paste your original into strudel.cc, where Hydra runs.');

  // top-level ducking across separate $: statements
  let finalHeads = heads;
  if (heads.some((h) => h.meta.duck)) {
    const g = groupDuck(heads, 99);
    finalHeads = [{ head: g.head, meta: {}, line: 0, text: 'duck' }, ...heads.filter((h) => !h.meta.duck && !(heads.filter((x) => x.meta.duck).flatMap((x) => x.meta.duck.targets || []).includes(h.meta.orbit))).map((h) => ({ ...h }))];
  }

  const outNode = add('output', { bpm: out.bpm, beats: out.beats, ...out.master }, 0);
  for (const [key, { sig, stmt }] of Object.entries(out.masterSig)) {
    const src = sig.kind === 'slider' ? add('slider', { value: sig.value, min: sig.min, max: sig.max }, stmt) : add('wave', { shape: sig.shape, min: sig.min, max: sig.max, slow: sig.slow }, stmt);
    wire(src, outNode, 'p:' + key);
  }
  const connected = new Set();
  for (const h of finalHeads) { wire(h.head, outNode, 'in'); connected.add(h.head.id); for (const x of h.extra || []) wire(x, outNode, 'in'); }
  if (!finalHeads.length) { /* nothing playable */ }

  // positions: statement order down the page, chain left to right (the board tidies them afterwards)
  const order = new Map();
  nodes.forEach((nd) => { const s = nd.__stmt ?? 0; order.set(s, (order.get(s) || 0) + 1); });
  const seen = new Map();
  nodes.forEach((nd) => { const s = nd.__stmt ?? 0; const i = seen.get(s) || 0; seen.set(s, i + 1); nd.x = (i + 1) * 320; nd.y = (s < 0 ? -1 : s) * 420 + i * 6; delete nd.__stmt; });
  outNode.x = 0; outNode.y = 0;

  const g = { v: 1, nodes, wires };
  const removed = normalize(g);
  removed.forEach((r) => report.skipped.push({ line: 0, text: 'a cable', reason: r.reason }));
  try { validateShape(g); } catch (e) { return { error: e.message }; }

  // sounds the app does not have
  if (sounds) {
    const missing = new Set();
    for (const nd of g.nodes) if (nd.type === 'sample') String(nd.params.name).split(/[\s\[\]<>~*!@,]+/).map((w) => w.split(':')[0]).filter((w) => w && !/^\d/.test(w) && !(typeof sounds === 'function' ? sounds(w, nd.params.bank || '') : sounds.has(w))).forEach((w) => missing.add(w));
    if (missing.size) report.notes.push(`these sound names are not in the built-in libraries and will be silent: ${[...missing].join(', ')}`);
  }
  report.done = finalHeads.map((h) => ({ line: h.line, text: h.text }));
  const playable = g.nodes.filter((n) => n.type !== 'output').length;
  return { graph: g, report, empty: playable === 0 };
}
