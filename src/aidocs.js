// Plain-text and HTML documentation of Patchboard, written from the module definitions themselves so it never goes stale. Used two ways:
//   - at build time (scripts/build-docs.mjs) to write static pages, llms.txt, llms-full.txt, robots.txt and sitemap.xml for people, search engines and AI agents;
//   - in the app, for "Copy for an AI chat" (chatPack), which pastes how Patchboard works plus the current board's code into any chatbot.
// Pure functions: no DOM, no network. Nothing here may contain a key, a setting, or anything from the person's saved data.
import { MODULES, CATEGORIES } from './modules.js';
import { emptyGraph, makeNode } from './graph.js';
import { compile } from './compile.js';
import { LESSONS } from './starters.js';
const teachingLessons = () => LESSONS.filter((l) => l.id !== 'feature-test').length;   // the Feature test is a tour board, not a one-idea lesson

export const SITE_DEFAULT = 'https://strudel-patchboard.pages.dev';
export const NAME = 'Strudel Patchboard';
export const TAGLINE = 'An unofficial visual patcher for Strudel, the live-coding music language that runs in the browser.';
export const DISCLAIMER = 'Strudel Patchboard is an unofficial, independent tool. It is not made or endorsed by the Strudel project. Strudel is free and open source (AGPL-3.0) and lives at strudel.cc.';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const firstSentence = (s) => { const m = /^(.+?[.!?])(\s|$)/.exec(String(s).trim()); return (m ? m[1] : String(s)).trim(); };
const catLabel = (c) => (CATEGORIES.find(([k]) => k === c) || [c, c])[1];

// ---------- one module ----------
const fmtNum = (n) => String(Math.round(n * 1e4) / 1e4);
function paramLine(p) {
  const label = p.label || p.key, tip = p.tip ? ` ${p.tip.replace(/\.$/, '')}.` : '';
  if (p.kind === 'knob') return `${label}: a knob from ${fmtNum(p.min)} to ${fmtNum(p.max)}${p.unit ? ' ' + p.unit : ''}, starting at ${fmtNum(p.def)}.${tip}`;
  if (p.kind === 'select') return `${label}: a choice of ${(p.options || []).map((o) => (Array.isArray(o) ? o[1] : o === '' ? '(none)' : o)).slice(0, 14).join(', ')}${(p.options || []).length > 14 ? ', and more' : ''}.${tip}`;
  if (p.kind === 'text') return `${label}: text${p.def !== undefined && p.def !== '' ? `, starting as "${String(p.def).slice(0, 60)}"` : ''}.${tip}`;
  return `${label}.${tip}`;
}
const portTypes = (def) => {
  if (def.inputs === 'multi') return 'several patterns of one kind (it has 2 to 6 inputs)';
  if (!Array.isArray(def.inputs) || !def.inputs.length) return null;
  const word = { notes: 'notes', trigger: 'a rhythm', sound: 'a sound', number: 'a number', key: 'a key' };
  return def.inputs.map((i) => { const t = (Array.isArray(i.type) ? i.type : [i.type]).map((x) => word[x] || x).join(' or '); return i.label && i.label !== 'in' ? `${i.label}${i.required ? '' : ' (optional)'}: ${t}` : `${t}${i.required ? '' : ' (optional)'}`; }).join('; ');
};
const OUT_WORDS = { notes: 'notes (a melody)', trigger: 'a rhythm (when things happen)', sound: 'a sound', through: 'the same kind of thing it was given', number: 'a number (plugs into a knob)', key: 'a key (root note and scale)' };

