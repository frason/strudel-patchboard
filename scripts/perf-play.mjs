// Playback performance: `npm run build && npm run perf:play [-- --repeat 3] [-- --only whole-song] [-- --load xray] [-- --save name] [-- --compare name]`
// Loads the production build in headless Chrome, presses play, and measures what matters most: does playback stay on time (notes skipped, audio underruns, page stalls, long tasks),
// and what does it cost (CPU, frame time, retained heap). A scenario can also run a "load" while it plays (a feature that works in the background during music): that is how a new
// feature proves it does not hurt playback. Run the same scenario without and with the load, save both, and judge one against the other.
// Results go to .perf/<name>.json (ignored by git). The judging rule is in scripts/perfjudge.mjs, tested in scripts/verify.mjs; it fails closed (see there).
//   --judge new --compare old   judge two saved runs without opening a browser
// A run is only valid if the music was playing when the window began AND ended, the audio clock moved through the window, and (with a load) the load really started.
// Counters are read fresh from Settings at both ends of the window (the panel is closed and opened again, because it writes its text once, when it opens).
// Needs Chrome (CHROME_BIN) and a network connection (sample files download from GitHub). Headless Chrome has no speakers: timing is real, loudness is not heard.
import fs from 'node:fs';
import { startBrowser, sleep } from './cdp.mjs';
import { LESSONS } from '../src/starters.js';
import { importStrudel } from '../src/importer.js';
import { judge, worst, validateRuns } from './perfjudge.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const REPEAT = Number(arg('repeat', 3)), ONLY = arg('only', ''), SAVE = arg('save', ''), COMPARE = arg('compare', ''), WINDOW = Number(arg('seconds', 20)), LOADNAME = arg('load', ''), JUDGE = arg('judge', '');
// the options are checked before Chrome starts: a window that is not positive or a repeat that is not a whole number cannot be evidence
const badArgs = [];
if (!JUDGE) { if (!Number.isFinite(WINDOW) || WINDOW < 1) badArgs.push(`--seconds must be a number of at least 1 (got ${arg('seconds', 20)})`); if (!Number.isInteger(REPEAT) || REPEAT < 1) badArgs.push(`--repeat must be a whole number of at least 1 (got ${arg('repeat', 3)})`); if (LOADNAME && !['xray', 'xray-edit', 'stall'].includes(LOADNAME)) badArgs.push(`--load ${LOADNAME} is not a known load`); }
if (badArgs.length) { for (const b of badArgs) console.log(`FAIL ${b}`); process.exit(2); }
const report = (res, label) => { for (const l of res.lines) console.log(`FAIL ${l}`); for (const n of res.notes || []) console.log(`note ${n}`); console.log(res.failed ? `${res.failed} playback check(s) failed against "${label}"` : `ok   playback is no worse than "${label}"`); return res.failed; };
const file = (n) => JSON.parse(fs.readFileSync(`.perf/${n}.json`, 'utf8'));
if (JUDGE) { const nw = file(JUDGE), old = file(COMPARE); process.exit(report(judge(nw.results, old.results, COMPARE, { heapOk: nw.heap === 'after-gc' && old.heap === 'after-gc', load: nw.load || '', meta: { now: { window: nw.window, repeat: nw.repeat }, base: { window: old.window, repeat: old.repeat } } }), COMPARE) ? 1 : 0); }

