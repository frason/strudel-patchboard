// Evidence labels for a board: facts that were checked, each saying exactly what was checked. None of them is a promise about how a board sounds.
//   guard    the code it makes passes the safety check (guard.js)
//   readback the code, read back into modules and written again, plays the same attacks (start, slot, every control) over N cycles on this engine (importer round trip; a finite replay, not a proof for every cycle)
// Samples that must exist and a listening check are NOT done here; the labels say so. Needs the offline query (snapshot.js), so it works in the browser and in the tests.
import { compile } from './compile.js';
import { guardCode } from './guard.js';
import { importStrudel } from './importer.js';
import { queryEvents, midiOf } from './snapshot.js';
import { onsets, ENGINE_ID } from './events.js';

// every attack, compared in full: when it starts and how long its slot is (exact fractions), and EVERY control it resolved (numbers to nine places, text and booleans as they are). A pitch is compared as written, never rounded to a semitone.
const spell = (k, v) => (k === 'note' && typeof v === 'string' && midiOf(v) !== null ? midiOf(v) : v);   // eb2 and d#2 are the same pitch; a pitch is otherwise compared exactly, never rounded
const val = (v) => (typeof v === 'number' ? String(Math.round(v * 1e9) / 1e9) : JSON.stringify(v));
const sig = (rec) => onsets(rec).map((e) => `${e.at[0]}/${e.at[1]}|${e.dur[0]}/${e.dur[1]}|${Object.keys(e.controls).sort().map((k) => k + '=' + val(spell(k, e.controls[k]))).join(',')}`).sort().join('\n');
const quiet = (rec) => rec.warnings.length === 0;   // a record that was cut, folded or left things out is not a full-fidelity comparison
export async function evidenceFor(graph, { cycles = 8, sounds = () => true } = {}) {
  const labels = [], code = compile(graph).code, bad = guardCode(code);
  labels.push(bad ? { id: 'guard', ok: false, text: 'The code is refused by the safety check: ' + bad } : { id: 'guard', ok: true, text: 'The code passes the safety check.' });
  if (bad) return { labels, ok: false };
  try {
    const imp = importStrudel(code, { sounds });
    if (imp.error || !imp.graph) { labels.push({ id: 'readback', ok: false, text: 'The code could not be read back into modules: ' + (imp.error || 'unknown') }); return { labels, ok: false }; }
    const again = compile(imp.graph).code;
    const a = await queryEvents(code, { from: 0, to: cycles }), b = await queryEvents(again, { from: 0, to: cycles }), n = onsets(a).length;
    const same = sig(a) === sig(b) && quiet(a) && quiet(b);
    labels.push({ id: 'readback', ok: same, text: same ? `Read back into modules and written again, it plays the same ${n} attacks over ${cycles} cycles (${ENGINE_ID}): same start, same slot and the same value for every control it sets. That is a replay of those cycles, not a proof for every cycle.` : `Read back into modules and written again, it does not play the same over ${cycles} cycles (${n} attacks before, ${onsets(b).length} after${quiet(a) && quiet(b) ? '' : '; the read was also cut or left things out, so it cannot show they are equal'}).` });
    if (imp.report && imp.report.skipped && imp.report.skipped.length) labels.push({ id: 'skipped', ok: false, text: `${imp.report.skipped.length} part${imp.report.skipped.length === 1 ? '' : 's'} of the code could not be turned into modules.` });
  } catch (e) { labels.push({ id: 'readback', ok: false, text: 'The read-back check failed: ' + String((e && e.message) || e).slice(0, 120) }); }
  labels.push({ id: 'not-checked', ok: null, text: 'Not checked: that the sample files exist and download, and how it sounds.' });
  return { labels, ok: labels.every((l) => l.ok !== false) };
}
