// Playback performance: `npm run build && npm run perf:play [-- --repeat 3] [-- --only whole-song] [-- --save name] [-- --compare name]`
// Loads the production build in headless Chrome, presses play, and measures what matters most: does playback stay on time (notes skipped, audio underruns, page stalls, long tasks),
// and what does it cost (heap, frame time). Each scenario can also run a "load" while it plays (a feature that works in the background while music plays), which is
// how a new feature proves it does not hurt playback: run the same scenario without and with the load and compare.
// Results are written to .perf/<name>.json (ignored by git). --compare checks a run against a saved one: it fails when a counter that should stay at zero rises,
// or when a measured cost is more than 25% worse than the worst repeat in the saved run (plus a small absolute allowance, so tiny numbers do not trip it).
// Needs Chrome (CHROME_BIN) and a network connection (sample files download from GitHub). Headless Chrome has no speakers: timing is real, loudness is not heard.
import fs from 'node:fs';
import { startBrowser, sleep } from './cdp.mjs';
import { LESSONS } from '../src/starters.js';
import { importStrudel } from '../src/importer.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const REPEAT = Number(arg('repeat', 1)), ONLY = arg('only', ''), SAVE = arg('save', ''), COMPARE = arg('compare', ''), WINDOW = Number(arg('seconds', 20));
const worst = (runs, k) => Math.max(...runs.map((r) => r[k] ?? 0));
// the rule: a counter that should stay at zero must not rise; a cost must not be more than 25% worse than the worst repeat in the saved run, plus a small allowance for tiny numbers
function judge(results, base, label, heapOk = true) {
  let failed = 0;
  for (const [name, runs] of Object.entries(results)) {
    const b = base[name]; if (!b) continue;
    for (const k of ['skipped', 'underruns', 'stalls']) if (worst(runs, k) > worst(b, k)) { failed++; console.log(`FAIL ${name}: ${k} rose from ${worst(b, k)} to ${worst(runs, k)}`); }
    for (const [k, slack] of [['longTaskMs', 30], ['longestMs', 25], ['cpuMsPerSec', 20], ['rafMsPerSec', 5], ...(heapOk ? [['heapGrowthMB', 5]] : [])]) if (worst(runs, k) > worst(b, k) * 1.25 + slack) { failed++; console.log(`FAIL ${name}: ${k} is ${worst(runs, k)} against ${worst(b, k)} in "${label}" (limit: 25% worse plus ${slack})`); }
  }
  console.log(failed ? `${failed} playback check(s) failed against "${label}"` : `ok   playback is no worse than "${label}"`);
  return failed;
}
const JUDGE = arg('judge', '');   // --judge new --compare old: compare two saved runs without opening a browser
if (JUDGE) { const file = (n) => JSON.parse(fs.readFileSync(`.perf/${n}.json`, 'utf8')); process.exit(judge(file(JUDGE).results, file(COMPARE).results, COMPARE, file(COMPARE).heap === 'after-gc') ? 1 : 0); }
const { connect, stopAll } = await startBrowser({ port: 4181, debug: 9341, chromeArgs: ['--autoplay-policy=no-user-gesture-required'] });

const song = (file) => importStrudel(fs.readFileSync(new URL('../tools/' + file, import.meta.url), 'utf8'), { sounds: () => true }).graph;
const SCENARIOS = [
  { name: 'whole-song', graph: LESSONS.find((l) => l.id === 'whole-song').graph() },
  { name: 'oleander', graph: song('oleander.strudel') },
  { name: 'feel-good', graph: song('feel-good.strudel') },
  ...(arg('load', '') ? [] : []),
].filter((s) => !ONLY || s.name === ONLY);
// loads that can run while playing: name -> JavaScript run in the page for the whole window (it must return when asked to stop through window.__stopLoad)
export const LOADS = {
  // pins the x-ray on the Instrument (or Sample) and makes it read again every 500 ms, whether or not the code changed: the worst case, far busier than any person editing
  xray: `async () => {
    const node = [...document.querySelectorAll('.node')].find((n) => /^(Instrument|Sample)/.test((n.innerText || '').trim()));
    if (!node) throw new Error('no Instrument or Sample on this board');
    node.querySelector('[aria-label="More"], [title="More"]').click(); await new Promise((r) => setTimeout(r, 200));
    [...document.querySelectorAll('.menu-item')].find((b) => /what comes out/i.test(b.textContent)).click(); await new Promise((r) => setTimeout(r, 800));
    window.__xrayStop = window.__xrayStress(500); return true;
  }`,
};