// loads that can run while playing: name -> JavaScript run in the page for the whole window; it must resolve to true once it is really running
const LOADS = {
  // pins the x-ray on the Instrument (or Sample) and makes it read again every 500 ms, whether or not the code changed: a fixed heavy load, far busier than any person editing
  // (it is not the worst case: a long Take, a dense Chop chain or live edits are not exercised)
  xray: `async () => {
    const node = [...document.querySelectorAll('.node')].find((n) => /^(Instrument|Sample)/.test((n.innerText || '').trim()));
    if (!node) throw new Error('no Instrument or Sample on this board');
    node.querySelector('[aria-label="More"], [title="More"]').click(); await new Promise((r) => setTimeout(r, 200));
    [...document.querySelectorAll('.menu-item')].find((b) => /what comes out/i.test(b.textContent)).click(); await new Promise((r) => setTimeout(r, 800));
    if (!document.querySelector('.xray canvas')) throw new Error('the x-ray did not open');
    if (typeof window.__xrayStress !== 'function') throw new Error('the x-ray stress hook is missing');
    window.__xrayStop = window.__xrayStress(500); return true;
  }`,
  // the same, but asking again only every 2 s: about what steady editing while the x-ray is open would cost (each edit changes the module's code, so each is a real query)
  'xray-edit': `async () => {
    const node = [...document.querySelectorAll('.node')].find((n) => /^(Instrument|Sample)/.test((n.innerText || '').trim()));
    if (!node) throw new Error('no Instrument or Sample on this board');
    node.querySelector('[aria-label="More"], [title="More"]').click(); await new Promise((r) => setTimeout(r, 200));
    [...document.querySelectorAll('.menu-item')].find((b) => /what comes out/i.test(b.textContent)).click(); await new Promise((r) => setTimeout(r, 800));
    if (!document.querySelector('.xray canvas')) throw new Error('the x-ray did not open');
    if (typeof window.__xrayStress !== 'function') throw new Error('the x-ray stress hook is missing');
    window.__xrayStop = window.__xrayStress(2000); return true;
  }`,
  // a self-test of the gate: blocks the page for 0.6 s in the middle of the window, which must show up as a stall and a long task (run with --compare and it must fail)
  stall: `async () => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 600); }, 4000); return true; }`,
};
if (LOADNAME && !LOADS[LOADNAME]) { console.error(`unknown load "${LOADNAME}" (known: ${Object.keys(LOADS).join(', ')})`); process.exit(2); }
const { connect, stopAll } = await startBrowser({ port: 4181, debug: 9341, chromeArgs: ['--autoplay-policy=no-user-gesture-required'] });

const song = (f) => importStrudel(fs.readFileSync(new URL('../tools/' + f, import.meta.url), 'utf8'), { sounds: () => true }).graph;
const SCENARIOS = [
  { name: 'whole-song', graph: LESSONS.find((l) => l.id === 'whole-song').graph() },
  { name: 'oleander', graph: song('oleander.strudel') },
  { name: 'feel-good', graph: song('feel-good.strudel') },
].filter((s) => !ONLY || s.name === ONLY);
if (!SCENARIOS.length) { console.error(`no scenario called "${ONLY}"`); process.exit(2); }

