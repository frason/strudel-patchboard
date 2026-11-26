// The cable x-ray: pick a module ("Show what comes out" in its menu) and a small panel pins to the screen showing the events that come out of it over four cycles.
// It is a RAW TAP (compile.js compileTap): the pattern as that module leaves it, before anything downstream, so you can see what each module did to your pattern.
// Built to cost almost nothing while music plays (ROADMAP section 7: performance first):
//   - idle until a module is picked, and gone when closed (no timers, no listeners);
//   - one query at a time, results kept by the code they came from, so an edit that does not change this module's code asks nothing;
//   - edits are coalesced (it waits for a short pause), and no new query starts while the page is hidden (one already running finishes);
//   - while the music plays, automatic updates stop once a reading has proved slow (over SLOW_MS: a query runs on the same thread as the player's scheduler and cannot be
//     interrupted, so a long one can make a note late). The last picture stays, a note says why, and the Refresh button asks once more on purpose;
//   - at most MAX_DRAWN events are drawn, and it says so when there are more. Bounding what a query may cost is not done here: queries are limited in range (snapshot.js MAX_RANGE)
//     and the guard refuses patterns that expand to absurd sizes; a query that is already running cannot be cancelled on this thread.
import { compileTap } from './compile.js';
import { queryEvents, midiOf, noteName } from './snapshot.js';
import { num, onsets, bounds, midiOfControl } from './events.js';
import { MODULES } from './modules.js';

const CYCLES = 4, MAX_DRAWN = 2000, PAUSE_MS = 350, SLOW_MS = 40;
const COLOURS = { bd: '#ff9f4a', sd: '#ff7aa8', rim: '#ff7aa8', cp: '#ff7aa8', hh: '#64a0ff', oh: '#64a0ff', cr: '#64a0ff', rd: '#64a0ff', lt: '#e0c050', mt: '#e0c050', ht: '#e0c050' };
const level = (c) => Math.max(0.15, Math.min(1, (typeof c.gain === 'number' ? c.gain : 1) * (typeof c.velocity === 'number' ? c.velocity : 1)));

// what the record looks like, as plain text (also the canvas's text alternative)
export function summarize(rec, tap) {
  const ev = onsets(rec), sounds = [...new Set(ev.map((e) => e.controls.s).filter(Boolean))];
  let lo = Infinity, hi = -Infinity;   // loops, not Math.min(...list): a long list would overflow the call
  for (const e of ev) { const n = midiOfControl(e.controls); if (n !== null) { if (n < lo) lo = n; if (n > hi) hi = n; } }
  const parts = [`${ev.length} event${ev.length === 1 ? '' : 's'} over ${CYCLES} cycles`];
  if (lo !== Infinity) parts.push(`notes ${noteName(lo)}${hi > lo ? ' to ' + noteName(hi) : ''}`);
  if (sounds.length) parts.push(`sound${sounds.length === 1 ? '' : 's'} ${sounds.slice(0, 6).join(', ')}${sounds.length > 6 ? ', ...' : ''}`);
  const b = bounds(rec); if (b.carryIn) parts.push(`${b.carryIn} began before cycle 1`);
  const out = tap.outside, notApplied = [];
  if (out.master) notApplied.push('master volume and effects');
  if (out.mixer) notApplied.push('Mixer faders, mute and solo');
  if (out.orbit) notApplied.push(out.sharedOrbit && out.sharedOrbit.length ? `orbit ${out.sharedOrbit.join(', ')} is also used by other parts (they share its reverb, delay and DJ filter)` : 'orbit and duck routing');
  return { line: parts.join(' · '), after: out.downstream.length ? `Not included, further along: ${[...new Set(out.downstream)].join(', ')}.` : 'Nothing comes after this module.', notApplied: notApplied.length ? `Not applied: ${notApplied.join('; ')}.` : '' };
}

