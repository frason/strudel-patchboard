#!/usr/bin/env node
// The handoff tool: files in docs/handoff/ are how Claude Code and Codex pass work to each other (see docs/handoff/README.md).
//   node scripts/handoff.mjs list
//   node scripts/handoff.mjs check
//   node scripts/handoff.mjs new "Title" [--to codex|claude] [--from claude|codex|owner] [--refs a.md,b.js]
//   node scripts/handoff.mjs context
//   node scripts/handoff.mjs fetch <branch> [--apply]
//   node scripts/handoff.mjs index
// No dependencies. The pure parts are exported so the tests can use them.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs', 'handoff');
export const STATUSES = ['open', 'answered', 'ingested', 'closed', 'declined'];
export const AGENTS = ['claude', 'codex', 'owner'];
const FILE_RE = /^(\d{4})-[a-z0-9-]+\.md$/;
const SECTIONS = ['Request', 'Response', 'Disposition'];

// ---------- pure parsing ----------
export function parseHandoff(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { error: 'no front matter (the file must start with --- and a block of key: value lines)' };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([a-z_]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (k) meta[k[1]] = k[2];
  }
  const body = m[2], sections = {}, order = [];
  const re = /^## (Request|Response|Disposition)\s*$/gm; let h, last = null;
  while ((h = re.exec(body))) { if (last) sections[last.name] = body.slice(last.at, h.index); last = { name: h[1], at: re.lastIndex }; order.push(h[1]); }
  if (last) sections[last.name] = body.slice(last.at);
  return { meta, sections, order, body };
}
// the text of a section without HTML comments, template placeholders and whitespace: what a person actually wrote
export const written = (s) => String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/^Source:.*$/gm, '').trim();
export function setMeta(text, key, value) {
  return text.replace(new RegExp(`^(${key}:\\s*)([^#\\n]*?)(\\s*(#.*)?)$`, 'm'), (_, a, _b, c) => `${a}${value}${c || ''}`);
}
export function replaceSection(text, name, content) {
  const re = new RegExp(`(^## ${name}[ \\t]*\\r?\\n)([\\s\\S]*?)(?=^## (?:Request|Response|Disposition)[ \\t]*$|(?![\\s\\S]))`, 'm');
  return text.replace(re, (_, head) => head + content.replace(/^\n+/, '').replace(/\s*$/, '\n') + '\n');
}

export function validate(file, text, exists = (p) => existsSync(join(ROOT, p))) {
  const errs = [], warns = [], p = parseHandoff(text), id = FILE_RE.exec(file)?.[1];
  if (p.error) return { errs: [p.error], warns };
  const { meta, sections, order } = p;
  for (const k of ['id', 'title', 'from', 'to', 'status', 'created', 'refs']) if (!meta[k]) errs.push(`front matter is missing "${k}"`);
  if (meta.id && id && meta.id !== id) errs.push(`id ${meta.id} does not match the file name (${id})`);
  if (meta.status && !STATUSES.includes(meta.status)) errs.push(`status "${meta.status}" is not one of ${STATUSES.join(', ')}`);
  for (const k of ['from', 'to']) if (meta[k] && !AGENTS.includes(meta[k])) errs.push(`${k} "${meta[k]}" is not one of ${AGENTS.join(', ')}`);
  if (meta.from && meta.from === meta.to) errs.push('from and to are the same');
  if (meta.created && !/^\d{4}-\d{2}-\d{2}$/.test(meta.created)) errs.push('created must be YYYY-MM-DD');
  if (order.join() !== SECTIONS.join()) errs.push(`sections must be exactly ${SECTIONS.map((s) => '## ' + s).join(', ')} in that order (found: ${order.join(', ') || 'none'})`);
  for (const r of String(meta.refs || '').split(',').map((x) => x.trim()).filter(Boolean)) if (!exists(r)) errs.push(`refs: "${r}" does not exist`);
  if (written(sections.Request).length < 60 || /<(one paragraph|repo-relative paths|what not to do|the shape|short title)/.test(sections.Request || '')) errs.push('the Request is empty or still the template (fill in every <...> placeholder)');
  const resp = written(sections.Response).length, disp = written(sections.Disposition).length;
  if (['answered', 'ingested', 'closed'].includes(meta.status) && resp < 40) errs.push(`status is ${meta.status} but the Response is empty`);
  if (meta.status === 'open' && resp >= 40) warns.push('the Response is filled in but the status is still open: set status: answered');
  if (['ingested', 'closed'].includes(meta.status)) {
    if (disp < 20) errs.push(`status is ${meta.status} but the Disposition is empty`);
    else if (!/accepted|rejected|deferred|needs the owner/i.test(sections.Disposition)) errs.push('the Disposition must say accepted, rejected, deferred or needs the owner for each finding');
  }
  if (meta.status === 'declined' && resp < 20) errs.push('declined needs the reason in the Response');
  return { errs, warns };
}

