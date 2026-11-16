// Tap tempo. Pure: give it the times of the taps (milliseconds, oldest first), get the tempo they imply.
// A pause longer than maxGap starts a new count; the last `keep` taps are used; an interval that is far from the typical one (a missed or doubled tap) is ignored.
export function tapBpm(times, { maxGap = 2500, keep = 8 } = {}) {
  if (!Array.isArray(times) || times.length < 2) return null;
  let start = 0;
  for (let i = times.length - 1; i > 0; i--) if (times[i] - times[i - 1] > maxGap) { start = i; break; }
  const t = times.slice(start).slice(-keep);
  if (t.length < 3) return null;   // two intervals at least, so one stray tap never sets the tempo
  const iv = []; for (let i = 1; i < t.length; i++) iv.push(t[i] - t[i - 1]);
  const sorted = [...iv].sort((a, b) => a - b), mid = sorted.length >> 1;
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (!(med > 0)) return null;
  const good = iv.filter((x) => Math.abs(x - med) <= 0.35 * med);
  const mean = good.reduce((a, b) => a + b, 0) / good.length;
  return { bpm: Math.round((60000 / mean) * 10) / 10, taps: t.length };
}