// a tiny board that uses the module, compiled to Strudel code, to show what it writes
function exampleGraph(type) {
  const def = MODULES[type];
  if (!def || def.out === 'number' || def.out === 'key' || type === 'output') return null;
  const g = emptyGraph(), N = (ty, p = {}) => { const n = makeNode(ty, 0, 0, p); g.nodes.push(n); return n; };
  const W = (a, b, port = 'in') => g.wires.push({ id: 'e' + g.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
  const out = N('output'), notes = () => N('notetext', { text: 'c3 e3 g3 b3' }), synth = () => N('synth', { wave: 'sawtooth' });
  const m = N(type);
  if (def.inputs === 'multi') { const a = notes(), b = N('notetext', { text: 'g2 d3' }), sy = synth(); W(a, m, 'in1'); W(b, m, 'in2'); W(m, sy); W(sy, out); return g; }
  if (def.out === 'notes') { const sy = synth(); W(m, sy); W(sy, out); return g; }
  if (def.out === 'trigger') { const sa = N('sample', { name: 'bd' }); W(m, sa); W(sa, out); return g; }
  if (def.out === 'sound' && !def.inputs) { W(m, out); return g; }
  const acc = (Array.isArray(def.inputs) ? def.inputs : []).flatMap((i) => (Array.isArray(i.type) ? i.type : [i.type]));
  if (def.out === 'sound') {
    if (acc.includes('notes')) { const src = notes(); W(src, m); W(m, out); return g; }                 // an instrument: notes in
    if (acc.length === 1 && acc[0] === 'trigger') { const src = N('rhythm'); W(src, m); W(m, out); return g; }   // a sample: a rhythm in
    const sy = synth(), src = notes(); W(src, sy); W(sy, m); W(m, out); return g;                        // an effect: after the instrument
  }
  if (acc.length === 1 && acc[0] === 'trigger') { const sa = N('sample', { name: 'bd' }), src = N('rhythm'); W(src, m); W(m, sa); W(sa, out); return g; }
  const src = notes(), sy = synth(); W(src, m); W(m, sy); W(sy, out); return g;   // a transform: between the melody and the instrument
}
let baseline = null;   // what a melody and an instrument alone write: a module whose example looks just like that adds nothing the example could show
export function moduleExample(type) {
  try {
    if (baseline === null) {
      const g = emptyGraph(), a = makeNode('notetext', 0, 0, { text: 'c3 e3 g3 b3' }), b = makeNode('synth', 0, 0, { wave: 'sawtooth' }), o = makeNode('output', 0, 0);
      g.nodes.push(a, b, o); g.wires.push({ id: 'b1', from: { node: a.id, port: 'out' }, to: { node: b.id, port: 'in' } }, { id: 'b2', from: { node: b.id, port: 'out' }, to: { node: o.id, port: 'in' } });
      baseline = compile(g).code.replace(/^setcpm\([^)]*\)\s*/, '').trim();
    }
    const g = exampleGraph(type); if (!g) return null;
    const code = compile(g).code.replace(/^setcpm\([^)]*\)\s*/, '').trim();
    return code && !/nothing to play|wire a sound/i.test(code) && (code !== baseline || type === 'synth') ? code : null;
  } catch { return null; }
}
export function moduleDoc(type) {
  const def = MODULES[type];
  const calls = [...new Set([def.call, ...(def.params || []).map((p) => p.call)].filter(Boolean))];
  return {
    type, title: def.title, cat: def.cat, catLabel: catLabel(def.cat), blurb: def.blurb || '', more: def.more || [],
    takes: portTypes(def), gives: OUT_WORDS[def.out] || (def.out ? String(def.out) : null), calls,
    params: (def.params || []).map(paramLine), example: moduleExample(type),
  };
}
export const allModuleDocs = () => Object.keys(MODULES).map(moduleDoc).sort((a, b) => CATEGORIES.findIndex(([k]) => k === a.cat) - CATEGORIES.findIndex(([k]) => k === b.cat) || a.title.localeCompare(b.title));
export const slugOf = (type) => type.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