export const nextId = (files) => String(Math.max(0, ...files.map((f) => Number(FILE_RE.exec(f)?.[1] || 0))) + 1).padStart(4, '0');
export const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'handoff';

export function indexMarkdown(rows) {
  const lines = ['# Handoff index', '', 'Generated by `npm run handoff:index`. Do not edit by hand; edit the files.', '', '| id | title | from -> to | status | created |', '|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| [${r.id}](${r.file}) | ${r.title} | ${r.from} -> ${r.to} | ${r.status} | ${r.created} |`);
  if (!rows.length) lines.push('| | (none yet) | | | |');
  return lines.join('\n') + '\n';
}

// ---------- files and git ----------
const handoffFiles = () => readdirSync(DIR).filter((f) => FILE_RE.test(f)).sort();
const read = (f) => readFileSync(join(DIR, f), 'utf8');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const rows = () => handoffFiles().map((file) => { const p = parseHandoff(read(file)); return { file, ...(p.meta || {}), id: p.meta?.id || FILE_RE.exec(file)[1], title: p.meta?.title || '(no title)', from: p.meta?.from || '?', to: p.meta?.to || '?', status: p.meta?.status || '?', created: p.meta?.created || '' }; });
const writeIndex = () => { writeFileSync(join(DIR, 'INDEX.md'), indexMarkdown(rows())); };

// ---------- commands ----------
function cmdList() {
  const r = rows();
  if (!r.length) return console.log('No handoffs yet. Create one with: npm run handoff:new -- "Title" --to codex');
  const w = (s, n) => String(s).padEnd(n);
  console.log(w('id', 5) + w('status', 10) + w('from -> to', 16) + 'title');
  for (const x of r) console.log(w(x.id, 5) + w(x.status, 10) + w(`${x.from} -> ${x.to}`, 16) + x.title);
  const mine = (who) => r.filter((x) => x.to === who && x.status === 'open'), ans = r.filter((x) => x.status === 'answered');
  console.log('');
  if (mine('codex').length) console.log(`Waiting for Codex: ${mine('codex').map((x) => x.id).join(', ')}`);
  if (mine('claude').length) console.log(`Waiting for Claude: ${mine('claude').map((x) => x.id).join(', ')}`);
  if (ans.length) console.log(`Answered, not yet ingested: ${ans.map((x) => x.id).join(', ')} (follow docs/handoff/INGEST.md)`);
}

function cmdCheck() {
  let bad = 0;
  for (const f of handoffFiles()) {
    const { errs, warns } = validate(f, read(f));
    for (const e of errs) { bad++; console.log(`ERROR ${f}: ${e}`); }
    for (const w of warns) console.log(`warn  ${f}: ${w}`);
    if (!errs.length && !warns.length) console.log(`ok    ${f}`);
  }
  const idx = existsSync(join(DIR, 'INDEX.md')) ? readFileSync(join(DIR, 'INDEX.md'), 'utf8') : '';
  if (idx !== indexMarkdown(rows())) { bad++; console.log('ERROR INDEX.md is out of date: run npm run handoff:index'); }
  process.exit(bad ? 1 : 0);
}

function cmdNew(args) {
  const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
  const title = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!title) { console.error('usage: handoff new "Title" [--to codex|claude] [--from claude|codex|owner] [--refs a,b]'); process.exit(2); }
  const to = opt('to', 'codex'), from = opt('from', to === 'codex' ? 'claude' : 'codex'), refs = opt('refs', 'docs/ROADMAP.md');
  if (!AGENTS.includes(to) || !AGENTS.includes(from) || to === 'owner' || from === to) { console.error('from and to must differ; to is claude or codex'); process.exit(2); }
  const id = nextId(handoffFiles()), file = `${id}-${slug(title)}.md`, today = new Date().toISOString().slice(0, 10);
  let t = readFileSync(join(DIR, 'TEMPLATE-request.md'), 'utf8');
  t = setMeta(t, 'id', id); t = setMeta(t, 'title', title); t = setMeta(t, 'from', from); t = setMeta(t, 'to', to); t = setMeta(t, 'created', today); t = setMeta(t, 'refs', refs);
  writeFileSync(join(DIR, file), t); writeIndex();
  console.log(`Created docs/handoff/${file}. Fill in the Request, then tell the owner where it is (nothing is committed).`);
}

