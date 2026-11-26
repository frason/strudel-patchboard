// Shared plumbing for the performance scripts: the production build behind `vite preview` and a headless Chrome driven over the DevTools protocol (Node's built-in WebSocket).
//   const b = await startBrowser({ port: 4179, debug: 9339, chromeArgs: [] });   const c = await b.connect();   ... c.send / c.evalJs ...   b.stopAll();
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function startBrowser({ port, debug, chromeArgs = [] }) {
  const CHROME = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
  if (!CHROME) { console.error('Chrome not found: set CHROME_BIN'); process.exit(2); }
  if (!fs.existsSync(new URL('../dist/index.html', import.meta.url))) { console.error('Run `npm run build` first'); process.exit(2); }
  const PORT = port, DEBUG = debug;
  // ---- servers ----
  const procs = [];
  const run = (cmd, args, opts = {}) => { const p = spawn(cmd, args, { stdio: 'ignore', ...opts }); procs.push(p); return p; };
  const stopAll = () => { for (const p of procs) { try { p.kill('SIGKILL'); } catch { /* ignore */ } } };
  process.on('exit', stopAll);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-perf-'));
  run(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { cwd: new URL('..', import.meta.url).pathname });
  run(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1600,1000', ...chromeArgs, 'about:blank']);
  for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${DEBUG}/json/version`); await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await sleep(250); } }

  // ---- a tiny DevTools client (Node's built-in WebSocket) ----
  async function connect() {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); } };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
    return { send, evalJs, close: () => ws.close() };
  }

  return { connect, stopAll };
}
