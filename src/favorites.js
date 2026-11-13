// Starred sounds, kept per browser.
const KEY = 'pb.favs';
let favs = new Set();
try { favs = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { /* none yet */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...favs])); } catch { /* private mode */ } };
export const isFav = (id) => favs.has(id);
export function toggleFav(id) { if (favs.has(id)) favs.delete(id); else favs.add(id); save(); return favs.has(id); }
export const favCount = () => favs.size;
