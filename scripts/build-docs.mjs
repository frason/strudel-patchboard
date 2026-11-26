#!/usr/bin/env node
// Writes the static documentation site (about, import guide, one page per module, llms.txt, llms-full.txt, robots.txt, sitemap.xml) from the module definitions.
//   node scripts/build-docs.mjs [--out dist] [--site https://example.com]
// `npm run build` runs it after Vite, into dist/. `npm run docs` writes into public/ (ignored by git) so the dev server serves the same pages.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteFiles, SITE_DEFAULT } from '../src/aidocs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const out = resolve(ROOT, arg('out', 'public')), site = String(arg('site', process.env.SITE_URL || SITE_DEFAULT)).replace(/\/+$/, '');
const files = siteFiles(site);
for (const f of files) {
  const dest = join(out, f.path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, f.content);
}
console.log(`docs: wrote ${files.length} files to ${out} for ${site}`);
