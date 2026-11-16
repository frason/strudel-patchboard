// Code-edit tests: pure functions, no browser. Run: npm run test:reconcile
import { LESSONS } from '../src/starters.js';
import { compile } from '../src/compile.js';
import { applyCodeEdit } from '../src/reconcile.js';
import { clone, emptyGraph, makeNode } from '../src/graph.js';
import { patchText, checkSync } from '../src/textsync.js';

let failures = 0;
const check = (name, cond, extra = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond || !extra ? '' : '  [' + extra + ']')); if (!cond) failures++; };
const idle = (c) => !c.added.length && !c.removed.length && !c.updated.length && !c.unapplied.length;
const sameBoard = (a, b) => JSON.stringify(a.nodes) === JSON.stringify(b.nodes) && JSON.stringify(a.wires) === JSON.stringify(b.wires);

// 1. unchanged code changes nothing at all, for every lesson (positions that a fresh import would never produce)
let calm = 0, bad = [];
for (const l of LESSONS) {
  const g = l.graph(); g.nodes.forEach((n, i) => { n.x = 17 * i + 3; n.y = 9 * i + 1; });
  const r = applyCodeEdit(g, compile(g).code);
  if (r.error) { bad.push(l.title + ': ' + r.error.slice(0, 40)); continue; }
  if (idle(r.changes) && sameBoard(r.graph, g)) calm++; else bad.push(`${l.title}: +${r.changes.added.length} -${r.changes.removed.length} ~${r.changes.updated.length} ?${r.changes.unapplied.length}`);
}
check(`unchanged code leaves the board byte for byte as it was (${calm}/${LESSONS.length} lessons)`, calm === LESSONS.length, bad.slice(0, 4).join(' | '));

