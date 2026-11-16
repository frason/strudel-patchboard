// Reads a General MIDI soundfont file without running it. The files are JavaScript object literals ("var _tone_... ={ zones:[ {...} ] };"), and the
// original code evaluated them with eval(), which would run anything the file server sent. This parses the text as an expression and only builds
// plain data from literals: numbers, strings, booleans, null, arrays and objects with plain keys. Anything else is an error and nothing runs.
import { parse } from 'acorn';

const MAX_DEPTH = 8, MAX_ITEMS = 20000;

function value(n, depth) {
  if (depth > MAX_DEPTH) throw new Error('the font file is nested too deeply');
  switch (n.type) {
    case 'Literal': if (n.regex || n.bigint) throw new Error('unexpected value in the font file'); return n.value;
    case 'UnaryExpression':
      if ((n.operator === '-' || n.operator === '+') && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return n.operator === '-' ? -n.argument.value : n.argument.value;
      throw new Error('unexpected expression in the font file');
    case 'ArrayExpression': {
      if (n.elements.length > MAX_ITEMS) throw new Error('the font file has too many items');
      return n.elements.map((e) => { if (!e) throw new Error('unexpected gap in the font file'); return value(e, depth + 1); });
    }
    case 'ObjectExpression': {
      const o = {};
      for (const p of n.properties) {
        if (p.type !== 'Property' || p.computed || p.kind !== 'init' || p.method || p.shorthand) throw new Error('unexpected property in the font file');
        const k = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'Literal' ? String(p.key.value) : null;
        if (k === null || k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error('unexpected property name in the font file');
        Object.defineProperty(o, k, { value: value(p.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
      return o;
    }
    default: throw new Error('unexpected expression in the font file');
  }
}

export function parseFontPreset(text) {
  if (typeof text !== 'string' || text.length > 12_000_000) throw new Error('the font file is the wrong size');
  const i = text.indexOf('={');
  if (i < 0) throw new Error('this is not a font file');
  const body = text.slice(i + 1).trim().replace(/;\s*$/, '');
  let ast;
  try { ast = parse('(' + body + '\n)', { ecmaVersion: 'latest' }); } catch (e) { throw new Error('the font file could not be read: ' + e.message); }
  const st = ast.body[0];
  if (ast.body.length !== 1 || st.type !== 'ExpressionStatement' || st.expression.type !== 'ObjectExpression') throw new Error('this is not a font file');
  const font = value(st.expression, 0);
  if (!Array.isArray(font.zones) || font.zones.length > 2000) throw new Error('this font has no usable zones');
  for (const z of font.zones) {
    if (!z || typeof z !== 'object') throw new Error('this font has a damaged zone');
    for (const k of ['midi', 'originalPitch', 'keyRangeLow', 'keyRangeHigh', 'coarseTune', 'fineTune', 'sampleRate']) if (k in z && typeof z[k] !== 'number') throw new Error('this font has a damaged zone');
    if ('file' in z && (typeof z.file !== 'string' || !/^[A-Za-z0-9+/=\s]*$/.test(z.file))) throw new Error('this font has a damaged sample');
  }
  return font.zones;   // the same thing the old eval() produced: the list of zones
}
