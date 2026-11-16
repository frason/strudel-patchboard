// Code edit -> board edit. The board is the real graph. To find out what a text edit MEANT, the code the board writes (before) and the edited code
// (after) are both read by the importer, and the two readings are compared: only what differs between them is applied to the real board.
// So a module the edit did not touch is never rewritten (its own settings, position, size, collapsed and mute state stay exactly as they were),
// even when the importer reads it back in a slightly different shape. New code adds modules, vanished code removes only its own modules and cables.
// Anything that cannot be applied (code the importer cannot read, or a module the importer reads back as several) is reported, never dropped:
// the text stays as typed. Nothing here touches the DOM, the store or audio.
//
// Identity is never decided by position in the file. Two modules are the same when they sit in the same place in the chain: the same kind of module,
// plugged into the same input of an already matched module, with the same kind of thing behind it.
import { normalize } from './graph.js';
import { compile } from './compile.js';
import { importStrudel } from './importer.js';
import { editableNumbers, numberTarget } from './codenums.js';

const portsOf = (g) => {
  const m = new Map();   // node id -> Map(port -> [source ids in wire order])
  for (const w of g.wires) {
    if (!m.has(w.to.node)) m.set(w.to.node, new Map());
    const p = m.get(w.to.node);
    if (!p.has(w.to.port)) p.set(w.to.port, []);
    p.get(w.to.port).push(w.from.node);
  }
  return m;
};

// what a module is, ignoring its settings: its kind plus what feeds each of its inputs
function signatures(g, inputs) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const memo = new Map();
  const sig = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id);
    if (seen.has(id)) return '~';
    seen.add(id);
    const ins = inputs.get(id);
    const s = (byId.get(id)?.type ?? '?') + (ins ? '(' + [...ins.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, ids]) => p + '=' + ids.map((x) => sig(x, seen)).join(',')).join(';') + ')' : '');
    seen.delete(id);
    memo.set(id, s);
    return s;
  };
  return { sig, byId };
}

