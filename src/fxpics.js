// Small animated pictures for effects, in the same spirit as the Pulse width wave: no controls, the knobs do the work and the picture shows what they mean.
//   Delay:  the hit on the left, then its echoes. Echoes sit one delay time apart (the time knob, in seconds, laid along the cycle by the Output's tempo) and each is quieter than the last (mix sets the first,
//           feedback how fast they die away). A light sweeps across and each bar glows as it is reached. The base line is one cycle long, with a tick for
//           every beat (the Output's beats) and the next cycle's hit drawn as a dashed ghost where the pattern comes round again.
//   Reverb: the hit on the left, then its tail. The tail is as long as the room is big (size) and as tall as the room is loud (room). The same sweep lights it up.
//   Vibrato, Tremolo, Phaser: a pitch curve, a volume envelope on a wave, and a notch sweeping through the frequencies. Late, Swing, Note length: notes on a
//   beat grid against the straight positions (dashed).
//   Distortion, Lo-fi, Compressor: the real maths of the effects drawn on a wave (clipping, bit crushing, held samples) or a level curve (the compressor).
// Everything stops when Animations are off (the pictures then sit still, fully lit).
import { animate, put, putStyle, putText } from './anim.js';
const NS = 'http://www.w3.org/2000/svg';
const W = 240, H = 104, Y = 72, X0 = 16, X1 = 228, MAXH = 52, LOOP = 2.6;   // base line, where the hit is, where the picture ends, tallest bar, seconds per sweep
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pseudo = (i) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };

// the delay's bars: the dry hit, then echo k at k times the delay time (in seconds), mix * feedback^(k-1) as tall. The picture is one cycle wide, `cycleSec` seconds long.
export function delayBars(p, cycleSec = 1, maxEchoes = 24) {
  const mix = clamp(Number(p.mix) || 0, 0, 1), time = clamp(Number(p.time) || 0.25, 0.01, 1), fb = clamp(Number(p.feedback) || 0, 0, 0.95);
  const bars = [{ x: X0, h: 1, dry: true }];
  for (let k = 1; k <= maxEchoes; k++) {
    const x = X0 + ((X1 - X0) * time * k) / cycleSec, h = mix * fb ** (k - 1);
    if (x > X1 || h < 0.03) break;
    bars.push({ x, h, dry: false });
  }
  return bars;
}
// the reverb's tail: how many pixels long, how tall it starts
export const reverbShape = (p) => ({ len: clamp(14 + 20 * (Number(p.size) || 0), 14, X1 - X0 - 12), top: 0.12 + 0.88 * clamp(Number(p.room) || 0, 0, 1) });

