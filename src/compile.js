// Graph -> idiomatic Strudel code. Pure. The returned `code` string is exactly what gets evaluated.
// Alongside the code we return `segments`: which character ranges belong to which module (and which knob / step),
// which is how highlighting, hover and "who made this event" work without any second representation of the sound.
import { parseArrangeOrder, portsOf, MODULES, MUTE_KIND, EVERY_FNS, SOMETIMES_FNS, fmt, cellNotes, scaleCode, parseX, leafAt, stepHas, SCALES, NOTE_NAMES, noteRank } from './modules.js';
import { chordSymbol } from './chords.js';
import { guardCalls, guardCode } from './guard.js';
import { takeToPattern } from './takecode.js';
import { nodeById, wiresInto, outType, effectiveKey, scopeId } from './graph.js';
const FM_WAVES = new Set(['sine', 'sawtooth', 'square', 'triangle', 'supersaw', 'pulse', 'sin', 'saw', 'sqr', 'tri', 'z_sine', 'z_sawtooth', 'z_square', 'z_triangle']);   // oscillators FM can modulate

const S = (t, meta = {}) => ({ t, ...meta });
const NL = (d) => ({ nl: d });

function chain(base, calls, depth, inline) {
  const out = [...base];
  for (const c of calls) {
    if (!inline) out.push(NL(depth + 1));
    out.push(...c);
  }
  return out;
}

const q = (s) => JSON.stringify(String(s));

const modp = (a, b) => ((a % b) + b) % b;
// scale degree -> note name, the way Strudel's scale("C3:major") reads it
export function degreeName(key, d) {
  const iv = SCALES[key.scale] || SCALES.major, rootPc = NOTE_NAMES.indexOf(String(key.root).toLowerCase()), abs = (rootPc < 0 ? 0 : rootPc) + iv[modp(d, iv.length)] + 12 * Math.floor(d / iv.length);
  return NOTE_NAMES[modp(abs, 12)] + (3 + Math.floor(abs / 12));
}


// text of one step, with repeats ([..]*2) and brackets ([a b]) and length (@2). leaf() renders one leaf value.
export function stepText(t, leaf) {
  if (t.rest) return '~';
  const x = parseX(t.cell);
  let out = x.type === 'sub' ? '[' + Array.from({ length: x.n }, (_, k) => leaf(leafAt(t.cell, k), t)).join(' ') + ']' : leaf(t.cell, t);
  if (x.type === 'rep') out += '*' + x.n;
  if (t.len > 1) out += '@' + t.len;
  return out;
}

