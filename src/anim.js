// One shared animation clock for every animated picture (Pulse width, FM, Delay, Reverb, Distortion and the rest).
//   - A single requestAnimationFrame loop calls every picture that needs it, instead of one loop each.
//   - A picture that is scrolled or zoomed out of view, or in a hidden tab, is not called at all (an IntersectionObserver tells the clock).
//   - Each picture says how often it needs to run (30 times a second is plenty for a gentle sweep) and can say it has nothing to animate (return false).
//   - With Animations off in Settings the clock calls each picture once so it can sit still, then stops.
// `put`, `putText` and `putStyle` write to the page only when the value really changed, so a picture that is not moving costs nothing.
const entries = new Set();
const byEl = new WeakMap();
let raf = 0, profiling = false;

const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((list) => { for (const e of list) { const ent = byEl.get(e.target); if (!ent) continue; if (!e.target.isConnected) { entries.delete(ent); io.unobserve(e.target); continue; } ent.visible = e.isIntersecting; if (e.isIntersecting) ent.lastRun = 0; } wake(); }, { rootMargin: '120px' })
  : null;

export function wake() { if (!raf && !document.hidden && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame); }

function frame(now) {
  raf = 0;
  if (document.hidden) return;
  const off = !!document.querySelector('.no-anim');
  let running = 0;
  for (const ent of entries) {
    if (!ent.el.isConnected) continue;   // (the observer drops pictures that were removed from the page)
    if (!ent.visible || ent.idle) continue;
    if (off) { if (!ent.settled) { ent.settled = true; ent.tick(now, 0, true); } continue; }
    ent.settled = false;
    running++;
    if (ent.lastRun && now - ent.lastRun < ent.minGap) continue;
    const dt = ent.lastRun ? Math.min(0.1, (now - ent.lastRun) / 1000) : 0;
    ent.lastRun = now;
    const t0 = profiling ? performance.now() : 0;
    if (ent.tick(now, dt, false) === false) ent.idle = true;   // nothing moving: stop calling until kick()
    if (profiling) { ent.ms = (ent.ms || 0) + performance.now() - t0; ent.n = (ent.n || 0) + 1; }
  }
  if (running) wake();
  else if (off) { /* everything has settled: wake() is called again when Animations go back on */ }
}

// register a picture: `tick(now, dt, off)` runs while `el` is on screen. Returns { kick, stop }.
export function animate(el, tick, { fps = 60 } = {}) {
  const ent = { el, tick, minGap: 1000 / fps - 2, lastRun: 0, visible: !io, idle: false, settled: false };
  byEl.set(el, ent); entries.add(ent); io?.observe(el);
  wake();
  return { kick() { ent.idle = false; ent.settled = false; wake(); }, stop() { entries.delete(ent); io?.unobserve(el); } };
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden) { for (const e of entries) e.lastRun = 0; wake(); } });

// write only when the value changed
export const put = (el, name, v) => { const s = String(v), k = '_a_' + name; if (el[k] !== s) { el[k] = s; el.setAttribute(name, s); } };
export const putStyle = (el, prop, v) => { const s = String(v), k = '_s_' + prop; if (el[k] !== s) { el[k] = s; el.style[prop] = s; } };
export const putText = (el, v) => { const s = String(v); if (el._t !== s) { el._t = s; el.textContent = s; } };

// for the performance check: how much time each kind of picture used since profiling was switched on
export function profileAnims(on = true) { profiling = on; for (const e of entries) { e.ms = 0; e.n = 0; } }
export function animStats() {
  const by = {};
  for (const e of entries) { const k = e.el.closest?.('.node')?.dataset.type || 'other'; const r = (by[k] ||= { type: k, ms: 0, calls: 0, pictures: 0 }); r.ms += e.ms || 0; r.calls += e.n || 0; r.pictures++; }
  return Object.values(by).sort((a, b) => b.ms - a.ms);
}
if (typeof window !== 'undefined') window.__anim = { profileAnims, animStats };
