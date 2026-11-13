// Which sounds exist, per drum-machine bank. Read from the same sample maps Strudel loads, so the suggestions are
// exactly what will play. Falls back to a short list until (or unless) the maps can be fetched.
const DS = 'https://raw.githubusercontent.com/felixroos/dough-samples/main';
const FALLBACK = ['bd', 'sd', 'hh', 'oh', 'cp', 'rim', 'lt', 'mt', 'ht', 'cb', 'cr', 'rd', 'sh', 'ma', 'cl'];
let data = { banks: {}, plain: {} };
let ready = false;
const subs = new Set();
const count = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 1);

export function ingestCatalog(drumMachines = {}, dirt = {}, extra = {}) {
  const banks = {}, plain = {};
  for (const [k, v] of Object.entries(drumMachines)) {
    if (k === '_base') continue;
    const i = k.indexOf('_');
    if (i < 1) continue;
    (banks[k.slice(0, i)] ||= {})[k.slice(i + 1)] = count(v);
  }
  for (const [k, v] of Object.entries(dirt)) if (k !== '_base') plain[k] = count(v);
  for (const [k, v] of Object.entries(extra)) if (k !== '_base') plain[k] = count(v);
  data = { banks, plain };
  ready = true;
  subs.forEach((f) => f());
}

export const catalogReady = () => ready;
export const onCatalog = (f) => subs.add(f);
export const bankNames = () => Object.keys(data.banks).sort();
export const soundsFor = (bank) => (bank && data.banks[bank] ? Object.keys(data.banks[bank]).sort() : ready ? Object.keys(data.plain).sort() : FALLBACK);
export const countFor = (bank, name) => (bank && data.banks[bank] ? data.banks[bank][name] : data.plain[name]) ?? (ready ? 0 : 1);
// "bd" or "bd:3" (the 4th variant); only sounds that exist in this bank
export function isValidSound(bank, text) {
  const [name, idx, ...rest] = String(text).trim().split(':');
  if (rest.length || !name || !soundsFor(bank).includes(name)) return false;
  if (idx === undefined) return true;
  return /^\d+$/.test(idx) && Number(idx) < countFor(bank, name);
}

export async function loadCatalog() {
  try {
    const cached = JSON.parse(localStorage.getItem('pb.catalog2') || 'null');
    if (cached && Date.now() - cached.t < 7 * 864e5) return ingestCatalog(cached.dm, cached.dirt, cached.extra);
  } catch { /* ignore */ }
  try {
    const [dm, dirt, extra] = await Promise.all([
      fetch(`${DS}/tidal-drum-machines.json`).then((r) => r.json()),
      fetch('https://raw.githubusercontent.com/tidalcycles/dirt-samples/master/strudel.json').then((r) => r.json()),
      Promise.all(['breaks', 'pad'].map((n) => fetch(`https://raw.githubusercontent.com/switchangel/${n}/main/strudel.json`).then((r) => r.json()).catch(() => ({})))).then((l) => Object.assign({}, ...l)),
    ]);
    // keep only names and counts: small enough for localStorage
    const slim = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === '_base' ? v : count(v)]));
    try { localStorage.setItem('pb.catalog2', JSON.stringify({ t: Date.now(), dm: slim(dm), dirt: slim(dirt), extra: slim(extra) })); } catch { /* quota */ }
    ingestCatalog(dm, dirt, extra);
  } catch { /* offline: the fallback list stays */ }
}

// plain-English names for the common abbreviations
const WORDS = {
  bd: 'Bass drum (kick)', sd: 'Snare drum', sn: 'Snare drum', hh: 'Closed hi-hat', oh: 'Open hi-hat', cp: 'Clap', rim: 'Rimshot',
  lt: 'Low tom', mt: 'Mid tom', ht: 'High tom', tom: 'Tom', cb: 'Cowbell', cr: 'Crash cymbal', rd: 'Ride cymbal', cy: 'Cymbal',
  sh: 'Shaker', ma: 'Maracas', cl: 'Claves', lc: 'Low conga', mc: 'Mid conga', hc: 'High conga', perc: 'Percussion', tb: 'Tambourine',
  ag: 'Agogo', cabasa: 'Cabasa', ride: 'Ride cymbal', crash: 'Crash cymbal', clap: 'Clap', kick: 'Bass drum (kick)', snare: 'Snare drum',
  hat: 'Hi-hat', bass: 'Bass sound', jvbass: 'Juno-style synth bass', arpy: 'Arpeggiated synth', drum: 'Drum hit', casio: 'Casio keyboard',
  jazz: 'Jazz drum kit', metal: 'Metallic hits', techno: 'Techno drum hits', tech: 'Tech drum hits', jungle: 'Jungle drum hits',
  breaks: 'Break loop (turn fit on to stretch it over its step)', wind: 'Wind', space: 'Space sounds', crow: 'Crow calls', insect: 'Insect sounds', numbers: 'Spoken numbers',
  east: 'Eastern percussion', amencutup: 'Amen break slices', loop: 'Loop', pad: 'Pad', perc2: 'Percussion', stab: 'Chord stab', sax: 'Saxophone',
  gtr: 'Guitar', piano: 'Piano', voice: 'Voice', noise: 'Noise', click: 'Click', tabla: 'Tabla', bongo: 'Bongo', conga: 'Conga',
};
// libraries by Switch Angel that the app loads (public domain): exact names only, so older sounds are not credited to them
const EXACT = { breaks: 'Break loops, public domain by Switch Angel (turn fit on to stretch one over its step)', swpad: 'Pad, public domain by Switch Angel' };
export function describe(text) {
  const name = String(text).split(':')[0];
  return EXACT[name] || WORDS[name] || WORDS[name.replace(/\d+$/, '')] || '';
}

export const SAMPLE_CATS = ['Drums', 'Cymbals', 'Percussion', 'Loops', 'Pitched', 'Other'];
const SAMPLE_RULES = [
  [/^(bd|sd|sn|cp|rim|kick|snare|clap|drum|bd\d|sd\d)/, 'Drums'],
  [/^(hh|oh|cr|rd|cy|hat|ride|crash)/, 'Cymbals'],
  [/^(lt|mt|ht|tom|perc|cb|cl|sh|ma|lc|mc|hc|tb|ag|cabasa|tabla|bongo|conga|east)/, 'Percussion'],
  [/break|loop|amen|jungle|tech|techno|breaks/, 'Loops'],
  [/bass|arpy|casio|sax|piano|pad|stab|gtr|voice/, 'Pitched'],
];
export const sampleCategoryOf = (id) => SAMPLE_RULES.find(([re]) => re.test(id))?.[1] ?? 'Other';
// the picker's rows for the Sample module: what exists in this bank, with plain-English names
export const sampleItems = (bank) => soundsFor(bank).map((id) => ({ id, label: describe(id) || id, cat: sampleCategoryOf(id), kind: 'sample', pitched: false, bank }));