// what an empty patch shows in the code panel: the board's own hint, not the person's text
// How high the sound can go before the Instrument's low-pass filter (and any Filter module before a Harmonics module) takes it away:
// the cutoff, the lowest note that plays (or C3 when it cannot be read) and the highest harmonic of that note below about one and a half times the cutoff.
export function audibleLimit(g, n, picked = null) {
  let cutoff = 20000, cur = n, synth = null;
  for (let hop = 0; hop < 8 && cur; hop++) {
    const w = wiresInto(g, cur.id, 'in')[0], src = w && nodeById(g, w.from.node);
    if (!src) break;
    if (src.type === 'synth') { synth = src; const lp = Number(src.params.lpf); if (lp > 0 && lp < cutoff && !wiresInto(g, src.id, 'p:lpf').length) cutoff = lp; break; }
    if (src.type === 'filter' && src.params.type === 'lpf' && !wiresInto(g, src.id, 'p:cutoff').length) { const c = Number(src.params.cutoff); if (c > 0 && c < cutoff) cutoff = c; }
    cur = src;
  }
  let lowestHz = 130.81, lowestPickedHz = null;
  const w2 = synth && wiresInto(g, synth.id, 'in')[0], s2 = w2 && nodeById(g, w2.from.node);
  if (s2 && (s2.type === 'melody' || s2.type === 'notetext')) {
    let names = [];
    if (s2.type === 'notetext') names = String(s2.params.text || '').match(/[a-g][#b]?-?\d/gi) || [];
    else { const key = effectiveKey(g, s2); for (const c of s2.params.cells || []) for (const lf of [c, ...(c.sub || [])]) for (const x of cellNotes(lf, !!key)) names.push(key ? degreeName(key, x) : String(x)); }
    const toMidi = (nm) => { const m = /^([a-g])([#b]?)(-?\d+)$/i.exec(nm); return m ? 12 * (Number(m[3]) + 1) + ({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 })[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null; };
    const midis = names.map(toMidi).filter((x) => x !== null), pm = picked ? midis.filter((x) => picked.has(x % 12)) : [];
    if (midis.length) lowestHz = 440 * 2 ** ((Math.min(...midis) - 69) / 12);
    if (pm.length) lowestPickedHz = 440 * 2 ** ((Math.min(...pm) - 69) / 12);
  }
  void noteRank;
  const upTo = (hz) => (cutoff >= 20000 ? 99 : Math.max(1, Math.floor((1.5 * cutoff) / hz)));
  return { cutoff, lowestHz: Math.round(lowestHz * 10) / 10, maxHarmonic: upTo(lowestHz), pickedHz: lowestPickedHz && Math.round(lowestPickedHz * 10) / 10, maxHarmonicPicked: lowestPickedHz ? upTo(lowestPickedHz) : upTo(lowestHz) };
}

export const EMPTY_NOTE = '// Add an Output module and wire a sound into it';
export function compile(g) {
  const issues = [];
  let acidNode = null;
  const mutedOut = new Set(); // modules that are silent on purpose (muted, or fed only by muted ones): not worth a warning
  const stack = [];
  const nodeLabel = (n) => MODULES[n.type].title;

  // compile whatever is wired into one input port (first wire). null = nothing / silent.
  function input(n, portId, depth, inline) {
    const ws = wiresInto(g, n.id, portId);
    if (!ws.length) return null;
    if (ws.length > 1 && portsOf(n).find((q) => q.id === portId)?.multi) {   // several cables into one input (Slow, Fast): they play together, as stack(a, b)
      const args = ws.map((w) => compileNode(nodeById(g, w.from.node), depth + 1, false)).filter(Boolean);
      if (!args.length) return null;
      if (args.length === 1) return args[0];
      const m = { node: n.id, role: 'fn' }, parts = [S('stack(', { ...m, note: 'stack(a, b) plays the patterns plugged into this input at the same time; what follows applies to all of them.' })];
      args.forEach((a, i) => { parts.push(NL(depth + 1), ...a); if (i < args.length - 1) parts.push(S(',', m)); });
      parts.push(NL(depth), S(')', m));
      return parts;
    }
    return compileNode(nodeById(g, ws[0].from.node), depth, inline);
  }

  // The number plugged into a knob's cable jack. A Macro is mapped to the knob it drives: "sweep" stretches it across the knob's whole
  // range (.range(lo, hi), with a curve for knobs that are logarithmic), "multiply" scales the knob's own setting (.mul(setting)).
  // A Random: rand (a new number each step or cycle) or perlin (a smooth wander), bent to the dial's own curve and always inside the dial's range.
  function randomTokens(src, spec) {
    const p = src.params, m = { node: src.id, role: 'fn' };
    let lo = Number(p.min), hi = Number(p.max);
    if (lo > hi) [lo, hi] = [hi, lo];
    const bounded = spec && !spec.dyn && Number.isFinite(spec.min) && Number.isFinite(spec.max);
    if (bounded) {
      if (lo < spec.min || hi > spec.max) issues.push({ node: src.id, msg: `Random goes from ${fmt(lo)} to ${fmt(hi)}, but "${spec.label}" only goes from ${fmt(spec.min)} to ${fmt(spec.max)}: it is kept inside that range.` });
      const a = Math.max(lo, spec.min), b = Math.min(hi, spec.max);
      if (a <= b) { lo = a; hi = b; } else { lo = spec.min; hi = spec.max; }
    }
    const glide = p.rate === 'glide', log = !!(bounded && spec.log);
    const base = glide ? 'perlin' : 'rand';
    const toks = [S(base, { ...m, note: glide ? 'perlin is smooth random noise: it drifts between 0 and 1 instead of jumping.' : 'rand is a random number between 0 and 1, different every time it is asked.' })];
    if (log) toks.push(S('.pow(3)', { ...m, note: '.pow(3) bends the random numbers to favour the low end, like this dial\'s own scale does.' }));
    toks.push(S(`.range(${fmt(lo)}, ${fmt(hi)})`, { ...m, note: `.range(${fmt(lo)}, ${fmt(hi)}) stretches 0 to 1 across the range${bounded ? ' of this dial' : ''}.` }));
    if (glide) { if (Number(p.slow) !== 1) toks.push(S(`.slow(${fmt(Number(p.slow))})`, { ...m, note: `.slow(${fmt(Number(p.slow))}) makes the wandering take ${fmt(Number(p.slow))} cycles.` })); }
    else { const n = p.rate === 'cycle' ? 1 : Math.max(1, Math.round(Number(p.steps))); toks.push(S(`.segment(${n})`, { ...m, note: `.segment(${n}) takes ${n} random number${n > 1 ? 's' : ''} per cycle and holds each one until the next.` })); }
    if (p.whole === 'whole') toks.push(S('.round()', { ...m, note: '.round() makes every number a whole number.' }));
    if (!glide && Number(p.loop) > 0) toks.push(S(`.ribbon(${Number(p.loop)}, 1)`, { ...m, role: 'knob', key: 'loop', note: `ribbon(${Number(p.loop)}, 1) takes cycle ${Number(p.loop)} of the randomness and repeats it forever, so it stops changing.` }));
    return toks;
  }

  function numInput(n, spec, value, depth) {
    const ws = wiresInto(g, n.id, 'p:' + spec.key);
    if (!ws.length) return null;
    const src = nodeById(g, ws[0].from.node);
    if (src && src.type === 'macro') {
      const base = compileNode(src, depth, true);
      if (!base) return null;
      const mm = { node: src.id, role: 'fn' };
      if (src.params.mode === 'multiply') return [...base, S(`.mul(${fmt(value)})`, { ...mm, note: `.mul(${fmt(value)}) multiplies the macro by this knob's own setting (${fmt(value)}), so the knob keeps its balance and the macro scales it.` })];
      return [...base, S(`${spec.log ? '.pow(3)' : ''}.range(${fmt(spec.min)}, ${fmt(spec.max)})`, { ...mm, note: `.range(${fmt(spec.min)}, ${fmt(spec.max)}) stretches the macro (0 to 1) across this knob's whole range${spec.log ? '; .pow(3) bends it so the low end gets more room, like the knob does' : ''}.` })];
    }
    if (src && src.type === 'random') return randomTokens(src, spec);
    if (src && src.type === 'numpat' && Number.isFinite(spec.min) && Number.isFinite(spec.max) && !spec.dyn) {   // a pattern whose numbers do not fit the dial it drives
      const bad = [...new Set(String(src.params.text || '').split(/[\s\[\]<>,|()]+/).map((t) => /^-?\d*\.?\d+/.exec(t)?.[0]).filter((x) => x !== undefined).map(Number).filter((v) => v < spec.min || v > spec.max))];
      if (bad.length) issues.push({ node: src.id, msg: `Number Pattern has ${bad.join(', ')}, but "${spec.label}" only goes from ${fmt(spec.min)} to ${fmt(spec.max)}` });
    }
    return input(n, 'p:' + spec.key, depth, true);
  }

  // one method call carrying a knob: .lpf(800) or .lpf(sine.range(200, 2000).slow(4))
  function knobCall(n, spec, name, depth, opts = {}) {
    const p = n.params;
    const meta = { node: n.id, role: 'knob', key: spec.key };
    const value = p[spec.key];
    const wired = spec.wire ? numInput(n, spec, value, depth) : null;
    const say = wired
      ? `${name}(…) — the "${spec.label}" knob is driven by a number cable, so it changes while playing.`
      : opts.say || `${name}(${fmt(value)}) — the "${spec.label}" knob.`;
    if (wired) return [S(`.${name}(`, { ...meta, note: say }), ...wired.map((x) => ({ ...x, role: x.role })), S(')', meta)];
    if (!(spec.always || value !== spec.def)) return null;
    if (n.type === 'distortion' && spec.key === 'amount' && value === 0) return null;   // distort(0) is not "no distortion" (it turns the sound down): 0 means the knob is not used, so nothing is written
    const txt = spec.str ? q(value) : fmt(value);
    return [S(`.${name}(${txt})`, { ...meta, note: say })];
  }

  function paramCalls(n, depth, skip = []) {
    const def = MODULES[n.type];
    const calls = [];
    for (const spec of def.params) {
      if (!spec.call || skip.includes(spec.key)) continue;
      if (spec.onlyWave && n.params.wave !== spec.onlyWave) continue;
      if (spec.key === 'name') continue;
      if (n.type === 'fm' && /^(attack|decay|sustain)[2-4]?$/.test(spec.key)) continue;   // the brightness envelopes are written together, below
      const c = knobCall(n, spec, spec.call, depth, { say: SAY[spec.call]?.(n.params[spec.key], spec) });
      if (c) calls.push(c);
    }
    if (n.type === 'fm') {
      // Each operator's brightness envelope: Strudel only applies one once a fm envelope call is present, and gives the missing stages odd defaults,
      // so all three are written together, and only when the brightness is not steady (sustain below 1, or an attack).
      const pick = (key) => def.params.find((x) => x.key === key);
      for (const k of [1, 2, 3, 4]) {
        const sfx = k === 1 ? '' : String(k), A = pick('attack' + sfx), D = pick('decay' + sfx), Sx = pick('sustain' + sfx);
        const on = n.params[Sx.key] !== 1 || n.params[A.key] > 0;   // sustain 1 with no attack is a steady brightness: the same as no envelope, so nothing is written
        if (!on) continue;
        const say = (what) => `${what} — the brightness of operator ${k}'s modulation over the note (${k === 1 ? 'the one you hear moving' : 'drawn in the FM module'}).`;
        if (n.params[A.key] > 0) { const c = knobCall(n, { ...A, always: true }, A.call, depth, { say: say(`${A.call}(${fmt(n.params[A.key])}) is the time to reach full strength`) }); if (c) calls.push(c); }
        for (const sp of [D, Sx]) { const c = knobCall(n, { ...sp, always: true }, sp.call, depth, { say: say(`${sp.call}(${fmt(n.params[sp.key])}) is the ${sp === D ? 'time to fall to the sustain level' : 'level it holds'}`) }); if (c) calls.push(c); }
      }
    }
    return calls;
  }

  // "steady pace": more than 8 steps keep the pace of an 8-step cycle, so the loop spans several cycles: "[ ... ]/2"
  const paceWrap = (p) => (p.mode === 'pace' && p.steps > 8 ? ['[', `]/${fmt(p.steps / 8)}`] : ['', '']);
  const paceCall = (n, m) => (n.params.mode === 'pace' && n.params.steps > 8 ? [S(`.slow(${fmt(n.params.steps / 8)})`, { ...m, role: 'fn', note: `slow(${fmt(n.params.steps / 8)}): the steps keep the pace of an 8-step cycle, so ${n.params.steps} steps take ${fmt(n.params.steps / 8)} cycles.` })] : null);

  function stepTokens(n, deg = false) {
    const { steps, cells, mode } = n.params;
    const pitched = n.type === 'melody';
    const tokens = [];
    for (let i = 0; i < steps; i++) {
      const c = cells[i];
      const len = Math.max(1, Math.min(c.len || 1, steps - i));
      const rest = !stepHas(c, deg, pitched);
      tokens.push({ step: i, rest, cell: c, len: rest ? 1 : len, vel: c.vel ?? 1 });
      i += (rest ? 1 : len) - 1;
    }
    return { tokens, wrap: mode === 'turns' ? ['<', '>'] : paceWrap(n.params) };
  }

  // ---- harmonics on some notes only ----
  const pcOfName = (w) => { const m = /^([a-g])([#b]?)(-?\d+)?$/i.exec(String(w)); return m ? (({ c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 })[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12 : -1; };
  // the notes that feed a Harmonics module, when the pattern can be read from the module itself: Harmonics <- effects <- Instrument <- Melody Sequencer or Note Pattern, with nothing that moves notes in time in between
  function accentSource(n) {
    let cur = n;
    for (let hop = 0; hop < 8; hop++) {
      const w = wiresInto(g, cur.id, 'in')[0], src = w && nodeById(g, w.from.node);
      if (!src) return { ok: false, why: 'nothing is plugged in' };
      if (src.type === 'synth') {
        if (wiresInto(g, src.id, 'rhythm').length) return { ok: false, why: 'a rhythm cable moves the notes' };
        const w2 = wiresInto(g, src.id, 'in')[0], s2 = w2 && nodeById(g, w2.from.node);
        if (!s2) return { ok: false, why: 'the Instrument has no notes' };
        if (s2.type === 'melody' || s2.type === 'notetext') return { ok: true, node: s2 };
        return { ok: false, why: `${MODULES[s2.type].title} sits between the notes and the Instrument` };
      }
      if (MODULES[src.type]?.cat !== 'effect' || src.type === 'orbit' || src.type === 'duck') return { ok: false, why: `${MODULES[src.type]?.title || 'a module'} sits between the Instrument and Harmonics` };
      cur = src;
    }
    return { ok: false, why: 'too many modules in between' };
  }
  // the same steps as the notes, with `hi` where the note is one of the picked pitch classes (a chord counts when any of its notes is) and `lo` elsewhere; rests stay rests. null when that cannot be done.
  function noteMask(srcNode, picked, hi, lo) {
    const word = (names) => (names.some((nm) => picked.has(pcOfName(nm))) ? fmt(hi) : fmt(lo));
    if (srcNode.type === 'melody') {
      const key = effectiveKey(g, srcNode), { tokens, wrap } = stepTokens(srcNode, !!key);
      const leaf = (lf) => { const ns = cellNotes(lf, !!key); if (!ns.length) return '~'; return word(key ? ns.map((d) => degreeName(key, d)) : ns.map(String)); };
      return wrap[0] + tokens.map((t) => stepText(t, leaf)).join(' ') + wrap[1];
    }
    const text = String(srcNode.params.text || '');
    if (/(^|[\s\[<,])-?\d/.test(text) || /[a-z]{2,}/i.test(text.replace(/[a-g][#b]?-?\d/gi, ''))) return null;   // numbers or other words: not plain note names
    if (/,/.test(text.replace(/\[[a-g][#b]?-?\d(?:\s*,\s*[a-g][#b]?-?\d)+\]/gi, ''))) return null;   // stacks that are not a plain chord
    return text.replace(/\[([a-g][#b]?-?\d(?:\s*,\s*[a-g][#b]?-?\d)+)\]|([a-g][#b]?-?\d)/gi, (m0, chord, one) => word(chord ? chord.split(',').map((x) => x.trim()) : [one]));
  }

  function seqString(n, tokens, wrap, text, extra) {
    const meta = { node: n.id, role: 'mini', ...extra };
    const parts = [S('"' + wrap[0], meta)];
    tokens.forEach((t, i) => {
      if (i) parts.push(S(' ', meta));
      parts.push(S(text(t), { ...meta, step: t.step }));
    });
    parts.push(S(wrap[1] + '"', meta));
    return parts;
  }

  function compileNode(n, depth, inline) {
    if (!n) return null;
    if (stack.includes(n.id)) {
      issues.push({ node: n.id, msg: 'feedback loop — cable ignored' });
      return null;
    }
    stack.push(n.id);
    try {
      return compileInner(n, depth, inline);
    } finally {
      stack.pop();
    }
  }

  function compileInner(n, depth, inline) {
    if (n.muted && MUTE_KIND[n.type]) {
      if (MUTE_KIND[n.type] === 'bypass') return input(n, 'in', depth, inline);
      mutedOut.add(n.id);
      return null;
    }
    const def = MODULES[n.type];
    const p = n.params;
    const m = { node: n.id };

    switch (n.type) {
      case 'melody': {
        const key = effectiveKey(g, n);
        const { tokens, wrap } = stepTokens(n, !!key);
        const noteLeaf = (lf) => { const ps = cellNotes(lf, !!key).slice().sort((a, b) => (key ? a - b : 0)); return ps.length ? (ps.length > 1 ? `[${ps.join(',')}]` : String(ps[0])) : '~'; };
        const text = (t) => stepText(t, noteLeaf);
        const say = key
          ? `n("…") is the melody as scale degrees: 0 is the key's root note, 1 the next note of the scale, and so on (negative numbers go below). ~ is a rest; [0,2,4] is a chord${p.mode === 'turns' ? '; <> plays one step per cycle' : ''}.`
          : `note("…") is the melody. Each word is a step; ~ is a rest; [c3,e3,g3] plays several notes at once; [a b] squeezes steps into one slot; *2 repeats${p.mode === 'turns' ? '; <> plays one step per cycle' : ''}.`;
        const base = [S(key ? 'n(' : 'note(', { ...m, role: 'fn', note: say }), ...seqString(n, tokens, wrap, text), S(')', m)];
        const calls = [];
        if (key) {
          const sc = scaleCode(key.root, key.scale);
          calls.push([S(`.scale(${q(sc)})`, { node: key.node, role: 'knob', key: 'scale', note: `scale("${sc}") turns the degrees into real notes of ${key.root} ${key.scale}. Change the key and every melody using it follows.` })]);
        }
        if (tokens.some((t) => !t.rest && t.vel !== 1)) {
          const vs = seqString(n, tokens, wrap, (t) => stepText(t, (lf) => (cellNotes(lf, !!key).length ? fmt(t.vel) : '~')), { role: 'vel' });
          calls.push([S('.velocity(', { ...m, role: 'fn', note: 'velocity("…") sets how hard each step is played (0 to 1), in the same step order.' }), ...vs, S(')', m)]);
        }
        return chain(base, calls, depth, inline);
      }
      case 'hitpattern': return [S('/* Hit Pattern */ ', { ...m, role: 'comment', note: 'A comment that says this rhythm came from a Hit Pattern module, so pasting the code back brings the module back.' }), S(q(String(p.text || 'x').trim() || 'x'), { ...m, role: 'mini', note: 'a rhythm in mini-notation: x is a hit, ~ a rest, @3 holds for 3 steps, *2 repeats, [x x] squeezes two hits into one step.' })];
      case 'notetext': {   // a melody written as text: note("…") with an optional matching .velocity("…")
        const m2 = { ...m, role: 'mini' };
        const base = [S('note(', { ...m, role: 'fn', note: 'note("…") is the melody written out as text. Each word is a step; @3 holds a note for 3 steps; ~ is a rest; [c3,e3,g3] plays several notes at once.' }), S('/* Note Pattern */ ', { ...m, role: 'comment', note: 'A comment that says this melody came from a Note Pattern module, so pasting the code back brings the module back.' }), S(q(String(p.text || '~').trim() || '~'), m2), S(')', m)];
        const calls = [];
        if (String(p.vel || '').trim()) calls.push([S('.velocity(', { ...m, role: 'fn', note: 'velocity("…") sets how hard each step is played (0 to 1). It needs the same steps as the notes.' }), S(q(String(p.vel).trim()), m2), S(')', m)]);
        return chain(base, calls, depth, inline);
      }
      case 'chords': {
        const key = effectiveKey(g, n);
        const meta = { ...m, role: 'mini' };
        const toks = [];
        for (let i = 0; i < p.steps; i++) {
          const c = p.cells[i] || {};
          const sym = key ? chordSymbol(key, c.d) : c.sym;
          const len = sym ? Math.max(1, Math.min(c.len || 1, p.steps - i)) : 1;
          toks.push({ step: i, text: sym ? sym + (len > 1 ? '@' + len : '') : '~' });
          i += len - 1;
        }
        const wrap = p.mode === 'turns' ? ['<', '>'] : ['', ''];
        const str = [S('"' + wrap[0], meta)];
        toks.forEach((t, i) => { if (i) str.push(S(' ', meta)); str.push(S(t.text, { ...meta, step: t.step })); });
        str.push(S(wrap[1] + '"', meta));
        const base = [S('chord(', { ...m, role: 'fn', note: `chord("…") is a progression written as chord names${key ? ', worked out from the Key you plugged in' : ''}: C is C major, Am is A minor, G7 is G seventh, ^7 is major seventh.${p.mode === 'turns' ? ' <> plays one chord per cycle.' : ''}` }), ...str, S(')', m)];
        const calls = [];
        if (p.register) calls.push([S(`.mode(${q(p.register)})`, { ...m, role: 'knob', key: 'register', note: `mode("${p.register}") places the chords ${p.register.endsWith('c3') ? 'low' : p.register.endsWith('c4') ? 'in the middle' : 'high'}: the notes start above ${p.register.slice(6)}.` })]);
        calls.push([S('.voicing()', { ...m, role: 'fn', note: 'voicing() turns each chord name into real notes, spaced so one chord flows smoothly into the next.' })]);
        return chain(base, calls, depth, inline);
      }
      case 'arp': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'notes');
        const pat = p.style === 'custom' ? p.custom || '0 1 2' : p.style;
        return chain(up, [[S('.arp(', { ...m, role: 'fn', note: `arp("${pat}") plays the chord's notes one at a time: 0 is the lowest note, 1 the next one up, and so on.` }), S(q(pat), { ...m, role: 'mini' }), S(')', m)]], depth, inline);
      }
      case 'rhythm': {
        const { tokens, wrap } = stepTokens(n);
        return seqString(n, tokens, wrap, (t) => stepText(t, (lf) => (lf.on ? 'x' : '~')), {});
      }
      case 'drums': {
        const live = p.tracks.map((t, ti) => ({ t, ti })).filter(({ t }) => !t.mute && t.cells.some((c) => stepHas(c, false, false)));
        if (!live.length) return silent(n, 'grid (no hits placed)');
        const trackExpr = ({ t, ti }, d) => {
          const meta = { ...m, role: 'mini', track: ti };
          const pw = paceWrap(p);
          const toks = [S('"' + pw[0], meta)];
          t.cells.forEach((c, i) => { if (i) toks.push(S(' ', meta)); toks.push(S(stepText({ step: i, rest: !stepHas(c, false, false), cell: c, len: 1 }, (lf) => (lf.on ? 'x' : '~')), { ...meta, step: i })); });
          toks.push(S(pw[1] + '"', meta));
          const base = [S('s(', { ...m, role: 'fn', note: `s("${t.name}") is this drum row's sound.` }), S(q(t.name), meta), S(')', m)];
          const struct = [S('.struct(', { ...m, role: 'fn', note: 'struct("x ~ x") is the row of steps: x = hit, ~ = silence.' }), ...toks, S(')', m)];
          return chain(base, [struct], d, inline);
        };
        const calls = paramCalls(n, depth);
        if (live.length === 1) return chain(trackExpr(live[0], depth), calls, depth, inline);
        const parts = [S('stack(', { ...m, role: 'fn', note: 'stack(a, b) plays the drum rows at the same time.' })];
        live.forEach((x, i) => {
          parts.push(NL(depth + 1), ...trackExpr(x, depth + 1));
          if (i < live.length - 1) parts.push(S(',', m));
        });
        parts.push(NL(depth), S(')', m));
        return chain(parts, calls, depth, inline);
      }
      case 'acid': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        acidNode = acidNode || n;
        const spec = def.params[0];
        const c = knobCall(n, spec, 'acidenv', depth, { say: `acidenv(${fmt(p.amount)}) is the squelch: the filter opens by ${fmt(p.amount)} × 9 on each note, then falls back (decay 0.12). It is defined at the top of the code.` });
        return chain(up, [c], depth, inline);
      }
      case 'duck': {
        const compileAll = (port) => wiresInto(g, n.id, port).map((w) => compileNode(nodeById(g, w.from.node), depth + 1, false)).filter(Boolean);
        const triggers = compileAll('kick'), leads = compileAll('lead');
        if (!triggers.length) return silent(n, 'trigger');
        if (!leads.length) return silent(n, 'ducked');
        const orbit = String(p.orbit);
        const trigCalls = [
          [S(`.duck(${q(orbit)})`, { ...m, role: 'knob', key: 'orbit', note: `duck("${orbit}") makes this sound push down whatever plays on orbit ${orbit}.` })],
          knobCall(n, def.params[1], 'duckdepth', depth + 1, { say: `duckdepth(${fmt(p.depth)}) is how far the ducked sound dips (1 = silent).` }),
          knobCall(n, def.params[2], 'duckattack', depth + 1, { say: `duckattack(${fmt(p.attack)}) is how long, in seconds, the ducked sound takes to swell back.` }),
        ];
        const leadCall = [[S(`.orbit(${orbit})`, { ...m, role: 'knob', key: 'orbit', note: `orbit(${orbit}) puts this sound on mix bus ${orbit}, the one the triggers duck.` })]];
        // the ducked sounds come first: an orbit only exists once something has played on it, and a trigger that fires before that logs "duck target orbit N does not exist"
        const items = [...leads.map((l) => chain(l, leadCall, depth + 1, false)), ...triggers.map((t) => chain(t, trigCalls, depth + 1, false))];
        const parts = [S('stack(', { ...m, role: 'fn', note: 'stack(a, b) plays the trigger and ducked sounds together; each trigger dips the sounds on the ducked orbit.' })];
        items.forEach((it, i) => { parts.push(NL(depth + 1), ...it); if (i < items.length - 1) parts.push(S(',', m)); });
        parts.push(NL(depth), S(')', m));
        return parts;
      }
      case 'pianoroll': case 'punchcard': case 'spiral': case 'pitchwheel': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'watch');
        return up; // a view: nothing is written to the code
      }
      case 'scope': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'watch');
        const id = scopeId(g, n);
        return chain(up, [[S(`.analyze(${id})`, { ...m, role: 'fn', note: `analyze(${id}) sends a copy of this sound to analyser ${id}, which the Scope module draws.` })]], depth, inline);
      }
      case 'synth': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'notes');
        const trig = input(n, 'rhythm', depth, true);
        if (!trig && wiresInto(g, n.id, 'rhythm').length) return silent(n, 'rhythm');
        const calls = [];
        if (trig) calls.push([S('.struct(', { ...m, role: 'fn', note: 'struct("x ~ x") puts the rhythm from the wire on the notes: x = hit, ~ = silence. Each hit plays the note that sits at that point of the cycle.' }), ...trig, S(')', m)]);
        calls.push(...paramCalls(n, depth));
        return chain(up, calls, depth, inline);
      }
      case 'codesource': {   // a whole pattern written as code, kept as written (see the Strudel Code (pattern) module)
        const t = String(p.code || '').trim();
        if (!t) return silent(n, 'code');
        const bad = guardCode(t);
        if (bad) { issues.push({ node: n.id, msg: 'Strudel Code (pattern) left out: ' + bad }); return silent(n, 'code'); }
        return [S(t, { ...m, role: 'fn', note: 'Strudel code kept exactly as written: this module holds a whole pattern that has no modules of its own.' })];
      }
      case 'sample': {
        const calls = [];
        const trig = input(n, 'in', depth, true);
        if (!trig && wiresInto(g, n.id, 'in').length) return silent(n, 'rhythm');
        const name = p.name || 'bd';
        const base = [S('s(', { ...m, role: 'fn', note: `s("${name}") plays the sample(s) named inside. Mini-notation: *2 repeats, [a b] squeezes steps into one, ~ rests.` }), S(q(name), { ...m, role: 'mini' }), S(')', m)];
        if (trig && /[\s*\[\]~<>!?@(,]/.test(name.trim())) {
          const rhythmy = /[*\[\]~<>!?@(]/.test(name);
          if (rhythmy) issues.push({ node: n.id, msg: `Sample: the rhythm cable decides the timing, so the repeats/brackets in "${name}" no longer work as written. Keep only sound names here.` });
        }
        if (trig) calls.push([S('.struct(', { ...m, role: 'fn', note: 'struct("x ~ x") imposes the rhythm from the wire: x = hit, ~ = silence. Each hit plays whichever sound sits at that point of the cycle.' }), ...trig, S(')', m)]);
        if (p.fit === 'on') calls.push([S('.fit()', { ...m, role: 'knob', key: 'fit', note: 'fit() stretches the sample so it lasts exactly as long as its step: a loop then fills the whole cycle.' })]);
        calls.push(...paramCalls(n, depth, ['name']));
        return chain(base, calls, depth, inline);
      }
      case 'fast': case 'slow': case 'ply': case 'late': case 'clip': case 'degrade': case 'transpose': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        const c = knobCall(n, def.params[0], def.params[0].call, depth, { say: SAY[def.params[0].call](p.n) });
        return chain(up, [c], depth, inline);
      }
      case 'code': {   // method calls kept as written (see the Strudel Code module)
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        const t = String(p.code || '').trim();
        if (!t) return up;
        const bad = guardCalls(t);
        if (bad) { issues.push({ node: n.id, msg: 'Strudel Code left out: ' + bad }); return up; }
        return chain(up, [[S(t, { ...m, role: 'fn', note: 'Strudel code kept exactly as written: this module holds method calls that have no module of their own.' })]], depth, inline);
      }
      case 'notefilter': {   // only some notes (or all but them): the same steps as the notes, high where a picked note plays, written as .mask("...")
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        const pk = new Set((Array.isArray(p.pcs) ? p.pcs : []).map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
        if (!pk.size) { issues.push({ node: n.id, msg: 'Note filter: no notes are picked, so every note passes. Pick the notes on the little keyboard.' }); return up; }
        const w0 = wiresInto(g, n.id, 'in')[0], src0 = w0 && nodeById(g, w0.from.node);
        const txt = src0 && (src0.type === 'melody' || src0.type === 'notetext') ? (p.mode === 'except' ? noteMask(src0, pk, 0, 1) : noteMask(src0, pk, 1, 0)) : null;
        if (!txt) { issues.push({ node: n.id, msg: `Note filter: it needs to be plugged straight into a Melody Sequencer or a Note Pattern with plain note names${src0 && !['melody', 'notetext'].includes(src0.type) ? ` (${MODULES[src0.type]?.title || 'this module'} is in the way)` : ''}, so every note passes.` }); return up; }
        return chain(up, [[S('.mask(', { ...m, role: 'fn', note: 'mask("1 0 1") keeps the notes where it says 1 and silences the others. Here it is 1 on the picked notes.' }), S(q(txt), { ...m, role: 'mini' }), S(')', m)]], depth, inline);
      }
      case 'rev': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        return chain(up, [[S('.rev()', { ...m, role: 'fn', note: SAY.rev() })]], depth, inline);
      }
      case 'swing': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        return chain(up, [[S(`.swingBy(${fmt(p.amount)}, ${fmt(p.slices)})`, { ...m, role: 'knob', key: 'amount', note: SAY.swingBy(p.amount, p.slices) })]], depth, inline);
      }
      case 'euclid': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        const pulses = Math.min(p.pulses, p.steps);
        return chain(up, [[S(`.euclid(${pulses},${p.steps})`, { ...m, role: 'knob', key: 'pulses', note: `euclid(${pulses},${p.steps}) spreads ${pulses} hits as evenly as possible over ${p.steps} steps.` })]], depth, inline);
      }
      case 'randnotes': {
        const key = effectiveKey(g, n);
        const sc = `${key.root}${p.octave}:${String(key.scale).replace(/ /g, ':')}`;
        const base = [S('n(', { ...m, role: 'fn', note: 'n(…) with .scale() writes notes as steps of a scale: 0 is the root, 1 the next note, and so on.' }),
          S(`irand(${p.range}).segment(${p.steps})`, { ...m, role: 'knob', key: 'range', note: `irand(${p.range}) picks a random whole number from 0 to ${p.range - 1}: a step of the scale. segment(${p.steps}) takes ${p.steps} of them per cycle. It picks again on every cycle, so the melody is new each time.` }),
          S(')', m)];
        const calls = [[S(`.scale(${q(sc)})`, { ...m, role: 'fn', note: `scale("${sc}") turns the numbers into notes of ${key.root} ${key.scale}, starting at octave ${p.octave}.${key.wired ? ' The key comes from the Key module plugged in.' : ''}` })]];
        if (p.loop > 0) calls.push([S(`.ribbon(${p.loop}, 1)`, { ...m, role: 'knob', key: 'loop', note: `ribbon(${p.loop}, 1) takes cycle ${p.loop} of the random melody and repeats it forever, so it stops changing.` })]);
        { const pc = paceCall(n, m); if (pc) calls.push(pc); }
        return chain(base, calls, depth, inline);
      }
      case 'randrhythm': {
        const d = Math.min(1, Math.max(0.05, Number(p.density)));
        const mm = { ...m, role: 'mini', key: 'density' };
        const txt = `x*${p.steps}${d < 1 ? '?' + fmt(+(1 - d).toFixed(4)) : ''}`;
        const toks = [S('"', mm), S(txt, { ...mm, note: `"${txt}" is ${p.steps} steps per cycle${d < 1 ? `; the ?${fmt(+(1 - d).toFixed(4))} drops each step at random ${Math.round((1 - d) * 100)}% of the time, differently on every cycle` : ''}.` }), S('"', mm)];
        if (p.loop > 0) toks.push(S(`.ribbon(${p.loop}, 1)`, { ...m, role: 'knob', key: 'loop', note: `ribbon(${p.loop}, 1) takes cycle ${p.loop} of the random rhythm and repeats it forever, so it stops changing.` }));
        { const pc = paceCall(n, m); if (pc) toks.push(...pc); }
        return toks;
      }
      case 'shuffle': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        const mode = p.mode === 'scramble' ? 'scramble' : 'shuffle';
        const calls = [[S(`.${mode}(${p.n})`, { ...m, role: 'knob', key: 'n', note: mode === 'shuffle' ? `shuffle(${p.n}) cuts the cycle into ${p.n} slices and plays each exactly once, in a new order every cycle.` : `scramble(${p.n}) cuts the cycle into ${p.n} slices and plays ${p.n} of them picked at random, so some repeat and some are missing.` })]];
        if (p.loop > 0) calls.push([S(`.ribbon(${p.loop}, 1)`, { ...m, role: 'knob', key: 'loop', note: `ribbon(${p.loop}, 1) takes cycle ${p.loop} and repeats it forever, so the order stops changing.` })]);
        return chain(up, calls, depth, inline);
      }
      case 'sometimes': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        const f = SOMETIMES_FNS[p.fn] || SOMETIMES_FNS.ply2;
        if (f.notesOnly && outType(g, n.id) !== 'notes') issues.push({ node: n.id, msg: 'an octave jump in Sometimes only makes sense for notes' });
        const calls = [[S(`.sometimesBy(${fmt(p.p)}, ${f.code})`, { ...m, role: 'knob', key: 'p', note: `sometimesBy(${fmt(p.p)}, …) ${f.say} for about ${Math.round(p.p * 100)}% of the events, picked at random, and leaves the others alone.` })]];
        if (p.loop > 0) calls.push([S(`.ribbon(${p.loop}, 1)`, { ...m, role: 'knob', key: 'loop', note: `ribbon(${p.loop}, 1) takes cycle ${p.loop} and repeats it forever, so the choices stop changing.` })]);
        return chain(up, calls, depth, inline);
      }
      case 'every': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        const f = EVERY_FNS[p.fn] || EVERY_FNS.rev;
        if (f.notesOnly && outType(g, n.id) !== 'notes') issues.push({ node: n.id, msg: 'transpose in Every N only makes sense for notes' });
        return chain(up, [[S(`.every(${p.n}, ${f.code})`, { ...m, role: 'knob', key: 'n', note: `every(${p.n}, …) every ${p.n}th cycle ${f.say}; other cycles play unchanged.` })]], depth, inline);
      }
      case 'stack': case 'cat': {
        const args = [];
        for (let i = 1; i <= p.n; i++) {
          const a = input(n, 'in' + i, depth + 1, false);
          if (a) args.push(a);
        }
        if (!args.length) return silent(n, 'inputs');
        const fn = n.type;
        const say = n.type === 'stack' ? 'stack(a, b) plays the patterns at the same time.' : 'cat(a, b) plays one pattern per cycle, in order, then starts over.';
        const parts = [S(fn + '(', { ...m, role: 'fn', note: say })];
        args.forEach((a, i) => {
          parts.push(NL(depth + 1), ...a);
          if (i < args.length - 1) parts.push(S(',', m));
        });
        parts.push(NL(depth), S(')', m));
        return parts;
      }
      case 'mixer': {
        const strips = p.strips || [];
        const wired = [];
        for (let i = 1; i <= p.n; i++) if (wiresInto(g, n.id, 'in' + i).length) wired.push(i);
        const anySolo = wired.some((i) => strips[i - 1]?.solo);
        const args = [];
        for (const i of wired) {
          const st = strips[i - 1] || { vol: 1, pan: 0.5 };
          if (st.mute || (anySolo && !st.solo)) continue;
          const a = input(n, 'in' + i, depth + 1, false);
          if (!a) continue;
          const calls = [];
          const mm = { ...m, role: 'knob', key: 'strips', step: i - 1 };
          if (st.vol !== 1) calls.push([S(`.postgain(${fmt(st.vol)})`, { ...mm, note: `postgain(${fmt(st.vol)}) is this strip's fader: it scales the part after its effects (1 = unchanged).` })]);
          if (st.pan !== 0.5) calls.push([S(`.pan(${fmt(st.pan)})`, { ...mm, note: `pan(${fmt(st.pan)}) is this strip's pan: 0 left, 0.5 middle, 1 right. It replaces any pan the part set itself.` })]);
          args.push(chain(a, calls, depth + 1, false));
        }
        if (!args.length) { if (wired.length) mutedOut.add(n.id); else issues.push({ node: n.id, msg: 'Mixer has nothing plugged into it — silent' }); return null; }
        const parts = [S('stack(', { ...m, role: 'fn', note: 'stack(a, b) plays the parts at the same time; each strip adds its own .postgain() (fader) and .pan(). Muted strips, and strips silenced by a solo, are left out.' })];
        args.forEach((a, i) => { parts.push(NL(depth + 1), ...a); if (i < args.length - 1) parts.push(S(',', m)); });
        parts.push(NL(depth), S(')', m));
        return parts;
      }
      case 'arrange': {
        const args = [];
        const ow = wiresInto(g, n.id, 'order')[0], osrc = ow && nodeById(g, ow.from.node);
        if (osrc && osrc.type === 'numpat') {   // a Number Pattern decides which section plays when, and for how many cycles
          const plan = parseArrangeOrder(osrc.params.text, p.n, p.lens);
          plan.problems.forEach((msg) => issues.push({ node: osrc.id, msg: 'Arrange order: ' + msg }));
          const empty = new Set();
          for (const { sec, len } of plan.items) {
            const a = input(n, 'in' + sec, depth + 1, false);   // written out again for each time the section plays
            if (a) args.push({ a, len });
            else if (!empty.has(sec)) { empty.add(sec); issues.push({ node: n.id, msg: `Arrange order: section ${sec} has nothing plugged into it, so it is left out` }); }
          }
        } else {
          if (osrc) issues.push({ node: osrc.id, msg: 'Arrange order needs a Number Pattern (for example 1@4 2@8 1@4); other number sources are not used here' });
          for (let i = 1; i <= p.n; i++) {
            const a = input(n, 'in' + i, depth + 1, false);
            if (a) args.push({ a, len: Math.max(1, Math.round(Number(p.lens?.[i - 1]) || 4)) });
          }
        }
        if (!args.length) return silent(n, 'inputs');
        const parts = [S('arrange(', { ...m, role: 'fn', note: 'arrange([4, a], [8, b]) plays a for 4 cycles, then b for 8, then starts over: the sections of a song.' })];
        args.forEach(({ a, len }, i) => {
          parts.push(NL(depth + 1), S('[' + len + ', ', { ...m, role: 'knob', key: 'lens', note: `${len} is how many cycles this section lasts before the next one starts.` }), ...a, S(']', m));
          if (i < args.length - 1) parts.push(S(',', m));
        });
        parts.push(NL(depth), S(')', m));
        return parts;
      }
      case 'filter': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        const t = p.type;
        const calls = [];
        const cut = knobCall(n, def.params[1], t, depth, { say: `${t}(${fmt(p.cutoff)}) ${{ lpf: 'lets frequencies below', hpf: 'lets frequencies above', bpf: 'lets frequencies around' }[t]} ${fmt(p.cutoff)} Hz through.` });
        calls.push(cut);
        if (p.q !== 1) calls.push([S(`.${t.replace('f', 'q')}(${fmt(p.q)})`, { ...m, role: 'knob', key: 'q', note: `${t.replace('f', 'q')}(${fmt(p.q)}) is the resonance: a boost right at the cutoff.` })]);
        if (p.ftype !== '12db') calls.push([S(`.ftype(${q(p.ftype)})`, { ...m, role: 'knob', key: 'ftype', note: `ftype("${p.ftype}") changes the filter's slope: ${p.ftype === 'ladder' ? 'the ladder filter is more aggressive' : '24 dB falls off more steeply than the default 12 dB'}.` })]);
        if (p.env > 0) {
          const pre = t.slice(0, 2);
          const E = (key, call, v, say) => [S(`.${pre}${call}(${fmt(v)})`, { ...m, role: 'knob', key, note: say })];
          calls.push(E('env', 'env', p.env, `${pre}env(${fmt(p.env)}) opens the filter by ${fmt(p.env)} on every note, then it falls back: the squelch.`));
          calls.push(E('fa', 'a', p.fa, `${pre}a(${fmt(p.fa)}) is how long the filter takes to open.`));
          calls.push(E('fd', 'd', p.fd, `${pre}d(${fmt(p.fd)}) is how long it takes to fall back.`));
          calls.push(E('fs', 's', p.fs, `${pre}s(${fmt(p.fs)}) is the level it settles at.`));
        }
        return chain(up, calls, depth, inline);
      }
      case 'tremolo': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        const name = p.sync === 'sync' ? 'tremolosync' : 'tremolo';
        const unit = p.sync === 'sync' ? 'per cycle, locked to the tempo' : 'Hz';
        const rate = knobCall(n, def.params[1], name, depth, { say: `${name}(${fmt(p.rate)}) wobbles the volume ${fmt(p.rate)} times ${p.sync === 'sync' ? 'per cycle, locked to the tempo' : 'per second'}.` });
        return chain(up, [rate, ...paramCalls(n, depth)], depth, inline);
      }
      case 'phaser': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        const rate = knobCall(n, def.params[0], 'phaser', depth, { say: `phaser(${fmt(p.rate)}) sweeps the phaser ${fmt(p.rate)} times per second.` });
        return chain(up, [rate, ...paramCalls(n, depth)], depth, inline);
      }
      case 'compressor': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        const v = [p.threshold, p.ratio, p.knee, p.attack, p.release].map(fmt).join(':');
        return chain(up, [[S(`.compressor(${q(v)})`, { ...m, role: 'knob', key: 'threshold', note: `compressor("${v}") is threshold:ratio:knee:attack:release. Sounds louder than ${fmt(p.threshold)} dB are turned down ${fmt(p.ratio)} to 1.` })]], depth, inline);
      }
      case 'orbit': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        // a Duck puts its ducked sounds on an orbit of its own, which would override this one
        const seen = new Set(), todo = [n.id];
        while (todo.length) { const id = todo.pop(); for (const w of g.wires) if (w.from.node === id && !seen.has(w.to.node)) { seen.add(w.to.node); if (nodeById(g, w.to.node)?.type === 'duck' && w.to.port === 'lead') issues.push({ node: n.id, msg: 'this Orbit feeds a Duck, which sets its own orbit and overrides it' }); todo.push(w.to.node); } }
        return chain(up, [[S(`.orbit(${p.n})`, { ...m, role: 'knob', key: 'n', note: `orbit(${p.n}) puts this sound on mix bus ${p.n}: reverb and delay are shared by everything on the same orbit.` })]], depth, inline);
      }
      case 'fx': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        const off = def.params.filter((s) => s.call && !p[s.key + '_on']).map((s) => s.key);
        return chain(up, paramCalls(n, depth, off), depth, inline);
      }
      case 'take': {   // a recording, written as a pattern (see takecode.js)
        const ev = Array.isArray(p.events) ? p.events : [];
        if (!ev.length) return silent(n, 'recording');
        const r = takeToPattern({ bpm: p.bpm, beatsPerBar: p.beats, events: ev }, { grid: Number(p.grid) || 4 });
        const say = `Your recording "${p.name || 'Take'}": ${r.notes} note${r.notes === 1 ? '' : 's'} over ${r.bars} bar${r.bars === 1 ? '' : 's'}, snapped to the grid and written as a pattern.`;
        // the quoted notes are mini-notation: written as their own pieces, so the code panel lights up each note as it plays (like a Note Pattern)
        const tag = S(`/* Take "${String(p.name || 'Take').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 40)}" snap ${Number(p.grid) || 4} bpm ${Number(p.bpm) || 120} beats ${Number(p.beats) || 4} bars ${r.bars} */ `, { ...m, role: 'comment', note: 'A comment that says this pattern is a recording from a Take module, so pasting the code back brings the Take back.' });
        return [tag, ...r.pattern.split(/("(?:[^"\\]|\\.)*")/).filter((x) => x !== '').map((part) => S(part, part.startsWith('"') ? { ...m, role: 'mini', note: say } : { ...m, role: 'fn', note: say }))];
      }
      case 'harmonics': {   // the loudness of each harmonic: .partials([1, 0.5, 0.33, ...]), optionally louder only on some notes
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        const cl = (v) => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 100) / 100;
        const arr = (Array.isArray(p.partials) ? p.partials : []).slice(0, 16).map(cl), acc = (Array.isArray(p.accent) ? p.accent : []).slice(0, 16).map(cl);
        const picked = new Set((Array.isArray(p.accentNotes) ? p.accentNotes : []).map((v, i) => (v ? i : -1)).filter((i) => i >= 0));
        // extra harmonics on some notes only: the bar of that harmonic becomes a pattern with the same steps as the notes, high where the note is one of the picked ones
        let maskOf = null;
        // "Only some notes": the picked notes use their own bars and every other note keeps the Instrument's own sound (its natural harmonics)
        let instWave = null;
        { let cur = n; for (let hop = 0; hop < 8 && cur; hop++) { const w = wiresInto(g, cur.id, 'in')[0], src = w && nodeById(g, w.from.node); if (!src) break; if (src.type === 'synth') { instWave = src.params.wave; break; } cur = src; } }
        const natural = (k) => (p.base !== 'user' ? 1 : instWave === 'sawtooth' ? 1 / k : instWave === 'square' ? (k % 2 ? 1 / k : 0) : instWave === 'triangle' ? (k % 2 ? 1 / (k * k) : 0) : k === 1 ? 1 : 0);
        const some = p.scope === 'some' && picked.size > 0;
        if (p.scope === 'some' && !picked.size) issues.push({ node: n.id, msg: 'Harmonics: "Only some notes" is on but no notes are picked, so every note keeps the bars of All notes. Pick the notes on the little keyboard.' });
        if (some) {
          const src = accentSource(n);
          maskOf = src && src.ok ? (hi, lo) => noteMask(src.node, picked, hi, lo) : null;
          if (!maskOf || maskOf(1, 0) === null) { issues.push({ node: n.id, msg: `Harmonics: "only some notes" needs the Instrument plugged straight into a Melody Sequencer or a Note Pattern with plain note names${src && !src.ok ? ' (' + src.why + ')' : ''}, so the extra harmonics are left out.` }); maskOf = null; }
        }
        {   // a low-pass filter in front takes the high harmonics away: say so, because then the bars seem to do nothing
          const lim = audibleLimit(g, n, picked.size ? picked : null), useAcc = !!maskOf;
          const loud = (useAcc ? acc.map((v, i) => [i + 1, v, lim.maxHarmonicPicked, lim.pickedHz || lim.lowestHz]) : arr.map((v, i) => [i + 1, v, lim.maxHarmonic, lim.lowestHz])).filter(([k, v, mx]) => v >= 0.05 && k > mx);
          if (lim.cutoff < 20000 && loud.length) { const ks = [...new Set(loud.map((x) => x[0]))].sort((a, b) => a - b); issues.push({ node: n.id, msg: `Harmonics: the filter before this module cuts at ${Math.round(lim.cutoff)} Hz, so harmonic${ks.length === 1 ? '' : 's'} ${ks.join(', ')} (about ${Math.round(Math.min(...loud.map((x) => x[2] * x[3])))} Hz and up on the notes it plays) will come out much quieter or not at all. Raise the Instrument's lpf to hear ${ks.length === 1 ? 'it' : 'them'}.` }); }
        }
        // "All notes": the bars as drawn. "Only some notes": [the picked notes' bar, the Instrument's own bar] for every harmonic
        const pairs = some && maskOf ? Array.from({ length: 16 }, (_, i) => [acc[i] ?? 0, cl(natural(i + 1))]) : arr.map((v) => [v, v]);
        let last = Math.max(pairs.length, 1); while (last > 1 && pairs[last - 1][0] === 0 && pairs[last - 1][1] === 0) last--;
        const items = pairs.slice(0, last).map(([own, other]) => (own === other ? String(own) : JSON.stringify(maskOf(own, other))));
        const calls = [];
        if (p.base !== 'user') {   // filtering only works on the basic waves of the Instrument before this module
          let cur = n, wave = null;
          for (let hop = 0; hop < 8 && cur; hop++) { const w = wiresInto(g, cur.id, 'in')[0], src = w && nodeById(g, w.from.node); if (!src) break; if (src.type === 'synth') { wave = src.params.wave; break; } cur = src; }
          if (wave && !['sawtooth', 'square', 'triangle'].includes(wave)) issues.push({ node: n.id, msg: `Harmonics: filtering only works on a sawtooth, square or triangle wave, and this Instrument plays "${wave}", so you will hear no change. Choose "made from the bars" instead.` });
        }
        if (p.base === 'user') calls.push([S('.s("user")', { ...m, role: 'knob', key: 'base', note: 'sound("user") makes a wave out of nothing but the harmonics listed in partials.' })]);
        calls.push([S(`.partials([${items.join(', ')}])`, { ...m, role: 'knob', key: 'partials', note: 'partials([...]) is how loud each harmonic is: the first number is the note itself, the second the octave above, the third the octave and a fifth, and so on. A harmonic that is not listed is silent. A quoted list of numbers is a pattern with the same steps as the notes: that harmonic is louder only on the notes that were picked.' })]);
        return chain(up, calls, depth, inline);
      }
      case 'delay': case 'reverb': case 'distortion': case 'pan': case 'vibrato': case 'pulsewidth': case 'vowel': case 'djf': case 'lofi': case 'pitchenv': case 'fm': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
        if (n.type === 'djf') {   // Strudel's DJ filter is a filter on the whole orbit (mix bus), so it also filters every other sound that plays on the same orbit
          const before = new Set(), todo = [n.id];
          while (todo.length) { const id = todo.pop(); for (const w of g.wires) if (w.to.node === id && !before.has(w.from.node)) { before.add(w.from.node); todo.push(w.from.node); } }
          const mates = g.nodes.filter((x) => !before.has(x.id) && x.id !== n.id && MODULES[x.type]?.cat === 'source' && !x.muted);
          if (mates.length && ![...before].some((id) => nodeById(g, id)?.type === 'orbit')) issues.push({ node: n.id, msg: `The DJ filter filters the whole orbit it plays on, so it also changes ${mates.length === 1 ? 'the other sound' : 'the other ' + mates.length + ' sounds'} on this board (the drums too). Put an Orbit module (set to 2) in front of it so only this part is filtered.` });
        }
        if (n.type === 'pulsewidth') {   // the width only exists on the pulse oscillator
          const seen = new Set(), todo = [n.id], other = [];
          while (todo.length) {
            const id = todo.pop();
            for (const w of g.wires) {
              if (w.to.node !== id || w.to.port.startsWith('p:') || seen.has(w.from.node)) continue;
              seen.add(w.from.node);
              const u = nodeById(g, w.from.node);
              if (!u) continue;
              if (u.type === 'synth') { if (String(u.params.wave) !== 'pulse') other.push(`the Instrument "${u.params.wave}"`); }
              else if (u.type === 'sample' || u.type === 'drums') other.push(u.type === 'drums' ? 'the Drum Machine' : 'a Sample');
              else todo.push(u.id);
            }
          }
          if (other.length) issues.push({ node: n.id, msg: `Pulse width has no effect on ${[...new Set(other)].join(' and ')}: it only shapes the pulse wave. Set the Instrument's sound to pulse.` });
        }
        if (n.type === 'fm') {   // FM shakes an oscillator, so it does nothing on a recorded sound (a sample, a drum, a gm_ instrument or the piano)
          const seen = new Set(), todo = [n.id], bad = [], bright = [];
          while (todo.length) {
            const id = todo.pop();
            for (const w of g.wires) {
              if (w.to.node !== id || w.to.port.startsWith('p:') || seen.has(w.from.node)) continue;
              seen.add(w.from.node);
              const u = nodeById(g, w.from.node);
              if (!u) continue;
              if (u.type === 'synth') { if (!FM_WAVES.has(String(u.params.wave))) bad.push(`the Instrument "${u.params.wave}"`); else if (['sawtooth', 'saw', 'square', 'sqr', 'supersaw', 'pulse'].includes(String(u.params.wave))) bright.push(u.params.wave); }
              else if (u.type === 'sample' || u.type === 'drums') bad.push(u.type === 'drums' ? 'the Drum Machine' : 'a Sample');
              else todo.push(u.id);
            }
          }
          if (!bad.length && bright.length) issues.push({ node: n.id, msg: `FM on a ${bright[0]} wave is harsh, because the wave already has bright overtones. A sine (or triangle) with a small index (0.5 to 3) is the clean starting point.` });
          if (bad.length) issues.push({ node: n.id, msg: `FM has no effect on ${[...new Set(bad)].join(' and ')}: it is a recorded sound, and FM only shakes a synth wave. Set the Instrument's sound to sine, sawtooth, square, triangle or supersaw.` });
        }
        return chain(up, paramCalls(n, depth), depth, inline);
      }
      case 'macro': {
        const v = Math.min(Math.max(Number(p.value), 0), 1);
        return [S(`slider(${fmt(v)}, 0, 1)`, { ...m, role: 'knob', key: 'value', note: `slider(${fmt(v)}, 0, 1) is the macro: one number from 0 to 1 that you can move. Each knob it drives maps it to its own range.` })];
      }
      case 'slider': {
        const lo = Number(p.min), hi = Number(p.max);
        const val = Math.min(Math.max(p.value, lo), hi);
        return [S(`slider(${fmt(val)}, ${fmt(lo)}, ${fmt(hi)})`, { ...m, role: 'knob', key: 'value', note: `slider(${fmt(val)}, ${fmt(lo)}, ${fmt(hi)}) is a number you can move; in strudel.cc it becomes a real slider.` })];
      }
      case 'random': return randomTokens(n, null);
      case 'wave': {
        const slow = p.slow !== 1 ? `.slow(${fmt(p.slow)})` : '';
        return [S(`${p.shape}.range(${fmt(Number(p.min))}, ${fmt(Number(p.max))})${slow}`, { ...m, role: 'fn', note: `${p.shape}.range(low, high) is a number that moves by itself between low and high${slow ? '; slow() sets how many cycles one sweep takes' : ''}.` })];
      }
      case 'numpat':
        return [S(q(p.text || '0'), { ...m, role: 'mini', note: 'a pattern of numbers; <a b> alternates one per cycle.' })];
      default:
        return null;
    }
  }

  function silent(n, what) {
    if (g.wires.some((w) => w.to.node === n.id && mutedOut.has(w.from.node))) { mutedOut.add(n.id); return null; }
    issues.push({ node: n.id, msg: `${nodeLabel(n)} has nothing plugged into its ${what} input — silent` });
    return null;
  }

  // ---------- top level ----------
  const parts = [];
  const outputs = g.nodes.filter((n) => n.type === 'output');
  const head = [];
  let played = 0;
  for (const o of outputs) {
    const beats = o.params.beats ?? 4;
    head.push(S(`setcpm(${fmt(o.params.bpm)}/${beats})`, { node: o.id, role: 'knob', key: 'bpm', note: `setcpm(${fmt(o.params.bpm)}/${beats}) sets the tempo: ${fmt(o.params.bpm)} beats per minute, ${beats} beats per cycle.` }));
    const ws = wiresInto(g, o.id, 'in')
      .map((w) => ({ w, src: nodeById(g, w.from.node) }))
      .filter((x) => x.src)
      .sort((a, b) => a.src.y - b.src.y || a.src.x - b.src.x || a.src.id.localeCompare(b.src.id));
    const blocks = [];
    for (const { src } of ws) {
      const expr = compileNode(src, 0, false);
      if (!expr) continue;
      blocks.push([S('$: ', { node: o.id, role: 'label', note: '$: starts a pattern that plays in parallel with the other $: lines.' }), ...expr]);
      played++;
    }
    if (!ws.length) issues.push({ node: o.id, msg: 'nothing is wired into Output — silent' });
    parts.push(...head.splice(0));
    const masterCalls = [];
    const mk = (key, name, say) => { if (o.params[key] > 0) masterCalls.push(S(`.${name}(${fmt(o.params[key])})`, { node: o.id, role: 'knob', key, note: say(o.params[key]) })); };
    const volWired = numInput(o, MODULES.output.params.find((s) => s.key === 'mvol'), o.params.mvol, 0);
    // a Mixer sets .postgain() on each strip, and a second .postgain() would replace it, not multiply: with a Mixer the master volume is written as .mul(postgain(v))
    const viaMul = g.nodes.some((x) => x.type === 'mixer'), pgOpen = viaMul ? '.mul(postgain(' : '.postgain(', pgClose = viaMul ? '))' : ')';
    if (volWired) masterCalls.push(S(pgOpen, { node: o.id, role: 'knob', key: 'mvol', note: 'postgain(…) is the master volume, driven by a number cable, so it changes while playing.' }), ...volWired, S(pgClose, { node: o.id, role: 'knob', key: 'mvol' }));
    else if (o.params.mvol !== 1) masterCalls.push(S(`${pgOpen}${fmt(o.params.mvol)}${pgClose}`, { node: o.id, role: 'knob', key: 'mvol', note: `${viaMul ? 'mul(postgain(' + fmt(o.params.mvol) + '))' : 'postgain(' + fmt(o.params.mvol) + ')'} is the master volume: it scales everything after all effects, so every part keeps its balance (1 = unchanged).${viaMul ? ' It multiplies, so the Mixer faders still count.' : ''}` }));
    mk('mphaser', 'phaser', (v) => `phaser(${fmt(v)}) on everything: all() applies it to every pattern.`);
    mk('mtrem', 'tremolo', (v) => `tremolo(${fmt(v)}) on everything.`);
    if (acidNode && !parts.some((x) => x.acidHeader)) parts.push(NL(0), NL(0), { ...S("register('acidenv', (x, pat) => pat.lpf(100).lpenv(x * 9).lps(.2).lpd(.12))", { node: acidNode.id, role: 'fn', note: 'register() teaches Strudel a new method: acidenv(x) = a 100 Hz low-pass whose cutoff opens by x × 9 on each note (lpenv), holds at 20% (lps) and falls over 0.12 s (lpd).' }), acidHeader: true });
    if (masterCalls.length) parts.push(NL(0), NL(0), S('all(x => x', { node: o.id, role: 'fn', note: 'all(x => x.effect()) applies an effect to every pattern at once: a global effect.' }), ...masterCalls, S(')', { node: o.id }));
    for (const b of blocks) parts.push(NL(0), NL(0), ...b);
  }
  if (!outputs.length) parts.push(S(EMPTY_NOTE));
  else if (!played) parts.push(NL(0), NL(0), S('// nothing to play yet: wire a sound into Output'));

  return flatten(parts, issues, played);
}

const FM_SAY = {
  fm3: (v) => `fm3(${fmt(v)}) adds a third modulator that shakes the second: four-operator FM.`,
  fm4: (v) => `fm4(${fmt(v)}) adds a fourth modulator that shakes the third.`,
  fmh3: (v) => `fmh3(${fmt(v)}) is the third modulator's pitch relative to the note.`,
  fmh4: (v) => `fmh4(${fmt(v)}) is the fourth modulator's pitch relative to the note.`,
  fm33: (v) => `fm33(${fmt(v)}) feeds the third modulator back into itself; keep it small.`,
  fm44: (v) => `fm44(${fmt(v)}) feeds the fourth modulator back into itself; keep it small.`,
};
for (const i of [1, 2, 3, 4]) for (const j of [0, 1, 2, 3, 4]) if (j !== i && i !== j + 1) FM_SAY[`fm${i}${j}`] = (v) => `fm${i}${j}(${fmt(v)}) sends modulator ${i} into ${j ? 'modulator ' + j : 'the note'} directly (the FM matrix).`;
const SAY = {
  ...FM_SAY,
  fast: (n) => `fast(${fmt(n)}) plays the pattern ${fmt(n)}× as quickly.`,
  slow: (n) => `slow(${fmt(n)}) stretches the pattern to take ${fmt(n)}× as long.`,
  degradeBy: (n) => `degradeBy(${fmt(n)}) randomly drops about ${Math.round(n * 100)}% of the events, a different set each cycle.`,
  clip: (n) => (Number(n) === 1 ? 'clip(1) makes each note last exactly its step.' : `clip(${fmt(n)}) makes each note last ${fmt(n)}× its step: ${n < 1 ? 'short and detached' : 'long enough to ring on into the next'}. A sample is cut off when the time is up. legato(${fmt(n)}) means the same.`),
  late: (n) => (Number(n) === 0 ? 'late(0) leaves the timing alone.' : `late(${fmt(n)}) nudges every event ${fmt(Math.abs(n))} of a cycle ${n < 0 ? 'earlier' : 'later'}.`),
  swingBy: (a, k) => `swingBy(${fmt(a)}, ${fmt(k)}) cuts each cycle into ${fmt(k)} slices and delays the second half of each by ${fmt(a)} of that half: a swing or shuffle feel. 0 is straight.`,
  ply: (n) => `ply(${fmt(n)}) repeats every event ${fmt(n)} times in the space of one.`,
  transpose: (n) => `transpose(${fmt(n)}) moves every note ${fmt(Math.abs(n))} semitones ${n < 0 ? 'down' : 'up'}.`,
  rev: () => 'rev() plays each cycle backwards.',
  s: (v) => `s("${v}") picks the sound: the oscillator or sample name.`,
  bank: (v) => `bank("${v}") picks the drum machine the sample names come from.`,
  attack: (v) => `attack(${fmt(v)}) fades the sound in over ${fmt(v)} seconds.`,
  decay: (v) => `decay(${fmt(v)}) lets it fall away over ${fmt(v)} seconds.`,
  sustain: (v) => `sustain(${fmt(v)}) is the level held while a note lasts.`,
  release: (v) => `release(${fmt(v)}) fades out over ${fmt(v)} seconds after the note ends.`,
  lpf: (v) => `lpf(${fmt(v)}) is a low-pass filter: it cuts frequencies above ${fmt(v)} Hz.`,
  lpq: (v) => `lpq(${fmt(v)}) is the filter's resonance.`,
  detune: (v) => `detune(${fmt(v)}) spreads the supersaw voices apart.`,
  gain: (v) => `gain(${fmt(v)}) sets the volume (1 is normal).`,
  vib: (v) => `vib(${fmt(v)}) wobbles the pitch ${fmt(v)} times per second.`,
  pw: (v) => `pw(${fmt(v)}) is how wide each pulse is (0.5 is a square wave; smaller sounds thinner and more nasal). It only affects the pulse wave.`,
  pwrate: (v) => `pwrate(${fmt(v)}) swings the pulse width ${fmt(v)} times per second.`,
  pwsweep: (v) => `pwsweep(${fmt(v)}) is how far the width swings either side of its middle.`,
  vibmod: (v) => `vibmod(${fmt(v)}) is how far the pitch moves, in semitones.`,
  vowel: (v) => `vowel("${v}") shapes the sound like the vowel "${v}".`,
  djf: (v) => `djf(${fmt(v)}): below 0.5 is a low-pass, above 0.5 a high-pass.`,
  coarse: (v) => `coarse(${fmt(v)}) divides the sample rate by ${fmt(v)}: gritty lo-fi.`,
  shape: (v) => `shape(${fmt(v)}) is wave-shaping distortion (it can get loud).`,
  penv: (v) => `penv(${fmt(v)}) bends the pitch by ${fmt(v)} semitones at the start of each note, then it settles.`,
  pattack: (v) => `pattack(${fmt(v)}) is how long the pitch takes to reach its bend.`,
  pdecay: (v) => `pdecay(${fmt(v)}) is how long the bend takes to settle.`,
  fm: (v) => `fm(${fmt(v)}) is the FM index: how strongly one oscillator modulates another.`,
  fmh: (v) => `fmh(${fmt(v)}) is the modulator's pitch relative to the note.`,
  fmsustain: (v) => `fmsustain(${fmt(v)}) is how much of the FM brightness is held while the note lasts.`,
  fm2: (v) => `fm2(${fmt(v)}) adds a second modulator on top of the first: three-operator FM.`,
  fm11: (v) => `fm11(${fmt(v)}) feeds the first modulator back into itself: a harsher, grittier tone.`,
  fm22: (v) => `fm22(${fmt(v)}) feeds the second modulator back into itself; keep it small (0.05 to 0.3) or it turns noisy.`,
  fmh2: (v) => `fmh2(${fmt(v)}) is the second modulator's pitch relative to the note.`,
  fmdecay: (v) => `fmdecay(${fmt(v)}) is how fast the FM brightness dies away.`,
  pan: (v) => `pan(${fmt(v)}) places the sound in stereo: 0 left, 0.5 middle, 1 right.`,
  tremolodepth: (v) => `tremolodepth(${fmt(v)}) is how deep the volume dips go.`,
  tremoloshape: (v) => `tremoloshape("${v}") is the wobble's waveform.`,
  phaserdepth: (v) => `phaserdepth(${fmt(v)}) is how strong the phaser effect is.`,
  phasercenter: (v) => `phasercenter(${fmt(v)}) is the middle frequency of the sweep, in Hz.`,
  phasersweep: (v) => `phasersweep(${fmt(v)}) is how far the sweep travels.`,
  speed: (v) => `speed(${fmt(v)}) plays the sample ${fmt(v)}× as fast, which also raises its pitch.`,
  delay: (v) => `delay(${fmt(v)}) is how loud the echoes are.`,
  delaytime: (v) => `delaytime(${fmt(v)}) is the gap between echoes, in seconds.`,
  delayfeedback: (v) => `delayfeedback(${fmt(v)}) is how much of each echo feeds the next.`,
  room: (v) => `room(${fmt(v)}) is how much reverb is mixed in.`,
  roomsize: (v) => `roomsize(${fmt(v)}) is how big the room is.`,
  distort: (v) => `distort(${fmt(v)}) overdrives the sound.`,
  crush: (v) => `crush(${fmt(v)}) reduces the sound to ${fmt(v)} bits: lo-fi crunch.`,
};

function flatten(parts, issues, played) {
  let code = '';
  const segments = [];
  const notes = [];
  for (const p of parts) {
    if (p.nl !== undefined) {
      code += '\n' + '  '.repeat(p.nl);
      continue;
    }
    const from = code.length;
    code += p.t;
    if (p.node) segments.push({ from, to: code.length, node: p.node, role: p.role, key: p.key, step: p.step, track: p.track });
    if (p.note) notes.push({ at: from, node: p.node, key: p.key, text: p.note });
  }
  // collapse runs of 3+ newlines produced by empty indents, trim trailing whitespace
  const lines = [];
  let pos = 0;
  for (const text of code.split('\n')) {
    lines.push({ from: pos, to: pos + text.length, text, notes: [] });
    pos += text.length + 1;
  }
  for (const n of notes) {
    const line = lines.find((l) => n.at >= l.from && n.at <= l.to);
    if (line) line.notes.push(n);
  }
  return { code, segments, lines, issues, played };
}

