// The Record window: play a MIDI keyboard (or the computer keyboard), watch the notes land on a roll, and add the take to the board.
import { openMidi } from './midiin.js';
import { createRecorder, keyToNote } from './recorder.js';
import { takeToPattern } from './takecode.js';

const KB = 'keyboard';
const SNAPS = [['4', '16ths'], ['2', '8ths'], ['12', '16ths and triplets']];
const LENGTHS = [['0', 'until I press stop'], ['4', '4 bars'], ['8', '8 bars'], ['16', '16 bars']];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// deps: { h, showModal, closeModal, getTempo() -> { bpm, beatsPerBar }, onAdd(take, grid) }
export async function openRecorder({ h, showModal, closeModal, getTempo, onAdd, onClose, addLabel = 'Add to the board' }) {
  const { bpm, beatsPerBar } = getTempo();
  const beatMs = 60000 / bpm;
  let rec = null, ctx = null, midi = null, stopListen = () => {}, source = KB, octave = 4, state = 'idle', clickTimer = 0, raf = 0, zeroPerf = 0, take = null, endTimer = 0, closed = false;
  const held = new Set();

  const status = h('div', { class: 'rec-status' }, 'Pick where the notes come from, then press Record.');
  const src = h('select', { class: 'sel', id: 'rec-source', 'aria-label': 'Where the notes come from' }, h('option', { value: KB }, 'Computer keyboard (a w s e d f t g y h u j k)'));
  const snap = h('select', { class: 'sel', id: 'rec-snap', 'aria-label': 'Snap the notes to' }, SNAPS.map(([v, l]) => h('option', { value: v }, l)));
  const len = h('select', { class: 'sel', id: 'rec-length', 'aria-label': 'How long to record' }, LENGTHS.map(([v, l]) => h('option', { value: v }, l)));
  const countIn = h('input', { type: 'checkbox', id: 'rec-countin', checked: true }), metro = h('input', { type: 'checkbox', id: 'rec-metro', checked: true });
  const canvas = h('canvas', { class: 'rec-roll', width: 760, height: 150, role: 'img', 'aria-label': 'The notes recorded so far' });
  const goBtn = h('button', { class: 'btn', id: 'rec-go' }, '● Record'), addBtn = h('button', { class: 'btn', id: 'rec-add', disabled: true }, addLabel), closeBtn = h('button', { class: 'btn ghost', id: 'rec-close' }, 'Close');
  const row = (label, ...kids) => h('label', { class: 'field rec-field' }, h('span', {}, label), ...kids);
  const body = h('div', { class: 'rec' },
    h('p', { class: 'imp-hint' }, `Tempo ${Math.round(bpm * 10) / 10} BPM, ${beatsPerBar} beats a bar (the Output module's tempo). A click counts you in. Play, then press Stop.`),
    row('notes from', src), row('snap to', snap), row('length', len),
    h('div', { class: 'rec-checks' }, h('label', {}, countIn, ' count in one bar'), h('label', {}, metro, ' click while recording')),
    canvas, status, h('div', { class: 'modal-btns' }, goBtn, addBtn, closeBtn));
  for (const x of [src, snap, len, countIn, metro]) x.addEventListener('keydown', (e) => e.stopPropagation());

  // ---- listening ----
  const nowMs = () => performance.now();
  const noteOn = (n, v, ts) => { if (state === 'recording' || state === 'counting') rec?.noteOn(n, v, ts); };
  const noteOff = (n, ts) => { rec?.noteOff(n, ts); };
  const tone = (n, on) => {   // a small sound for the computer keyboard (a MIDI keyboard makes its own)
    if (!ctx) return;
    if (on) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = 440 * 2 ** ((n - 69) / 12); g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.01); o.connect(g); g.connect(ctx.destination); o.start(); held.add({ n, o, g }); }
    else for (const k of [...held]) if (k.n === n) { k.g.gain.cancelScheduledValues(ctx.currentTime); k.g.gain.setTargetAtTime(0, ctx.currentTime, 0.05); k.o.stop(ctx.currentTime + 0.3); held.delete(k); }
  };
  const down = new Set();
  const onKeyDown = (e) => {
    if (closed || source !== KB || e.repeat || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '')) return;
    if (e.key === 'z') { octave = clamp(octave - 1, 0, 8); return; }
    if (e.key === 'x') { octave = clamp(octave + 1, 0, 8); return; }
    const n = keyToNote(e.key.toLowerCase(), octave); if (n === null || down.has(e.key)) return;
    down.add(e.key); e.preventDefault(); tone(n, true); noteOn(n, 0.8, e.timeStamp || nowMs());
  };
  const onKeyUp = (e) => {
    const k = e.key.toLowerCase(), n = keyToNote(k, octave); if (n === null) return;
    // release the note that this key started (the octave may have moved since): find it from the held set by key
    down.delete(e.key); tone(n, false); noteOff(n, e.timeStamp || nowMs());
  };
  document.addEventListener('keydown', onKeyDown, true); document.addEventListener('keyup', onKeyUp, true);
  const listen = () => {
    stopListen(); stopListen = () => {};
    if (source !== KB && midi?.listen) stopListen = midi.listen(source, (kind, n, v, ts) => (kind === 'on' ? noteOn(n, v, ts) : noteOff(n, ts)));
  };
  src.addEventListener('change', () => { source = src.value; src.blur(); listen(); });

  // ---- the roll ----
  const draw = () => {
    const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height; c.clearRect(0, 0, W, H);
    c.fillStyle = '#0b0f13'; c.fillRect(0, 0, W, H);
    const evs = rec ? rec.peek(nowMs()) : take ? take.events : [], limit = Number(len.value) * beatsPerBar;
    const nowBeat = state === 'recording' ? rec.beat(nowMs()) : 0;
    const span = Math.max(beatsPerBar * 4, limit || 0, Math.ceil(Math.max(0, nowBeat, ...evs.map((e) => e.t + e.d)) / beatsPerBar) * beatsPerBar + beatsPerBar);
    const lo = evs.length ? Math.min(...evs.map((e) => e.n)) - 2 : 55, hi = evs.length ? Math.max(...evs.map((e) => e.n)) + 2 : 79, rows = Math.max(12, hi - lo + 1), rh = H / rows, px = W / span;
    for (let b = 0; b <= span; b++) { c.strokeStyle = b % beatsPerBar === 0 ? '#3a4a58' : '#1b242d'; c.lineWidth = 1; c.beginPath(); c.moveTo(b * px, 0); c.lineTo(b * px, H); c.stroke(); }
    for (const e of evs) { c.fillStyle = `rgba(232,168,90,${0.45 + 0.55 * e.v})`; c.fillRect(e.t * px, H - (e.n - lo + 1) * rh, Math.max(3, e.d * px - 1), Math.max(3, rh - 1)); }
    if (state === 'recording') { c.strokeStyle = '#ff6b6b'; c.lineWidth = 2; c.beginPath(); c.moveTo(nowBeat * px, 0); c.lineTo(nowBeat * px, H); c.stroke(); }
    if (state === 'recording') {
      const bar = Math.floor(nowBeat / beatsPerBar) + 1, bt = Math.floor(nowBeat % beatsPerBar) + 1;
      status.textContent = `Recording: bar ${bar}, beat ${bt} · ${evs.length} note${evs.length === 1 ? '' : 's'}${rec.held() ? ` (${rec.held()} held)` : ''}`;
      if (limit && nowBeat >= limit) stop();
    }
    raf = requestAnimationFrame(draw);
  };

  // ---- the click and the transport ----
  const startClicks = (countBeats) => {
    const beatSec = 60 / bpm, c0 = ctx.currentTime + 0.12; let next = 0;
    zeroPerf = nowMs() + 120 + countBeats * beatMs;
    const tick = () => {
      while (c0 + next * beatSec < ctx.currentTime + 0.15) {
        const i = next++, beatIn = i - countBeats;
        if (i < countBeats || metro.checked) {
          const o = ctx.createOscillator(), g = ctx.createGain(), t = c0 + i * beatSec, accent = (beatIn < 0 ? i : beatIn) % beatsPerBar === 0;
          o.frequency.value = accent ? 1500 : 1000; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
          o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.06);
        }
      }
    };
    tick(); clickTimer = setInterval(tick, 25);
  };
  const begin = async () => {
    if (state !== 'idle') return;
    take = null; addBtn.disabled = true;
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); await ctx.resume(); } catch { ctx = null; }
    const countBeats = countIn.checked ? beatsPerBar : 0;
    if (ctx) startClicks(countBeats); else zeroPerf = nowMs() + 120 + countBeats * beatMs;
    rec = createRecorder({ bpm, beatsPerBar, zeroMs: zeroPerf, maxBeats: 64 * beatsPerBar });
    state = countBeats ? 'counting' : 'recording'; goBtn.textContent = '■ Stop'; src.disabled = true; len.disabled = true;
    status.textContent = countBeats ? 'Counting in…' : 'Recording…';
    if (countBeats) endTimer = setTimeout(() => { if (state === 'counting') state = 'recording'; }, zeroPerf - nowMs());
    cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
  };
  const stop = () => {
    if (state === 'idle') return;
    clearInterval(clickTimer); clearTimeout(endTimer);
    take = rec.stop(nowMs()); rec = null; state = 'idle'; goBtn.textContent = '● Record again'; src.disabled = false; len.disabled = false;
    const r = take.events.length ? takeToPattern(take, { grid: Number(snap.value) }) : null;
    addBtn.disabled = !r;
    status.textContent = r ? `${take.events.length} note${take.events.length === 1 ? '' : 's'} over ${r.bars} bar${r.bars === 1 ? '' : 's'}. Press "${addLabel}", or record again.` : 'No notes were played. Press Record and try again.';
  };
  goBtn.addEventListener('click', () => (state === 'idle' ? begin() : stop()));
  addBtn.addEventListener('click', () => { if (take?.events.length) { onAdd(take, Number(snap.value)); closeBtn.click(); } });
  const finish = () => { closed = true; stop(); cancelAnimationFrame(raf); stopListen(); document.removeEventListener('keydown', onKeyDown, true); document.removeEventListener('keyup', onKeyUp, true); for (const k of [...held]) tone(k.n, false); try { ctx?.close(); } catch { /* ignore */ } };
  closeBtn.addEventListener('click', () => closeModal());   // closing the window also runs finish (see onClose)

  showModal('Record from a keyboard', body);
  onClose?.(finish);
  raf = requestAnimationFrame(draw);
  midi = await openMidi();
  if (midi.error) status.textContent = midi.error;
  else {
    const fill = () => {
      const list = midi.inputs();
      src.replaceChildren(h('option', { value: KB }, 'Computer keyboard (a w s e d f t g y h u j k)'), ...list.map((i) => h('option', { value: i.id }, i.name)));
      if (list.length && source === KB) { source = list[0].id; }
      src.value = source; listen();
      status.textContent = list.length ? `${list.length} MIDI input${list.length === 1 ? '' : 's'} found. Press Record and play.` : 'No MIDI keyboard found: plug one in, or play the computer keyboard.';
    };
    fill(); midi.onChange(fill);
  }
  return { finish };
}
