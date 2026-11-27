// Strudel is the only clock. We hand it the compiled code string and tap the events it schedules.
import { initStrudel, initAudio, webaudioOutput, getAudioContext, samples, evalScope, ref, getAnalyzerData, superdough, getSuperdoughAudioController, soundMap, getSampleBuffer, aliasBank } from '@strudel/web';
import { approvedPacks, validPack, cleanPack } from './packs.js';
import DRUM_ALIASES from './drum-aliases.json';
import { REC_MAX_SECONDS } from './wav.js';
import { exclusive } from './evallock.js';
import { getPrefs, onPrefs } from './prefs.js';
import { makeSliderWithID, sliderValues } from './slider.js';
import { registerSoundfonts } from './soundfonts.js';
import { guardCode, isTooDense } from './guard.js';
import { bindPlayerClock } from './snapshot.js';

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
    const tap = ctx.createGain(); shaper.connect(tap);   // what the speakers get, for recording (a recording hears the limiter too)
    safe = { ctx, dg, comp, trim, pre, shaper, tap, meter, buf: new Float32Array(meter.fftSize), on: null };
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
    if (on) s.dg.connect(s.comp); else { s.dg.connect(s.ctx.destination); s.dg.connect(s.tap); }
    s.pre.disconnect(); if (on) s.pre.connect(s.shaper);
    s.on = on;
  } catch { /* leave the output as it was */ }
}

// iPhones mute Web Audio when the ring/silent switch is on silent, unless the page counts as playing media. Two ways to say so, both
// started from a tap: the audio session type (Safari 16.4+), and a looping silent <audio> element (older iOS).
let keepAlive = null;
// Only phones and tablets have a silent switch to get around; on a computer the keep-alive <audio> element is one more thing for the browser to run.
const isTouchApple = () => { try { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); } catch { return false; } };
function unlockAudioSession() {
  if (!isTouchApple()) return;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
  try {
    if (!keepAlive) {
      const n = 800, b = new Uint8Array(44 + n), dv = new DataView(b.buffer), w = (o, s) => [...s].forEach((c, i) => b.set([c.charCodeAt(0)], o + i));
      w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
      b.fill(128, 44);   // 8-bit silence
      keepAlive = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
      keepAlive.loop = true; keepAlive.setAttribute('playsinline', ''); keepAlive.setAttribute('aria-hidden', 'true');
    }
    keepAlive.play()?.catch(() => {});
  } catch { /* the sound still plays when the switch is on ring */ }
}


// The recorder: an audio worklet that turns what reaches the speakers into 16-bit stereo pieces and posts them to the page (the page never touches the audio thread).
const REC_WORKLET = `class PbRec extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.n = 0; this.buf = new Int16Array(8192); this.port.onmessage = (e) => { if (e.data === 'stop') { this.flush(); this.on = false; } }; }
  flush() { if (!this.n) return; this.port.postMessage(this.buf.slice(0, this.n)); this.n = 0; }
  process(inputs) {
    if (!this.on) return false;
    const x = inputs[0];
    if (x && x.length) {
      const l = x[0], r = x[1] || x[0], q = (v) => (v > 1 ? 32767 : v < -1 ? -32768 : Math.round(v * 32767));
      for (let i = 0; i < l.length; i++) { this.buf[this.n++] = q(l[i]); this.buf[this.n++] = q(r[i]); }
      if (this.n >= 8192 - 256) this.flush();
    }
    return true;
  }
}
registerProcessor('pb-rec', PbRec);`;

