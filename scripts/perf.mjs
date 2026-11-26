// Performance check: `npm run build && npm run perf`
// Loads the production build in headless Chrome on a few boards, with nothing playing, and measures what the animated pictures cost.
// It fails if a picture gets too expensive, if pictures keep running when they are off screen, or if Animations off does not stop them.
// Needs Chrome: set CHROME_BIN if it is not in the usual place.
import fs from 'node:fs';
import { startBrowser, sleep } from './cdp.mjs';
import { MODULES } from '../src/modules.js';
import { makeNode, emptyGraph } from '../src/graph.js';
import { LESSONS } from '../src/starters.js';

const PORT = 4179, DEBUG = 9339, SECONDS = 6;
const { connect, stopAll } = await startBrowser({ port: PORT, debug: DEBUG });

// ---- the boards ----
const allAt = (dx) => { const g = emptyGraph(); Object.keys(MODULES).forEach((t, i) => g.nodes.push(makeNode(t, dx + (i % 8) * 420, Math.floor(i / 8) * 700, {}))); return g; };
const lesson = (id) => LESSONS.find((l) => l.id === id).graph();
const small = emptyGraph(); ['sample', 'delay', 'reverb', 'output'].forEach((t, i) => small.nodes.push(makeNode(t, i * 420, 0, {})));
const scenarios = [
  { name: 'empty board', graph: null, fit: false },
  { name: '4 modules in view', graph: small, fit: true },
  { name: 'whole-song lesson', graph: lesson('whole-song'), fit: true },
  { name: 'FM patch', graph: lesson('fm-routing'), fit: true },
  { name: 'all 57 modules in view', graph: allAt(0), fit: true },
  { name: 'all 57 modules, zoomed far in', graph: allAt(0), fit: true, zoomIn: 12 },
  { name: 'all 57 modules, Animations off', graph: allAt(0), fit: true, prefs: { animations: false } },
];
// what each may cost (generous: about twice what a Mac laptop measures, so only a real regression trips them)
const LIMITS = {
  'all 57 modules in view': { pictureMsPerSec: 60, rafMsPerSec: 150, layoutsPerSec: 45 },
  'FM patch': { pictureMsPerSec: 55, rafMsPerSec: 90 },   // four shakers all working: the heaviest picture
  'whole-song lesson': { pictureMsPerSec: 30, rafMsPerSec: 80 },
  '4 modules in view': { pictureMsPerSec: 15 },
  'all 57 modules, zoomed far in': { pictureCallsPerSec: 130 },
  'all 57 modules, Animations off': { pictureCallsPerSec: 5 },
};

const results = [];
for (const sc of scenarios) {
  const c = await connect();
  await c.send('Page.enable'); await c.send('Performance.enable'); await c.send('HeapProfiler.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  const { identifier } = await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.clear(); ${sc.graph ? `localStorage.setItem('pb.autosave', ${JSON.stringify(JSON.stringify(sc.graph))});` : ''} localStorage.setItem('pb.introSeen', '1'); ${sc.prefs ? `localStorage.setItem('pb.prefs', ${JSON.stringify(JSON.stringify(sc.prefs))});` : ''} } catch (e) {}
    window.__raf = { calls: 0, ms: 0 }; const _raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => _raf((t) => { const s = performance.now(); try { cb(t); } finally { window.__raf.ms += performance.now() - s; window.__raf.calls++; } });` });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(5000);
  if (sc.fit) await c.evalJs(`(async () => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'fit'); b && b.click(); await new Promise((r) => setTimeout(r, 1200)); })()`);
  if (sc.zoomIn) await c.evalJs(`(async () => { const z = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '+'); for (let i = 0; i < ${sc.zoomIn}; i++) { z && z.click(); await new Promise((r) => setTimeout(r, 120)); } await new Promise((r) => setTimeout(r, 800)); })()`);
  await sleep(1000);
  await c.send('HeapProfiler.collectGarbage');
  const metrics = async () => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const m0 = await metrics(), r0 = JSON.parse(await c.evalJs('JSON.stringify(window.__raf)'));
  await c.evalJs('window.__anim && window.__anim.profileAnims(true)');
  await sleep(SECONDS * 1000);
  const m1 = await metrics(), r1 = JSON.parse(await c.evalJs('JSON.stringify(window.__raf)'));
  const stats = JSON.parse(await c.evalJs('JSON.stringify(window.__anim ? window.__anim.animStats() : [])'));
  const nodes = await c.evalJs('document.querySelectorAll(".node").length');
  const per = (a, b) => Math.round(((b - a) / SECONDS) * 10) / 10;
  results.push({
    name: sc.name, modules: nodes, heapMB: +(m1.JSHeapUsedSize / 1e6).toFixed(1), domNodes: m1.Nodes,
    rafCallsPerSec: Math.round((r1.calls - r0.calls) / SECONDS), rafMsPerSec: per(r0.ms, r1.ms),
    pictureMsPerSec: Math.round((stats.reduce((t, s) => t + s.ms, 0) / SECONDS) * 10) / 10, pictureCallsPerSec: Math.round(stats.reduce((t, s) => t + s.calls, 0) / SECONDS),
    layoutsPerSec: per(m0.LayoutCount, m1.LayoutCount), layoutMsPerSec: Math.round(per(m0.LayoutDuration, m1.LayoutDuration) * 1000), styleMsPerSec: Math.round(per(m0.RecalcStyleDuration, m1.RecalcStyleDuration) * 1000),
    top: stats.slice(0, 3).map((s) => `${s.type} ${(s.ms / SECONDS).toFixed(1)}ms/s`).join(', '),
  });
  await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await c.send('Page.navigate', { url: 'about:blank' }); await sleep(400);
  c.close();
}

console.table(results.map(({ top, ...r }) => r));
for (const r of results) if (r.top) console.log(`  ${r.name}: busiest ${r.top}`);
let failed = 0;
for (const r of results) for (const [k, lim] of Object.entries(LIMITS[r.name] || {})) if (r[k] > lim) { failed++; console.log(`FAIL ${r.name}: ${k} is ${r[k]}, the limit is ${lim}`); }
const zoomed = results.find((r) => r.name === 'all 57 modules, zoomed far in'), inView = results.find((r) => r.name === 'all 57 modules in view');
if (zoomed && inView && zoomed.pictureCallsPerSec > inView.pictureCallsPerSec / 2) { failed++; console.log(`FAIL zoomed far in, ${zoomed.pictureCallsPerSec} picture calls a second still run against ${inView.pictureCallsPerSec} with everything in view: off-screen pictures should stop`); }
console.log(failed ? `${failed} performance check(s) failed` : 'ok   performance checks passed');
stopAll();
process.exit(failed ? 1 : 0);
