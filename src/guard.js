// The last gate before code reaches Strudel's evaluator. The compiler is the only thing that should write the code that gets evaluated, so the code
// is parsed here and must be made of nothing but the shapes the compiler writes: calls to Strudel's pattern functions, method chains from a fixed list,
// literals, arrays and one-argument arrow functions that call methods on their argument. Anything else (an assignment, a call to some other
// function, a template string, a property lookup by computed name, ...) is refused and nothing is evaluated.
// This does not sandbox anything. It is an allow-list for text the app itself generates, so a bug or a bad value upstream can not become code.
import { parse } from 'acorn';

const FUNCS = new Set(['setcpm', 'n', 'note', 's', 'chord', 'stack', 'cat', 'arrange', 'slider', 'irand', 'all', 'postgain']);   // all(x => x.postgain(..)) is how the Output module writes its master volume and effects
const IDENTS = new Set(['rand', 'perlin', 'sine', 'saw', 'tri', 'square', 'isaw', 'cosine', 'silence', 'rev']);
const METHODS = new Set(`acidenv analyze arp attack bank bpf bpq chord chorus coarse compressor crush decay degrade degradeBy delay delayfeedback delaytime detune distort djf duck duckattack duckdepth
clip euclid every fast fit late legato swingBy fm fm11 fm12 fm13 fm14 fm2 fm20 fm22 fm23 fm24 fm3 fm30 fm31 fm33 fm34 fm4 fm40 fm41 fm42 fm44 fmattack fmattack2 fmattack3 fmattack4 fmdecay fmdecay2 fmdecay3 fmdecay4
fmh fmh2 fmh3 fmh4 fmsustain fmsustain2 fmsustain3 fmsustain4 fmwave fmwave2 fmwave3 fmwave4 ftype gain hpf hpq leslie lpa lpd lpe lpenv lpf lpq lps lrate lsize mode mul orbit pan phaser phasercenter
phaserdepth phasersweep ply postgain pow pattack pdecay penv range release repeat rev ribbon ring ringf room roomsize round s scale scramble segment shape shuffle slow sometimesBy speed squiz
struct sustain pw pwrate pwsweep tremolo tremolosync tremolodepth tremoloshape transpose velocity vib vibmod voicing vowel _scope _pianoroll _punchcard _spiral _pitchwheel
add sub div mask seg palindrome adsr someCycles someCyclesBy sometimes often rarely almostNever almostAlways always never superimpose off jux juxBy chunk chunkBack linger iter iterBack hurry inside outside
early dict set when cpm press pressBy rolled rolledBy slice splice chop striate begin end loopAt cut unit accelerate nudge cutoff resonance hcutoff hresonance bandf bandq sz rsize roomfade roomlp roomdim lpattack lprelease hpattack hprelease
delayfb delayt dt dfb att dec sus rel amp vel sound freq stut echo euclidRot euclidLegato euclidInv euclidLegatoRot fastGap compress zoom focus rangex inv bite squeeze toggle pick scaleTranspose trans rootNotes
degradeBy undegradeBy brak ply plyWith fastchunk slowchunk run gap legato note n s ftype color colour anchor echoWith rib offset partials phases`.split(/\s+/).filter(Boolean));
// helper definitions the compiler writes word for word (nothing in them depends on the patch): allowed only when they match exactly
const FIXED = new Set(["register('acidenv', (x, pat) => pat.lpf(100).lpenv(x * 9).lps(.2).lpd(.12))"]);
const MAX_CHARS = 600_000, MAX_NODES = 60_000;
// Admission limits (not proofs of cheap work): a pattern string that expands to an absurd number of events, or a count that is absurd, is refused before anything is evaluated.
const MAX_EXPANDED = 50_000;
const NUM_LIMITS = { fast: 4096, fastGap: 4096, ply: 1024, chop: 1024, striate: 1024, segment: 1024, seg: 1024, echo: 64, stut: 64, euclid: 1024, euclidRot: 1024, euclidLegato: 1024, euclidLegatoRot: 1024, euclidInv: 1024, linger: 1024, hurry: 1024, iter: 1024, iterBack: 1024, repeat: 1024 };
// which arguments are counts (echo(times, time, feedback): only the first; euclid(pulses, steps): both)
const COUNT_ARGS = { echo: [0], stut: [0], euclid: [0, 1], euclidRot: [0, 1], euclidLegato: [0, 1], euclidLegatoRot: [0, 1], euclidInv: [0, 1] };
// these multiply how many events a pattern makes (a chain of them multiplies: .fast(4096).fast(4096) is 16 million)
const MULTIPLIES = new Set(['fast', 'fastGap', 'ply', 'chop', 'striate', 'segment', 'seg', 'echo', 'stut', 'hurry']);
const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi;
// the exact value of a calculation on plain numbers (1000*1000, 1/(1-.999999)), or null when it depends on anything else
function constVal(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'number') return node.value;
  if (node.type === 'UnaryExpression' && node.operator === '-') { const v = constVal(node.argument); return v === null ? null : -v; }
  if (node.type === 'BinaryExpression') {
    const l = constVal(node.left), r = constVal(node.right); if (l === null || r === null) return null;
    return node.operator === '+' ? l + r : node.operator === '-' ? l - r : node.operator === '*' ? l * r : node.operator === '/' ? (r === 0 ? Infinity : l / r) : null;
  }
  return null;
}
// The biggest number a call argument can be, when it can be known without running anything: a number, a calculation on numbers, or a string/list of them. null when it cannot be known.
function biggest(node) {
  if (!node) return null;
  const c = constVal(node); if (c !== null) return Math.abs(c);
  if (node.type === 'Literal' && typeof node.value === 'string') return strMax(node.value);
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return strMax(node.quasis[0].value.cooked || '');
  if (node.type === 'ArrayExpression') { let m = 0; for (const e of node.elements) { const v = biggest(e); if (v === null) return null; if (v > m) m = v; } return m; }
  return null;
}
const strMax = (t) => { let m = 0; for (const x of String(t).match(NUM_RE) || []) m = Math.max(m, Math.abs(Number(x))); return m; };
// A rough upper bound on how many events a mini-notation string makes in a cycle: words and brackets count one, *n multiplies, !n copies, (k,n) places k hits. Nested brackets multiply.
export function expandedSize(str) {
  let i = 0; const n = str.length;
  const seq = (close, depth) => {
    if (depth > 100) return Infinity;   // nested this deep is refused, not walked (a deep walk would overflow the stack)
    let total = 0;
    while (i < n && str[i] !== close) {
      const c = str[i];
      if (/[\s,.|~-]/.test(c) && !(c === '-' && /\d/.test(str[i + 1] || ''))) { if (c === '~') total += 1; i++; continue; }
      let base;
      if (c === '[' || c === '<' || c === '{') { const cl = c === '[' ? ']' : c === '<' ? '>' : '}'; i++; base = seq(cl, depth + 1); if (str[i] === cl) i++; }
      else { let j = i; while (j < n && !/[\s,|\[\]<>{}*!@(/]/.test(str[j])) j++; if (j === i) { i++; continue; } i = j; base = 1; }
      let mult = 1, copies = 1;
      for (;;) {
        const m = /^([*!@/:?%])((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)?/i.exec(str.slice(i));
        if (m && m[1] === '*' && !m[2] && (str[i + 1] === '[' || str[i + 1] === '<' || str[i + 1] === '{')) {   // "bd*[30 30]": the biggest number inside the group is the rate
          const open = str[i + 1], cl = open === '[' ? ']' : open === '<' ? '>' : '}'; let d = 0, j = i + 1; for (; j < n; j++) { if (str[j] === open) d++; else if (str[j] === cl && --d === 0) break; }
          mult *= Math.max(1, strMax(str.slice(i + 1, j + 1))); i = j + 1; continue;
        }
        if (m) { i += m[0].length; if (m[1] === '*' && m[2]) mult *= Math.max(1, Number(m[2])); else if (m[1] === '!') copies += m[2] ? Number(m[2]) - 1 : 1; continue; }
        if (str[i] === '(') { const e = /^\(\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*-?\d+)?\s*\)/.exec(str.slice(i)); if (!e) break; i += e[0].length; mult *= Math.max(1, Number(e[1]), Number(e[2])); continue; }   // the work is in the steps, not only the hits
        break;
      }
      total += base * mult * copies;
      if (total > 1e12) return Infinity;
    }
    return total;
  };
  let all = 0; while (i < n) { all += seq(null, 0); if (i < n) i++; }   // a stray closing bracket does not stop the count
  return all;
}

class Refuse extends Error {}
const at = (node, code) => { const line = code.slice(0, node.start).split('\n').length; return `line ${line}`; };

const tooBig = (text, node, code) => { if (typeof text === 'string' && text.length > 3 && /[*!(]/.test(text)) { const n = expandedSize(text); if (n > MAX_EXPANDED) throw new Refuse(`${at(node, code)}: this pattern expands to about ${n > 1e9 ? 'billions of' : n} events (the limit is ${MAX_EXPANDED})`); return Math.max(1, n); } return 1; };
function expr(node, code, ctx) {
  if (++ctx.nodes > MAX_NODES) throw new Refuse('the code is too large');
  switch (node.type) {
    case 'TemplateLiteral':   // `...` with nothing computed inside is just text
      if (node.expressions.length === 0) return tooBig(node.quasis[0].value.cooked, node, code);
      throw new Refuse(`${at(node, code)}: a template string with values inside is not allowed`);
    case 'Literal':
      if (typeof node.value === 'string') return tooBig(node.value, node, code);
      if (typeof node.value === 'number' || typeof node.value === 'boolean') return;
      throw new Refuse(`${at(node, code)}: this kind of value is not allowed`);
    case 'Identifier':
      if (IDENTS.has(node.name) || (ctx.arrow && node.name === ctx.arrow)) return;
      throw new Refuse(`${at(node, code)}: "${node.name}" is not something patches may use`);
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') return;
      throw new Refuse(`${at(node, code)}: only a minus sign in front of a number is allowed`);
    case 'BinaryExpression':
      if ('+-*/'.includes(node.operator)) { numeric(node.left, code, ctx); numeric(node.right, code, ctx); return; }
      throw new Refuse(`${at(node, code)}: this operator is not allowed`);
    case 'ArrayExpression': { let sum = 0; node.elements.forEach((e) => { if (!e || e.type === 'SpreadElement') throw new Refuse(`${at(node, code)}: this list is not allowed`); sum += expr(e, code, ctx) || 1; }); return sum; }
    case 'CallExpression': {
      const c = node.callee;
      let base = 1;   // how many events this call's pattern makes per cycle, roughly (admission estimate)
      if (c.type === 'Identifier') { if (!FUNCS.has(c.name)) throw new Refuse(`${at(node, code)}: "${c.name}" is not a function patches may call`); base = 0; }
      else if (c.type === 'MemberExpression') base = member(c, code, ctx) || 1;
      else throw new Refuse(`${at(node, code)}: this kind of call is not allowed`);
      const name = c.type === 'MemberExpression' ? c.property.name : null, lim = name ? NUM_LIMITS[name] : null;
      if (lim) for (const i of COUNT_ARGS[name] || [0]) { const v = biggest(node.arguments[i]); if (v !== null && v > lim) throw new Refuse(`${at(node, code)}: ".${name}(${code.slice(node.arguments[i].start, node.arguments[i].end).slice(0, 24)})" is larger than the limit of ${lim}`); }
      let factor = 1;
      if (name && MULTIPLIES.has(name)) { const v = biggest(node.arguments[0]); factor = v === null ? 1 : Math.max(1, v); }   // an argument that is not known in advance counts as 1: the limits above and the cost of what is known are what is checked
      let extra = 0;
      node.arguments.forEach((a) => {
        if (a.type === 'SpreadElement') throw new Refuse(`${at(node, code)}: spread is not allowed`);
        if (a.type === 'ArrowFunctionExpression') arrow(a, code, ctx); else { const v = expr(a, code, ctx) || 1; if (base === 0) extra += v; }
      });
      const total = c.type === 'Identifier' ? extra : base * factor;
      if (total > MAX_EXPANDED) throw new Refuse(`${at(node, code)}: this chain makes about ${total > 1e9 ? 'billions of' : Math.round(total)} events per cycle (the limit is ${MAX_EXPANDED})`);
      return total || 1;
    }
    case 'MemberExpression': return member(node, code, ctx);
    default: throw new Refuse(`${at(node, code)}: "${node.type}" is not allowed in a patch`);
  }
}
// x => x.method(...): the only kind of function a pattern may be given, and only as an argument (one inside another is fine, up to three deep: x => x.superimpose(x => x.late(.01)))
function arrow(node, code, ctx) {
  if ((ctx.depth || 0) >= 3 || node.async || node.generator || node.params.length !== 1 || node.params[0].type !== 'Identifier' || node.params[0].name !== 'x' || node.body.type !== 'CallExpression') throw new Refuse(`${at(node, code)}: only x=>x.method(...) functions are allowed`);
  expr(node.body, code, { ...ctx, arrow: 'x', depth: (ctx.depth || 0) + 1 });
}
function numeric(node, code, ctx) {
  if (node.type === 'Literal' && typeof node.value === 'number') return;
  if (node.type === 'BinaryExpression' || node.type === 'UnaryExpression') { expr(node, code, ctx); return; }
  throw new Refuse(`${at(node, code)}: only numbers can be calculated with`);
}
function member(node, code, ctx) {
  if (node.computed || node.optional || node.property.type !== 'Identifier') throw new Refuse(`${at(node, code)}: this way of reaching a function is not allowed`);
  if (!METHODS.has(node.property.name)) throw new Refuse(`${at(node, code)}: ".${node.property.name}()" is not something patches may call`);
  return expr(node.object, code, ctx);
}

// A list of method calls to put after a pattern (".mask(\"1 0\").seg(8)"): the same check, on the calls alone. Returns null when allowed, otherwise a short reason.
export const guardCalls = (text) => (/^\s*\./.test(text) ? guardCode('s("x")' + String(text).trim()) : 'the calls must start with a dot, like .mask("1 0")');

// Returns null when the code is made only of allowed shapes, otherwise a short reason.
export function guardCode(code) {
  if (typeof code !== 'string') return 'the code is not text';
  if (code.length > MAX_CHARS) return 'the code is too large';
  let ast;
  try { ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: false }); }
  catch (e) { return 'the code does not parse: ' + e.message; }
  const ctx = { nodes: 0, arrow: null };
  try {
    for (const st of ast.body) {
      let s = st;
      if (s.type === 'LabeledStatement') s = s.body;
      if (s.type === 'EmptyStatement') continue;
      if (s.type === 'ExpressionStatement' && FIXED.has(code.slice(s.start, s.end))) continue;
      if (s.type !== 'ExpressionStatement') throw new Refuse(`${at(st, code)}: only pattern lines are allowed, not "${st.type}"`);
      expr(s.expression, code, ctx);
    }
  } catch (e) { if (e instanceof Refuse) return e.message; return 'the code could not be checked safely (' + String((e && e.message) || e).slice(0, 80) + ')'; }   // anything unexpected (a stack overflow on absurd nesting) is a refusal, not a crash
  return null;
}
