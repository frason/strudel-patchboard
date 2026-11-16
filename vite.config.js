import { defineConfig } from 'vite';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// Build label shown in Settings: commit count (always rises), short commit, date, and a + when the working tree had uncommitted changes.
const git = (c) => { try { return execSync('git ' + c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const build = { number: git('rev-list --count HEAD') || '0', commit: git('rev-parse --short HEAD') || 'unknown', dirty: !!git('status --porcelain'), date: new Date().toISOString().slice(0, 10) };

// `npm run preview` serves the production build with the same headers Cloudflare Pages will send (public/_headers), so a policy can be tested locally.
const headers = {};
try {
  let on = false;
  for (const line of fs.readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    if (/^\S/.test(line)) { on = line.trim() === '/*'; continue; }
    const i = line.indexOf(':');
    if (on && i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch { /* no headers file */ }

export default defineConfig({
  server: { port: 5174, host: '127.0.0.1' },
  preview: { headers },
  define: { global: 'globalThis', __BUILD__: JSON.stringify(build) },   // some audio dependencies written for bundlers expect Node's `global`
  optimizeDeps: { rolldownOptions: { transform: { define: { global: 'globalThis' } } } },
  build: { target: 'es2022' },
});