function draw(canvas, rec, cssW) {
  const ev = onsets(rec).slice(0, MAX_DRAWN), dpr = Math.min(2, window.devicePixelRatio || 1);
  const pitched = ev.filter((e) => midiOfControl(e.controls) !== null), other = ev.filter((e) => midiOfControl(e.controls) === null);
  const lanes = [...new Set(other.map((e) => String(e.controls.s ?? e.controls.n ?? 'sound')))].sort();
  const pitchH = pitched.length ? 84 : 0, laneH = 16, H = Math.max(40, pitchH + lanes.length * (laneH + 2) + 22);
  canvas.width = cssW * dpr; canvas.height = H * dpr; canvas.style.width = cssW + 'px'; canvas.style.height = H + 'px';
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#0f1318'; c.fillRect(0, 0, cssW, H);
  const L = 44, W = cssW - L - 6, x = (t) => L + (t / CYCLES) * W;
  for (let i = 0; i <= CYCLES; i++) { c.strokeStyle = i % 1 === 0 ? 'rgba(120,230,230,.35)' : '#222'; c.lineWidth = 1; c.beginPath(); c.moveTo(x(i), 0); c.lineTo(x(i), H - 14); c.stroke(); if (i < CYCLES) { c.fillStyle = '#6a8a8a'; c.font = '10px system-ui, sans-serif'; c.fillText(String(i + 1), x(i) + 3, H - 3); } }
  let y = 0;
  if (pitched.length) {
    let lo = Infinity, hi = -Infinity; for (const e of pitched) { const m = midiOfControl(e.controls); if (m < lo) lo = m; if (m > hi) hi = m; }
    const span = Math.max(1, hi - lo);
    c.fillStyle = '#8b98a6'; c.font = '10px system-ui, sans-serif'; c.fillText(noteName(hi), 4, 12); c.fillText(noteName(lo), 4, pitchH - 6);
    for (const e of pitched) {
      const m = midiOfControl(e.controls), x0 = x(num(e.at)), w = Math.max(2, x(num(e.at) + num(e.dur)) - x0 - 1);
      c.globalAlpha = 0.35 + 0.65 * level(e.controls); c.fillStyle = '#b48cff'; c.fillRect(x0, 8 + (1 - (m - lo) / span) * (pitchH - 22), w, 6);
    }
    c.globalAlpha = 1; y = pitchH;
  }
  lanes.forEach((name, i) => {
    const y0 = y + i * (laneH + 2) + 2; c.fillStyle = '#c9d2db'; c.font = '10px system-ui, sans-serif'; c.fillText(name.slice(0, 7), 4, y0 + 12);
    for (const e of other) { if (String(e.controls.s ?? e.controls.n ?? 'sound') !== name) continue; c.globalAlpha = 0.35 + 0.65 * level(e.controls); c.fillStyle = COLOURS[name] || '#7ad68b'; c.fillRect(x(num(e.at)), y0 + 1, 3, laneH - 2); }
    c.globalAlpha = 1;
  });
  return ev.length < onsets(rec).length;
}

