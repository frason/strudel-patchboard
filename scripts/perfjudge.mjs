// The rule that decides whether a playback run is acceptable, kept apart from the browser so it can be tested (scripts/verify.mjs does).
// A run is { playingStart, playingEnd, audioAdvanced, loadOk, skipped, underruns, stalls, longTasks, longTaskMs, longestMs, cpuMsPerSec, rafMsPerSec, heapGrowthMB }; a counter the browser cannot give is null, never 0.
// Judging fails closed: a missing scenario, a counter that was measured before and is not now, a run that was not playing, an audio clock that did not move, or a load that did not start is a failure.
export const worst = (runs, k) => Math.max(...runs.map((r) => r[k] ?? 0));
const COUNTERS = ['skipped', 'underruns', 'stalls'];
const COSTS = [['longTaskMs', 30], ['longestMs', 25], ['cpuMsPerSec', 20], ['rafMsPerSec', 5], ['heapGrowthMB', 5]];   // metric, allowance added to the 25% margin so tiny numbers do not trip it

export function validateRuns(results, { load = '' } = {}) {
  const lines = [];
  for (const [name, runs] of Object.entries(results || {})) {
    if (!Array.isArray(runs) || !runs.length) { lines.push(`${name}: no runs were recorded`); continue; }
    runs.forEach((r, i) => {
      if (!r.playingStart || !r.playingEnd) lines.push(`${name} run ${i + 1}: it was not playing ${!r.playingStart ? 'when the window began' : 'when the window ended'}: no measurement`);
      if (r.audioAdvanced === false) lines.push(`${name} run ${i + 1}: the audio clock did not advance through the window: no measurement`);
      if (load && r.loadOk !== true) lines.push(`${name} run ${i + 1}: the load "${load}" did not start${r.loadError ? ' (' + r.loadError + ')' : ''}`);
    });
  }
  if (!Object.keys(results || {}).length) lines.push('there are no results at all');
  return lines;
}

// judge(results, base, label, { heapOk, load }) -> { failed, lines }
export function judge(results, base, label, { heapOk = true, load = '' } = {}) {
  const lines = validateRuns(results, { load }), notes = [];
  for (const name of Object.keys(base || {})) if (!results || !Array.isArray(results[name]) || !results[name].length) lines.push(`${name}: this scenario is in "${label}" but was not measured now`);
  for (const [name, runs] of Object.entries(results || {})) {
    const b = base && base[name]; if (!b || !b.length || !Array.isArray(runs) || !runs.length) continue;
    for (const k of COUNTERS) {
      const nowNull = runs.some((r) => r[k] == null), baseNull = b.some((r) => r[k] == null);
      if (nowNull && !baseNull) { lines.push(`${name}: ${k} could not be read now but was measured in "${label}"`); continue; }
      if (nowNull) { notes.push(`${name}: ${k} is not available in this browser (not measured)`); continue; }
      if (worst(runs, k) > worst(b, k)) lines.push(`${name}: ${k} rose from ${worst(b, k)} to ${worst(runs, k)}`);
    }
    for (const [k, slack] of COSTS) { if (k === 'heapGrowthMB' && !heapOk) continue; if (runs.some((r) => r[k] == null) || b.some((r) => r[k] == null)) { lines.push(`${name}: ${k} is missing from one of the runs`); continue; } if (worst(runs, k) > worst(b, k) * 1.25 + slack) lines.push(`${name}: ${k} is ${worst(runs, k)} against ${worst(b, k)} in "${label}" (limit: 25% worse plus ${slack})`); }
  }
  return { failed: lines.length, lines, notes };
}