// ---------- the prose guides: blocks that become both Markdown and HTML ----------
// block kinds: ['p', text] ['h2', text] ['ul', [items]] ['code', text]
const moduleCount = () => Object.keys(MODULES).length;
export const GUIDES = () => [
  {
    slug: 'about', title: `About ${NAME}`, summary: TAGLINE,
    blocks: [
      ['p', `${NAME} is a free tool for making music with Strudel, the live-coding language that plays patterns of notes and sounds in the browser. Instead of only typing code, you build a piece from modules (${moduleCount()} of them) and connect them with cables, like a modular synthesizer. The board writes the Strudel code for you, line by line, with a plain-English note beside each part, and it plays that code with Strudel's own engine.`],
      ['h2', 'How it works'],
      ['ul', [
        'Modules are the building blocks: sequencers that hold notes or rhythms, instruments and samples that make sound, transforms that change a pattern (slow it, reverse it, mask it), effects, a mixer, number sources (waves, sliders, random) and views (piano roll, scope).',
        'Cables carry a pattern from one module to the next. The board only lets cables connect when the kinds match (notes into an instrument, a sound into an effect).',
        'The code panel always shows the Strudel code the board writes. Each note that plays lights up in the code and on the module that made it.',
        'It works both ways: change a number or a word in the code, or paste Strudel code from strudel.cc, and the board updates. Parts the modules cannot express are kept exactly as written in a Strudel Code module, or listed as skipped with a reason; nothing is guessed.',
        'Audio is made in your browser by Strudel. Your boards are kept on your device, and nothing you make is uploaded unless you choose to use the optional AI helper (see Privacy).',
      ]],
      ['h2', 'What you can do with it'],
      ['ul', [
        `Learn Strudel with ${teachingLessons()} short lessons, each one a small board you can change, plus a Feature test board that tries the newer modules.`,
        'Build beats, melodies, chords, bass lines and full songs from modules, with drum machines and General MIDI instruments built in.',
        'Import Strudel code from strudel.cc, a .strudel file or a MIDI file, and export your board as a patch file or as Strudel code.',
        'Record notes from a MIDI keyboard or the computer keyboard into a Take module, and record the sound output to a WAV file.',
        'Load sample packs from GitHub when a piece of code asks for them (it always asks you first).',
      ]],
      ['h2', 'What it is not'],
      ['ul', [
        'It is not a DAW: there is no timeline of audio clips, no audio track recording, no plugin hosting.',
        'It is not the official Strudel editor. Programs written in JavaScript with their own functions and lookup tables cannot become modules and are refused; run those on strudel.cc.',
      ]],
      ['p', DISCLAIMER],
    ],
  },
  {
    slug: 'import-from-strudel', title: 'Import Strudel code from strudel.cc', summary: 'What happens to Strudel code you paste into Patchboard, what becomes modules, and what is kept as text.',
    blocks: [
      ['p', 'Paste Strudel code into Import (or choose a .strudel or .mid file). Patchboard reads it and builds a board. It then tells you what it turned into modules, what it kept as written, and what it skipped, with the line number and the reason.'],
      ['h2', 'What becomes modules'],
      ['ul', [
        'Note and rhythm patterns written in mini-notation (short ones become step grids, long or unusual ones stay as text in a Note Pattern or Hit Pattern module).',
        'Sounds with s("..."), banks (bank("RolandTR909")), instruments, and the common effects (filters, reverb, delay, distortion, phaser, FM and more).',
        'Transforms such as slow, fast, rev, euclid, every, mask, chop, loopAt, when, superimpose, off, jux, echo, iter and add.',
        'Tempo from setcps, setcpm or a .cpm() on the whole pattern, and several $: lines (each becomes its own part).',
        'Many near-identical lines that play one sound can be folded into a single Instrument, with each line\'s volume turned into note velocities.',
      ]],
      ['h2', 'What is kept as written'],
      ['p', 'A call with no module of its own (for example linger, pick, or a function you pass to when()) is kept as text inside a Strudel Code module, in the same place in the chain, so the piece still plays the same. While Patchboard is being built, each real song used to test the importer is played as the original code and as the imported board in real Strudel, and the notes are compared over a fixed stretch of cycles. That check runs on those songs, not on every piece you import.'],
      ['h2', 'What is refused, and why'],
      ['p', 'Patchboard only evaluates code made of Strudel\'s own calls, from a fixed list. This check exists so that pasted code cannot read the settings and saved data stored in your browser. So code that defines its own functions, uses lookup tables (objects), indexes into lists, or calls things outside Strudel is not run here. Open that kind of piece on strudel.cc.'],
      ['h2', 'Sample packs'],
      ['p', 'Code that starts with samples(\'github:user/repo\') asks for a sample pack. The import window shows the pack and asks before anything downloads. Only GitHub packs written github:user/repo (optionally with a branch) are accepted. Your yes is remembered for that pack in this browser.'],
      ['h2', 'Round trips'],
      ['p', 'Code that Patchboard wrote is meant to read back into the same board; the tests replay real songs and many generated boards, but that is not a proof for every board. The Open in strudel.cc and Copy buttons use the full text, so the code runs on strudel.cc exactly as written.'],
    ],
  },
  {
    slug: 'sample-packs-and-recording', title: 'Sample packs, recording and MIDI', summary: 'Downloading sounds, recording the output to a WAV file, and playing or importing MIDI.',
    blocks: [
      ['h2', 'Sample packs and the progress bar'],
      ['p', 'When a piece plays recorded samples, Patchboard looks ahead over about 64 cycles and downloads the sample files that stretch uses. The play button turns into a progress bar (for example 7/10) and goes back to play when they are in memory, so the piece usually starts without gaps. A file that fails to download is reported and that part stays silent, and a sound that only appears later can still load while it plays. Click the bar to cancel.'],
      ['h2', 'Record the sound'],
      ['p', 'The rec button next to play starts the piece if it is not playing and records what comes out of the speakers to a 16-bit stereo WAV file. Press it again to stop and save. A recording stops by itself at 15 minutes. The recording includes the safe-output limiter that protects your ears and speakers; it is what the app sends to the speakers, so it can differ slightly from the same code on strudel.cc when a patch is very loud.'],
      ['h2', 'MIDI'],
      ['ul', [
        'Record notes from a MIDI keyboard (in browsers that support Web MIDI, such as Chrome and Edge) or from the computer keyboard into a Take module. A Take keeps when each note started, how long it lasted and how hard it was played, and writes them as a Strudel pattern.',
        'Import a .mid file: each track and channel becomes its own Take on its own Instrument, and you can adopt the file\'s tempo.',
      ]],
    ],
  },
  {
    slug: 'privacy', title: 'Privacy and what the app stores', summary: 'What Patchboard keeps in your browser and which sites it talks to.',
    blocks: [
      ['ul', [
        'No account, no cookies, no analytics. Your boards, history and settings are kept in your browser\'s own storage on your device only.',
        'Sound libraries (drum machines, General MIDI instruments, sample packs) are downloaded from GitHub-hosted sources when a sound needs them.',
        'The optional AI helper is off until you add your own API key. When you use it, your request and the board text it needs are sent to the AI provider you chose (Anthropic), together with your key, which that request requires. The key is stored only in your browser and is never written into a board, an export or a shared file.',
        'A shared or imported patch cannot run code outside Strudel\'s own calls (see the import guide), and sample packs never download without your yes.',
      ]],
      ['p', DISCLAIMER],
    ],
  },
];