// 2. change one number in the code of every lesson: the board must follow, and nothing else may move
let followed = 0, tried = 0; const off = [];
for (const l of LESSONS) {
  const g = l.graph(), code = compile(g).code;
  const lines = code.split('\n'), li = lines.findIndex((ln) => !/register\(/.test(ln) && /\.(gain|lpf|room|delay|speed|release)\((\d*\.?\d+)\)/.test(ln));
  if (li < 0) continue;
  const m = /\.(gain|lpf|room|delay|speed|release)\((\d*\.?\d+)\)/.exec(lines[li]);
  tried++;
  const to = m[1] === 'lpf' ? (m[2] === '900' ? '1234' : '900') : m[2] === '0.4' ? '0.3' : '0.4';
  lines[li] = lines[li].replace(m[0], `.${m[1]}(${to})`);
  const next = lines.join('\n');
  const r = applyCodeEdit(g, next);
  if (r.error) { off.push(l.title + ' ' + r.error.slice(0, 30)); continue; }
  const moved = r.graph.nodes.some((n) => { const o = g.nodes.find((q) => q.id === n.id); return !o || o.x !== n.x || o.y !== n.y; });
  if (compile(r.graph).code === next && !r.changes.added.length && !r.changes.removed.length && !moved && r.graph.nodes.length === g.nodes.length) followed++; else off.push(`${l.title} (${m[1]}) updated ${r.changes.updated.length} unapplied ${r.changes.unapplied.length}`);
}
check(`a changed number moves the right knob and the board writes back exactly the edited code (${followed}/${tried} lessons)`, tried > 15 && followed === tried, off.slice(0, 4).join(' | '));

// 3. a handwritten two-line board
const base = emptyGraph();
const N = (t, p = {}, x = 0, y = 0) => { const n = makeNode(t, x, y, p); base.nodes.push(n); return n; };
const W = (a, b, port = 'in') => base.wires.push({ id: 'w' + base.wires.length, from: { node: a.id, port: 'out' }, to: { node: b.id, port } });
const s1 = N('sample', { name: 'bd*2' }, 400, 10), s2 = N('sample', { name: 'hh*4' }, 400, 300), out = N('output', {}, 900, 150);
W(s1, out); W(s2, out);
const codeB = compile(base).code;
const gone = applyCodeEdit(base, codeB.split('\n').filter((ln) => !/hh/.test(ln)).join('\n'));
check('deleting a line removes only that line\'s module and cable', !gone.error && gone.changes.removed.includes(s2.id) && gone.graph.nodes.length === 2 && gone.graph.nodes.some((n) => n.id === s1.id && n.x === 400 && n.y === 10) && gone.graph.wires.length === 1);
const more = applyCodeEdit(base, codeB + '\n$: s("cp*2")');
check('adding a line adds modules and keeps every existing one exactly where it was', !more.error && more.changes.added.length === 1 && [s1, s2, out].every((o) => more.graph.nodes.some((n) => n.id === o.id && n.x === o.x && n.y === o.y)) && more.graph.wires.length === 3 && compile(more.graph).code.includes('cp*2'));
const swapped = applyCodeEdit(base, codeB.split('\n').reverse().join('\n'));
check('reordering lines does not recreate anything', !swapped.error && !swapped.changes.added.length && !swapped.changes.removed.length);
const renamed = applyCodeEdit(base, codeB.replace('bd*2', 'bd*3 sd'));
check('changing a sound name keeps the module and its place and only changes its sound', !renamed.error && renamed.changes.updated.length === 1 && renamed.changes.updated[0] === s1.id && renamed.graph.nodes.find((n) => n.id === s1.id).params.name === 'bd*3 sd');

// 4. what the code does not describe survives
const withExtra = clone(base);
const muted = makeNode('filter', 200, 600, { cutoff: 900 }); muted.muted = true; muted.collapsed = true;
const loose = makeNode('slider', 200, 700, { value: 0.3 });
withExtra.nodes.push(muted, loose);
const kept = applyCodeEdit(withExtra, compile(withExtra).code.replace('bd*2', 'bd*4'));
check('a muted module and a module with no cable survive an edit, with their state', !kept.error && kept.graph.nodes.some((n) => n.id === muted.id && n.muted && n.collapsed) && kept.graph.nodes.some((n) => n.id === loose.id));

// 5. groups
const grouped = clone(base); grouped.groups = [{ id: 'g1', name: 'Drums', nodes: [s1.id, s2.id], collapsed: false }];
const g2 = applyCodeEdit(grouped, codeB.split('\n').filter((ln) => !/hh/.test(ln)).join('\n'));
check('a group is dropped once it has fewer than two members, and kept while it has two', !g2.error && !g2.graph.groups && applyCodeEdit(grouped, codeB.replace('bd*2', 'bd*3')).graph.groups?.[0]?.nodes.length === 2);

// 6. bad code never touches the board and says why; code the importer cannot read is reported, the rest still applies
const broken = applyCodeEdit(base, codeB + '\n$: s("bd"');
check('code that is not valid JavaScript gives an error and no new board', typeof broken.error === 'string' && !broken.graph);
const odd = applyCodeEdit(base, codeB + '\nfoo.bar(baz)');
check('a line the board cannot show is reported and the rest of the board stays', !odd.error && odd.report.skipped.length >= 1 && sameBoard(odd.graph, base));
check('every result compiles', [gone, more, swapped, renamed, kept, g2, odd].every((o) => { try { return typeof compile(o.graph).code === 'string'; } catch { return false; } }));

// 7. keeping the person's text: a board change is carried into their own text, comments and spacing intact
{
  const g = LESSONS[7].graph(), canon = compile(g).code;
  const lines = canon.split('\n');
  const user = '// my track\n' + lines.map((ln) => ln.replace(/^(\s*)\./, '$1  .')).join('\n\n') + '\n// end';
  const m = /\.(gain|lpf|room|delay|speed|release)\((\d*\.?\d+)\)/.exec(canon);
  const to = m[1] === 'lpf' ? '1234' : '0.37';
  const canon2 = canon.replace(m[0], `.${m[1]}(${to})`);
  const out = patchText(user, canon, canon2);
  check('a board change goes into the person\'s text as one small edit; their comments and spacing stay', typeof out === 'string' && out.startsWith('// my track') && out.endsWith('// end') && out.includes(`.${m[1]}(${to})`) && out.length - user.length === canon2.length - canon.length);
  check('when the text was not changed, a board change simply gives the new code', patchText(canon, canon, canon2) === canon2);
  check('when the text around the change has been edited away, it says so instead of guessing', patchText('$: s("bd")', canon, canon2) === null);
  const dup = 'a(1)\nb(1)\n', dupOld = 'a(1)\n', dupNew = 'a(2)\n';
  check('an ambiguous place is refused, not guessed', patchText(dup + dup, dupOld, dupNew) === null || patchText(dup + dup, dupOld, dupNew).split('a(2)').length === 2);
  const typed = canon.replace(m[0], `.${m[1]}(${to})`);
  const s1 = checkSync(g, user), s2 = checkSync(g, typed), s3 = checkSync(g, canon + '\n$: s("bd"');
  check('read-back: the same music in the person\'s layout is in sync; an edit not yet applied is flagged; broken code is an error', s1.state === 'ok' && s2.state === 'differs' && s3.state === 'error');
  const moved = 'x(1)\n$: s("bd")\ny(2)\n', userMoved = '// c\ny(2)\nx(1)\n$: s("bd")\n';
  check('a removed statement is still found when it was moved elsewhere in the text', (() => { const o = patchText(userMoved, moved, 'x(1)\ny(2)\n'); return typeof o === 'string' && !o.includes('bd') && o.startsWith('// c') && o.includes('x(1)') && o.includes('y(2)'); })());
  const s4 = checkSync(g, canon + '\nfoo.bar(baz)');
  check('read-back: a line the board cannot show is listed, with the reason', s4.state === 'partial' && s4.parts.length >= 1 && !!s4.parts[0].why);
}

// 8. starting from an empty patch: typing code builds a whole working board, including the Output module with the tempo
{
  const empty = emptyGraph();
  const r = applyCodeEdit(empty, 'setcpm(130/4)\n\n$: s("bd")');
  const out = r.graph?.nodes.find((n) => n.type === 'output');
  check('typing code into an empty patch creates the module and an Output with the tempo, cabled together', !r.error && r.graph.nodes.length === 2 && out && out.params.bpm === 130 && r.graph.wires.length === 1 && compile(r.graph).code.includes('s("bd")') && checkSync(r.graph, 'setcpm(130/4)\n\n$: s("bd")').state === 'ok');
  const again = applyCodeEdit(r.graph, 'setcpm(130/4)\n\n$: s("bd")');
  check('and typing the same code again changes nothing', !again.changes.added.length && !again.changes.removed.length && !again.changes.updated.length);
}

// 9. whole-line changes keep the person's indentation, and adding then removing a line gives back the exact text
{
  const oldC = 'setcpm(123/4)\n\n$: s("~@4 rim")\n  .gain(0.48)\n';
  const newC = 'setcpm(123/4)\n\n$: s("~@4 rim")\n  .bank("RolandTR909")\n  .gain(0.48)\n';
  const user = '// my comment\nsetcpm(123 / 4)\n\n// Rim\n$: s("~@4 rim")\n  .gain(0.48)\n';
  const added = patchText(user, oldC, newC);
  check('a line added on the board lands on its own line with the same indentation as its neighbours', added === '// my comment\nsetcpm(123 / 4)\n\n// Rim\n$: s("~@4 rim")\n  .bank("RolandTR909")\n  .gain(0.48)\n');
  check('removing that line again gives back the exact original text, with no blank or indented leftovers', patchText(added, newC, oldC) === user);
}
process.exit(failures ? 1 : 0);
