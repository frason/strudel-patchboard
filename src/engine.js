// Strudel is the only clock. We hand it the compiled code string and tap the events it schedules.
import { initHydra, clearHydra, H } from './hydra.js';
import { initStrudel, initAudio, webaudioOutput, getAudioContext, samples, evalScope, ref, getAnalyzerData, superdough, getSuperdoughAudioController } from '@strudel/web';
import { getPrefs, onPrefs } from './prefs.js';
import { makeSliderWithID, sliderValues } from './slider.js';
import { registerSoundfonts } from './soundfonts.js';

const DS = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';

// Safe output: a limiter between Strudel's output and the speakers, in two stages. A compressor with a fast attack and a high ratio takes hot peaks down
// smoothly (it starts at -2 dB, so anything below 0.8 passes untouched). Behind it a soft clipper rounds off what is left, so the output can never pass 0.97.
// A soft clipper alone is not enough: a very hot patch (a ring mod or a stack of FM voices can reach +10 dB or more) would be flattened against its ceiling
// and crackle, which is the "serious clipping" you hear. It is part of this app's audio path, not of the generated code, so it is not in the code panel
// and is not there when the same code runs on strudel.cc.
const LIMIT = { threshold: -2, knee: 1, ratio: 20, attack: 0.003, release: 0.15 };
const SHAPER_RANGE = 4;   // the shaper sees -1..1 times this; the gain before it divides the signal by the same number
function softCurve() {
  const N = 8192, c = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = ((i / (N - 1)) * 2 - 1) * SHAPER_RANGE, a = Math.abs(x);
    const y = a <= 0.8 ? a : 0.8 + 0.17 * Math.tanh((a - 0.8) / 0.17);   // leaves a little margin: never above 0.97
    c[i] = Math.sign(x) * y;
  }
  return c;
}
function makeCompressor(ctx) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = LIMIT.threshold; c.knee.value = LIMIT.knee; c.ratio.value = LIMIT.ratio; c.attack.value = LIMIT.attack; c.release.value = LIMIT.release;
  return c;
}
// A Web Audio compressor adds an automatic make-up gain that differs a little between browsers. Measure it once, on a quiet tone, and undo it,
// so that quiet and normal material passes at exactly the level it came in.
async function compressorTrim() {
  try {
    const sr = 44100, ctx = new OfflineAudioContext(1, sr / 4, sr), o = ctx.createOscillator(), g = ctx.createGain(), c = makeCompressor(ctx);
    o.frequency.value = 220; g.gain.value = 0.05; o.connect(g); g.connect(c); c.connect(ctx.destination); o.start();
    const d = (await ctx.startRendering()).getChannelData(0).slice(sr / 8);
    let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v));
    return pk > 0.001 ? Math.min(1.5, Math.max(0.5, 0.05 / pk)) : 1;
  } catch { return 1; }
}
let safe = null;
function ensureSafeOutput() {
  if (safe) return safe;
  try {
    const ctx = getAudioContext(), dg = getSuperdoughAudioController().output.destinationGain;
    if (!dg) return null;
    const comp = makeCompressor(ctx), trim = ctx.createGain();
    const pre = ctx.createGain(); pre.gain.value = 1 / SHAPER_RANGE;
    comp.connect(trim); trim.connect(pre);
    compressorTrim().then((t) => { trim.gain.value = t; });
    const shaper = ctx.createWaveShaper(); shaper.curve = softCurve(); shaper.oversample = '2x';
    const meter = ctx.createAnalyser(); meter.fftSize = 1024;
    shaper.connect(ctx.destination);
    safe = { ctx, dg, comp, trim, pre, shaper, meter, buf: new Float32Array(meter.fftSize), on: null };
  } catch { safe = null; }
  return safe;
}
function routeSafeOutput() {
  const s = ensureSafeOutput();
  if (!s) return;
  const on = getPrefs().safeOutput !== false;
  if (s.on === on) return;
  try {
    s.dg.disconnect();
    s.dg.connect(s.meter);                       // the meter always listens to the signal as Strudel makes it
    if (on) s.dg.connect(s.comp); else s.dg.connect(s.ctx.destination);
    s.pre.disconnect(); if (on) s.pre.connect(s.shaper);
    s.on = on;
  } catch { /* leave the output as it was */ }
}

