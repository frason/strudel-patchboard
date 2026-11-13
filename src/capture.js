// Developer-only audio capture (loaded only by `npm run dev`; never part of the build).
// It listens to whatever reaches the speakers, then reports numbers a person (or an assistant that cannot hear) can read:
// loudness over time, where each note starts, how fast it fades in and out, the strongest frequencies, and a spectrogram.
// Use from the browser console:   await __capture.record(4)   then   __capture.analyze(rec)   and   __capture.spectrogram(rec)
const orig = AudioNode.prototype.connect;
let tapIn = null, ctxTap = null, chunks = null, sampleRate = 44100;

function ensureTap(ctx) {
  if (tapIn) return;
  ctxTap = ctx; sampleRate = ctx.sampleRate;
  tapIn = ctx.createGain();
  const proc = ctx.createScriptProcessor(4096, 2, 2);
  const mute = ctx.createGain(); mute.gain.value = 0;
  proc.onaudioprocess = (e) => { if (chunks) chunks.push([new Float32Array(e.inputBuffer.getChannelData(0)), new Float32Array(e.inputBuffer.getChannelData(1))]); };
  orig.call(tapIn, proc); orig.call(proc, mute); orig.call(mute, ctx.destination);
}
AudioNode.prototype.connect = function (dest, ...rest) {
  const r = orig.call(this, dest, ...rest);
  // only the live output is tapped: offline contexts (Strudel renders reverb impulses in one) also have a destination, and must be left alone
  if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode && !(dest.context instanceof OfflineAudioContext)) {
    ensureTap(dest.context);
    if (this !== tapIn && this.context === tapIn.context) orig.call(this, tapIn);
  }
  return r;
};

