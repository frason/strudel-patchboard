// The rule that decides whether a playback run is acceptable, kept apart from the browser so it can be tested (scripts/verify.mjs does).
// A run is { playingStart, playingEnd, audioAdvanced, loadOk, skipped, underruns, stalls, longTasks, longTaskMs, longestMs, cpuMsPerSec, rafMsPerSec, heapGrowthMB }; a counter the browser cannot give is null, never 0.
// Judging fails closed: a missing scenario, a counter that was measured before and is not now, a run that was not playing, an audio clock that did not move, or a load that did not start is a failure.
export const worst = (runs, k) => Math.max(...runs.map((r) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? r[k] : 0)));   // (judging checks every value is valid first; a bad one never reaches here as a pass)
const COUNTERS = ['skipped', 'underruns', 'stalls'];
const MANDATORY = ['skipped', 'stalls'];   // the app's own counters: a run where they could not be read is no evidence (underruns come from the browser and may honestly be unavailable)
const COSTS = [['longTaskMs', 30], ['longestMs', 25], ['cpuMsPerSec', 20], ['rafMsPerSec', 5], ['heapGrowthMB', 5]];   // metric, allowance added to the 25% margin so tiny numbers do not trip it

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
// every metric must be a real number (counters may be null when the browser cannot give them; that is "not measured", never a pass by itself). Costs and counters cannot be negative; heap growth can.
const NONNEG = ['longTasks', 'longTaskMs', 'longestMs', 'cpuMsPerSec', 'rafMsPerSec'];

export function validateRuns(results, { load = '', who = '' } = {}) {
  const lines = [], pre = who ? who + ': ' : '';
  for (const [name, runs] of Object.entries(results || {})) {
    if (!Array.isArray(runs) || !runs.length) { lines.push(`${pre}${name}: no runs were recorded`); continue; }
    runs.forEach((r, i) => {
      const at = `${pre}${name} run ${i + 1}`;
      if (!r || typeof r !== 'object') { lines.push(`${at}: the run is not a record`); return; }
      if (r.playingStart !== true || r.playingEnd !== true) lines.push(`${at}: it was not playing ${r.playingStart !== true ? 'when the window began' : 'when the window ended'}: no measurement`);
      if (r.audioAdvanced !== true) lines.push(`${at}: the audio clock ${r.audioAdvanced === false ? 'did not advance through the window' : 'could not be read'}: no measurement`);
      if (load && r.loadOk !== true) lines.push(`${at}: the load "${load}" did not start${r.loadError ? ' (' + r.loadError + ')' : ''}`);
      for (const k of MANDATORY) if (r[k] == null) lines.push(`${at}: ${k} could not be read: no measurement`);
      for (const k of COUNTERS) if (r[k] != null && (!isNum(r[k]) || r[k] < 0)) lines.push(`${at}: ${k} is not a valid count (${JSON.stringify(r[k])})`);
      for (const k of NONNEG) if (!isNum(r[k]) || r[k] < 0) lines.push(`${at}: ${k} is missing or not a valid number (${JSON.stringify(r[k])})`);
      if (!isNum(r.heapGrowthMB)) lines.push(`${at}: heapGrowthMB is missing or not a number (${JSON.stringify(r.heapGrowthMB)})`);
    });
  }
  if (!Object.keys(results || {}).length) lines.push(`${pre}there are no results at all`);
  return lines;
}

// the options of one saved run set, checked before anything is compared: a window that is not positive, or a different length from the baseline's, is not evidence
export function validateMeta(meta, who) {
  const lines = [];
  if (!meta || !isNum(meta.window) || !(meta.window > 0)) lines.push(`${who}: the window length is missing or not positive (${JSON.stringify(meta && meta.window)})`);
  if (!meta || !Number.isInteger(meta.repeat) || meta.repeat < 1) lines.push(`${who}: the repeat count is missing or not a positive whole number (${JSON.stringify(meta && meta.repeat)})`);
  return lines;
}

// judge(results, base, label, { heapOk, load, meta: { now, base } }) -> { failed, lines, notes }. Both sides must be valid evidence, with the same window length, and every scenario now must have a baseline.
export function judge(results, base, label, { heapOk = true, load = '', baseLoad = '', meta = null, noMeta = false } = {}) {
  // both sides are checked as evidence first (each with its own load); only valid evidence is compared
  const lines = validateRuns(results, { load }), notes = [];
  if (!base || !Object.keys(base).length) lines.push(`there is no baseline ("${label}") to compare with`);
  else lines.push(...validateRuns(base, { who: `baseline "${label}"`, load: baseLoad }));
  if (!meta && !noMeta) lines.push('the options of the two runs (window length and repeat count) were not given, so they cannot be compared');
  if (meta) {
    lines.push(...validateMeta(meta.now, 'this run'), ...validateMeta(meta.base, `baseline "${label}"`));
    if (meta.now && meta.base && isNum(meta.now.window) && isNum(meta.base.window) && meta.now.window !== meta.base.window) lines.push(`this run measured ${meta.now.window} s and "${label}" measured ${meta.base.window} s: only equal windows can be compared`);
    const counts = (res, m, who) => { for (const [name, runs] of Object.entries(res || {})) if (Array.isArray(runs) && m && Number.isInteger(m.repeat) && runs.length !== m.repeat) lines.push(`${who}: ${name} has ${runs.length} run(s) but declares ${m.repeat}`); };
    counts(results, meta.now, 'this run'); counts(base, meta.base, `baseline "${label}"`);
    if (meta.now && meta.base && Number.isInteger(meta.now.repeat) && Number.isInteger(meta.base.repeat) && meta.now.repeat < meta.base.repeat) lines.push(`this run has ${meta.now.repeat} repeat(s) against ${meta.base.repeat} in "${label}": fewer repeats cannot stand against more`);
  }
  if (lines.length) return { failed: lines.length, lines, notes };   // invalid evidence: nothing is compared
  for (const name of Object.keys(base)) if (!Array.isArray(results[name]) || !results[name].length) lines.push(`${name}: this scenario is in "${label}" but was not measured now`);
  for (const [name, runs] of Object.entries(results)) {
    const b = base[name];
    if (!Array.isArray(b) || !b.length) { lines.push(`${name}: "${label}" has no run of this scenario to compare with`); continue; }
    for (const k of COUNTERS) {
      const nowNull = runs.some((r) => r[k] == null), baseHas = b.some((r) => r[k] != null), baseNull = b.some((r) => r[k] == null);
      if (nowNull && baseHas) { lines.push(`${name}: ${k} could not be read now but was measured in "${label}"`); continue; }
      if (nowNull) { notes.push(`${name}: ${k} is not available in this browser (not measured)`); continue; }
      if (baseNull) { lines.push(`${name}: ${k} was not measured in every run of "${label}", so there is nothing sure to compare with`); continue; }
      if (worst(runs, k) > worst(b, k)) lines.push(`${name}: ${k} rose from ${worst(b, k)} to ${worst(runs, k)}`);
    }
    for (const [k, slack] of COSTS) { if (k === 'heapGrowthMB' && !heapOk) continue; if (worst(runs, k) > worst(b, k) * 1.25 + slack) lines.push(`${name}: ${k} is ${worst(runs, k)} against ${worst(b, k)} in "${label}" (limit: 25% worse plus ${slack})`); }
  }
  return { failed: lines.length, lines, notes };
}
