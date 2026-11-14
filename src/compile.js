// Graph -> idiomatic Strudel code. Pure. The returned `code` string is exactly what gets evaluated.
// Alongside the code we return `segments`: which character ranges belong to which module (and which knob / step),
// which is how highlighting, hover and "who made this event" work without any second representation of the sound.
import { MODULES, MUTE_KIND, EVERY_FNS, SOMETIMES_FNS, fmt, cellNotes, scaleCode, parseX, leafAt, stepHas } from './modules.js';
import { chordSymbol } from './chords.js';
import { nodeById, wiresInto, outType, effectiveKey, scopeId } from './graph.js';

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

// text of one step, with repeats ([..]*2) and brackets ([a b]) and length (@2). leaf() renders one leaf value.
function stepText(t, leaf) {
  if (t.rest) return '~';
  const x = parseX(t.cell);
  let out = x.type === 'sub' ? '[' + Array.from({ length: x.n }, (_, k) => leaf(leafAt(t.cell, k), t)).join(' ') + ']' : leaf(t.cell, t);
  if (x.type === 'rep') out += '*' + x.n;
  if (t.len > 1) out += '@' + t.len;
  return out;
}

export function compile(g) {
  const issues = [];
  let acidNode = null;
  const hydraNode = g.nodes.find((n) => n.type === 'hydra' && !n.muted) || null;
  const mutedOut = new Set(); // modules that are silent on purpose (muted, or fed only by muted ones): not worth a warning
  const stack = [];
  const nodeLabel = (n) => MODULES[n.type].title;

  // compile whatever is wired into one input port (first wire). null = nothing / silent.
  function input(n, portId, depth, inline) {
    const ws = wiresInto(g, n.id, portId);
    if (!ws.length) return null;
    return compileNode(nodeById(g, ws[0].from.node), depth, inline);
  }

  // The number plugged into a knob's cable jack. A Macro is mapped to the knob it drives: "sweep" stretches it across the knob's whole
  // range (.range(lo, hi), with a curve for knobs that are logarithmic), "multiply" scales the knob's own setting (.mul(setting)).
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
      // FM only has a brightness envelope once any fm envelope call is present, so fmdecay is written whenever fmsustain is
      const forced = n.type === 'fm' && spec.key === 'decay' && n.params.sustain !== def.params.find((x) => x.key === 'sustain').def;
      const c = knobCall(n, forced ? { ...spec, always: true } : spec, spec.call, depth, { say: SAY[spec.call]?.(n.params[spec.key], spec) });
      if (c) calls.push(c);
    }
    return calls;
  }

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
    return { tokens, wrap: mode === 'turns' ? ['<', '>'] : ['', ''] };
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
          const toks = [S('"', meta)];
          t.cells.forEach((c, i) => { if (i) toks.push(S(' ', meta)); toks.push(S(stepText({ step: i, rest: !stepHas(c, false, false), cell: c, len: 1 }, (lf) => (lf.on ? 'x' : '~')), { ...meta, step: i })); });
          toks.push(S('"', meta));
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
        const calls = paramCalls(n, depth);
        return chain(up, calls, depth, inline);
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
      case 'fast': case 'slow': case 'ply': case 'degrade': case 'transpose': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        const c = knobCall(n, def.params[0], def.params[0].call, depth, { say: SAY[def.params[0].call](p.n) });
        return chain(up, [c], depth, inline);
      }
      case 'rev': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'input');
        return chain(up, [[S('.rev()', { ...m, role: 'fn', note: SAY.rev() })]], depth, inline);
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
        return chain(base, calls, depth, inline);
      }
      case 'randrhythm': {
        const d = Math.min(1, Math.max(0.05, Number(p.density)));
        const mm = { ...m, role: 'mini', key: 'density' };
        const txt = `x*${p.steps}${d < 1 ? '?' + fmt(+(1 - d).toFixed(4)) : ''}`;
        const toks = [S('"', mm), S(txt, { ...mm, note: `"${txt}" is ${p.steps} steps per cycle${d < 1 ? `; the ?${fmt(+(1 - d).toFixed(4))} drops each step at random ${Math.round((1 - d) * 100)}% of the time, differently on every cycle` : ''}.` }), S('"', mm)];
        if (p.loop > 0) toks.push(S(`.ribbon(${p.loop}, 1)`, { ...m, role: 'knob', key: 'loop', note: `ribbon(${p.loop}, 1) takes cycle ${p.loop} of the random rhythm and repeats it forever, so it stops changing.` }));
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
        for (let i = 1; i <= p.n; i++) {
          const a = input(n, 'in' + i, depth + 1, false);
          if (a) args.push({ a, len: Math.max(1, Math.round(Number(p.lens?.[i - 1]) || 4)) });
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
      case 'delay': case 'reverb': case 'distortion': case 'chorus': case 'pan': case 'vibrato': case 'ring': case 'vowel': case 'djf': case 'leslie': case 'lofi': case 'pitchenv': case 'fm': {
        const up = input(n, 'in', depth, inline);
        if (!up) return silent(n, 'sound');
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
    if (volWired) masterCalls.push(S('.postgain(', { node: o.id, role: 'knob', key: 'mvol', note: 'postgain(…) is the master volume, driven by a number cable, so it changes while playing.' }), ...volWired, S(')', { node: o.id, role: 'knob', key: 'mvol' }));
    else if (o.params.mvol !== 1) masterCalls.push(S(`.postgain(${fmt(o.params.mvol)})`, { node: o.id, role: 'knob', key: 'mvol', note: `postgain(${fmt(o.params.mvol)}) is the master volume: it scales everything after all effects, so every part keeps its balance (1 = unchanged).` }));
    mk('mphaser', 'phaser', (v) => `phaser(${fmt(v)}) on everything: all() applies it to every pattern.`);
    mk('mtrem', 'tremolo', (v) => `tremolo(${fmt(v)}) on everything.`);
    mk('mchorus', 'chorus', (v) => `chorus(${fmt(v)}) on everything.`);
    if (hydraNode && !parts.some((x) => x.hydraHeader)) {
      const hm = { node: hydraNode.id, role: 'fn' };
      const lines = String(hydraNode.params.code || '').split('\n');
      parts.push(NL(0), NL(0), { ...S('await initHydra()', { ...hm, note: 'initHydra() starts Hydra, a live visuals engine. Where its picture appears (behind the board, a panel, or a window) is chosen on the Hydra module, not in the code.' }), hydraHeader: true });
      for (const ln of lines) parts.push(NL(0), S(ln, { ...hm, note: 'Hydra code: a chain of visual functions ending in .out(). It runs on its own, in the GPU, next to your music.' }));
    }
    if (acidNode && !parts.some((x) => x.acidHeader)) parts.push(NL(0), NL(0), { ...S("register('acidenv', (x, pat) => pat.lpf(100).lpenv(x * 9).lps(.2).lpd(.12))", { node: acidNode.id, role: 'fn', note: 'register() teaches Strudel a new method: acidenv(x) = a 100 Hz low-pass whose cutoff opens by x × 9 on each note (lpenv), holds at 20% (lps) and falls over 0.12 s (lpd).' }), acidHeader: true });
    if (masterCalls.length) parts.push(NL(0), NL(0), S('all(x => x', { node: o.id, role: 'fn', note: 'all(x => x.effect()) applies an effect to every pattern at once: a global effect.' }), ...masterCalls, S(')', { node: o.id }));
    for (const b of blocks) parts.push(NL(0), NL(0), ...b);
  }
  if (!outputs.length) parts.push(S('// Add an Output module and wire a sound into it'));
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
  vibmod: (v) => `vibmod(${fmt(v)}) is how far the pitch moves, in semitones.`,
  ring: (v) => `ring(${fmt(v)}) is how much ring modulation is mixed in.`,
  ringf: (v) => `ringf(${fmt(v)}) is the frequency of the ring-mod tone, in Hz.`,
  vowel: (v) => `vowel("${v}") shapes the sound like the vowel "${v}".`,
  djf: (v) => `djf(${fmt(v)}): below 0.5 is a low-pass, above 0.5 a high-pass.`,
  leslie: (v) => `leslie(${fmt(v)}) is how much of the rotating-speaker sound is mixed in.`,
  lrate: (v) => `lrate(${fmt(v)}) is how fast the speakers rotate.`,
  lsize: (v) => `lsize(${fmt(v)}) is the cabinet size, which changes the doppler warble.`,
  coarse: (v) => `coarse(${fmt(v)}) divides the sample rate by ${fmt(v)}: gritty lo-fi.`,
  squiz: (v) => `squiz(${fmt(v)}) pinches the sound.`,
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
  chorus: (v) => `chorus(${fmt(v)}) mixes in detuned, delayed copies for a thicker sound.`,
  tremolodepth: (v) => `tremolodepth(${fmt(v)}) is how deep the volume dips go.`,
  tremoloshape: (v) => `tremoloshape("${v}") is the wobble's waveform.`,
  phaserdepth: (v) => `phaserdepth(${fmt(v)}) is how strong the phaser effect is.`,
  phasercenter: (v) => `phasercenter(${fmt(v)}) is the middle frequency of the sweep, in Hz.`,
  phasersweep: (v) => `phasersweep(${fmt(v)}) is how far the sweep travels.`,
  speed: (v) => `speed(${fmt(v)}) plays the sample ${fmt(v)}× as fast, which also raises its pitch.`,
  delay: (v) => `delay(${fmt(v)}) is how loud the echoes are.`,
  delaytime: (v) => `delaytime(${fmt(v)}) is the gap between echoes, in cycles.`,
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

