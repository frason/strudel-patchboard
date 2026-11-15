// Turn a Sample's pattern text (like "[bd]*4, [cp east], 808lt 808lc") into the rows of a Drum Machine: one row per sound, one step per slot.
// Strudel itself reads the pattern (so every mini-notation feature works), and the steps are the smallest grid that holds every hit.
import { mini } from '@strudel/mini';
import { MAX_TRACKS } from './modules.js';

export function patternToDrums(text) {
  let haps;
  try { haps = mini(String(text || '')).queryArc(0, 1).filter((h) => h.hasOnset()); }
  catch (e) { return { error: 'Strudel could not read this pattern: ' + (e.message || e) }; }
  const hits = [];
  for (const h of haps) {
    const v = h.value, name = typeof v === 'string' ? v : v && typeof v === 'object' ? (v.s ?? v.value) : null;
    if (typeof name !== 'string' || !name) continue;
    hits.push({ at: h.whole.begin.valueOf(), name });
  }
  if (!hits.length) return { error: 'Nothing in this pattern plays, so there is nothing to put on a grid.' };
  let steps = 0;
  for (let n = 1; n <= 16 && !steps; n++) if (hits.every((x) => Math.abs(x.at * n - Math.round(x.at * n)) < 1e-6)) steps = n;
  if (!steps) return { error: 'These hits do not fit a grid of up to 16 steps (the timing is too fine).' };
  const rows = new Map();
  for (const x of hits) {
    if (!rows.has(x.name)) rows.set(x.name, Array.from({ length: steps }, () => ({ on: false })));
    rows.get(x.name)[Math.min(steps - 1, Math.round(x.at * steps))].on = true;
  }
  if (rows.size > MAX_TRACKS) return { error: `This pattern uses ${rows.size} different sounds, and a Drum Machine holds ${MAX_TRACKS} rows.` };
  return { steps, tracks: [...rows].map(([name, cells]) => ({ name, mute: false, cells })), alternates: /[<?|]/.test(String(text)) };
}