// ---------- renderers ----------
const blockMd = ([k, v]) => (k === 'h2' ? `## ${v}\n` : k === 'ul' ? v.map((x) => `- ${x}`).join('\n') + '\n' : k === 'code' ? '```\n' + v + '\n```\n' : v + '\n');
const blockHtml = ([k, v]) => (k === 'h2' ? `<h2>${esc(v)}</h2>` : k === 'ul' ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : k === 'code' ? `<pre><code>${esc(v)}</code></pre>` : `<p>${esc(v)}</p>`);

const moduleMd = (d) => [
  `### ${d.title}`, `Group: ${d.catLabel}.${d.takes ? ` Takes: ${d.takes}.` : ''}${d.gives ? ` Gives: ${d.gives}.` : ''}${d.calls.length ? ` Strudel names: ${d.calls.map((c) => c + '()').join(', ')}.` : ''}`,
  d.blurb, ...d.more.map(([h, t]) => `${h}: ${t}`),
  ...(d.params.length ? ['Settings:', ...d.params.map((p) => `- ${p}`)] : []),
  ...(d.example ? ['Example (the code a small board with this module writes):', '```', d.example, '```'] : []), '',
].join('\n');

export function llmsTxt(site = SITE_DEFAULT) {
  const g = GUIDES();
  return [
    `# ${NAME}`, '', `> ${TAGLINE} You build music from ${moduleCount()} modules joined by cables; the board writes the Strudel code, plays it in the browser, and reads Strudel code back into modules. Free, no account, runs entirely in the browser.`, '',
    `${DISCLAIMER}`, '', '## Start here', '',
    `- [About ${NAME}](${site}/about/): what it is, how modules, cables and the code panel work, what it can and cannot do.`,
    `- [Import Strudel code](${site}/import-from-strudel/): what becomes modules, what stays as text, what is refused and why.`,
    `- [Sample packs, recording and MIDI](${site}/sample-packs-and-recording/): downloading sounds, the WAV recorder, MIDI keyboards and files.`,
    `- [Privacy](${site}/privacy/): what is stored in the browser and which sites it talks to.`,
    '', '## Reference', '',
    `- [All modules](${site}/modules/): every module with its settings and the Strudel code it writes.`,
    `- [Everything in one file](${site}/llms-full.txt): the whole documentation as plain text, for pasting into a chat.`,
    '', '## Try it', '', `- [Open the app](${site}/): the board, code panel and ${teachingLessons()} lessons.`, '', `<!-- ${g.length} guides, ${moduleCount()} modules; generated from the module definitions -->`, '',
  ].join('\n');
}