export function createEngine() {
  const late = { count: 0, at: 0, by: 0 };   // notes that reached the audio player after their moment had passed (they are skipped, with only a console message)
  let repl = null;
  let starting = null;
  bindPlayerClock(() => repl?.scheduler?.cps ?? 0.5, () => repl?.scheduler?.now?.() ?? 0);   // lets an offline query put the player's tempo hook back after it runs (snapshot.js)
  let playing = false;
  const hapSubs = new Set();
  const statusSubs = new Set();
  let status = { state: 'idle', message: '' };
  let evalSeq = 0;
  const packsLoaded = new Set();

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
      if (t - ctx.currentTime < 0.002) { late.count++; late.at = Date.now(); late.by = Math.max(late.by, ctx.currentTime - t); }   // handed over too late: Strudel's audio player will skip this note
      const durMs = Math.max(90, duration * 1000);
      const locations = hap.context?.locations || [];
      hapSubs.forEach((f) => f({ locations, delayMs, durMs, value: hap.value }));
    } catch (e) { /* visuals must never break audio */ }
    return webaudioOutput(hap, deadline, duration, cps, t);
  };

  // Strudel skips notes it cannot play on time and only says so in the console: when the page is too busy (or the tab was in the background) its clock misses a
  // stretch of the pattern ("skip query: too late"), or a note reaches the audio player after its moment ("cannot schedule sounds in the past", "skip hap").
  // Count those messages, so the app can say that notes were skipped instead of leaving a gap that nobody can explain.
  let watching = false;
  const SKIP = /skip query: too late|cannot schedule sounds in the past|skip hap: still loading/;
  const watchSkips = () => {
    if (watching) return; watching = true;
    for (const k of ['log', 'warn']) {
      const orig = console[k].bind(console);
      console[k] = (...a) => { try { const m = typeof a[0] === 'string' ? a[0] : ''; if (SKIP.test(m)) { late.count++; late.at = Date.now(); } } catch { /* never in the way of logging */ } orig(...a); };
    }
  };
  async function ensure() {
    watchSkips();
    if (repl) return repl;
    if (!starting) {
      starting = (async () => {
        setStatus('loading', 'loading sounds…');
        const r = await initStrudel({
          defaultOutput,
          onEvalError: (e) => setStatus('error', e.message),
          prebake: async () => {
            await evalScope({ sliderWithID: makeSliderWithID(ref) });
            registerSoundfonts(); // General MIDI instruments: nothing downloads until one is played
            const results = await Promise.allSettled([
              samples(`${DS}/tidal-drum-machines.json`),
              samples(`${DS}/piano.json`),
              samples('github:tidalcycles/dirt-samples'),
              samples('github:switchangel/breaks'), // public-domain break loops: s("breaks")
              samples('github:switchangel/pad'),    // public-domain pad: s("swpad")
              ...approvedPacks().map((spec) => { packsLoaded.add(spec); return samples(spec); }),   // packs the person said yes to when importing code that asked for them
            ]);
            // short names for the drum machines (dr550_bd, tr808_cp, linn_sd ...), the same ones strudel.cc has: s("dr550_bd") plays BossDR550_bd. The list is kept in this app, because the page may only fetch from GitHub.
            try { await aliasBank({ ...DRUM_ALIASES }); } catch (e) { console.warn('[patchboard] drum machine names failed', String(e)); }
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
    async start(code, { prepare } = {}) {
      unlockAudioSession();                // inside the click: lets sound play with the iPhone silent switch on
      const audio = initAudio();           // inside the click, before any await that could lose the gesture
      await audio;
      await ensure();
      routeSafeOutput();
      // prepare() runs before the first note: it downloads the sounds the piece will use, so playing starts only once they are here. It may return false to cancel.
      if (prepare && (await prepare()) === false) { setStatus('ready', ''); return; }
      playing = true;
      if ((await api.evaluate(code)) === false) playing = false;
    },
    // Sample packs the person approved (github:user/repo): their sound lists are fetched and registered. The sound files themselves come with download().
    async addPacks(specs) {
      await ensure();
      for (const spec of specs.map(cleanPack).filter(validPack)) {
        if (packsLoaded.has(spec)) continue;
        await samples(spec); packsLoaded.add(spec);
      }
    },
    // The sample files that playing these events needs and that are not in memory yet. events: { s, n, bank } from the offline query of the piece.
    soundNeeds(events) {
      const map = soundMap.get(), need = new Map();
      for (const e of events) {
        const s = typeof e.s === 'string' ? e.s.toLowerCase() : null; if (!s) continue;
        const bank = typeof e.bank === 'string' && e.bank ? e.bank.toLowerCase() : '';
        const key = bank && map[`${bank}_${s}`] ? `${bank}_${s}` : s, entry = map[key], data = entry && entry.data;
        if (!data || data.type !== 'sample' || !data.samples) continue;
        const n = Number.isFinite(Number(e.n)) ? Number(e.n) : 0;
        need.set(`${key}:${n}:${e.note ?? ''}`, { key, hap: { s: key, n, ...(e.note !== undefined ? { note: e.note } : {}) }, samples: data.samples });
      }
      return [...need.values()];
    },
    // Download and decode them, a few at a time. onProgress(done, total); stop() returning true cancels. Resolves to how many failed.
    async download(needs, onProgress, stop = () => false) {
      let done = 0, failed = 0, next = 0;
      const total = needs.length; onProgress?.(0, total);
      const worker = async () => {
        while (next < total && !stop()) {
          const it = needs[next++];
          try { await getSampleBuffer(it.hap, it.samples); } catch { failed++; }
          done++; onProgress?.(done, total);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
      return failed;
    },
    // Record what comes out of the speakers. Resolves to { stop() -> Promise<{ chunks, sampleRate }> }; onLimit() is called when the recording reaches its longest length.
    async record(onLimit) {
      const sf = ensureSafeOutput(); if (!sf) throw new Error('The audio has not started yet. Press play first.');
      routeSafeOutput();
      const ctx = sf.ctx;
      if (!sf.recReady) {
        const url = URL.createObjectURL(new Blob([REC_WORKLET], { type: 'text/javascript' }));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        sf.recReady = true;
      }
      const node = new AudioWorkletNode(ctx, 'pb-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }), mute = ctx.createGain(), chunks = [];
      mute.gain.value = 0; node.connect(mute); mute.connect(ctx.destination);   // a node nothing listens to may not be run: this one feeds a muted path
      let samples = 0, finished = null, hitLimit = false;
      node.port.onmessage = (e) => {
        chunks.push(e.data); samples += e.data.length;
        if (!hitLimit && samples / 2 / ctx.sampleRate >= REC_MAX_SECONDS) { hitLimit = true; onLimit?.(); }
      };
      sf.tap.connect(node);
      return {
        stop() {
          if (!finished) finished = new Promise((resolve) => {
            node.port.onmessage = (e) => { chunks.push(e.data); };
            node.port.postMessage('stop');
            setTimeout(() => { try { sf.tap.disconnect(node); node.disconnect(); mute.disconnect(); } catch { /* already gone */ } resolve({ chunks, sampleRate: ctx.sampleRate }); }, 120);
          });
          return finished;
        },
        get seconds() { return samples / 2 / ctx.sampleRate; },
      };
    },
    async evaluate(code) {
      if (!repl) return false;
      const refused = guardCode(code);   // only code made of the shapes the compiler writes is ever evaluated
      if (refused) { setStatus('error', 'Not played: ' + refused + (isTooDense(refused) ? '. Nothing was run.' : '. This patch contains something Patchboard does not allow, so nothing was run.')); return false; }
      const seq = ++evalSeq;
      setStatus('ok', '');
      // An orbit (mix bus) only exists once the first sound has played on it, and .duck("3") on a kick that hits before that logs
      // "duck target orbit 3 does not exist". Create the orbits that the code ducks up front.
      try {
        const ctrl = getSuperdoughAudioController();
        for (const m of code.matchAll(/\.duck\(\s*["'`]?([\d:\s]+)/g)) for (const n of m[1].split(/[:\s]+/).filter(Boolean)) ctrl.getOrbit(Number(n), [0, 1]);
      } catch { /* the sound will still play; at worst the first hit is not ducked */ }
      await exclusive(() => repl.evaluate(code, playing));   // never while the offline evaluator is mid-evaluation (see evallock.js)
      if (seq === evalSeq && repl.state.evalError) setStatus('error', repl.state.evalError.message);
      else if (seq === evalSeq) setStatus(playing ? 'playing' : 'ready', '');
      return true;
    },
    stop() {
      playing = false;
      try { keepAlive?.pause(); } catch { /* ignore */ }
      repl?.stop();
      setStatus('ready', '');
    },
    setSlider(id, value) { sliderValues[id] = value; },
    // Sound previews (hover in the pickers). warm() must run inside a click so the browser lets audio start.
    warm() { unlockAudioSession(); try { initAudio(); } catch { /* already running */ } ensure().then(() => routeSafeOutput()).catch(() => {}); },
    // the highest level of the last moment, as Strudel makes it (above 1 would have clipped without the limiter)
    peak() {
      const s = safe;
      if (!s || s.on === null) return 0;
      s.meter.getFloatTimeDomainData(s.buf);
      let p = 0; for (let i = 0; i < s.buf.length; i++) { const v = Math.abs(s.buf[i]); if (v > p) p = v; }
      return p;
    },
    // fill buf (1024 floats) with the latest moment of the output as Strudel makes it, before the limiter; false until something has played
    waveform(buf) { const s = safe; if (!s || s.on === null) return false; s.meter.getFloatTimeDomainData(buf); return true; },
    limiterOn: () => getPrefs().safeOutput !== false,
    // how many times the speakers ran dry since the page loaded (the computer could not keep up). Chrome-based browsers only; null elsewhere.
    lateNotes: () => ({ ...late }),
    // how the audio side looks right now, for the health line in Settings
    audioInfo() {
      try { const c = getAudioContext(); return { state: c.state, sampleRate: c.sampleRate, baseLatencyMs: Math.round((c.baseLatency || 0) * 1000), outputLatencyMs: Math.round((c.outputLatency || 0) * 1000), time: c.currentTime, seconds: Math.round(c.currentTime) }; }
      catch { return null; }
    },
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
    cps: () => repl?.scheduler?.cps ?? 0.5,   // (also given to snapshot.js below, so an offline query can put the player's clock hook back)
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