// one live picture: `init` builds the shapes once, `paint` places them for the current knobs and the sweep position (0 to 1)
function live(node, ctl, { store, h }, key, label, init, paint, opts = {}) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const svg = el('svg', { class: 'fxpic', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  if (opts.base !== false) svg.append(el('line', { class: 'fx-base', x1: 8, x2: W - 8, y1: Y, y2: Y }));
  const state = init(svg);
  let P = paramsOf(), t0 = 0;
  const animated = () => !svg.closest('.no-anim');
  const tick = (now, dt, off) => {
    if (off) { paint(svg, state, P, 2); return; }                   // Animations off: sit still, fully lit
    if (!t0) t0 = now;
    paint(svg, state, P, ((now - t0) / 1000 / LOOP) % 1);
  };
  const anim = animate(svg, tick, { fps: 30 });
  const draw = (p) => {
    P = p || paramsOf();
    paint(svg, state, P, animated() ? (t0 ? ((performance.now() - t0) / 1000 / LOOP) % 1 : 0) : 2);
    anim.kick();
  };
  ctl[key] = { draw };
  const wrap = h('div', { class: 'fxpicwrap' }, svg);
  draw(node.params);
  return wrap;
}
// how lit something at x is when the sweep is at `pos` (0 to 1): bright as the sweep reaches it, then easing back
const lit = (x, pos) => { if (pos > 1) return 1; const at = X0 + (X1 - X0) * pos, d = at - x; return d < -2 ? 0.28 : 0.28 + 0.72 * Math.exp(-Math.max(0, d) / 34); };

export function buildDelayPic(node, ctl, deps) {
  const out = () => deps.store.graph.nodes.find((n) => n.type === 'output')?.params || {};
  const cycleSec = () => (60 * (Number(out().beats) || 4)) / Math.max(1, Number(out().bpm) || 120);   // how long one cycle lasts, from the Output's tempo
  const beatsNow = () => Math.max(1, Math.min(16, Math.round(Number(deps.store.graph.nodes.find((n) => n.type === 'output')?.params.beats) || 4)));
  return live(node, ctl, deps, 'delaypic', 'Animation of a hit and its echoes along one cycle: how far apart they are and how fast they fade, with the next cycle marked',
    (svg) => {
      const bars = [], sweep = el('line', { class: 'fx-sweep', y1: Y - MAXH - 4, y2: Y });
      const ghost = el('rect', { class: 'fx-ghost', rx: 2, x: X1 - 2.5, y: Y - MAXH, width: 5, height: MAXH });
      const ticks = el('g'), tnext = el('text', { class: 'fx-txt', x: X1, y: H - 4, 'text-anchor': 'end' }), tfirst = el('text', { class: 'fx-txt', x: X0, y: H - 4, 'text-anchor': 'start' });
      tnext.textContent = 'next cycle'; tfirst.textContent = 'hit';
      svg.append(ghost, ticks, tfirst, tnext, sweep);
      return { bars, sweep, ghost, ticks, beats: 0 };
    },
    (svg, st, p, pos) => {
      const beats = beatsNow();
      if (beats !== st.beats) {   // one tick per beat along the cycle, longer at the start and the end
        st.beats = beats; st.ticks.replaceChildren();
        for (let i = 0; i <= beats; i++) { const x = X0 + ((X1 - X0) * i) / beats, ln = el('line', { class: 'fx-tick', x1: x, x2: x, y1: Y, y2: Y + (i === 0 || i === beats ? 9 : 5) }); st.ticks.append(ln); }
      }
      putStyle(st.ghost, 'opacity', String(lit(X1, pos) * 0.9));
      const data = delayBars(p, cycleSec());
      while (st.bars.length < data.length) { const r = el('rect', { class: 'fx-bar', rx: 2, width: 5 }); svg.insertBefore(r, st.sweep); st.bars.push(r); }
      st.bars.forEach((r, i) => {
        const b = data[i];
        putStyle(r, 'display', b ? '' : 'none');
        if (!b) return;
        const hh = Math.max(2, b.h * MAXH);
        put(r, 'x', b.x - 2.5); put(r, 'y', Y - hh); put(r, 'height', hh);
        r.classList.toggle('fx-dry', b.dry);
        putStyle(r, 'opacity', String(lit(b.x, pos)));
      });
      put(st.sweep, 'x1', X0 + (X1 - X0) * Math.min(pos, 1)); put(st.sweep, 'x2', X0 + (X1 - X0) * Math.min(pos, 1)); putStyle(st.sweep, 'display', pos > 1 ? 'none' : '');
    });
}

export function buildReverbPic(node, ctl, deps) {
  const N = 56;
  return live(node, ctl, deps, 'reverbpic', 'Animation of a hit and the tail of the room: how long it rings and how loud',
    (svg) => {
      const hit = el('rect', { class: 'fx-bar fx-dry', rx: 2, width: 5, x: X0 - 2.5, y: Y - MAXH, height: MAXH });
      const lines = Array.from({ length: N }, () => el('line', { class: 'fx-tail' })), sweep = el('line', { class: 'fx-sweep', y1: Y - MAXH - 4, y2: Y });
      svg.append(...lines, hit, sweep);
      return { hit, lines, sweep };
    },
    (svg, st, p, pos) => {
      const { len, top } = reverbShape(p), x0 = X0 + 9;
      putStyle(st.hit, 'opacity', String(lit(X0, pos)));
      st.lines.forEach((ln, i) => {
        const u = i / (N - 1), x = x0 + len * u, hh = Math.max(1.5, MAXH * top * Math.exp(-3.2 * u) * (0.55 + 0.45 * pseudo(i)));
        put(ln, 'x1', x); put(ln, 'x2', x); put(ln, 'y1', Y - hh); put(ln, 'y2', Y);
        putStyle(ln, 'opacity', String(lit(x, pos)));
      });
      put(st.sweep, 'x1', X0 + (X1 - X0) * Math.min(pos, 1)); put(st.sweep, 'x2', X0 + (X1 - X0) * Math.min(pos, 1)); putStyle(st.sweep, 'display', pos > 1 ? 'none' : '');
    });
}

// ======================= Distortion, Lo-fi and Compressor =======================
const WAVE_Y = 50, WAVE_A = 38, WX0 = 10, WX1 = 230;
const wavePath = (fn, n) => { let d = ''; for (let k = 0; k <= n; k++) { const u = k / n; d += (k ? 'L' : 'M') + (WX0 + (WX1 - WX0) * u).toFixed(1) + ' ' + (WAVE_Y - WAVE_A * fn(u)).toFixed(1) + ' '; } return d; };
const caption = (svg, x, y, anchor = 'start') => { const t = el('text', { class: 'fx-txt', x, y, 'text-anchor': anchor }); svg.append(t); return t; };

// one sample through the Distortion module's three effects, in the order superdough runs them: crush, then shape, then distort
// returns both the wave after crush and shape (before distort) and the final wave, so the picture can show what each stage does
export function distortStages(p, x) {
  let v = clamp(x, -1, 1);
  const bits = Number(p.crush) || 16;
  if (bits < 16) { const q = 2 ** (Math.max(1, bits) - 1); v = Math.round(v * q) / q; }
  const shape = clamp(Number(p.shape) || 0, 0, 0.95);
  if (shape > 0) { const k = (2 * shape) / (1 - shape); v = ((1 + k) * v) / (1 + k * Math.abs(v)); }
  const pre = v, amount = Math.max(0, Number(p.amount) || 0);
  if (amount > 0) { const k = Math.expm1(amount); v = ((1 + k) * v) / (1 + k * Math.abs(v)); }
  return { pre, out: v };
}
export const distortSample = (p, x) => distortStages(p, x).out;
// the Lo-fi module's coarse: keep one sample in every `coarse` and hold it (the same loop as superdough's coarse processor)
export function coarseSamples(input, coarse) {
  const c = Math.max(1, Math.round(coarse) || 1), out = new Float32Array(input.length);
  for (let n = 0; n < input.length; n++) out[n] = n % c === 0 ? input[n] : out[n - 1];
  return out;
}
// the compressor's static curve: output level for an input level, all in dB, with a soft knee
export function compressDb(inDb, threshold, ratio, knee) {
  const over = inDb - threshold, r = Math.max(1, ratio), k = Math.max(0, knee);
  if (2 * over < -k) return inDb;
  if (k > 0 && 2 * Math.abs(over) <= k) return inDb + ((1 / r - 1) * (over + k / 2) ** 2) / (2 * k);
  return threshold + over / r;
}
// the loudness of a kick-like input at time t (seconds): a hit every quarter of the loop that dies away
export const kickDb = (t) => -60 + 57 * Math.exp(-(t % (LOOP / 4)) / 0.14);
// run the compressor over the loop up to time `upTo`: returns [{ t, inDb, outDb }]. The gain reduction follows the attack and release times.
export function compressRun(p, upTo, dt = 0.01) {
  const th = Number(p.threshold) || -20, ratio = Number(p.ratio) || 4, knee = Number(p.knee) || 0;
  const att = Math.max(0.001, Number(p.attack) || 0.003), rel = Math.max(0.01, Number(p.release) || 0.1);
  let g = 0; const out = [];
  for (let t = 0; t <= upTo + 1e-9; t += dt) {
    const inDb = kickDb(t), target = compressDb(inDb, th, ratio, knee) - inDb;
    const tau = target < g ? att : rel;
    g += (target - g) * (1 - Math.exp(-dt / tau));
    out.push({ t, inDb, outDb: inDb + g });
  }
  return out;
}

export function buildDistortionPic(node, ctl, deps) {
  return live(node, ctl, deps, 'distortionpic', 'A wave being clipped, crushed and shaped by the distortion settings',
    (svg) => {
      const lim = [-1, 1].map((s) => el('line', { class: 'fx-lim', x1: WX0, x2: WX1, y1: WAVE_Y - s * WAVE_A, y2: WAVE_Y - s * WAVE_A }));
      const ax = el('line', { class: 'fx-base', x1: 8, x2: W - 8, y1: WAVE_Y, y2: WAVE_Y });
      const inp = el('path', { class: 'fx-in', fill: 'none' }), mid = el('path', { class: 'fx-mid', fill: 'none' }), out = el('path', { class: 'fx-out', fill: 'none' });
      svg.append(...lim, ax, inp, mid, out);
      return { inp, mid, out, cap: caption(svg, 10, H - 6) };
    },
    (svg, st, p, pos) => {
      const ph = pos > 1 ? 0.1 : pos, A = 0.8, sine = (u) => A * Math.sin(2 * Math.PI * (2 * u - ph));
      put(st.inp, 'd', wavePath(sine, 110)); put(st.out, 'd', wavePath((u) => distortStages(p, sine(u)).out, 200));
      const early = +p.shape > 0 || +p.crush < 16;   // crush and shape come first: show the wave after them in teal, then distort's work in purple on top
      put(st.mid, 'd', early ? wavePath((u) => distortStages(p, sine(u)).pre, 200) : ''); 
      putText(st.cap, (early ? 'teal: after shape/crush · ' : '') + `purple: distort ${(+p.amount || 0).toFixed(1)}`);
    }, { base: false });
}

export function buildLofiPic(node, ctl, deps) {
  return live(node, ctl, deps, 'lofipic', 'A wave turned into coarse steps by the lo-fi setting',
    (svg) => {
      const ax = el('line', { class: 'fx-base', x1: 8, x2: W - 8, y1: WAVE_Y, y2: WAVE_Y });
      const inp = el('path', { class: 'fx-in', fill: 'none' }), out = el('path', { class: 'fx-out', fill: 'none' });
      svg.append(ax, inp, out);
      return { inp, out, cap: caption(svg, 10, H - 6) };
    },
    (svg, st, p, pos) => {
      const ph = pos > 1 ? 0.1 : pos, N = 200, sine = (u) => 0.8 * Math.sin(2 * Math.PI * (2 * u - ph));
      const input = Float32Array.from({ length: N }, (_, n) => sine(n / N)), held = coarseSamples(input, p.coarse);
      let d = '';
      for (let n = 0; n < N;) { let m = n + 1; while (m < N && held[m] === held[n]) m++; const x0 = WX0 + ((WX1 - WX0) * n) / N, x1 = WX0 + ((WX1 - WX0) * m) / N, y = WAVE_Y - WAVE_A * held[n]; d += (n ? 'L' : 'M') + x0.toFixed(1) + ' ' + y.toFixed(1) + 'L' + x1.toFixed(1) + ' ' + y.toFixed(1) + ' '; n = m; }   // one flat line for each held run
      put(st.inp, 'd', wavePath(sine, 110)); put(st.out, 'd', d);
      const c = Math.max(1, Math.round(p.coarse) || 1);
      putText(st.cap, (c === 1 ? 'coarse 1: no change' : `coarse ${c}: keeps 1 in ${c}`));
    }, { base: false });
}

export function buildCompressorPic(node, ctl, deps) {
  const PX0 = 12, PX1 = 104, PY0 = 16, PY1 = 90, TX0 = 128, TX1 = 228;   // the curve box, the level-over-time box
  const dbX = (d) => PX0 + ((clamp(d, -60, 0) + 60) / 60) * (PX1 - PX0), dbY = (d) => PY1 - ((clamp(d, -60, 0) + 60) / 60) * (PY1 - PY0);
  const tY = (d) => PY1 - ((clamp(d, -60, 0) + 60) / 60) * (PY1 - PY0);
  return live(node, ctl, deps, 'compressorpic', 'A compressor: the curve from input level to output level, and a loud hit being turned down over time',
    (svg) => {
      const frame1 = el('rect', { class: 'fx-box', x: PX0, y: PY0, width: PX1 - PX0, height: PY1 - PY0 }), frame2 = el('rect', { class: 'fx-box', x: TX0, y: PY0, width: TX1 - TX0, height: PY1 - PY0 });
      const diag = el('line', { class: 'fx-lim', x1: PX0, y1: PY1, x2: PX1, y2: PY0 });
      const thV = el('line', { class: 'fx-lim' }), thH = el('line', { class: 'fx-lim' }), thT = el('line', { class: 'fx-lim', x1: TX0, x2: TX1 });
      const curve = el('path', { class: 'fx-out', fill: 'none' }), dot = el('circle', { class: 'fx-dot', r: 3.5 });
      const lin = el('path', { class: 'fx-in', fill: 'none' }), lout = el('path', { class: 'fx-out', fill: 'none' }), sweep = el('line', { class: 'fx-sweep', y1: PY0, y2: PY1 });
      svg.append(frame1, frame2, diag, thV, thH, thT, curve, lin, lout, sweep, dot);
      const c1 = caption(svg, PX0, 10), c2 = caption(svg, TX0, 10), c3 = caption(svg, PX0, H - 6);
      c1.textContent = 'level in → out'; c2.textContent = 'level over time';
      return { curve, dot, lin, lout, sweep, thV, thH, thT, c3 };
    },
    (svg, st, p, pos) => {
      const th = Number(p.threshold) || -20, ratio = Number(p.ratio) || 4, knee = Number(p.knee) || 0, now = pos > 1 ? 1 : pos;
      let d = '';
      for (let k = 0; k <= 60; k++) { const inDb = -60 + k; d += (k ? 'L' : 'M') + dbX(inDb).toFixed(1) + ' ' + dbY(compressDb(inDb, th, ratio, knee)).toFixed(1) + ' '; }
      put(st.curve, 'd', d);
      put(st.thV, 'x1', dbX(th)); put(st.thV, 'x2', dbX(th)); put(st.thV, 'y1', PY0); put(st.thV, 'y2', PY1);
      put(st.thH, 'y1', dbY(th)); put(st.thH, 'y2', dbY(th)); put(st.thH, 'x1', PX0); put(st.thH, 'x2', PX1);
      put(st.thT, 'y1', tY(th)); put(st.thT, 'y2', tY(th));
      const run = compressRun(p, now * LOOP, 0.02);
      const tx = (t) => TX0 + ((TX1 - TX0) * t) / LOOP;
      put(st.lin, 'd', 'M' + run.map((r) => `${tx(r.t).toFixed(1)} ${tY(r.inDb).toFixed(1)}`).join('L'));
      put(st.lout, 'd', 'M' + run.map((r) => `${tx(r.t).toFixed(1)} ${tY(r.outDb).toFixed(1)}`).join('L'));
      const last = run[run.length - 1];
      put(st.dot, 'cx', dbX(last.inDb)); put(st.dot, 'cy', dbY(last.outDb));
      put(st.sweep, 'x1', tx(now * LOOP)); put(st.sweep, 'x2', tx(now * LOOP)); putStyle(st.sweep, 'display', pos > 1 ? 'none' : '');
      putText(st.c3, `threshold ${Math.round(th)} dB · ratio ${(+ratio).toFixed(1)}:1`);
    }, { base: false });
}

// ======================= Vibrato, Tremolo, Phaser =======================
// the shape of one tremolo wobble, 0 (quietest) to 1 (loudest), at a point u (any number) in the wobble
export function lfo01(shape, u) {
  const x = u - Math.floor(u);
  if (shape === 'triangle') return 1 - Math.abs(2 * x - 1);
  if (shape === 'square') return x < 0.5 ? 1 : 0;
  if (shape === 'sawtooth') return x;
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * x);
}
// the volume factor of tremolo: down to 1 - depth at the quietest (the module's curve of 1.5 makes the dips a touch sharper)
export const tremoloGain = (p, u) => 1 - clamp(Number(p.depth) || 0, 0, 1) * (1 - lfo01(p.shape || 'sine', u) ** 1.5);
// a notch filter's gain (0 to 1) at frequency f for a notch at f0; depth widens it (the phaser sets the notch's Q from depth)
export function notchGain(f, f0, depth) {
  const q = 2 - clamp(depth * 2, 0, 1.9), r = f / f0, a = 1 - r * r;
  return Math.sqrt((a * a) / (a * a + (r / q) ** 2));
}
// where the phaser's notch is at a moment: centre (plus the 282 Hz offset superdough adds) swung up and down by `sweep` cents
export const phaserNotchHz = (p, sine) => ((Number(p.center) || 1000) + 282) * 2 ** (((Number(p.sweep) || 0) * sine) / 1200);