export function createEngine() {
  let repl = null;
  let starting = null;
  let playing = false;
  const hapSubs = new Set();
  const statusSubs = new Set();
  let status = { state: 'idle', message: '' };
  let evalSeq = 0;

  const setStatus = (state, message = '') => {
    status = { state, message };
    statusSubs.forEach((f) => f(status));
  };

  // Strudel calls this for every scheduled event. We forward the event's source locations (character ranges in the
  // code string we evaluated) so the UI can tell which module produced it, then let the real audio output run.
  const defaultOutput = (hap, deadline, duration, cps, t) => {
    try {
      const ctx = getAudioContext();
      const delayMs = Math.max(0, (t - ctx.currentTime) * 1000);
      const durMs = Math.max(90, duration * 1000);
      const locations = hap.context?.locations || [];
      hapSubs.forEach((f) => f({ locations, delayMs, durMs, value: hap.value }));
    } catch (e) { /* visuals must never break audio */ }
    return webaudioOutput(hap, deadline, duration, cps, t);
  };

  async function ensure() {
    if (repl) return repl;
    if (!starting) {
      starting = (async () => {
        setStatus('loading', 'loading sounds…');
        const r = await initStrudel({
          defaultOutput,
          onEvalError: (e) => setStatus('error', e.message),
          prebake: async () => {
            await evalScope({ sliderWithID: makeSliderWithID(ref), initHydra, clearHydra, H });
            registerSoundfonts(); // General MIDI instruments: nothing downloads until one is played
            const results = await Promise.allSettled([
              samples(`${DS}/tidal-drum-machines.json`),
              samples(`${DS}/piano.json`),
              samples('github:tidalcycles/dirt-samples'),
              samples('github:switchangel/breaks'), // public-domain break loops: s("breaks")
              samples('github:switchangel/pad'),    // public-domain pad: s("swpad")
            ]);
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length) console.warn('[patchboard] sample maps failed to load', failed.map((f) => String(f.reason)));
          },
        });
        repl = r;
        if (!playing) setStatus('ready', '');
        return r;
      })();
    }
    return starting;
  }

  const api = {
    get playing() { return playing; },
    get status() { return status; },
    onHap(f) { hapSubs.add(f); return () => hapSubs.delete(f); },
    onStatus(f) { statusSubs.add(f); return () => statusSubs.delete(f); },
    // must be called from the click handler: initAudio has to run inside the user gesture
    async start(code) {
      const audio = initAudio();           // inside the click, before any await that could lose the gesture
      await audio;
      await ensure();
      routeSafeOutput();
      playing = true;
      await api.evaluate(code);
    },
    async evaluate(code) {
      if (!repl) return;
      const seq = ++evalSeq;
      setStatus('ok', '');
      // An orbit (mix bus) only exists once the first sound has played on it, and .duck("3") on a kick that hits before that logs
      // "duck target orbit 3 does not exist". Create the orbits that the code ducks up front.
      try {
        const ctrl = getSuperdoughAudioController();
        for (const m of code.matchAll(/\.duck\(\s*["'`]?([\d:\s]+)/g)) for (const n of m[1].split(/[:\s]+/).filter(Boolean)) ctrl.getOrbit(Number(n), [0, 1]);
      } catch { /* the sound will still play; at worst the first hit is not ducked */ }
      await repl.evaluate(code, playing);
      if (seq === evalSeq && repl.state.evalError) setStatus('error', repl.state.evalError.message);
      else if (seq === evalSeq) setStatus(playing ? 'playing' : 'ready', '');
    },
    stop() {
      playing = false;
      clearHydra();
      repl?.stop();
      setStatus('ready', '');
    },
    setSlider(id, value) { sliderValues[id] = value; },
    // Sound previews (hover in the pickers). warm() must run inside a click so the browser lets audio start.
    warm() { try { initAudio(); } catch { /* already running */ } ensure().then(() => routeSafeOutput()).catch(() => {}); },
    // the highest level of the last moment, as Strudel makes it (above 1 would have clipped without the limiter)
    peak() {
      const s = safe;
      if (!s || s.on === null) return 0;
      s.meter.getFloatTimeDomainData(s.buf);
      let p = 0; for (let i = 0; i < s.buf.length; i++) { const v = Math.abs(s.buf[i]); if (v > p) p = v; }
      return p;
    },
    limiterOn: () => getPrefs().safeOutput !== false,
    // how many times the speakers ran dry since the page loaded (the computer could not keep up). Chrome-based browsers only; null elsewhere.
    underruns() { try { const n = getAudioContext().playbackStats?.underrunEvents; return Number.isFinite(n) ? n : null; } catch { return null; } },
    isReady: () => !!repl,
    async preview({ id, kind, bank, pitched }) {
      if (!repl) return false;
      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        const dur = 0.8;
        await superdough({ s: id, ...(pitched ? { note: kind === 'soundfont' ? 'c4' : 'c3' } : {}), ...(bank ? { bank } : {}), gain: 0.8, duration: dur, release: 0.3 }, ctx.currentTime + 0.02, dur, 0.5, 0.5);
        return true;
      } catch { return false; }
    },
    cps: () => repl?.scheduler?.cps ?? 0.5,
    // the live pattern and clock, for the display-only views
    nowCycle: () => { try { return repl?.scheduler?.now?.() ?? 0; } catch { return 0; } },
    haps: (a, b) => { try { return repl?.state?.pattern?.queryArc(a, b) ?? []; } catch { return []; } },
    analyser: (kind, id) => { try { return getAnalyzerData(kind, id); } catch { return null; } },
  };

  onPrefs(() => routeSafeOutput());
  document.addEventListener('strudel.log', (e) => {
    const { message, type } = e.detail || {};
    if (/not found|error|failed/i.test(message || '')) setStatus('warn', String(message).replace(/^\[.*?\]\s*/, ''));
  });
  return api;
}