const parse = (txt) => {
  const n = (re) => { const m = re.exec(txt); return m ? Number(m[1]) : null; };   // null means "not given", never 0
  return { skipped: n(/notes skipped (\d+)/), stalls: n(/page stalls over 0\.15 s: (\d+)/), underruns: n(/audio underruns (\d+)/), audioSec: n(/running (\d+) s/), clock: n(/audio clock ([\d.]+)×/) };
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
  // Settings writes the health text once, when it opens: close it if it is open, open it fresh, read it, close it again
  const health = () => c.evalJs(`(async () => {
    const away = () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find((b) => /settings/i.test(b.getAttribute('aria-label') || b.title || b.id || ''));
    if (document.getElementById('health-text')) { away(); await new Promise((r) => setTimeout(r, 150)); }
    btn.click(); await new Promise((r) => setTimeout(r, 300));
    const t = document.getElementById('health-text'); const text = t ? t.textContent : '';
    away(); await new Promise((r) => setTimeout(r, 150)); return text;
  })()`);
  const status = () => c.evalJs(`document.getElementById('status').textContent`);
  const metrics = async () => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const page = async () => JSON.parse(await c.evalJs('JSON.stringify({ lt: window.__lt, raf: window.__raf })'));
  await c.evalJs(`document.getElementById('play').click()`);
  await sleep(7000);   // sounds download and the music settles
  const playingStart = /playing/.test(await status());
  await c.send('HeapProfiler.collectGarbage');   // heap growth is what is still held after a collection
  const h0 = parse(await health()), m0 = await metrics(), l0 = await page();
  await c.evalJs('window.__lt.max = 0; 0');   // the longest task is measured inside the window only
  let loadOk = !load, loadError = '';
  if (load) { try { loadOk = (await c.evalJs(`(${load})()`)) === true; if (!loadOk) loadError = 'it did not report that it was running'; } catch (e) { loadOk = false; loadError = String(e.message || e).slice(0, 120); } }
  await sleep(WINDOW * 1000);
  if (load) await c.evalJs('window.__xrayStop && window.__xrayStop(); 0');
  const playingEnd = /playing/.test(await status());
  await c.send('HeapProfiler.collectGarbage');
  const h1 = parse(await health()), m1 = await metrics(), l1 = await page();
  const d = (a, b) => (a === null || b === null ? null : b - a);
  const audioAdvanced = h0.audioSec === null || h1.audioSec === null ? null : (h1.audioSec - h0.audioSec) >= WINDOW * 0.8;   // the audio clock moved at about the speed of the page's
  const out = {
    playingStart, playingEnd, audioAdvanced, loadOk, loadError, skipped: d(h0.skipped, h1.skipped), underruns: d(h0.underruns, h1.underruns), stalls: d(h0.stalls, h1.stalls),
    longTasks: l1.lt.n - l0.lt.n, longTaskMs: Math.round(l1.lt.ms - l0.lt.ms), longestMs: Math.round(l1.lt.max), clock: h1.clock,
    heapGrowthMB: +((m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1e6).toFixed(1), rafMsPerSec: +((l1.raf.ms - l0.raf.ms) / WINDOW).toFixed(1), cpuMsPerSec: Math.round(((m1.TaskDuration - m0.TaskDuration) / WINDOW) * 1000),
  };
  await c.send('Page.navigate', { url: 'about:blank' }); await sleep(300); c.close();
  return out;
}

const results = {};
for (const sc of SCENARIOS) { const runs = []; for (let i = 0; i < REPEAT; i++) runs.push(await runOnce(sc, LOADNAME ? LOADS[LOADNAME] : null)); results[sc.name] = runs; }
console.log(`playback for ${WINDOW} s per run, ${REPEAT} run(s) per scenario${LOADNAME ? `, with load "${LOADNAME}"` : ''} (worst run shown)`);
console.table(Object.entries(results).map(([name, runs]) => ({ scenario: name, playing: runs.every((r) => r.playingStart && r.playingEnd), audioClock: runs.every((r) => r.audioAdvanced !== false), load: runs.every((r) => r.loadOk), skipped: worst(runs, 'skipped'), underruns: worst(runs, 'underruns'), stalls: worst(runs, 'stalls'), longTasks: worst(runs, 'longTasks'), longTaskMs: worst(runs, 'longTaskMs'), longestMs: worst(runs, 'longestMs'), cpuMsPerSec: worst(runs, 'cpuMsPerSec'), rafMsPerSec: worst(runs, 'rafMsPerSec'), heapGrowthMB: worst(runs, 'heapGrowthMB') })));
fs.mkdirSync('.perf', { recursive: true });
if (SAVE) fs.writeFileSync(`.perf/${SAVE}.json`, JSON.stringify({ when: new Date().toISOString(), heap: 'after-gc', window: WINDOW, repeat: REPEAT, load: LOADNAME, results }, null, 1));
let failed = 0;
const invalid = validateRuns(results, { load: LOADNAME });
for (const l of invalid) { failed++; console.log(`FAIL ${l}`); }
if (COMPARE) { const base = file(COMPARE); failed += invalid.length ? 0 : report(judge(results, base.results, COMPARE, { heapOk: base.heap === 'after-gc', load: LOADNAME, meta: { now: { window: WINDOW, repeat: REPEAT }, base: { window: base.window, repeat: base.repeat } } }), COMPARE); }
stopAll();
process.exit(failed ? 1 : 0);