const outParams = (deps) => deps.store.graph.nodes.find((n) => n.type === 'output')?.params || {};
const cycleSecOf = (deps) => (60 * (Number(outParams(deps).beats) || 4)) / Math.max(1, Number(outParams(deps).bpm) || 120);
const beatsOf = (deps) => Math.max(1, Math.min(16, Math.round(Number(outParams(deps).beats) || 4)));

export function buildVibratoPic(node, ctl, deps) {
  return live(node, ctl, deps, 'vibratopic', 'The pitch of a held note wobbling up and down',
    (svg) => {
      const grid = [-1, 1].map((s) => el('line', { class: 'fx-lim', x1: WX0, x2: WX1, y1: WAVE_Y - s * WAVE_A * 0.5, y2: WAVE_Y - s * WAVE_A * 0.5 }));
      const ax = el('line', { class: 'fx-base', x1: 8, x2: W - 8, y1: WAVE_Y, y2: WAVE_Y }), glow = el('path', { class: 'fx-out fx-soft', fill: 'none' }), curve = el('path', { class: 'fx-out', fill: 'none' });
      svg.append(...grid, ax, glow, curve);
      const t1 = caption(svg, WX1, WAVE_Y - WAVE_A * 0.5 - 2, 'end'), t2 = caption(svg, WX1, WAVE_Y + WAVE_A * 0.5 + 9, 'end'); t1.textContent = '+ half the depth'; t2.textContent = '− half the depth';
      return { curve, glow, cap: caption(svg, 10, H - 6) };
    },
    (svg, st, p, pos) => {
      const ph = pos > 1 ? 0 : pos, rate = clamp(Number(p.rate) || 5, 0.5, 20), depth = clamp(Number(p.depth) || 0, 0, 4);
      // one second of pitch across the picture; the vertical scale is 4 semitones from the middle to the top
      const d = wavePath((u) => (depth / 4) * Math.sin(2 * Math.PI * (rate * u - ph)), Math.min(400, Math.max(120, Math.round(rate * 14))));
      put(st.curve, 'd', d); put(st.glow, 'd', d);
      putText(st.cap, `pitch over 1 s: ${(+rate).toFixed(1)} wobbles, ±${(+depth).toFixed(2)} semitones`);
    }, { base: false });
}

