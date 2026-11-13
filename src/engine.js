// Strudel is the only clock. We hand it the compiled code string and tap the events it schedules.
import { initHydra, clearHydra, H } from './hydra.js';
import { initStrudel, initAudio, webaudioOutput, getAudioContext, samples, evalScope, ref, getAnalyzerData, superdough, getSuperdoughAudioController } from '@strudel/web';
import { getPrefs, onPrefs } from './prefs.js';
import { makeSliderWithID, sliderValues } from './slider.js';
import { registerSoundfonts } from './soundfonts.js';

const DS = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';

// Safe output: a soft limiter between Strudel's output and the speakers. Below 0.8 the signal passes untouched; above it the peaks are rounded
// off smoothly and can never pass 0.97, so a hot patch becomes a little denser instead of crackling. It is part of this app's audio path, not of the
// generated code, so it is not in the code panel and is not there when the same code runs on strudel.cc.
function softCurve() {
  const N = 8192, c = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = ((i / (N - 1)) * 2 - 1) * 2, a = Math.abs(x);   // the shaper sees -1..1; the gain before it halves the signal, so this covers -2..2
    const y = a <= 0.8 ? a : 0.8 + 0.17 * Math.tanh((a - 0.8) / 0.17);   // leaves a little margin: never above 0.97
    c[i] = Math.sign(x) * y;
  }
  return c;
}
let safe = null;
function ensureSafeOutput() {
  if (safe) return safe;
  try {
    const ctx = getAudioContext(), dg = getSuperdoughAudioController().output.destinationGain;
    if (!dg) return null;
    const pre = ctx.createGain(); pre.gain.value = 0.5;
    const shaper = ctx.createWaveShaper(); shaper.curve = softCurve(); shaper.oversample = '2x';
    const meter = ctx.createAnalyser(); meter.fftSize = 1024;
    shaper.connect(ctx.destination);
    safe = { ctx, dg, pre, shaper, meter, buf: new Float32Array(meter.fftSize), on: null };
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
    if (on) s.dg.connect(s.pre); else s.dg.connect(s.ctx.destination);
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
