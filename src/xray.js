// The cable x-ray: pick a module ("Show what comes out" in its menu) and a small panel pins to the screen showing the events that come out of it over four cycles.
// It is a RAW TAP (compile.js compileTap): the pattern as that module leaves it, before anything downstream, so you can see what each module did to your pattern.
// Built to cost almost nothing while music plays (ROADMAP section 7: performance first):
//   - idle until a module is picked, and gone when closed (no timers, no listeners);
//   - one query at a time, results kept by the code they came from, so an edit that does not change this module's code asks nothing;
//   - edits are coalesced (it waits for a short pause), and nothing runs while the page is hidden;
//   - at most MAX_DRAWN events are drawn, and it says so when there are more.
import { compileTap } from './compile.js';
import { queryEvents, midiOf, noteName } from './snapshot.js';
import { num, onsets, bounds, midiOfControl } from './events.js';
import { MODULES } from './modules.js';

const CYCLES = 4, MAX_DRAWN = 2000, PAUSE_MS = 350;
const COLOURS = { bd: '#ff9f4a', sd: '#ff7aa8', rim: '#ff7aa8', cp: '#ff7aa8', hh: '#64a0ff', oh: '#64a0ff', cr: '#64a0ff', rd: '#64a0ff', lt: '#e0c050', mt: '#e0c050', ht: '#e0c050' };
const level = (c) => Math.max(0.15, Math.min(1, (typeof c.gain === 'number' ? c.gain : 1) * (typeof c.velocity === 'number' ? c.velocity : 1)));

// what the record looks like, as plain text (also the canvas's text alternative)
export function summarize(rec, tap) {
  const ev = onsets(rec), notes = ev.map((e) => midiOfControl(e.controls)).filter((n) => n !== null), sounds = [...new Set(ev.map((e) => e.controls.s).filter(Boolean))];
  const parts = [`${ev.length} event${ev.length === 1 ? '' : 's'} over ${CYCLES} cycles`];
  if (notes.length) parts.push(`notes ${noteName(Math.min(...notes))}${Math.max(...notes) > Math.min(...notes) ? ' to ' + noteName(Math.max(...notes)) : ''}`);
  if (sounds.length) parts.push(`sound${sounds.length === 1 ? '' : 's'} ${sounds.slice(0, 6).join(', ')}${sounds.length > 6 ? ', ...' : ''}`);
  const b = bounds(rec); if (b.carryIn) parts.push(`${b.carryIn} began before cycle 1`);
  const out = tap.outside, notApplied = [];
  if (out.master) notApplied.push('master volume and effects');
  if (out.mixer) notApplied.push('Mixer faders, mute and solo');
  if (out.orbit) notApplied.push('orbit and duck routing');
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
    const ms = pitched.map((e) => midiOfControl(e.controls)), lo = Math.min(...ms), hi = Math.max(...ms), span = Math.max(1, hi - lo);
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
export function createXray({ h, getGraph }) {
  let el = null, nodeId = null, lastKey = '', busy = false, dirty = false, timer = 0, canvas = null, line = null, after = null, applied = null, warn = null, title = null;
  const onVis = () => { if (!document.hidden) schedule(0); };
  function close() { clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); el?.remove(); el = null; nodeId = null; lastKey = ''; }
  async function refresh() {
    if (!el || document.hidden) return;
    const g = getGraph(), node = g.nodes.find((n) => n.id === nodeId);
    if (!node) return close();   // the module was deleted
    const tap = compileTap(g, nodeId);
    if (tap.error) { line.textContent = tap.error; return; }
    const key = tap.code;
    if (key === lastKey) return;   // nothing in this module's code changed: nothing to ask
    if (busy) { dirty = true; return; }
    busy = true; dirty = false;
    try {
      const rec = await queryEvents(tap.code, { from: 0, to: CYCLES });
      if (!el || nodeId !== node.id) return;
      const sum = summarize(rec, tap), capped = draw(canvas, rec, Math.min(380, window.innerWidth - 48));
      lastKey = key; title.textContent = `What comes out of ${MODULES[node.type].title}`;
      line.textContent = sum.line; after.textContent = sum.after; applied.textContent = sum.notApplied; warn.textContent = capped ? `Only the first ${MAX_DRAWN} events are drawn.` : (rec.warnings[0] || '');
      canvas.setAttribute('aria-label', `${MODULES[node.type].title} output. ${sum.line}`);
    } catch (e) { line.textContent = 'Could not read this: ' + String((e && e.message) || e).slice(0, 120); }
    finally { busy = false; if (dirty) schedule(PAUSE_MS); }
  }
  function schedule(ms = PAUSE_MS) { clearTimeout(timer); timer = setTimeout(refresh, ms); }
  return {
    get openId() { return nodeId; },
    open(id) {
      close(); nodeId = id;
      title = h('strong', { class: 'xr-title' }, 'What comes out');
      canvas = h('canvas', { role: 'img', 'aria-label': 'Events coming out of this module' });
      line = h('div', { class: 'xr-line' }, 'Reading…'); after = h('div', { class: 'xr-note' }); applied = h('div', { class: 'xr-note' }); warn = h('div', { class: 'xr-note' });
      el = h('section', { class: 'xray', role: 'region', 'aria-label': 'Cable x-ray', tabindex: '-1', onkeydown: (e) => { if (e.key === 'Escape') close(); } },
        h('div', { class: 'xr-head' }, title, h('button', { class: 'btn sm', type: 'button', title: 'Close (Esc)', onclick: close }, 'Close')),
        canvas, line, after, applied, warn,
        h('div', { class: 'xr-note xr-fine' }, 'The pattern as this module leaves it, four cycles from the start. It stays up to date as you edit.'));
      document.body.append(el); document.addEventListener('visibilitychange', onVis); schedule(0);
    },
    // for the performance harness only: read again every `ms` whether or not the code changed (the worst case, far busier than any person editing). Returns a stop function.
    stress(ms) { const t = setInterval(() => { lastKey = ''; refresh(); }, ms); return () => clearInterval(t); },
    update() { if (el) schedule(); },   // the board changed: look again after a pause (if this module's code is the same, nothing is asked)
    close,
  };
}