function fft(re, im) {                       // in-place radix-2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
}
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
function spectrum(x, start, size = 8192) {   // magnitude spectrum in dB (relative to the strongest bin) of a Hann-windowed slice
  const re = new Float32Array(size), im = new Float32Array(size);
  for (let i = 0; i < size; i++) re[i] = (x[start + i] || 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  fft(re, im);
  const mag = new Float32Array(size / 2); let mx = 1e-12;
  for (let i = 0; i < size / 2; i++) { mag[i] = Math.hypot(re[i], im[i]); if (mag[i] > mx) mx = mag[i]; }
  return { mag, mx, hz: sampleRate / size };
}
const centroid = (s) => { let a = 0, b = 0; for (let i = 1; i < s.mag.length; i++) { a += i * s.hz * s.mag[i]; b += s.mag[i]; } return b ? a / b : 0; };
function peaks(s, n = 6) {
  const out = [];
  for (let i = 2; i < s.mag.length - 2; i++) if (s.mag[i] > s.mag[i - 1] && s.mag[i] >= s.mag[i + 1] && db(s.mag[i] / s.mx) > -40) out.push({ hz: Math.round(i * s.hz), db: Math.round(db(s.mag[i] / s.mx)) });
  out.sort((a, b) => b.db - a.db);
  const kept = [];
  for (const p of out) if (kept.every((k) => Math.abs(k.hz - p.hz) > 25)) kept.push(p);
  return kept.slice(0, n).sort((a, b) => a.hz - b.hz);
}

window.__capture = {
  // record what is playing for `seconds` (start playback first: the browser only allows sound after a click)
  async record(seconds = 4) {
    if (!tapIn) throw new Error('no audio yet: press Play on the board first, then record');
    chunks = [];
    let prePeak = 0;   // the level as Strudel makes it, before the app's safe-output limiter (if it is on)
    const poll = setInterval(() => { try { prePeak = Math.max(prePeak, window.__engine?.peak?.() || 0); } catch { /* ignore */ } }, 40);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    clearInterval(poll);
    const got = chunks; chunks = null;
    const n = got.reduce((a, c) => a + c[0].length, 0), l = new Float32Array(n), rr = new Float32Array(n);
    let o = 0; for (const c of got) { l.set(c[0], o); rr.set(c[1], o); o += c[0].length; }
    const mono = new Float32Array(n); for (let i = 0; i < n; i++) mono[i] = (l[i] + rr[i]) / 2;
    return { mono, l, r: rr, sampleRate, prePeak };
  },
  analyze(rec, minGapMs = 160) {
    const x = rec.mono, sr = rec.sampleRate, win = Math.round(sr * 0.02), nw = Math.floor(x.length / win);
    const env = new Float32Array(nw); let peak = 0, clipped = 0;
    for (let w = 0; w < nw; w++) { let s = 0; for (let i = 0; i < win; i++) { const v = x[w * win + i]; s += v * v; const a = Math.abs(v); if (a > peak) peak = a; if (a >= 0.999) clipped++; } env[w] = Math.sqrt(s / win); }
    const envDb = Array.from(env, db), top = Math.max(...envDb);
    const onsets = []; let last = -99;
    for (let w = 3; w < nw - 1; w++) {
      const before = Math.min(envDb[w - 1], envDb[w - 2], envDb[w - 3]);
      if (envDb[w] > -50 && envDb[w] - before > 6 && w - last > Math.round(minGapMs / 20)) { onsets.push(w); last = w; }
    }
    const notes = onsets.map((w, i) => {
      const end = Math.min(nw, onsets[i + 1] ?? nw, w + 60);                      // look at most 1.2 s ahead, or until the next note
      let pk = w; for (let k = w; k < end; k++) if (env[k] > env[pk]) pk = k;
      const p = env[pk]; let k = pk; while (k < end && env[k] > p * 0.1) k++;     // time until it has fallen 20 dB
      let a = w; while (a < pk && env[a] < p * 0.9) a++;
      const s = spectrum(x, Math.max(0, pk * win - 2048));
      return { t: +((w * win) / sr).toFixed(2), peakDb: Math.round(db(p)), attackMs: Math.round(((a - w) * win * 1000) / sr), fallToMinus20dbMs: k >= end ? null : Math.round(((k - pk) * win * 1000) / sr), centroidHz: Math.round(centroid(s)), partials: peaks(s, 5) };
    });
    const lw = envDb.indexOf(top), os = spectrum(x, Math.max(0, Math.min(x.length - 8192, lw * win - 4096)));
    const overall = { centroidHz: Math.round(centroid(os)), partials: peaks(os, 8) };   // the spectrum at the loudest moment, for sounds with no separate notes
    return { prePeakDb: rec.prePeak ? Math.round(db(rec.prePeak)) : null, overall, seconds: +(x.length / sr).toFixed(2), peak: +peak.toFixed(3), peakDb: Math.round(db(peak)), loudestWindowDb: Math.round(top), silentPercent: Math.round((100 * envDb.filter((d) => d < -60).length) / nw), clippedSamples: clipped, notes: notes.length, noteList: notes.slice(0, 12) };
  },
  // a picture: time left to right, frequency (log scale, 40 Hz .. 12 kHz) bottom to top, brightness = loudness
  spectrogram(rec, width = 640, height = 260) {
    const x = rec.mono, sr = rec.sampleRate, size = 2048, hop = Math.max(1, Math.floor((x.length - size) / width));
    const cv = document.createElement('canvas'); cv.width = width; cv.height = height; const g = cv.getContext('2d'), img = g.createImageData(width, height);
    for (let c = 0; c < width; c++) {
      const s = spectrum(x, c * hop, size);
      for (let y = 0; y < height; y++) {
        const f = 40 * Math.pow(12000 / 40, 1 - y / height), bin = Math.min(s.mag.length - 1, Math.round(f / s.hz)), d = Math.max(0, 1 + db(s.mag[bin] / 30) / 70), v = Math.min(255, Math.floor(d * 255)), i = (y * width + c) * 4;
        img.data[i] = v; img.data[i + 1] = v * 0.45; img.data[i + 2] = 255 - v * 0.3; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return cv;
  },
  show(rec) {   // pops the spectrogram over the page; call __capture.hide() to remove it
    this.hide(); const d = document.createElement('div'); d.id = '__cap'; d.style.cssText = 'position:fixed;left:180px;top:60px;z-index:99999;background:#000;padding:6px;font:11px system-ui;color:#9ab'; d.append(this.spectrogram(rec), `  0 – ${(rec.mono.length / rec.sampleRate).toFixed(1)} s, 40 Hz – 12 kHz`); document.body.append(d);
  },
  hide() { document.getElementById('__cap')?.remove(); },
};

// ---- automated checks (need the engine, so Play must have been pressed once) ----
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function play(code, settleMs = 1200, seconds = 4) {
  await window.__engine.evaluate(code); await wait(settleMs);
  const rec = await window.__capture.record(seconds); return window.__capture.analyze(rec);
}
// every starter patch: does it make sound, how loud, does it clip
window.__capture.sweep = async (items = window.__lessons(), { seconds = 4, settleMs = 2500 } = {}) => {
  const rows = [];
  for (const it of items) {
    try {
      const a = await play(it.code, settleMs, seconds);
      const verdict = a.silentPercent > 90 || a.peakDb < -50 ? 'FAIL silent' : a.prePeakDb != null && a.prePeakDb > 0 ? 'WARN over 0 dB before the limiter' : a.clippedSamples > 0 ? 'WARN clips' : a.peakDb > -1 ? 'WARN very loud' : a.silentPercent > 92 ? 'WARN mostly quiet' : 'ok';
      rows.push({ name: it.title || it.name, verdict, peakDb: a.peakDb, beforeLimiterDb: a.prePeakDb, loudDb: a.loudestWindowDb, silent: a.silentPercent + '%', clipped: a.clippedSamples, notes: a.notes });
    } catch (e) { rows.push({ name: it.title || it.name, verdict: 'FAIL ' + e.message }); }
  }
  return rows;
};
// does each control still do what it says? Each check compares two patches.
window.__capture.suite = async () => {
  const out = [], note = '"c3 c3"';
  const t = (name, pass, detail) => out.push({ name, pass, detail });
  const a1 = await play(`note(${note}).s("sawtooth").attack(0.001).decay(0.3).sustain(0).release(0.1)`), a2 = await play(`note(${note}).s("sawtooth").attack(0.3).decay(0.3).sustain(0).release(0.1)`);
  const at1 = a1.noteList[0]?.attackMs, at2 = a2.noteList[0]?.attackMs;
  t('attack setting changes how fast a note fades in', at1 != null && at2 != null && at2 - at1 > 150, `attack 0.001s -> ${at1} ms, attack 0.3s -> ${at2} ms`);
  const d1 = await play(`note(${note}).s("sawtooth").attack(0.001).decay(0.1).sustain(0).release(0.05)`), d2 = await play(`note(${note}).s("sawtooth").attack(0.001).decay(0.6).sustain(0).release(0.05)`);
  const f1 = d1.noteList[0]?.fallToMinus20dbMs, f2 = d2.noteList[0]?.fallToMinus20dbMs;
  t('decay setting changes how fast a note dies away', f1 != null && (f2 == null || f2 > f1 * 2), `decay 0.1s -> ${f1} ms, decay 0.6s -> ${f2 ?? 'longer than 1.2 s'} ms`);
  const m0 = await play(`note(${note}).s("sine").fm(0).fmh(2).release(0.1)`), m8 = await play(`note(${note}).s("sine").fm(8).fmh(2).release(0.1)`);
  t('FM index adds brightness', m8.overall.centroidHz > m0.overall.centroidHz * 3, `index 0 -> ${m0.overall.centroidHz} Hz, index 8 -> ${m8.overall.centroidHz} Hz`);
  t('FM index adds overtones', m8.overall.partials.length > m0.overall.partials.length + 2, `${m0.overall.partials.length} partials -> ${m8.overall.partials.length}`);
  const h1 = await play(`note(${note}).s("sine").fm(6).fmh(1).release(0.1)`), h3 = await play(`note(${note}).s("sine").fm(6).fmh(3.5).release(0.1)`);
  const sp = (a) => { const p = a.overall.partials.map((q) => q.hz); return p.length > 1 ? p[1] - p[0] : 0; };
  t('FM harmonic changes the overtone spacing', Math.abs(sp(h3) - sp(h1)) > 60, `fmh 1 -> ${sp(h1)} Hz apart, fmh 3.5 -> ${sp(h3)} Hz apart`);
  const s0 = await play(`note(${note}).s("sine").fm(4).fmh(1).release(0.1)`), s2 = await play(`note(${note}).s("sine").fm(4).fmh(1).fm2(6).fmh2(2).release(0.1)`);
  t('a second modulator adds more overtones', s2.overall.partials.length > s0.overall.partials.length || s2.overall.centroidHz > s0.overall.centroidHz * 1.15, `centroid ${s0.overall.centroidHz} -> ${s2.overall.centroidHz} Hz`);
  const q = await play(`note("c3 c3").s("sawtooth").attack(0.001).decay(0.1).sustain(0).release(0.05).room(0)`), w = await play(`note("c3 c3").s("sawtooth").attack(0.001).decay(0.1).sustain(0).release(0.05).room(1).roomsize(6)`);
  const rq = q.noteList[0]?.fallToMinus20dbMs, rw = w.noteList[0]?.fallToMinus20dbMs;
  t('reverb makes the tail longer', rq != null && (rw == null || rw > rq * 1.5), `dry: falls 20 dB in ${rq} ms, with reverb: ${rw == null ? 'more than 1.2 s' : rw + ' ms'}`);
  await window.__engine.evaluate('silence'); await wait(5000);
  const fe0 = await play(`note(${note}).s("sawtooth").lpf(300).release(0.1)`, 2500), fe1 = await play(`note(${note}).s("sawtooth").lpf(300).lpenv(6).lpa(0.01).lpd(0.25).lps(0).release(0.1)`), fe2 = await play(`note(${note}).s("sawtooth").lpf(300).lpenv(6).lpa(0.3).lpd(0.25).lps(0).release(0.1)`);
  t('filter envelope opens the filter on each note', fe1.overall.centroidHz > fe0.overall.centroidHz * 4, `no envelope ${fe0.overall.centroidHz} Hz, envelope 6 ${fe1.overall.centroidHz} Hz`);
  t('a slow filter attack delays the opening', fe2.overall.centroidHz < fe1.overall.centroidHz / 3, `attack 10 ms ${fe1.overall.centroidHz} Hz, attack 300 ms ${fe2.overall.centroidHz} Hz at the loudest moment`);
  out.push(...(await window.__capture.matrixSuite()));
  out.push(...(await window.__capture.mixSuite()));
  out.push(...(await window.__capture.randSuite()));
  return out;
};

// the FM matrix: operators 3 and 4, and routes that are not part of the plain chain
window.__capture.matrixSuite = async () => {
  const out = [], n = 'note("c3 c3")', t = (name, pass, detail) => out.push({ name, pass, detail });
  const warm = async () => { await window.__engine.evaluate('silence'); await wait(5000); };
  const pl = (a) => a.overall.partials.map((p) => p.hz);
  const differs = (a, b) => { const A = pl(a), B = pl(b); return A.filter((x) => !B.some((y) => Math.abs(x - y) < 12)).length >= 3; };
  const base = '.s("sine").fm(2).fmh(1).fm2(2).fmh2(2)';
  await warm();
  const r0 = await play(`${n}.s("sine").fm(0).release(0.1)`, 2000), r1 = await play(`${n}.s("sine").fm(0).fm20(5).fmh2(3).release(0.1)`);
  t('FM matrix route (operator 2 straight into the note) adds brightness', r1.overall.centroidHz > r0.overall.centroidHz * 3, `centroid ${r0.overall.centroidHz} -> ${r1.overall.centroidHz} Hz`);
  const c2 = await play(`${n}${base}.release(0.1)`), c3 = await play(`${n}${base}.fm3(6).fmh3(3).release(0.1)`), c4 = await play(`${n}${base}.fm3(6).fmh3(3).fm4(6).fmh4(5).release(0.1)`);
  t('operator 3 changes the overtones', differs(c2, c3), `2 operators: ${pl(c2).slice(0, 5)} Hz; 3 operators: ${pl(c3).slice(0, 5)} Hz`);
  t('operator 4 changes the overtones again', differs(c3, c4), `3 operators: ${pl(c3).slice(0, 5)} Hz; 4 operators: ${pl(c4).slice(0, 5)} Hz`);
  const u = await play(`${n}${base}.fm3(0).fmh3(3).fm13(6).release(0.1)`);
  t('a route into an operator nobody hears changes nothing', !differs(c2, u), `unchanged overtones: ${pl(u).slice(0, 5)} Hz`);
  const w0 = await play(`${n}${base}.fm3(3).fmh3(3).release(0.1)`), w1 = await play(`${n}${base}.fm3(3).fmh3(3).fm13(6).release(0.1)`);
  t('operator 1 into operator 3 changes the sound once operator 3 is heard', differs(w0, w1), `without the route: ${pl(w0).slice(0, 5)} Hz; with it: ${pl(w1).slice(0, 5)} Hz`);
  return out;
};

// level of a recording: the median of its notes' peaks (a stray echo or tail in one note cannot move it), else the global peak
const lvl = (a) => { const v = a.noteList.map((x) => x.peakDb).sort((x, y) => x - y); return v.length >= 2 ? v[Math.floor(v.length / 2)] : a.peakDb; };
// Mixer fader, Effects rack, Macro
window.__capture.mixSuite = async () => {
  const out = [], n = 'note("c3 c3")', t = (name, pass, detail) => out.push({ name, pass, detail });
  await window.__engine.evaluate('silence'); await wait(5000);
  const part = `${n}.s("sine").gain(0.8).release(0.1)`;
  const a1 = await play(`stack(${part})`, 2500), a2 = await play(`stack(${part}.postgain(0.5))`), a3 = await play(`stack(${part}.postgain(0.25))`);
  t('mixer fader halves the volume at 0.5 (about -6 dB)', Math.abs((lvl(a1) - lvl(a2)) - 6) < 1.6, `1: ${lvl(a1)} dB, 0.5: ${lvl(a2)} dB, 0.25: ${lvl(a3)} dB`);
  const lo = await play(`stack(${part}.postgain(0.5), ${n}.s("sawtooth").gain(0.4).release(0.1))`);
  t('mixer keeps the other part audible when one is turned down', lvl(lo) > lvl(a2), `part with another playing: ${lvl(lo)} dB vs alone at 0.5: ${lvl(a2)} dB`);
  const d0 = await play(`${n}.s("sawtooth").decay(0.1).sustain(0).release(0.05).delay(0)`), d1 = await play(`${n}.s("sawtooth").decay(0.1).sustain(0).release(0.05).delay(0.8).delaytime(0.1).delayfeedback(0.7)`);
  t('effects rack delay tile fills the gaps with echoes', d1.silentPercent < d0.silentPercent - 5, `silent time without delay ${d0.silentPercent}%, with delay ${d1.silentPercent}%`);
  await window.__engine.evaluate('silence'); await wait(9000);   // the delay test above leaves echoes ringing for a few seconds
  const m0 = await play(`${n}.s("sine").fm(slider(0, 0, 1).range(0, 16)).fmh(2).release(0.1)`), m1 = await play(`${n}.s("sine").fm(slider(1, 0, 1).range(0, 16)).fmh(2).release(0.1)`);
  t('macro sweep: 0 is a pure tone, 1 opens the FM index fully', m1.overall.centroidHz > m0.overall.centroidHz * 3, `macro 0: ${m0.overall.centroidHz} Hz, macro 1: ${m1.overall.centroidHz} Hz`);
  const f0 = await play(`${n}.s("sawtooth").lpf(slider(0.3, 0, 1).pow(3).range(50, 20000)).release(0.1)`), f1 = await play(`${n}.s("sawtooth").lpf(slider(0.9, 0, 1).pow(3).range(50, 20000)).release(0.1)`);
  t('macro sweep on a log knob: low macro is dark, high macro is bright', f1.overall.centroidHz > f0.overall.centroidHz * 2, `macro 0.3: ${f0.overall.centroidHz} Hz, macro 0.9: ${f1.overall.centroidHz} Hz`);
  await window.__engine.evaluate('silence'); await wait(4000);
  const u1 = await play(`${n}.s("sine").gain(0.8).postgain(slider(1, 0, 1).mul(0.8)).release(0.1)`, 2500), u2 = await play(`${n}.s("sine").gain(0.8).postgain(slider(0.5, 0, 1).mul(0.8)).release(0.1)`, 2500);
  t('macro multiply: half the macro is half the setting (about -6 dB)', Math.abs((lvl(u1) - lvl(u2)) - 6) < 1.6, `macro 1: ${lvl(u1)} dB, macro 0.5: ${lvl(u2)} dB`);
  return out;
};

// Random Notes, Random Rhythm, Shuffle: does freeze really repeat, does density really thin the rhythm?
window.__capture.randSuite = async () => {
  const out = [], t = (name, pass, detail) => out.push({ name, pass, detail });
  await window.__engine.evaluate('silence'); await wait(5000);
  const strongest = (x) => (x.partials.slice().sort((a, b) => b.db - a.db)[0] || { hz: 0 }).hz;
  const pitches = (a) => a.noteList.map(strongest);
  const sameSet = (a, b) => a.length === b.length && a.slice().sort((x, y) => x - y).every((v, i) => Math.abs(v - b.slice().sort((x, y) => x - y)[i]) < 8);
  const longRun = async (code) => { await window.__engine.evaluate(code); await wait(2500); return window.__capture.analyze(await window.__capture.record(12), 200); };
  const base = 'n(irand(7).segment(4)).scale("C3:minor").s("sine").decay(0.12).sustain(0).release(0.05)';   // short separate notes, so each one can be found
  const fresh = pitches(await longRun(base)), frozen = pitches(await longRun(base + '.ribbon(2, 1)'));
  const win = (a, i) => a.slice(i, i + 4);
  t('random notes freeze repeats the same melody every cycle', frozen.length >= 8 && sameSet(win(frozen, 0), win(frozen, 4)) && sameSet(win(frozen, 1), win(frozen, 5)), `frozen notes (Hz): ${frozen.slice(0, 8).join(', ')}`);
  t('random notes without freeze change from cycle to cycle', fresh.length >= 8 && !(sameSet(win(fresh, 0), win(fresh, 4)) && sameSet(win(fresh, 1), win(fresh, 5))), `fresh notes (Hz): ${fresh.slice(0, 8).join(', ')}`);
  const hits = async (d) => (await longRun(`s("hh").struct("x*8${d < 1 ? '?' + (1 - d).toFixed(2) : ''}").gain(0.7)`)).notes;
  const full = await hits(1), thin = await hits(0.25);
  t('random rhythm density thins the hits', thin < full * 0.6 && thin > 0, `density 1: ${full} hits in 12 s, density 0.25: ${thin} hits`);
  return out;
};

console.info('[patchboard] audio capture ready: press Play, then  const r = await __capture.record(4); __capture.analyze(r)');
