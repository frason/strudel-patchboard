// Editing a Hit Pattern from clicks, with brackets.
// The text is read as a tree: a sequence of steps, where a step is a hit (x), a rest (~) or a group [ ... ] that squeezes its own sequence into one step.
//   "x ~ [x x] x@2"  ->  4 steps; the third holds two hits, the last is twice as wide.
// Repeats are opened out so they can be edited: x*2 becomes [x x], [x ~]*2 becomes [[x ~] [x ~]], x!2 becomes x x.
// Anything else (< > alternation, , stacks, ? chance, (3,8) euclid, other words) is not read, and the picture stays read-only.
const MAX_LEAVES = 512, MAX_DEPTH = 6;
const clone = (v) => JSON.parse(JSON.stringify(v));

export function parseHitTree(text) {
  const s = String(text || '').trim();
  if (!s || /[^\sx1~[\]@*!\d]/i.test(s)) return null;
  let i = 0, leaves = 0;
  const num = () => { const j = i; while (i < s.length && s[i] >= '0' && s[i] <= '9') i++; return i === j ? 0 : Number(s.slice(j, i)); };
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const depthOf = (kids) => kids.reduce((d, k) => Math.max(d, k.kids ? 1 + depthOf(k.kids) : 0), 0);
  const seq = (end) => {
    const out = [];
    for (;;) {
      ws();
      if (i >= s.length || s[i] === end) return out;
      out.push(...item());
    }
  };
  const item = () => {
    let node;
    if (s[i] === '[') {
      i++; const kids = seq(']'); if (s[i] !== ']' || !kids.length) throw new Error('bracket'); i++;
      node = { kids, w: 1 };
    } else {
      const c = s[i]; if (!c || !/[x1~]/i.test(c)) throw new Error('word'); i++;
      if (++leaves > MAX_LEAVES) throw new Error('size');
      node = { rest: c === '~', sym: c === '~' ? '~' : 'x', w: 1 };
    }
    let w = 1, rep = 1, bang = 1;
    for (;;) {
      const c = s[i];
      if (c === '@') { i++; const n = num(); if (n < 1 || n > 256) throw new Error('weight'); w = n; }
      else if (c === '*') { i++; const n = num(); if (n < 1 || n > 16) throw new Error('repeat'); rep = n; }
      else if (c === '!') { i++; const n = num(); if (n < 1 || n > 16) throw new Error('bang'); bang = n; }
      else break;
    }
    node.w = w;
    let one = node;
    if (rep > 1) { const inner = { ...node, w: 1 }; one = { kids: Array.from({ length: rep }, () => clone(inner)), w }; }
    leaves += (bang - 1) * 1;
    return Array.from({ length: bang }, () => clone(one));
  };
  try {
    const kids = seq(null);
    if (i < s.length || !kids.length || depthOf(kids) > MAX_DEPTH) return null;
    return kids;
  } catch { return null; }
}

export function writeHitTree(kids) {
  const w = (k, base) => (k.w > 1 ? `${base}@${k.w}` : base);
  const one = (k) => (k.kids ? w(k, `[${k.kids.map(one).join(' ')}]`) : w(k, k.rest ? '~' : 'x'));
  return kids.map(one).join(' ');
}

// where every step sits across the cycle (a and b are fractions of the cycle), and the groups around them
export function layoutHitTree(kids, a = 0, b = 1, path = [], out = { leaves: [], groups: [] }, depth = 0) {
  const total = kids.reduce((t, k) => t + k.w, 0); let x = a;
  kids.forEach((k, i) => {
    const e = x + ((b - a) * k.w) / total;
    if (k.kids) { out.groups.push({ a: x, b: e, depth }); layoutHitTree(k.kids, x, e, [...path, i], out, depth + 1); }
    else out.leaves.push({ a: x, b: e, path: [...path, i], rest: k.rest, w: k.w });
    x = e;
  });
  return out;
}
export const leafAt = (lay, t) => lay.leaves.find((l) => t >= l.a && t < l.b) || null;

const nodeAt = (kids, path) => { let list = kids, n = null; for (const i of path) { n = list[i]; if (!n) return null; list = n.kids || []; } return n; };
const parentList = (kids, path) => { let list = kids; for (const i of path.slice(0, -1)) list = list[i].kids; return list; };

// click: a hit becomes a rest and a rest becomes a hit. In a wide rest (~@4) the click makes a hit one unit wide where you clicked, `unit` counting from the left of the step.
export function toggleAt(kids, path, unit = 0) {
  const t = clone(kids), n = nodeAt(t, path); if (!n || n.kids) return null;
  const list = parentList(t, path), idx = path[path.length - 1];
  if (n.rest && n.w > 1) {
    const u = Math.max(0, Math.min(n.w - 1, unit)), parts = [];
    if (u > 0) parts.push({ rest: true, sym: '~', w: u });
    parts.push({ rest: false, sym: 'x', w: 1 });
    if (n.w - u - 1 > 0) parts.push({ rest: true, sym: '~', w: n.w - u - 1 });
    list.splice(idx, 1, ...parts);
  } else { n.rest = !n.rest; n.sym = n.rest ? '~' : 'x'; }
  return t;
}
// shift-click: cut one step in two, so a hit becomes [x x] and a rest [~ ~]
export function splitAt(kids, path) {
  if (path.length >= MAX_DEPTH) return null;
  const t = clone(kids), n = nodeAt(t, path); if (!n || n.kids) return null;
  const list = parentList(t, path), idx = path[path.length - 1], half = () => ({ rest: n.rest, sym: n.sym, w: 1 });
  list.splice(idx, 1, { kids: [half(), half()], w: n.w });
  return t;
}
// alt-click: fold the group a step sits in back into one step (a hit if any of it was a hit)
export function mergeAt(kids, path) {
  if (path.length < 2) return null;
  const t = clone(kids), gp = path.slice(0, -1), g = nodeAt(t, gp); if (!g || !g.kids) return null;
  const any = (k) => (k.kids ? k.kids.some(any) : !k.rest);
  const list = parentList(t, gp), idx = gp[gp.length - 1], hit = any(g);
  list.splice(idx, 1, { rest: !hit, sym: hit ? 'x' : '~', w: g.w });
  return t;
}