export function buildTremoloPic(node, ctl, deps) {
  return live(node, ctl, deps, 'tremolopic', 'A held note whose volume wobbles up and down',
    (svg) => {
      const ax = el('line', { class: 'fx-base', x1: 8, x2: W - 8, y1: WAVE_Y, y2: WAVE_Y });
      const top = el('path', { class: 'fx-mid', fill: 'none' }), bot = el('path', { class: 'fx-mid', fill: 'none' }), wave = el('path', { class: 'fx-out', fill: 'none' });
      svg.append(ax, top, bot, wave);
      return { top, bot, wave, cap: caption(svg, 10, H - 6) };
    },
    (svg, st, p, pos) => {
      const ph = pos > 1 ? 0 : pos, sync = p.sync === 'sync', cycleSec = cycleSecOf(deps), rate = Number(p.rate) || 4, hz = sync ? rate / cycleSec : rate;
      const env = (u) => tremoloGain(p, hz * u - ph);   // one second across
      put(st.top, 'd', wavePath((u) => env(u), 240)); put(st.bot, 'd', wavePath((u) => -env(u), 240));
      put(st.wave, 'd', wavePath((u) => env(u) * Math.sin(2 * Math.PI * 28 * u), 340));
      putText(st.cap, `volume over 1 s: ${hz.toFixed(1)} wobbles` + (sync ? ` (${rate} per cycle)` : '') + `, down to ${Math.round((1 - clamp(+p.depth || 0, 0, 1)) * 100)}%`);
    }, { base: false });
}

