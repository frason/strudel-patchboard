// Share a board as a link (no server): the graph, compressed, in the part of the address after '#'. Nothing else goes in it: never settings, an AI key, sample-pack approvals or saved boards.
// Opening a shared link NEVER loads anything by itself: it shows what the board is and checks it first (validateShape, the guard, a read-back), and only the person at the keyboard opens it, as a copy.
// Plain functions around the browser's CompressionStream (also in Node 18+), so they are tested without a page.
import { validateShape, normalize, expansionCost, MAX_EXPANSION } from './graph.js';
import { compile } from './compile.js';
import { guardCode } from './guard.js';
import { LIMITS } from './validate.js';

export const SHARE_PREFIX = '#share=';
export const MAX_LINK_CHARS = 24_000;   // what a link may hold: longer ones are refused with a pointer to the file export (many chat apps and browsers cut long links)
const MAX_INFLATED = LIMITS.bytes;       // the size a link may unpack to, checked while unpacking so a small link cannot become a huge board

const toB64Url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64Url = (t) => { const s = atob(String(t).replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
async function pipe(bytes, stream, limit = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(), parts = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { try { await reader.cancel(); } catch { /* ignore */ } throw new Error('the board is larger than a link may unpack to'); } parts.push(value); }
  const out = new Uint8Array(size); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// graph -> '#share=...' (or an error text). `plain` is the only thing packed: { v: 1, kind: 'patchboard-board', graph }.
export async function makeShareFragment(graph) {
  const text = JSON.stringify({ v: 1, kind: 'patchboard-board', graph: { v: graph.v, nodes: graph.nodes, wires: graph.wires, groups: graph.groups || [] } });
  const bytes = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
  const frag = SHARE_PREFIX + toB64Url(bytes);
  return frag.length > MAX_LINK_CHARS ? { error: `This board is too big for a link (${Math.round(frag.length / 1000)} thousand characters; the limit is ${MAX_LINK_CHARS / 1000} thousand). Use Export, Patch file, and send the file.` } : { fragment: frag };
}

// '#share=...' -> { graph } or { error }. Everything is checked before anything is returned: the shape, the sizes, and the guard on the code it compiles to.
export async function readShareFragment(fragment) {
  const f = String(fragment || '');
  if (!f.startsWith(SHARE_PREFIX)) return { error: 'This is not a Patchboard share link.' };
  const data = f.slice(SHARE_PREFIX.length);
  if (data.length > MAX_LINK_CHARS || !/^[A-Za-z0-9_-]+$/.test(data)) return { error: 'This link is too long or damaged.' };
  let text;
  try { text = new TextDecoder().decode(await pipe(fromB64Url(data), new DecompressionStream('deflate-raw'), MAX_INFLATED)); } catch (e) { return { error: 'This link could not be unpacked: ' + String((e && e.message) || e).slice(0, 100) }; }
  let env;
  try { env = JSON.parse(text); } catch { return { error: 'This link does not contain a board.' }; }
  if (!env || env.v !== 1 || env.kind !== 'patchboard-board' || typeof env.graph !== 'object') return { error: 'This link is from a different kind of share, or a newer Patchboard.' };
  return checkBoard(env.graph);
}

// a board that came from outside (a link, a library file): the shape, the expansion count, the compile and the guard. Returns { graph, code, issues } or { error }.
export function checkBoard(raw) {
  let graph, removed = 0;
  try { graph = validateShape(raw); if (JSON.stringify({ nodes: graph.nodes, wires: graph.wires, groups: graph.groups || [] }).length > MAX_INFLATED) return { error: 'The board in this link is larger than a board may be here (' + Math.round(MAX_INFLATED / 1000) + ' KB of data).' }; const wires0 = graph.wires.length; normalize(graph); removed = Math.max(0, wires0 - graph.wires.length); } catch (e) { return { error: 'The board in this link is not valid: ' + String((e && e.message) || e).slice(0, 140) }; }
  // the compiler writes a module once for every path that reaches it, so a few modules wired in a fan-out can ask for an enormous amount of text: counted BEFORE anything is built, and refused past a limit
  const cost = expansionCost(graph); if (cost > MAX_EXPANSION) return { error: `The board in this link is too tangled to open safely: its cables fan out so that it would be written ${cost > 1e9 ? 'billions of' : cost.toLocaleString('en')} times over (the limit is ${MAX_EXPANSION.toLocaleString('en')}).` };
  let r; try { r = compile(graph); } catch (e) { return { error: 'The board in this link could not be turned into code: ' + String((e && e.message) || e).slice(0, 100) }; }
  if (r.refused) return { error: 'The board in this link cannot be written safely: ' + (r.issues[0]?.msg || 'too large') };
  const code = r.code, bad = guardCode(code);   // (the compiler already leaves out code the guard refuses and says so in `issues`; this is the second check, on what would really run)
  if (bad) return { error: 'The code this board makes is refused by the safety check: ' + bad };
  return { graph, code, issues: [...(removed ? [`${removed} cable${removed === 1 ? ' was' : 's were'} removed because ${removed === 1 ? 'it does' : 'they do'} not connect modules properly`] : []), ...r.issues.map((i) => i.msg)] };
}

// what to tell the person before they open it: plain facts about the board, none of them a promise about how it sounds
export function describeBoard(graph, code) {
  const types = {}; for (const n of graph.nodes) types[n.type] = (types[n.type] || 0) + 1;
  const packs = [...new Set((code.match(/github:[A-Za-z0-9_.\/-]+/g) || []))];
  return { modules: graph.nodes.length, cables: graph.wires.length, types, packs, codeLines: code.split('\n').length };
}
