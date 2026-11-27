// Schema validation for patches. Everything that arrives from outside (an imported file, a saved slot, autosave, AI output) is rebuilt here from the
// module specifications: unknown keys are dropped, every value is checked for its type and range, and anything wrong falls back to the module's
// default. The compiler writes these values into code that Strudel evaluates, so nothing that reaches it may be anything but a bounded number,
// a bounded plain string, or one of the module's own options.
import { MODULES, defaultParams } from './modules.js';

export const LIMITS = { bytes: 1_500_000, nodes: 400, wires: 1500, groups: 100, cells: 64, tracks: 8, subs: 8, text: 400, pattern: 8000, name: 40, id: 64 };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NOTE = /^[a-gA-G][#bs]{0,2}-?\d{1,2}$/;
const SOUND = /^[A-Za-z0-9_:.\-]{1,80}$/;
const SYM = /^[A-Ga-g][#b]?[A-Za-z0-9#^+°ø\-/()]{0,14}$/;
const X_OK = new Set(['', 'rep2', 'rep3', 'rep4', 'sub2', 'sub3', 'sub4', 'rep5', 'rep6', 'rep7', 'rep8', 'rep9']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cleanText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null);
const num = (v, lo, hi, dflt) => (isNum(v) ? clamp(v, lo, hi) : dflt);
const int = (v, lo, hi, dflt) => (isNum(v) ? clamp(Math.round(v), lo, hi) : dflt);
export const TAKE_MAX_EVENTS = 2000;
// the notes of a Take as they are kept: at most TAKE_MAX_EVENTS, positions and lengths to a thousandth of a beat (Grab checks what this does to a capture)
export const cleanTakeEvents = (arr) => (Array.isArray(arr) ? arr.slice(0, TAKE_MAX_EVENTS) : []).filter((e) => e && isNum(e.t) && isNum(e.d) && isNum(e.n)).map((e) => ({ t: Math.round(clamp(e.t, 0, 4096) * 1000) / 1000, d: Math.round(clamp(e.d, 0.05, 4096) * 1000) / 1000, n: int(e.n, 0, 127, 60), v: Math.round(num(e.v, 0, 1, 0.8) * 100) / 100 }));

function cleanLeaf(c, kind) {
  const o = {};
  if (kind === 'chords') {
    if (c.sym === null || c.sym === undefined) o.sym = null; else if (typeof c.sym === 'string' && SYM.test(c.sym)) o.sym = c.sym; else o.sym = null;
    const d = c.d;
    o.d = d === null || d === undefined ? null : isNum(d) ? clamp(Math.round(d), -64, 64) : d && typeof d === 'object' && isNum(d.i) ? { i: int(d.i, 0, 13, 0), ext: ['', '7', '9'].includes(d.ext) ? d.ext : '' } : null;
    o.len = int(c.len, 1, 64, 1);
    return o;
  }
  if (kind === 'melody') {
    const notes = (v) => (v === null || v === undefined ? null : typeof v === 'string' ? (NOTE.test(v) ? v : null) : Array.isArray(v) ? v.slice(0, 12).filter((x) => typeof x === 'string' && NOTE.test(x)) : null);
    const degs = (v) => (v === null || v === undefined ? null : isNum(v) ? clamp(Math.round(v), -64, 64) : Array.isArray(v) ? v.slice(0, 12).filter(isNum).map((x) => clamp(Math.round(x), -64, 64)) : null);
    o.n = notes(c.n); o.d = degs(c.d); o.len = int(c.len, 1, 64, 1); o.vel = num(c.vel, 0, 1, 1);
    return o;
  }
  o.on = c.on === true; o.len = int(c.len, 1, 64, 1);
  return o;
}
function cleanCell(c, kind) {
  if (typeof c === 'boolean') c = { on: c };
  if (!c || typeof c !== 'object') return cleanLeaf({}, kind);
  const o = cleanLeaf(c, kind);
  if (typeof c.x === 'string' && X_OK.has(c.x)) { if (c.x) o.x = c.x; }
  if (Array.isArray(c.sub)) o.sub = c.sub.slice(0, LIMITS.subs).map((s) => cleanLeaf(s && typeof s === 'object' ? s : {}, kind));
  return o;
}
const cleanCells = (arr, kind) => (Array.isArray(arr) ? arr.slice(0, LIMITS.cells).map((c) => cleanCell(c, kind)) : []);

function optionValues(spec) { return (spec.options || []).map((o) => (Array.isArray(o) ? o[0] : o)); }

function cleanParam(spec, v, node, notes) {
  const d = spec.def;
  switch (spec.kind) {
    case 'knob': case 'num': {   // a number can never become code, so this only keeps values sane: code written outside a dial's range (speed 8, gain 3, 300 BPM) is kept as written, up to 10 spans beyond it
      if (!isNum(v)) return d;
      return Number.isFinite(spec.min) && Number.isFinite(spec.max) && !spec.dyn ? clamp(v, spec.min - 10 * (spec.max - spec.min), spec.max + 10 * (spec.max - spec.min)) : clamp(v, -1e9, 1e9);
    }
    case 'view': return isNum(v) ? clamp(v, -99, 99) : d;
    case 'toggle': return typeof v === 'boolean' ? v : d;
    case 'select': {
      if (spec.key === 'bank') return typeof v === 'string' && /^[A-Za-z0-9_\-]{0,40}$/.test(v) ? v : d;   // the list of drum banks grows with the catalog, so any plain bank name is allowed
      const vals = optionValues(spec);
      const hit = vals.find((x) => x === v || (typeof v !== 'object' && String(x) === String(v)));
      return hit === undefined ? d : hit;
    }
    case 'text': {   // pattern text (mini-notation): only the characters it uses; quotes, backslashes, backticks, $ and ; can never be part of it
      const cap = spec.key === 'custom' ? 200 : LIMITS.pattern;
      if (typeof v === 'string' && v.length > cap) throw new Error(`a pattern is too long (${v.length} characters; the limit is ${cap})`);
      const t = cleanText(v, cap);
      return t === null ? d : t.replace(/[^\p{L}\p{N}_\s\[\]<>*!@?~,:.\-()/%|{}#^+']/gu, '');
    }
    case 'code': {   // Strudel method calls kept as written: quotes are part of them, so only control characters are removed. The guard checks every call before anything runs.
      if (typeof v === 'string' && v.length > 4000) throw new Error(`the Strudel Code text is too long (${v.length} characters; the limit is 4000)`);
      const t = cleanText(v, 4000);
      return t === null ? d : t;
    }
    case 'instrument': return typeof v === 'string' && SOUND.test(v) ? v : d;
    default: return d;
  }
}

export function cleanParams(type, raw) {
  const def = MODULES[type], dflt = defaultParams(type), src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const spec of def.params) out[spec.key] = cleanParam(spec, Object.prototype.hasOwnProperty.call(src, spec.key) ? src[spec.key] : spec.def, null);
  if (def.data?.cells) out.cells = cleanCells(src.cells, type === 'chords' ? 'chords' : type === 'melody' ? 'melody' : 'rhythm');
  if (def.data?.tracks) {
    const tr = Array.isArray(src.tracks) ? src.tracks.slice(0, LIMITS.tracks) : [];
    out.tracks = tr.map((t) => ({ name: t && typeof t.name === 'string' && SOUND.test(t.name) ? t.name.slice(0, LIMITS.name) : 'bd', mute: !!(t && t.mute === true), cells: cleanCells(t && t.cells, 'rhythm') }));
    if (!out.tracks.length) out.tracks = dflt.tracks;
  }
  if (def.data?.mixer) {
    const st = Array.isArray(src.strips) ? src.strips.slice(0, 6) : [];
    out.strips = Array.from({ length: 6 }, (_, i) => { const s = st[i] || {}; return { vol: num(s.vol, 0, 2, 1), pan: num(s.pan, 0, 1, 0.5), mute: s.mute === true, solo: s.solo === true }; });
  }
  if (def.data?.notefilter) { const pc = Array.isArray(src.pcs) ? src.pcs : []; out.pcs = Array.from({ length: 12 }, (_, i) => pc[i] === true); }
  if (def.data?.take) {   // a recording: notes with start and length in beats, kept to sensible sizes
    const evs = cleanTakeEvents;
    out.events = evs(src.events); out.len = num(src.len, 0, 4096, 0); out.bpm = num(src.bpm, 20, 300, 120); out.beats = int(src.beats, 1, 12, 4);
    out.versions = (Array.isArray(src.versions) ? src.versions.slice(0, 5) : []).filter((v) => v && typeof v === 'object').map((v) => ({ at: num(v.at, 0, 9e15, 0), bpm: num(v.bpm, 20, 300, 120), beats: int(v.beats, 1, 12, 4), events: evs(v.events) }));
  }
  if (def.data?.harmonics) {
    const arr = Array.isArray(src.partials) ? src.partials : [];
    out.partials = Array.from({ length: 16 }, (_, i) => num(arr[i], 0, 1, dflt.partials[i] ?? 0));
    const ac = Array.isArray(src.accent) ? src.accent : [], an = Array.isArray(src.accentNotes) ? src.accentNotes : [];
    out.accent = Array.from({ length: 16 }, (_, i) => num(ac[i], 0, 1, dflt.accent[i] ?? 0));
    out.accentNotes = Array.from({ length: 12 }, (_, i) => an[i] === true);
    out.scope = src.scope === 'some' ? 'some' : 'all';
  }
  if (def.data?.arrange) {
    const l = Array.isArray(src.lens) ? src.lens : [];
    out.lens = Array.from({ length: 6 }, (_, i) => int(l[i], 1, 9999, 4));
  }
  return out;
}

// Rebuild a whole patch. Throws for something that is not a patch or is too large; fixes or drops everything else. Removed Hydra modules are
// listed on the (non-enumerable) `dropped` property so the caller can tell the person their code was not run.
const REMOVED_FX = new Set(['ring', 'leslie', 'chorus']);
export function cleanGraph(g) {
  if (!g || typeof g !== 'object' || !Array.isArray(g.nodes) || !Array.isArray(g.wires)) throw new Error('not a patch');
  if (g.nodes.length > LIMITS.nodes) throw new Error(`too many modules (${g.nodes.length}; the limit is ${LIMITS.nodes})`);
  if (g.wires.length > LIMITS.wires) throw new Error(`too many cables (${g.wires.length}; the limit is ${LIMITS.wires})`);
  // Chorus, Ring mod and Leslie were taken out: the audio engine in the browser has no code to play them. An old patch that has them keeps working: the module is
  // left out and the cables on either side of it are joined up. The names are listed on the (non-enumerable) `removedFx` property.
  const removedFx = [];
  if (g.nodes.some((n) => n && REMOVED_FX.has(n.type))) {
    const gone = new Set(g.nodes.filter((n) => n && REMOVED_FX.has(n.type)).map((n) => n.id));
    removedFx.push(...new Set(g.nodes.filter((n) => n && REMOVED_FX.has(n.type)).map((n) => n.type)));
    const all = g.wires.filter((w) => w && w.from && w.to);
    // what feeds a removed module (looking through any removed modules in a row)
    const sources = (id, seen = new Set()) => (seen.has(id) ? [] : (seen.add(id), all.filter((w) => w.to.node === id && w.to.port === 'in').flatMap((w) => (gone.has(w.from.node) ? sources(w.from.node, seen) : [w.from]))));
    const kept = all.filter((w) => !gone.has(w.from.node) && !gone.has(w.to.node));
    const bridged = all.filter((w) => gone.has(w.from.node) && !gone.has(w.to.node)).flatMap((w) => sources(w.from.node).map((f) => ({ id: null, from: f, to: w.to })));
    g = { ...g, nodes: g.nodes.filter((n) => !(n && gone.has(n.id))), wires: [...kept, ...bridged] };
  }
  const dropped = [], ids = new Set(), nodes = [];
  for (const n of g.nodes) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'hydra') { dropped.push({ type: 'hydra', code: typeof n.params?.code === 'string' ? n.params.code.slice(0, 20000) : '' }); continue; }
    if (typeof n.type !== 'string' || !Object.prototype.hasOwnProperty.call(MODULES, n.type)) throw new Error(`unknown module type "${String(n.type).slice(0, 40)}"`);
    if (typeof n.id !== 'string' || !ID.test(n.id)) throw new Error('a module has an invalid id');
    if (ids.has(n.id)) throw new Error('duplicate module id');
    ids.add(n.id);
    const hadScale = n.params && typeof n.params === 'object' && 'scale' in n.params;
    const params = cleanParams(n.type, n.params);
    if (n.type === 'melody' && !hadScale) params.scale = 'off';   // patches from before keys existed keep their note names
    const o = { id: n.id, type: n.type, x: num(n.x, -1e6, 1e6, 0), y: num(n.y, -1e6, 1e6, 0), params };
    if (isNum(n.w) && n.w >= 100 && n.w <= 2000) o.w = n.w;
    if (n.collapsed === true) o.collapsed = true;
    if (n.muted === true) o.muted = true;
    nodes.push(o);
  }
  const wires = [];
  for (const w of g.wires) {
    if (!w || !w.from || !w.to || typeof w.from.node !== 'string' || typeof w.to.node !== 'string' || typeof w.from.port !== 'string' || typeof w.to.port !== 'string') continue;
    if (!ids.has(w.from.node) || !ids.has(w.to.node) || w.from.port !== 'out' || w.to.port.length > 40 || !/^[A-Za-z0-9_:]+$/.test(w.to.port)) continue;
    wires.push({ id: typeof w.id === 'string' && ID.test(w.id) ? w.id : null, from: { node: w.from.node, port: 'out' }, to: { node: w.to.node, port: w.to.port } });
  }
  const out = { v: 1, nodes, wires };
  if (Array.isArray(g.groups)) {
    out.groups = g.groups.slice(0, LIMITS.groups).filter((gr) => gr && typeof gr === 'object' && Array.isArray(gr.nodes)).map((gr, i) => ({
      id: typeof gr.id === 'string' && ID.test(gr.id) ? gr.id : 'g' + (i + 1),
      name: cleanText(gr.name, 60) ?? 'Group', nodes: gr.nodes.filter((id) => typeof id === 'string' && ids.has(id)).slice(0, 100), collapsed: gr.collapsed === true,
    }));
    if (!out.groups.length) delete out.groups;
  }
  Object.defineProperty(out, 'dropped', { value: dropped, enumerable: false });
  Object.defineProperty(out, 'removedFx', { value: removedFx, enumerable: false });
  return out;
}

// quick size guard for text that is about to be parsed
export function checkSize(text, label = 'This file') {
  if (typeof text !== 'string') throw new Error(`${label} could not be read`);
  if (text.length > LIMITS.bytes) throw new Error(`${label} is too large (${Math.round(text.length / 1000)} KB; the limit is ${Math.round(LIMITS.bytes / 1000)} KB)`);
  return text;
}