export function llmsFullTxt(site = SITE_DEFAULT) {
  const parts = [`# ${NAME}: full documentation`, '', `> ${TAGLINE}`, '', `Site: ${site}/`, ''];
  for (const guide of GUIDES()) parts.push(`# ${guide.title}`, '', ...guide.blocks.map(blockMd), '');
  parts.push('# Modules', '', `${NAME} has ${moduleCount()} modules in these groups: ${CATEGORIES.map(([k, l]) => l).join(', ')}.`, '');
  let cat = null;
  for (const d of allModuleDocs()) { if (d.cat !== cat) { cat = d.cat; parts.push(`## ${d.catLabel}`, ''); } parts.push(moduleMd(d)); }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// the text a person pastes into a chatbot: a short account of how Patchboard works, the module list, and their board as code
export function chatPack(code, site = SITE_DEFAULT) {
  const docs = allModuleDocs();
  const lines = docs.map((d) => `- ${d.title} (${d.catLabel}): ${firstSentence(d.blurb)}${d.calls.length ? ` [${d.calls.slice(0, 3).map((c) => c + '()').join(' ')}]` : ''}`);
  return [
    `I am using ${NAME} (${site}/), ${TAGLINE.charAt(0).toLowerCase() + TAGLINE.slice(1)} Please help me with my board.`, '',
    'How it works: I build a piece from modules joined by cables. The board writes Strudel code (shown below), plays it with Strudel in the browser, and reads Strudel code back into modules. A line of code that no module can express is kept as written in a Strudel Code module. Code that defines its own functions or lookup tables cannot be imported (use strudel.cc for those).', '',
    `Modules (${docs.length}):`, ...lines, '',
    'My board as Strudel code (these are the notes and settings the board writes; it is not a recording of how it sounds):', '```', String(code || '(the board is empty)').trim(), '```', 'Before you share this: it contains the board code and any names or comments in it.', '',
    'When you suggest a change, tell me either which module to add or change and which cables to connect, or give Strudel code I can paste into Import. Say which parts you are sure of and which you are guessing.',
  ].join('\n');
}

// ---------- the static site ----------
const CSS = ':root{color-scheme:light dark;--bg:#fff;--fg:#1a1d21;--mut:#5b6670;--line:#dfe3e8;--acc:#b4531f;--code:#f3f4f6}@media (prefers-color-scheme:dark){:root{--bg:#14181d;--fg:#e8ecf0;--mut:#9aa6b2;--line:#2b333b;--acc:#f3c9a0;--code:#1c232a}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}main,header,footer{max-width:46rem;margin:0 auto;padding:0 16px}header{padding-top:18px;padding-bottom:10px;border-bottom:1px solid var(--line)}nav a{margin-right:14px;color:var(--acc);text-decoration:none;font-size:.95rem}nav a:hover{text-decoration:underline}h1{line-height:1.2;margin:1.2em 0 .3em}h2{margin:1.6em 0 .4em;font-size:1.2rem}p,li{max-width:42rem}code,pre{background:var(--code);border-radius:6px;font:14px/1.5 ui-monospace,Menlo,monospace}code{padding:1px 5px}pre{padding:12px;overflow:auto}pre code{padding:0;background:none}.lead{color:var(--mut);font-size:1.05rem}.app{display:inline-block;margin:.6em 0;padding:8px 14px;border-radius:8px;background:var(--acc);color:var(--bg);text-decoration:none;font-weight:600}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}footer{color:var(--mut);font-size:.9rem;padding-top:20px;padding-bottom:40px;border-top:1px solid var(--line);margin-top:2.5em}a{color:var(--acc)}';
const NAV = (site) => `<nav aria-label="Documentation"><a href="${site}/about/">About</a><a href="${site}/modules/">Modules</a><a href="${site}/import-from-strudel/">Import</a><a href="${site}/sample-packs-and-recording/">Packs &amp; recording</a><a href="${site}/privacy/">Privacy</a><a href="${site}/llms.txt">llms.txt</a></nav>`;
function page(site, path, title, summary, bodyHtml, extraLd = null, lead = summary) {
  const url = `${site}${path}`, desc = esc(summary.slice(0, 300));
  const ld = { '@context': 'https://schema.org', '@type': 'TechArticle', headline: title, description: summary, url, isPartOf: { '@type': 'SoftwareApplication', name: NAME, url: `${site}/` }, ...(extraLd || {}) };
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} | ${NAME}</title><meta name="description" content="${desc}"><link rel="canonical" href="${url}"><meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${desc}"><meta property="og:url" content="${url}"><meta property="og:site_name" content="${NAME}"><meta name="robots" content="index, follow"><link rel="alternate" type="text/plain" href="${site}/llms-full.txt"><style>${CSS}</style><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script></head><body><header><strong>${NAME}</strong> ${NAV(site)}</header><main><h1>${esc(title)}</h1><p class="lead">${esc(lead)}</p><a class="app" href="${site}/">Open the app</a>${bodyHtml}</main><footer>${esc(DISCLAIMER)}</footer></body></html>\n`;
}
const moduleHtml = (d, site) => {
  const rows = [['Group', d.catLabel], d.takes && ['Takes', d.takes], d.gives && ['Gives', d.gives], d.calls.length && ['Strudel names', d.calls.map((c) => `${c}()`).join(', ')]].filter(Boolean);
  return `<p>${esc(d.blurb)}</p>${d.more.map(([h, t]) => `<h2>${esc(h)}</h2><p>${esc(t)}</p>`).join('')}<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>${d.params.length ? `<h2>Settings</h2><ul>${d.params.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}${d.example ? `<h2>The code it writes</h2><p>A small board with this module writes:</p><pre><code>${esc(d.example)}</code></pre>` : ''}<p><a href="${site}/modules/">All modules</a></p>`;
};

// every file of the static site: [{ path: 'about/index.html', content }]
export function siteFiles(site = SITE_DEFAULT) {
  const files = [], docs = allModuleDocs();
  for (const g of GUIDES()) files.push({ path: `${g.slug}/index.html`, url: `/${g.slug}/`, content: page(site, `/${g.slug}/`, g.title, g.summary, g.blocks.map(blockHtml).join('')) });
  let cat = null, list = '';
  for (const d of docs) { if (d.cat !== cat) { if (cat) list += '</ul>'; cat = d.cat; list += `<h2>${esc(d.catLabel)}</h2><ul>`; } list += `<li><a href="${site}/modules/${slugOf(d.type)}/">${esc(d.title)}</a>: ${esc(firstSentence(d.blurb))}</li>`; }
  list += '</ul>';
  files.push({ path: 'modules/index.html', url: '/modules/', content: page(site, '/modules/', `All ${docs.length} modules`, `Every ${NAME} module, grouped by what it does, with its settings and the Strudel code it writes.`, list) });
  for (const d of docs) files.push({ path: `modules/${slugOf(d.type)}/index.html`, url: `/modules/${slugOf(d.type)}/`, content: page(site, `/modules/${slugOf(d.type)}/`, `${d.title} module`, firstSentence(d.blurb), moduleHtml(d, site), null, `A ${d.catLabel.toLowerCase()} module in ${NAME}.`) });
  files.push({ path: 'llms.txt', url: '/llms.txt', content: llmsTxt(site) }, { path: 'llms-full.txt', url: '/llms-full.txt', content: llmsFullTxt(site) });
  files.push({ path: 'robots.txt', content: robotsTxt(site) });
  files.push({ path: 'sitemap.xml', content: sitemapXml(site, files.filter((f) => f.url && f.path.endsWith('.html')).map((f) => f.url)) });
  return files;
}
export const robotsTxt = (site = SITE_DEFAULT) => `# ${NAME}: everything public is welcome to search engines and AI assistants.\n# To keep one crawler out, add a block like these two lines (one block per crawler):\n#   User-agent: GPTBot\n#   Disallow: /\nUser-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`;
export const sitemapXml = (site, urls) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[`${site}/`, ...urls.map((u) => `${site}${u}`), `${site}/llms.txt`, `${site}/llms-full.txt`].map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
