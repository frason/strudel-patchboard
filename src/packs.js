// Sample packs that a piece of code asks for with samples('github:user/repo'). Nothing downloads until the person says yes in the import window; a yes is remembered
// for that pack in this browser (localStorage), so the same piece plays again later without asking. Only GitHub packs of the form github:user/repo[/branch] are accepted:
// the code can name what to fetch, so the names are checked here and nothing else is ever passed to the loader.
const KEY = 'pb.packs', MAX = 8;
export const PACK_RE = /^github:[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}(?:\/[A-Za-z0-9_.-]{1,60})?$/;
export const validPack = (s) => typeof s === 'string' && PACK_RE.test(s.trim()) && !s.trim().slice(7).split('/').some((x) => /^\.+$/.test(x));   // no ".." or "." parts
export const cleanPack = (s) => String(s).trim();

export function approvedPacks() {
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a.filter(validPack).slice(0, MAX) : []; } catch { return []; }
}
export function approvePacks(specs) {
  const all = [...new Set([...approvedPacks(), ...specs.filter(validPack).map(cleanPack)])].slice(-MAX);
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: it loads for this visit only */ }
  return all;
}
export function forgetPack(spec) {
  try { localStorage.setItem(KEY, JSON.stringify(approvedPacks().filter((x) => x !== spec))); } catch { /* ignore */ }
}
