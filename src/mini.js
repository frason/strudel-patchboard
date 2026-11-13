// A reader for the part of Strudel's mini-notation that the step grids can show:
//   words and rests (c3 ~ x), several steps in one ("[a b]"), chords ("[c3,e3,g3]"), "<a b c>" turns,
//   and the modifiers *n (repeat), @n (longer), !n (copies). Anything else is reported, never guessed.
export class Unsupported extends Error {}

export function parseMini(src, { euclid = false } = {}) {
  let i = 0;
  const ws = () => { while (' \n\t\r'.includes(src[i] || 'x') && i < src.length) i++; };
  const number = () => { let s = ''; while (/[0-9]/.test(src[i] || '')) s += src[i++]; if (!s) throw new Unsupported('a number was expected after a modifier'); return Number(s); };
  const mods = (item) => {
    for (;;) {
      const c = src[i];
      if (c === '*') { i++; item.rep = (item.rep || 1) * number(); }
      else if (c === '@') { i++; item.len = number(); }
      else if (c === '!') { i++; item.copies = /[0-9]/.test(src[i] || '') ? number() : 2; }
      else if (c && '?/%.|{}:'.includes(c)) throw new Unsupported(`"${c}" in the pattern string`);
      else break;
    }
    return item;
  };
  function atom() {
    const c = src[i];
    if (c === '[') {
      i++;
      const parts = [];
      let cur = [];
      for (;;) {
        ws();
        if (i >= src.length) throw new Unsupported('a "[" is never closed');
        if (src[i] === ']') { i++; parts.push(cur); break; }
        if (src[i] === ',') { i++; parts.push(cur); cur = []; continue; }
        cur.push(mods(atom()));
      }
      if (parts.length > 1) {
        const notes = parts.map((p) => (p.length === 1 && p[0].t === 'word' && !p[0].rep && !p[0].len && !p[0].copies ? p[0].v : null));
        if (notes.some((n) => n === null)) throw new Unsupported('layers with "," that are not simple chords');
        return { t: 'chord', notes };
      }
      return { t: 'sub', items: parts[0] };
    }
    if (c === '<') {
      i++;
      const items = [];
      for (;;) {
        ws();
        if (i >= src.length) throw new Unsupported('a "<" is never closed');
        if (src[i] === '>') { i++; break; }
        items.push(mods(atom()));
      }
      return { t: 'turns', items };
    }
    if (c === '~' || (c === '-' && !/[0-9.]/.test(src[i + 1] || ''))) { i++; return { t: 'rest' }; }
    const m = /^(?:-?\d+\.\d+|[A-Za-z0-9#_'\-]+)/.exec(src.slice(i));
    if (m) {
      i += m[0].length;
      const item = { t: 'word', v: m[0] };
      if (euclid && src[i] === '(') {
        const e = /^\(\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/.exec(src.slice(i));
        if (!e) throw new Unsupported('this euclid form');
        i += e[0].length;
        item.euclid = [Number(e[1]), Number(e[2]), e[3] ? Number(e[3]) : 0];
      }
      return item;
    }
    throw new Unsupported(`"${c}" in the pattern string`);
  }
  const items = [];
  for (;;) {
    ws();
    if (i >= src.length) break;
    if (src[i] === ',') throw new Unsupported('layers with "," at the top level');
    items.push(mods(atom()));
  }
  return items;
}
