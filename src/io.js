// Export / import. The .strudel file is the exact code the panel shows, with the patch embedded in a trailing comment.
import { compile } from './compile.js';
import { validateShape } from './graph.js';

export const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
export const unb64 = (s) => decodeURIComponent(escape(atob(s)));
const HEADER = '// Strudel Patchboard export. Paste into strudel.cc, or import this file back into Patchboard.\n';

export function strudelFile(graph) {
  const res = compile(graph);
  return `${HEADER}${res.code}\n\n/* patchboard-patch v1\n${b64(JSON.stringify(graph))}\n*/\n`;
}

export function parseImport(text) {
  const t = text.trim();
  if (t.startsWith('{')) return { graph: validateShape(JSON.parse(t)) };
  const m = t.match(/\/\*\s*patchboard-patch v1\s+([A-Za-z0-9+/=]+)\s*\*\//);
  if (!m) return { error: 'This file has no Patchboard patch inside. Patchboard can only import .strudel files it exported itself, because it cannot turn arbitrary Strudel code back into modules.' };
  let graph;
  try { graph = validateShape(JSON.parse(unb64(m[1]))); } catch (e) { return { error: 'The embedded patch is damaged: ' + e.message }; }
  const codePart = t.slice(0, m.index).replace(/^\/\/ Strudel Patchboard export.*\n/, '').trim();
  const expected = compile(graph).code.trim();
  if (codePart !== expected) {
    const a = codePart.split('\n'), b = expected.split('\n');
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
    return { graph, edited: true, error: `The code in this file was edited after export (first difference on line ${i + 1}: “${(a[i] ?? '').trim()}”). Patchboard cannot turn edited code back into modules, so it will not guess.` };
  }
  return { graph };
}