export function buildPhaserPic(node, ctl, deps) {
  const FX0 = 40, FX1 = 8000, GX0 = 12, GX1 = 228, GY0 = 20, GY1 = 82;
  const xOfHz = (f) => GX0 + ((GX1 - GX0) * Math.log(f / FX0)) / Math.log(FX1 / FX0);
  return live(node, ctl, deps, 'phaserpic', 'A notch in the frequencies sweeping up and down',
    (svg) => {
      const box = el('rect', { class: 'fx-box', x: GX0, y: GY0, width: GX1 - GX0, height: GY1 - GY0 }), curve = el('path', { class: 'fx-out', fill: 'none' }), glow = el('path', { class: 'fx-out fx-soft', fill: 'none' });
      const ticks = [100, 1000, 8000].map((f) => { const t = el('text', { class: 'fx-txt', x: xOfHz(f), y: GY1 + 10, 'text-anchor': f === 8000 ? 'end' : 'middle' }); t.textContent = f >= 1000 ? f / 1000 + 'k' : String(f); return t; });
      svg.append(box, glow, curve, ...ticks);
      const t0 = caption(svg, GX0, 12); t0.textContent = 'what gets through, by frequency';
      return { curve, glow, cap: caption(svg, GX0, H - 6) };
    },
    (svg, st, p, pos) => {
      const ph = pos > 1 ? 0.25 : pos, f0 = phaserNotchHz(p, Math.sin(2 * Math.PI * ph)), depth = clamp(Number(p.depth) || 0.75, 0, 1);
      let d = '';
      for (let k = 0; k <= 160; k++) { const f = FX0 * (FX1 / FX0) ** (k / 160), g = notchGain(f, f0, depth); d += (k ? 'L' : 'M') + xOfHz(f).toFixed(1) + ' ' + (GY1 - g * (GY1 - GY0 - 4)).toFixed(1) + ' '; }
      put(st.curve, 'd', d); put(st.glow, 'd', d);
      putText(st.cap, `notch swings around ${Math.round(+p.center || 1000)} Hz, ${(+p.rate).toFixed(2)} sweeps a second`);
    }, { base: false });
}