// h: the DOM helper; getGraph(): the board's graph now; the tempo is not needed (the x-ray is in cycles)
export function createXray({ h, getGraph, isPlaying = () => false }) {
  let el = null, nodeId = null, lastKey = '', lastRec = null, lastMs = 0, busy = false, dirty = false, timer = 0, rt = 0, gen = 0, invoker = null, canvas = null, line = null, after = null, applied = null, warn = null, title = null, pausedNote = null;
  const width = () => Math.min(380, window.innerWidth - 48);
  const onVis = () => { if (!document.hidden) schedule(0); };
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (el && lastRec) draw(canvas, lastRec, width()); }, 150); };   // redraw what we already have: no new query
  function close() {
    clearTimeout(timer); clearTimeout(rt); gen++;   // an answer still on its way is discarded
    document.removeEventListener('visibilitychange', onVis); window.removeEventListener('resize', onResize);
    el?.remove(); el = null; nodeId = null; lastKey = ''; lastRec = null;
    if (invoker && document.contains(invoker)) invoker.focus?.();   // back to the control that opened it
    invoker = null;
  }
  function show(rec, tap, node, capped) {   // the words and the picture for a record and the tap's current surroundings
    const sum = summarize(rec, tap);
    title.textContent = `What comes out of ${MODULES[node.type].title}`;
    line.textContent = sum.line; after.textContent = sum.after; applied.textContent = sum.notApplied; warn.textContent = capped ? `Only the first ${MAX_DRAWN} events are drawn.` : (rec.warnings[0] || '');
    canvas.setAttribute('aria-label', `${MODULES[node.type].title} output. ${sum.line}`);
  }
  async function refresh(manual = false) {
    if (!el || document.hidden) return;
    const g = getGraph(), node = g.nodes.find((n) => n.id === nodeId);
    if (!node) return close();   // the module was deleted
    const tap = compileTap(g, nodeId);
    if (tap.error) { line.textContent = tap.error; return; }
    const key = tap.code;
    if (key === lastKey && lastRec && !manual) { show(lastRec, tap, node, onsets(lastRec).length > MAX_DRAWN); return; }   // this module's code is the same: no query, but what lies around it may have changed, so the words are renewed
    if (!manual && lastRec && lastMs > SLOW_MS && isPlaying()) { pausedNote.textContent = `Updates are paused while the music plays: the last reading took ${Math.round(lastMs)} ms, which could make a note late. Press Refresh to read again, or stop the music.`; return; }
    pausedNote.textContent = '';
    if (busy) { dirty = true; return; }
    busy = true; dirty = false; const mine = ++gen;
    try {
      const t0 = performance.now(), rec = await queryEvents(tap.code, { from: 0, to: CYCLES }); lastMs = performance.now() - t0;
      if (!el || mine !== gen || nodeId !== node.id) return;   // closed, or a newer question was asked while this one ran
      const capped = draw(canvas, rec, width());
      lastKey = key; lastRec = rec; show(rec, tap, node, capped);
    } catch (e) { if (el && mine === gen) line.textContent = 'Could not read this: ' + String((e && e.message) || e).slice(0, 120); }
    finally { busy = false; if (dirty) schedule(PAUSE_MS); }
  }
  function schedule(ms = PAUSE_MS) { clearTimeout(timer); timer = setTimeout(refresh, ms); }
  return {
    get openId() { return nodeId; },
    open(id) {
      const was = document.activeElement; close(); nodeId = id; invoker = was && was !== document.body ? was : null;
      title = h('strong', { class: 'xr-title' }, 'What comes out');
      canvas = h('canvas', { role: 'img', 'aria-label': 'Events coming out of this module' });
      line = h('div', { class: 'xr-line', 'aria-live': 'polite' }, 'Reading…'); after = h('div', { class: 'xr-note' }); applied = h('div', { class: 'xr-note' }); warn = h('div', { class: 'xr-note' }); pausedNote = h('div', { class: 'xr-note xr-paused', 'aria-live': 'polite' }); lastMs = 0;
      el = h('section', { class: 'xray', role: 'region', 'aria-label': 'Cable x-ray', tabindex: '-1', onkeydown: (e) => { if (e.key === 'Escape') close(); } },
        h('div', { class: 'xr-head' }, title, h('span', { class: 'xr-btns' }, h('button', { class: 'btn sm', type: 'button', title: 'Read this module again now', onclick: () => refresh(true) }, 'Refresh'), h('button', { class: 'btn sm', type: 'button', title: 'Close (Esc)', onclick: close }, 'Close'))),
        canvas, line, after, applied, warn, pausedNote,
        h('div', { class: 'xr-note xr-fine' }, 'The pattern as this module leaves it, four cycles from the start. It stays up to date as you edit.'));
      document.body.append(el); document.addEventListener('visibilitychange', onVis); window.addEventListener('resize', onResize); el.focus(); schedule(0);
    },
    // for the performance harness only: read again every `ms` whether or not the code changed (the worst case, far busier than any person editing). Returns a stop function.
    stress(ms) { const t = setInterval(() => { lastKey = ''; refresh(); }, ms); return () => clearInterval(t); },
    update() { if (el) schedule(); },   // the board changed: look again after a pause (if this module's code is the same, nothing is asked)
    close,
  };
}