// pair up two ordered lists: identical shapes first (longest common run), then leftovers of the same kind in order
function pairUp(a, b, keyOf, typeOf) {
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = keyOf(a[i], 'a') === keyOf(b[j], 'b') ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs = [], ua = new Set(a.keys()), ub = new Set(b.keys());
  for (let i = 0, j = 0; i < n && j < m;) {
    if (keyOf(a[i], 'a') === keyOf(b[j], 'b')) { pairs.push([i, j]); ua.delete(i); ub.delete(j); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  for (const i of [...ua]) {
    const j = [...ub].find((q) => typeOf(b[q], 'b') === typeOf(a[i], 'a'));
    if (j !== undefined) { pairs.push([i, j]); ub.delete(j); }
  }
  return pairs;
}

export function matchNodes(oldG, newG) {
  const oin = portsOf(oldG), nin = portsOf(newG);
  const O = signatures(oldG, oin), N = signatures(newG, nin);
  const match = new Map();   // new id -> old id
  const taken = new Set();
  const visit = (nid, oid) => {
    if (match.has(nid) || taken.has(oid)) return;
    match.set(nid, oid); taken.add(oid);
    const nm = nin.get(nid) || new Map(), om = oin.get(oid) || new Map();
    for (const port of new Set([...nm.keys(), ...om.keys()])) {
      const a = nm.get(port) || [], b = om.get(port) || [];
      const pairs = pairUp(a, b, (id, side) => (side === 'a' ? N : O).sig(id), (id, side) => (side === 'a' ? N : O).byId.get(id)?.type);
      for (const [i, j] of pairs) visit(a[i], b[j]);
    }
  };
  const nOut = newG.nodes.find((n) => n.type === 'output'), oOut = oldG.nodes.find((n) => n.type === 'output');
  if (nOut && oOut) visit(nOut.id, oOut.id);
  return match;
}


const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rid = () => Math.random().toString(36).slice(2, 7);

// real: the board. oldImp / newImp: the importer's readings of the code before and after the edit. represented: ids of real modules that write code.
export function applyEdit(real, oldImp, newImp, represented) {
  const m1 = matchNodes(oldImp, newImp);   // newImp id -> oldImp id
  const m0 = matchNodes(real, oldImp);     // oldImp id -> real id
  const oldOfNew = m1, newOfOld = new Map([...m1].map(([n, o]) => [o, n]));
  const realOfOld = (oid) => { const r = m0.get(oid); return r && represented.has(r) ? r : undefined; };
  const nodes = new Map(real.nodes.map((n) => [n.id, { ...n, params: { ...n.params } }]));
  const changes = { updated: [], added: [], removed: [], unapplied: [] };
  const impOld = new Map(oldImp.nodes.map((n) => [n.id, n])), impNew = new Map(newImp.nodes.map((n) => [n.id, n]));
  const describe = (n) => n.type + (n.params?.name ? ' "' + String(n.params.name).slice(0, 20) + '"' : '');

  // settings: only the keys the edit changed
  for (const [nid, oid] of m1) {
    const o = impOld.get(oid), n = impNew.get(nid), rId = realOfOld(oid);
    const keys = [...new Set([...Object.keys(o.params), ...Object.keys(n.params)])].filter((k) => !same(o.params[k], n.params[k]));
    if (!keys.length) continue;
    if (!rId) { changes.unapplied.push({ what: describe(n), why: 'the board shows this part as one module that the code reads as several, so it cannot be edited from the code yet' }); continue; }
    const r = nodes.get(rId);
    for (const k of keys) { if (n.params[k] === undefined) delete r.params[k]; else r.params[k] = n.params[k]; }
    changes.updated.push(rId);
  }
  // code that vanished
  const gone = new Set();
  for (const [oid, o] of impOld) {
    if (newOfOld.has(oid) || o.type === 'output') continue;
    const rId = realOfOld(oid);
    if (!rId) { changes.unapplied.push({ what: describe(o), why: 'this code was removed, but the board shows it as part of a larger module, so that module was left as it is' }); continue; }
    gone.add(rId); nodes.delete(rId); changes.removed.push(rId);
  }
  // code that is new
  const idOfNew = new Map();
  for (const [nid] of impNew) { const o = oldOfNew.get(nid); const r = o !== undefined ? realOfOld(o) : undefined; if (r) idOfNew.set(nid, r); else if (o !== undefined && m0.get(o)) idOfNew.set(nid, m0.get(o)); }
  const placed = [...nodes.values()];
  for (const n of newImp.nodes) {
    if (oldOfNew.has(n.id)) continue;
    const id = real.nodes.some((x) => x.id === n.id) ? n.id + '_' + rid() : n.id;
    idOfNew.set(n.id, id);
    const down = newImp.wires.find((w) => w.from.node === n.id && idOfNew.has(w.to.node) && nodes.has(idOfNew.get(w.to.node)));
    const up = newImp.wires.find((w) => w.to.node === n.id && idOfNew.has(w.from.node) && nodes.has(idOfNew.get(w.from.node)));
    const anchor = down ? nodes.get(idOfNew.get(down.to.node)) : up ? nodes.get(idOfNew.get(up.from.node)) : null;
    const add = { ...n, id, x: anchor ? anchor.x + (down ? -320 : 320) : 0, y: Math.max(0, ...placed.map((q) => q.y)) + 300 };   // below everything already there, so it never lands on top of a module
    nodes.set(id, add); placed.push(add); changes.added.push(id);
  }

  // cables
  const key = (w) => `${w.from.node}>${w.to.node}:${w.to.port}`;
  let wires = real.wires.filter((w) => nodes.has(w.from.node) && nodes.has(w.to.node));
  const have = new Set(wires.map(key));
  const wantNew = new Set();
  for (const w of newImp.wires) {
    const from = idOfNew.get(w.from.node), to = idOfNew.get(w.to.node);
    if (!from || !to || !nodes.has(from) || !nodes.has(to)) continue;
    const mapped = { id: 'w' + rid(), from: { node: from, port: w.from.port }, to: { node: to, port: w.to.port } };
    wantNew.add(key(mapped));
    if (!have.has(key(mapped))) { wires.push(mapped); have.add(key(mapped)); }
  }
  for (const w of oldImp.wires) {   // a cable the code no longer has, between two modules that both stay
    const a = newOfOld.get(w.from.node), b = newOfOld.get(w.to.node);
    if (a === undefined || b === undefined) continue;
    const ra = realOfOld(w.from.node), rb = realOfOld(w.to.node);
    if (!ra || !rb) continue;
    const k = `${ra}>${rb}:${w.to.port}`;
    if (!wantNew.has(k)) wires = wires.filter((x) => key(x) !== k);
  }

  const graph = { ...real, nodes: [...nodes.values()], wires };
  if (real.groups) graph.groups = real.groups.map((gr) => ({ ...gr, nodes: gr.nodes.filter((id) => nodes.has(id)) }));
  normalize(graph);
  void gone;
  return { graph, changes };
}

// First, the exact path. When the edited text is the old text with only some of its knob numbers changed, nothing needs guessing: every number
// already knows which module and knob wrote it, so each changed number goes straight to that knob (the same rules as typing it in the panel).
// Returns the list of changes, or null when the edit is anything else (then the structural path below reads the whole text).
export function numberEdits(res, newCode) {
  const ranges = editableNumbers(res).sort((a, b) => a.from - b.from).filter((r, i, all) => i === 0 || r.from >= all[i - 1].to);
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let re = '', at = 0;
  for (const r of ranges) { re += esc(res.code.slice(at, r.from)) + '(-?\\d*\\.?\\d+)'; at = r.to; }
  re += esc(res.code.slice(at));
  const m = new RegExp('^' + re + '$').exec(newCode);
  if (!m) return null;
  const out = [];
  ranges.forEach((r, i) => { const was = Number(res.code.slice(r.from, r.to)), now = Number(m[i + 1]); if (now !== was) out.push({ seg: r.seg, call: r.call, value: now }); });
  return out;
}

// the whole step: the board and the edited code in, the new board (or a reason it could not be read) out
// baseCode: the code the person's text last agreed with, when that is no longer what the board writes (the board changed since). The text's own
// edits are then merged onto the board relative to that code, so a change made on the board in the meantime is not undone.
export function applyCodeEdit(real, newCode, { sounds = null, baseCode = null } = {}) {
  const before = compile(real);
  const base = baseCode ?? before.code;
  const nums = base === before.code ? numberEdits(before, newCode) : null;
  if (nums) {
    const graph = { ...real, nodes: real.nodes.map((n) => ({ ...n, params: { ...n.params } })) }, updated = [];
    let ok = true;
    for (const e of nums) {
      const t = numberTarget(graph, e.seg, e.call, e.value);
      if (!t) { ok = false; break; }
      graph.nodes.find((n) => n.id === t.id).params[t.key] = t.value;
      if (!updated.includes(t.id)) updated.push(t.id);
    }
    if (ok) return { graph: updated.length ? graph : real, changes: { updated, added: [], removed: [], unapplied: [] }, report: { done: [], skipped: [], notes: [] }, via: 'numbers' };
  }
  const oldImp = importStrudel(base, { sounds }), newImp = importStrudel(newCode, { sounds });
  if (newImp.error) return { error: newImp.error };
  if (oldImp.error) return { error: oldImp.error };
  const represented = new Set(before.segments.map((s) => s.node).filter(Boolean));
  const out = applyEdit(real, oldImp.graph, newImp.graph, represented);
  return { ...out, report: newImp.report };
}