// ======================= Late, Swing, Note length =======================
// eight steps in one cycle, as the straight grid and as the module changes them. Times are in cycles, so everything wraps round the cycle.
export function gridEvents(kind, p, n = 8) {
  const evs = [];
  for (let i = 0; i < n; i++) {
    const t = i / n, base = { t0: t, len: 1 / n, shift: 0, mul: 1 };
    if (kind === 'late') base.shift = Number(p.n) || 0;
    else if (kind === 'swing') {
      const slices = Math.max(1, Math.round(Number(p.slices) || 4)), sl = 1 / slices, pos = (t % sl) / sl;
      if (pos >= 0.5 - 1e-9) base.shift = (clamp(Number(p.amount) || 0, 0, 1) * sl) / 2;
    } else if (kind === 'clip') base.mul = Number(p.n);
    evs.push(base);
  }
  return evs;
}

function gridPic(kind, key, label, captionOf) {
  return (node, ctl, deps) => live(node, ctl, deps, key, label,
    (svg) => {
      const ghosts = [], bars = [], ticks = el('g'), sweep = el('line', { class: 'fx-sweep', y1: Y - 40, y2: Y });
      for (let i = 0; i < 8; i++) { ghosts.push(el('rect', { class: 'fx-ghost', rx: 2, height: 30, y: Y - 30 })); bars.push(el('rect', { class: 'fx-bar fx-dry', rx: 2, height: 30, y: Y - 30 })); }
      const tn = caption(svg, X1, H - 4, 'end'); tn.textContent = 'next cycle';
      svg.append(...ghosts, ...bars, ticks, sweep);
      return { ghosts, bars, ticks, sweep, beats: 0, cap: caption(svg, X0, H - 4) };
    },
    (svg, st, p, pos) => {
      const beats = beatsOf(deps);
      if (beats !== st.beats) {
        st.beats = beats; st.ticks.replaceChildren();
        for (let i = 0; i <= beats; i++) { const x = X0 + ((X1 - X0) * i) / beats; st.ticks.append(el('line', { class: 'fx-tick', x1: x, x2: x, y1: Y, y2: Y + (i === 0 || i === beats ? 9 : 5) })); }
      }
      const evs = gridEvents(kind, p), span = X1 - X0;
      evs.forEach((e, i) => {
        const gx = X0 + span * e.t0, gw = Math.max(2, span * e.len * 0.8);
        put(st.ghosts[i], 'x', gx); put(st.ghosts[i], 'width', gw);
        let t = e.t0 + e.shift; t -= Math.floor(t);                         // late and swing wrap round the cycle
        const w = Math.max(2, span * e.len * (kind === 'clip' ? e.mul * 0.8 : 0.8));
        put(st.bars[i], 'x', X0 + span * t); put(st.bars[i], 'width', Math.min(w, X1 + 10 - (X0 + span * t)));
        putStyle(st.bars[i], 'opacity', String(lit(X0 + span * t, pos)));
      });
      put(st.sweep, 'x1', X0 + span * Math.min(pos, 1)); put(st.sweep, 'x2', X0 + span * Math.min(pos, 1)); putStyle(st.sweep, 'display', pos > 1 ? 'none' : '');
      putText(st.cap, captionOf(p, cycleSecOf(deps)));
    });
}
export const buildLatePic = gridPic('late', 'latepic', 'Eight steps along one cycle against the straight grid, nudged later or earlier', (p, cs) => `late ${(+p.n).toFixed(3)} cycle = ${Math.round((+p.n) * cs * 1000)} ms`);
export const buildSwingPic = gridPic('swing', 'swingpic', 'Eight steps along one cycle against the straight grid, with the second half of every slice delayed', (p) => `swing ${(+p.amount).toFixed(2)} · ${Math.round(p.slices)} slices`);
export const buildClipPic = gridPic('clip', 'clippic', 'Eight steps along one cycle, each note shortened or lengthened', (p) => `note length ×${(+p.n).toFixed(2)} of a step`);

// every picture, by the flag a module sets in its `data`
export const FXPICS = {
  delaypic: buildDelayPic, reverbpic: buildReverbPic, distortionpic: buildDistortionPic, lofipic: buildLofiPic, compressorpic: buildCompressorPic,
  vibratopic: buildVibratoPic, tremolopic: buildTremoloPic, phaserpic: buildPhaserPic, latepic: buildLatePic, swingpic: buildSwingPic, clippic: buildClipPic,
};
