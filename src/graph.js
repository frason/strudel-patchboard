// The one serialisable graph. Everything else (compiler, code panel, undo, saves, export) reads this.
//   { v:1, nodes:[{id,type,x,y,params,collapsed?}], wires:[{id,from:{node,port},to:{node,port}}] }
import { MODULES, PATTERN_TYPES, defaultParams, portsOf, resizeCells, resizeTracks } from './modules.js';
import { cleanGraph } from './validate.js';

let counter = 0;
export function uid(prefix = 'n') {
  counter++;
  return prefix + Date.now().toString(36).slice(-4) + counter.toString(36) + Math.random().toString(36).slice(2, 5);
}

export const emptyGraph = () => ({ v: 1, nodes: [], wires: [] });
export const clone = (g) => JSON.parse(JSON.stringify(g));

export function makeNode(type, x, y, params = {}) {
  return { id: uid('n'), type, x, y, params: { ...defaultParams(type), ...params } };
}

export const nodeById = (g, id) => g.nodes.find((n) => n.id === id);
export const portOf = (g, nodeId, portId) => {
  const n = nodeById(g, nodeId);
  return n ? portsOf(n).find((p) => p.id === portId) : undefined;
};
export const wiresInto = (g, nodeId, portId) => g.wires.filter((w) => w.to.node === nodeId && w.to.port === portId);
export const wiresFrom = (g, nodeId) => g.wires.filter((w) => w.from.node === nodeId);

// What kind of cable does this node's output carry? null = not known yet (a pass-through with nothing plugged in).
export function outType(g, nodeId, seen = new Set()) {
  const n = nodeById(g, nodeId);
  if (!n || seen.has(nodeId)) return null;
  const def = MODULES[n.type];
  if (def.out === 'through') {
    seen.add(nodeId);
    for (const p of portsOf(n)) {
      if (p.dir !== 'in' || p.param || p.order) continue;
      for (const w of wiresInto(g, nodeId, p.id)) {
        const t = outType(g, w.from.node, seen);
        if (t) return t;
      }
    }
    return null;
  }
  return def.out;
}

// can `from`'s output reach `target` by following wires? (cycle test)
export function reaches(g, from, target, seen = new Set()) {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return wiresFrom(g, from).some((w) => reaches(g, w.to.node, target, seen));
}

// Returns null if the connection is legal, otherwise a short reason.
export function whyNot(g, fromNode, toNode, toPort, ignoreWire) {
  if (fromNode === toNode) return 'a module cannot plug into itself';
  const to = nodeById(g, toNode);
  const from = nodeById(g, fromNode);
  if (!to || !from) return 'missing module';
  const port = portsOf(to).find((p) => p.id === toPort);
  if (!port || port.dir !== 'in') return 'no such input';
  if (!MODULES[from.type].out) return 'this module has no output';
  const test = ignoreWire ? { ...g, wires: g.wires.filter((w) => w.id !== ignoreWire) } : g;
  const t = outType(test, fromNode);
  if (port.accept === 'same') {
    if (t === 'number' || t === 'key') return `${t} cables plug into knobs and key inputs, not patterns`;
    // all inputs of a stack/sequence share one type
    for (const p of portsOf(to)) {
      if (p.id === toPort || p.dir !== 'in' || p.accept !== 'same') continue;
      for (const w of wiresInto(test, toNode, p.id)) {
        const o = outType(test, w.from.node);
        if (o && t && o !== t) return `this module already holds ${o} cables, not ${t}`;
      }
    }
  } else if (t === null) {
    if (port.accept.length === 1 && port.accept[0] === 'number') return 'only number cables fit here';
  } else if (!port.accept.includes(t)) {
    return `${t} cable does not fit a ${port.accept.join('/')} input`;
  }
  if (reaches(test, toNode, fromNode)) return 'that would make a feedback loop';
  return null;
}

// Remove anything illegal: unknown nodes/ports, bad types, loops, doubled single inputs. Returns what was removed.
export function normalize(g) {
  const removed = [];
  for (const n of g.nodes) {
    const def = MODULES[n.type];
    if (def.data?.tracks) n.params.tracks = resizeTracks(n.params.tracks || [], n.params.steps);
    if (def.data?.cells) n.params.cells = resizeCells(n.type, n.params.cells || [], n.params.steps);
  }
  const keep = [];
  const draft = { ...g, wires: [] };
  const consider = (w) => {
    const reason = whyNot(draft, w.from.node, w.to.node, w.to.port);
    if (reason) return removed.push({ wire: w, reason });
    const port = portOf(g, w.to.node, w.to.port);
    if (!port.multi && wiresInto(draft, w.to.node, w.to.port).length) return removed.push({ wire: w, reason: 'input already used' });
    draft.wires.push(w);
    keep.push(w);
  };
  g.wires.forEach(consider);
  // types can change after an upstream wire arrived later in the list: re-check until stable
  for (let i = 0; i < 8; i++) {
    let changed = false;
    for (const w of keep.slice()) {
      const reason = whyNot({ ...g, wires: keep.filter((k) => k !== w) }, w.from.node, w.to.node, w.to.port);
      if (reason) {
        keep.splice(keep.indexOf(w), 1);
        removed.push({ wire: w, reason });
        changed = true;
      }
    }
    if (!changed) break;
  }
  g.wires = keep;
  // groups (a visual frame around modules): drop dead members, a module belongs to one group, a group needs two or more
  if (g.groups) {
    const alive = new Set(g.nodes.map((n) => n.id)), taken = new Set();
    g.groups = g.groups.map((gr) => ({ ...gr, nodes: gr.nodes.filter((id) => alive.has(id) && !taken.has(id) && taken.add(id)) })).filter((gr) => gr.nodes.length >= 2);
    if (!g.groups.length) delete g.groups;
  }
  return removed;
}

