// Evidence labels for a board: facts that were checked, each saying exactly what was checked. None of them is a promise about how a board sounds.
//   guard    the code it makes passes the safety check (guard.js)
//   readback the code, read back into modules and written again, plays the same events over N cycles on this engine (importer round trip; a finite replay, not a proof for every cycle)
// Samples that must exist and a listening check are NOT done here; the labels say so. Needs the offline query (snapshot.js), so it works in the browser and in the tests.
import { compile } from './compile.js';
import { guardCode } from './guard.js';
import { importStrudel } from './importer.js';
import { queryEvents } from './snapshot.js';
import { onsets, num, midiOfControl, ENGINE_ID } from './events.js';

const sig = (rec) => onsets(rec).map((e) => `${num(e.at).toFixed(6)}|${e.controls.s ?? ''}|${midiOfControl(e.controls) ?? e.controls.n ?? ''}`).sort().join('\n');

export async function evidenceFor(graph, { cycles = 8, sounds = () => true } = {}) {
  const labels = [], code = compile(graph).code, bad = guardCode(code);
  labels.push(bad ? { id: 'guard', ok: false, text: 'The code is refused by the safety check: ' + bad } : { id: 'guard', ok: true, text: 'The code passes the safety check.' });
  if (bad) return { labels, ok: false };
  try {
    const imp = importStrudel(code, { sounds });
    if (imp.error || !imp.graph) { labels.push({ id: 'readback', ok: false, text: 'The code could not be read back into modules: ' + (imp.error || 'unknown') }); return { labels, ok: false }; }
    const again = compile(imp.graph).code;
    const a = await queryEvents(code, { from: 0, to: cycles }), b = await queryEvents(again, { from: 0, to: cycles }), n = onsets(a).length;
    const same = sig(a) === sig(b);
    labels.push({ id: 'readback', ok: same, text: same ? `Read back into modules and written again, it plays the same ${n} events over ${cycles} cycles (${ENGINE_ID}). That is a replay of those cycles, not a proof for every cycle.` : `Read back into modules and written again, it plays different events over ${cycles} cycles (${n} before, ${onsets(b).length} after).` });
    if (imp.report && imp.report.skipped && imp.report.skipped.length) labels.push({ id: 'skipped', ok: false, text: `${imp.report.skipped.length} part${imp.report.skipped.length === 1 ? '' : 's'} of the code could not be turned into modules.` });
  } catch (e) { labels.push({ id: 'readback', ok: false, text: 'The read-back check failed: ' + String((e && e.message) || e).slice(0, 120) }); }
  labels.push({ id: 'not-checked', ok: null, text: 'Not checked: that the sample files exist and download, and how it sounds.' });
  return { labels, ok: labels.every((l) => l.ok !== false) };
}