async function cmdContext() {
  const sh = (...a) => { try { return git(...a).trim(); } catch { return '(unavailable)'; } };
  let modules = '?', guardNames = '?';
  try { modules = Object.keys((await import(pathToFileURL(join(ROOT, 'src', 'modules.js')).href)).MODULES).length; } catch { /* leave ? */ }
  try { const g = readFileSync(join(ROOT, 'src', 'guard.js'), 'utf8'), m = /new Set\(`([\s\S]*?)`\.split/.exec(g); guardNames = new Set(m[1].split(/\s+/).filter(Boolean)).size; } catch { /* leave ? */ }
  const songs = existsSync(join(ROOT, 'tools')) ? readdirSync(join(ROOT, 'tools')).filter((f) => f.endsWith('.strudel')) : [];
  const open = rows().filter((r) => r.status === 'open' || r.status === 'answered');
  const out = [
    '# Repo facts (generated by `npm run handoff:context`; not committed)', '',
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
    `- Branch: ${sh('rev-parse', '--abbrev-ref', 'HEAD')}  HEAD: ${sh('rev-parse', '--short', 'HEAD')}`,
    `- Uncommitted files: ${sh('status', '--short').split('\n').filter(Boolean).length}`,
    `- Modules: ${modules}  Methods the guard allows: ${guardNames}`,
    `- Real songs replayed by the tests (tools/): ${songs.join(', ') || 'none'}`,
    `- Open or answered handoffs: ${open.map((r) => `${r.id} (${r.status}, ${r.from} -> ${r.to})`).join('; ') || 'none'}`,
    '', '## Last commits', '```', sh('log', '--oneline', '-8'), '```',
    '', '## Commands', '```', 'npm run dev        # http://localhost:5174', 'npm test           # verify + reconcile + guard', 'npm run handoff:list', '```', '',
  ].join('\n');
  writeFileSync(join(DIR, 'CONTEXT.md'), out);
  console.log(out);
}

function cmdFetch(args) {
  const apply = args.includes('--apply'), name = args.find((a) => !a.startsWith('--'));
  if (!name) { console.error('usage: handoff fetch <branch> [--apply]'); process.exit(2); }
  const branch = [name, 'codex/' + name].find((b) => { try { git('rev-parse', '--verify', '--quiet', b); return true; } catch { return false; } });
  if (!branch) { console.error(`No branch "${name}" or "codex/${name}" in this repository.`); process.exit(1); }
  let names = '';
  try { names = git('ls-tree', '--name-only', branch, 'docs/handoff/'); } catch { /* none */ }
  const found = names.split('\n').map((p) => p.replace('docs/handoff/', '')).filter((f) => FILE_RE.test(f));
  if (!found.length) return console.log(`Branch ${branch} has no handoff files.`);
  let any = false;
  for (const f of found) {
    const theirs = parseHandoff(git('show', `${branch}:docs/handoff/${f}`)), mainPath = join(DIR, f);
    const resp = written(theirs.sections?.Response);
    if (resp.length < 40) { console.log(`${f}: no Response on ${branch} yet`); continue; }
    if (!existsSync(mainPath)) { console.log(`${f}: answered on ${branch} but the Request is not on main: copy the whole file in (git show ${branch}:docs/handoff/${f}) and check it`); any = true; continue; }
    const mine = read(f), mp = parseHandoff(mine);
    if (written(mp.sections?.Response) === resp) { console.log(`${f}: already on main`); continue; }
    any = true;
    console.log(`${f}: answered on ${branch} (${resp.length} characters)${apply ? ' - applying' : ''}`);
    if (apply) {
      let t = replaceSection(mine, 'Response', theirs.sections.Response);
      if (mp.meta.status === 'open') t = setMeta(t, 'status', 'answered');
      writeFileSync(mainPath, t); writeIndex();
      console.log(`  copied the Response into docs/handoff/${f} and set status: answered. Now follow docs/handoff/INGEST.md.`);
    }
  }
  if (any && !apply) console.log('Run again with --apply to copy the Response into the files on main.');
}

// ---------- entry ----------
const [cmd, ...rest] = process.argv.slice(2);
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (cmd === 'list') cmdList();
  else if (cmd === 'check') cmdCheck();
  else if (cmd === 'new') cmdNew(rest);
  else if (cmd === 'context') await cmdContext();
  else if (cmd === 'fetch') cmdFetch(rest);
  else if (cmd === 'index') { writeIndex(); console.log('INDEX.md written'); }
  else { console.log('usage: handoff list | check | new "Title" | context | fetch <branch> [--apply] | index'); process.exit(cmd ? 2 : 0); }
}
