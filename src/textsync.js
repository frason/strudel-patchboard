// Keeping the person's own text. The board writes "canonical" code; the person may have added comments, spacing or their own layout on top of it.
// Two pure helpers, no DOM:
//  - patchText: a change on the board (canonical code before -> after) is carried into the person's text as one small edit, found by the text around it.
//    If that text is no longer there, or is ambiguous, it returns null and the caller asks instead of guessing.
//  - checkSync: after the person's text has been applied to the board, read the board back and compare: does the text still say what the board says?
import { applyCodeEdit } from './reconcile.js';

// find a piece of text wherever it sits in the person's text, ignoring differences in spacing and line breaks
const loose = (t) => [...t].filter((c) => !/\s/.test(c)).map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
function findLoose(hay, pre, mid, post) {
  const re = new RegExp(loose(pre) + '\\s*(' + loose(mid) + ')\\s*' + loose(post), 'gd'), out = [];
  for (let m = re.exec(hay); m; m = re.exec(hay)) { const [from, to] = m.indices[1]; if (!out.some((o) => o.from === from)) out.push({ from, to }); re.lastIndex = m.index + 1; }   // leading spacing lets one match start at several places: count each position once
  return out;
}

// the one changed stretch between two texts: { at, del, ins } (positions in `a`)
export function oneHunk(a, b) {
  const max = Math.min(a.length, b.length);
  let p = 0; while (p < max && a[p] === b[p]) p++;
  let s = 0; while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  // a change that spans lines is a change of whole lines: a plain text diff would cut a statement in the middle ("s(...)\n\n$: ")
  if (/\n/.test(a.slice(p, a.length - s) + b.slice(p, b.length - s))) {
    while (p > 0 && a[p - 1] !== '\n') p--;
    s = 0; while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;   // with the start moved back, the same ending may now match further
    while (s > 0 && a[a.length - s - 1] !== '\n') s--;
  }
  return { at: p, del: a.slice(p, a.length - s), ins: b.slice(p, b.length - s), tail: s };
}

export function patchText(user, oldCanon, newCanon) {
  if (user === oldCanon) return newCanon;
  if (oldCanon === newCanon) return user;
  const { at, del, ins, tail } = oneHunk(oldCanon, newCanon);
  for (const ctx of [8, 20, 40, 80, 160]) {
    const pre = oldCanon.slice(Math.max(0, at - ctx), at), post = oldCanon.slice(oldCanon.length - tail, oldCanon.length - tail + ctx);
    const found = findLoose(user, pre, del, post);
    if (found.length === 1) return user.slice(0, found[0].from) + ins + user.slice(found[0].to);
    if (found.length === 0) break;   // more context can only match less
  }
  // the text around the change was edited or moved, but a stretch long enough to be distinctive that is removed or replaced can still be found on its own
  if (del.trim().length >= 10) { const only = findLoose(user, '', del, ''); if (only.length === 1) return user.slice(0, only[0].from) + ins + user.slice(only[0].to); }
  return null;
}

// What changes between two texts as a single edit, for the editor to apply without moving the caret elsewhere
export function minimalChange(from, to) { const h = oneHunk(from, to); return { from: h.at, to: h.at + h.del.length, insert: h.ins }; }

// state: 'ok' (the text and the board say the same), 'error' (not valid JavaScript), 'partial' (some of the text is kept but the board cannot show or play it)
export function checkSync(graph, text, { sounds = null } = {}) {
  const res = applyCodeEdit(graph, text, { sounds });
  if (res.error) return { state: 'error', message: res.error };
  const parts = [
    ...res.report.skipped.map((s) => ({ line: s.line, text: s.text, why: s.reason })),
    ...res.changes.unapplied.map((u) => ({ line: 0, text: u.what, why: u.why })),
  ];
  const differs = res.changes.updated.length || res.changes.added.length || res.changes.removed.length;
  if (parts.length) return { state: 'partial', parts, notes: res.report.notes, differs: !!differs };
  if (differs) return { state: 'differs', message: 'The board and the text disagree in a way that could not be settled.' };
  return { state: 'ok', notes: res.report.notes };
}
