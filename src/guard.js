// The last gate before code reaches Strudel's evaluator. The compiler is the only thing that should write the code that gets evaluated, so the code
// is parsed here and must be made of nothing but the shapes the compiler writes: calls to Strudel's pattern functions, method chains from a fixed list,
// literals, arrays and one-argument arrow functions that call methods on their argument. Anything else (an assignment, a call to some other
// function, a template string, a property lookup by computed name, ...) is refused and nothing is evaluated.
// This does not sandbox anything. It is an allow-list for text the app itself generates, so a bug or a bad value upstream can not become code.
import { parse } from 'acorn';

const FUNCS = new Set(['setcpm', 'n', 'note', 's', 'chord', 'stack', 'cat', 'arrange', 'slider', 'irand', 'all']);   // all(x => x.postgain(..)) is how the Output module writes its master volume and effects
const IDENTS = new Set(['rand', 'perlin', 'sine', 'saw', 'tri', 'square', 'isaw', 'cosine', 'silence', 'rev']);
const METHODS = new Set(`acidenv analyze arp attack bank bpf bpq chord chorus coarse compressor crush decay degrade degradeBy delay delayfeedback delaytime detune distort djf duck duckattack duckdepth
clip euclid every fast fit late legato swingBy fm fm11 fm12 fm13 fm14 fm2 fm20 fm22 fm23 fm24 fm3 fm30 fm31 fm33 fm34 fm4 fm40 fm41 fm42 fm44 fmattack fmattack2 fmattack3 fmattack4 fmdecay fmdecay2 fmdecay3 fmdecay4
fmh fmh2 fmh3 fmh4 fmsustain fmsustain2 fmsustain3 fmsustain4 fmwave fmwave2 fmwave3 fmwave4 ftype gain hpf hpq leslie lpa lpd lpenv lpf lpq lps lrate lsize mode mul orbit pan phaser phasercenter
phaserdepth phasersweep ply postgain pow pattack pdecay penv range release repeat rev ribbon ring ringf room roomsize round s scale scramble segment shape shuffle slow sometimesBy speed squiz
struct sustain pw pwrate pwsweep tremolo tremolosync tremolodepth tremoloshape transpose velocity vib vibmod voicing vowel _scope _pianoroll _punchcard _spiral _pitchwheel
add sub div mask seg palindrome adsr someCycles someCyclesBy sometimes often rarely almostNever almostAlways always never superimpose off jux juxBy chunk chunkBack linger iter iterBack hurry inside outside
early press pressBy rolled rolledBy slice splice chop striate begin end loopAt cut unit accelerate nudge cutoff resonance hcutoff hresonance bandf bandq sz rsize roomfade roomlp roomdim lpattack lprelease hpattack hprelease
delayfb delayt dt dfb att dec sus rel amp vel sound freq stut echo euclidRot euclidLegato euclidInv euclidLegatoRot fastGap compress zoom focus rangex inv bite squeeze toggle pick scaleTranspose trans rootNotes
degradeBy undegradeBy brak ply plyWith fastchunk slowchunk run gap legato note n s ftype color colour anchor echoWith rib offset partials phases`.split(/\s+/).filter(Boolean));
// helper definitions the compiler writes word for word (nothing in them depends on the patch): allowed only when they match exactly
const FIXED = new Set(["register('acidenv', (x, pat) => pat.lpf(100).lpenv(x * 9).lps(.2).lpd(.12))"]);
const MAX_CHARS = 600_000, MAX_NODES = 60_000;

class Refuse extends Error {}
const at = (node, code) => { const line = code.slice(0, node.start).split('\n').length; return `line ${line}`; };

function expr(node, code, ctx) {
  if (++ctx.nodes > MAX_NODES) throw new Refuse('the code is too large');
  switch (node.type) {
    case 'TemplateLiteral':   // `...` with nothing computed inside is just text
      if (node.expressions.length === 0) return;
      throw new Refuse(`${at(node, code)}: a template string with values inside is not allowed`);
    case 'Literal':
      if (typeof node.value === 'string' || typeof node.value === 'number' || typeof node.value === 'boolean') return;
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
    case 'ArrayExpression': node.elements.forEach((e) => { if (!e || e.type === 'SpreadElement') throw new Refuse(`${at(node, code)}: this list is not allowed`); expr(e, code, ctx); }); return;
    case 'CallExpression': {
      const c = node.callee;
      if (c.type === 'Identifier') { if (!FUNCS.has(c.name)) throw new Refuse(`${at(node, code)}: "${c.name}" is not a function patches may call`); }
      else if (c.type === 'MemberExpression') member(c, code, ctx);
      else throw new Refuse(`${at(node, code)}: this kind of call is not allowed`);
      node.arguments.forEach((a) => {
        if (a.type === 'SpreadElement') throw new Refuse(`${at(node, code)}: spread is not allowed`);
        if (a.type === 'ArrowFunctionExpression') arrow(a, code, ctx); else expr(a, code, ctx);
      });
      return;
    }
    case 'MemberExpression': member(node, code, ctx); return;
    default: throw new Refuse(`${at(node, code)}: "${node.type}" is not allowed in a patch`);
  }
}
// x => x.method(...): the only kind of function a pattern may be given, and only as an argument
function arrow(node, code, ctx) {
  if (ctx.arrow || node.async || node.generator || node.params.length !== 1 || node.params[0].type !== 'Identifier' || node.params[0].name !== 'x' || node.body.type !== 'CallExpression') throw new Refuse(`${at(node, code)}: only x=>x.method(...) functions are allowed`);
  expr(node.body, code, { ...ctx, arrow: 'x' });
}
function numeric(node, code, ctx) {
  if (node.type === 'Literal' && typeof node.value === 'number') return;
  if (node.type === 'BinaryExpression' || node.type === 'UnaryExpression') { expr(node, code, ctx); return; }
  throw new Refuse(`${at(node, code)}: only numbers can be calculated with`);
}
function member(node, code, ctx) {
  if (node.computed || node.optional || node.property.type !== 'Identifier') throw new Refuse(`${at(node, code)}: this way of reaching a function is not allowed`);
  if (!METHODS.has(node.property.name)) throw new Refuse(`${at(node, code)}: ".${node.property.name}()" is not something patches may call`);
  expr(node.object, code, ctx);
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
  } catch (e) { if (e instanceof Refuse) return e.message; throw e; }
  return null;
}