const parse = (txt) => {
  const n = (re) => { const m = re.exec(txt); return m ? Number(m[1]) : null; };
  return { skipped: n(/notes skipped (\d+)/), stalls: n(/page stalls over 0\.15 s: (\d+)/), underruns: n(/audio underruns (\d+)/), clock: n(/audio clock ([\d.]+)×/), memMB: n(/memory (\d+) MB/) };
};
async function runOnce(sc, load) {
  const c = await connect();
  await c.send('Page.enable'); await c.send('Performance.enable'); await c.send('HeapProfiler.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    try { localStorage.clear(); localStorage.setItem('pb.autosave', ${JSON.stringify(JSON.stringify(sc.graph))}); localStorage.setItem('pb.introSeen', '1'); ${load ? "localStorage.setItem('pb.perf', '1');" : ''} } catch (e) {}
    window.__lt = { n: 0, ms: 0, max: 0 }; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lt.n++; window.__lt.ms += e.duration; window.__lt.max = Math.max(window.__lt.max, e.duration); } }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
    window.__raf = { calls: 0, ms: 0 }; const _raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => _raf((t) => { const s = performance.now(); try { cb(t); } finally { window.__raf.ms += performance.now() - s; window.__raf.calls++; } });` });
  await c.send('Page.navigate', { url: 'http://127.0.0.1:4181/' });
  await sleep(4000);
  const health = async () => c.evalJs(`(async () => { let pre = document.getElementById('health-text'); if (!pre) { [...document.querySelectorAll('button')].find((b) => /settings/i.test(b.getAttribute('aria-label') || b.title || b.id || ''))?.click(); await new Promise((r) => setTimeout(r, 300)); pre = document.getElementById('health-text'); } return pre ? pre.textContent : ''; })()`);
  await c.evalJs(`document.getElementById('play').click()`);
  await sleep(7000);   // sounds download and the music settles
  const status = await c.evalJs(`document.getElementById('status').textContent`);
  await c.send('HeapProfiler.collectGarbage');   // heap growth is what is still held after a collection, not whatever garbage the window happened to start or end with
  const h0 = parse(await health()), m0 = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value])), l0 = JSON.parse(await c.evalJs('JSON.stringify({ lt: window.__lt, raf: window.__raf })'));
  await c.evalJs('window.__lt.max = 0; 0');   // the longest task is measured inside the window only
  if (load) await c.evalJs(`window.__stopLoad = false; window.__loadDone = (${load})(); 0`);
  await sleep(WINDOW * 1000);
  if (load) await c.evalJs('window.__stopLoad = true; window.__xrayStop && window.__xrayStop(); 0');
  await c.send('HeapProfiler.collectGarbage');
  const h1 = parse(await health()), m1 = Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value])), l1 = JSON.parse(await c.evalJs('JSON.stringify({ lt: window.__lt, raf: window.__raf })'));
  const d = (a, b) => (a === null || b === null ? null : b - a);
  const out = {
    playing: /playing/.test(status), skipped: d(h0.skipped, h1.skipped), underruns: d(h0.underruns, h1.underruns), stalls: d(h0.stalls, h1.stalls),
    longTasks: l1.lt.n - l0.lt.n, longTaskMs: Math.round(l1.lt.ms - l0.lt.ms), longestMs: Math.round(l1.lt.max), clock: h1.clock,
    heapGrowthMB: +((m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1e6).toFixed(1), rafMsPerSec: +((l1.raf.ms - l0.raf.ms) / WINDOW).toFixed(1),
    cpuMsPerSec: Math.round(((m1.TaskDuration - m0.TaskDuration) / WINDOW) * 1000),
  };
  await c.send('Page.navigate', { url: 'about:blank' }); await sleep(300); c.close();
  return out;
}

const LOADNAME = arg('load', '');
const results = {};
for (const sc of SCENARIOS) {
  const runs = [];
  for (let i = 0; i < REPEAT; i++) runs.push(await runOnce(sc, LOADNAME ? LOADS[LOADNAME] : null));
  results[sc.name] = runs;
}
console.log(`playback for ${WINDOW} s per run, ${REPEAT} run(s) per scenario${LOADNAME ? `, with load "${LOADNAME}"` : ''}`);
console.table(Object.entries(results).map(([name, runs]) => ({ scenario: name, playing: runs.every((r) => r.playing), skipped: worst(runs, 'skipped'), underruns: worst(runs, 'underruns'), stalls: worst(runs, 'stalls'), longTasks: worst(runs, 'longTasks'), longTaskMs: worst(runs, 'longTaskMs'), longestMs: worst(runs, 'longestMs'), cpuMsPerSec: worst(runs, 'cpuMsPerSec'), rafMsPerSec: worst(runs, 'rafMsPerSec'), heapGrowthMB: worst(runs, 'heapGrowthMB') })));
fs.mkdirSync('.perf', { recursive: true });
if (SAVE) fs.writeFileSync(`.perf/${SAVE}.json`, JSON.stringify({ when: new Date().toISOString(), heap: 'after-gc', window: WINDOW, repeat: REPEAT, load: LOADNAME, results }, null, 1));
let failed = 0;
for (const [name, runs] of Object.entries(results)) if (!runs.every((r) => r.playing)) { failed++; console.log(`FAIL ${name}: it was not playing (status not "playing"): no measurement`); }
if (COMPARE) { const base = JSON.parse(fs.readFileSync(`.perf/${COMPARE}.json`, 'utf8')); failed += judge(results, base.results, COMPARE, base.heap === 'after-gc'); }
stopAll();
process.exit(failed ? 1 : 0);