export function validateShape(g) {
  const c = cleanGraph(g);   // rebuilt from the module specifications: see validate.js
  g.nodes = c.nodes;
  g.wires = c.wires;
  if (c.groups) g.groups = c.groups; else delete g.groups;
  g.wires.forEach((w) => (w.id = w.id || uid('w')));
  g.v = 1;
  Object.defineProperty(g, 'dropped', { value: c.dropped, enumerable: false, configurable: true, writable: true });
  Object.defineProperty(g, 'removedFx', { value: c.removedFx, enumerable: false, configurable: true, writable: true });
  return g;
}

export const isPattern = (t) => PATTERN_TYPES.includes(t);

// The key a Melody Sequencer is using: a plugged-in Key module wins over its own key/scale selectors.
export function effectiveKey(g, n) {
  if (n.type === 'randnotes') {   // a Random Notes module always works in a scale: a plugged-in Key wins over its own key and scale
    const w0 = wiresInto(g, n.id, 'key')[0], k0 = w0 && nodeById(g, w0.from.node);
    return k0 && k0.type === 'key' ? { root: k0.params.root, scale: k0.params.scale, node: k0.id, wired: true } : { root: n.params.root, scale: n.params.scale, node: n.id, wired: false };
  }
  if (n.type !== 'melody' && n.type !== 'chords') return null;
  const w = wiresInto(g, n.id, 'key')[0];
  const k = w && nodeById(g, w.from.node);
  if (k && k.type === 'key') return { root: k.params.root, scale: k.params.scale, node: k.id, wired: true };
  if (n.params.scale && n.params.scale !== 'off') return { root: n.params.root, scale: n.params.scale, node: n.id, wired: false };
  return null;
}

// Scope modules get analyser ids 1, 2, ... in board order, so the code and the drawing agree.
export const scopeId = (g, n) => g.nodes.filter((x) => x.type === 'scope').findIndex((x) => x.id === n.id) + 1;

// ---- helpers for the phone "flow" view (pure, so they can be tested) ----
// The order modules are listed in: sources first, then each step downstream (longest path from a source), top to bottom within a step.
export function flowOrder(g) {
  const depth = new Map(g.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < g.nodes.length; pass++) {
    let changed = false;
    for (const w of g.wires) {
      if (w.from.node === w.to.node) continue;
      const d = (depth.get(w.from.node) || 0) + 1;
      if (d > (depth.get(w.to.node) || 0) && d <= g.nodes.length) { depth.set(w.to.node, d); changed = true; }
    }
    if (!changed) break;
  }
  return [...g.nodes].sort((a, b) => depth.get(a.id) - depth.get(b.id) || a.y - b.y || a.x - b.x).map((n) => n.id);
}
// Where a cable from this module's output could go: every input (and number knob) that accepts it, as {node, port, label}.
export function legalTargets(g, fromNode) {
  const out = [];
  for (const n of g.nodes) {
    if (n.id === fromNode) continue;
    for (const p of portsOf(n)) {
      if (p.dir !== 'in') continue;
      if (!whyNot(g, fromNode, n.id, p.id)) out.push({ node: n.id, port: p.id, label: p.param ? `${p.label} knob` : p.label || 'in' });
    }
  }
  return out;
}
// Which modules could feed this input: every output that is allowed to plug into it.
export function legalSources(g, toNode, toPort) {
  return g.nodes.filter((n) => n.id !== toNode && MODULES[n.type].out && !whyNot(g, n.id, toNode, toPort)).map((n) => n.id);
}

// Can this module be dropped into this cable? The module needs an input that takes what the cable carries, and an output the cable's end accepts.
// Returns { inPort } (the input to plug the cable's start into) or null. The module must not be wired to anything yet.
export function insertPlan(g, wire, node) {
  if (!wire || !node || !MODULES[node.type]?.out) return null;
  if (wire.from.node === node.id || wire.to.node === node.id) return null;
  if (MODULES[node.type].single && g.nodes.some((n) => n.type === node.type && n.id !== node.id)) return null;
  if (g.wires.some((w) => w.from.node === node.id || w.to.node === node.id)) return null;
  const base = { ...g, nodes: g.nodes.some((n) => n.id === node.id) ? g.nodes : [...g.nodes, node], wires: g.wires.filter((w) => w.id !== wire.id) };
  for (const p of portsOf(node)) {
    if (p.dir !== 'in' || p.param) continue;
    if (whyNot(base, wire.from.node, node.id, p.id)) continue;
    const mid = { ...base, wires: [...base.wires, { id: 'tmp-insert', from: wire.from, to: { node: node.id, port: p.id } }] };
    if (!whyNot(mid, node.id, wire.to.node, wire.to.port)) return { inPort: p.id };
  }
  return null;
}
