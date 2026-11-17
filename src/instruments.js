// Everything you can put in s("...") to play notes: synth waves, a recorded piano, and 125 General MIDI instruments.
// Pure data (no Strudel import), so it also runs in the tests.
import gm from '@strudel/soundfonts/gm.mjs';

export const CATEGORIES = ['Synth', 'Keys', 'Mallets', 'Organ', 'Guitar', 'Bass', 'Strings', 'Voice', 'Brass', 'Winds', 'Pads', 'Other'];

const RULES = [
  [/piano|harpsichord|clavinet|celesta/, 'Keys'],
  [/glockenspiel|music_box|vibraphone|marimba|xylophone|tubular|dulcimer|steel_drums|kalimba|agogo|woodblock|taiko|melodic_tom|synth_drum|timpani|reverse_cymbal/, 'Mallets'],
  [/organ|accordion|harmonica|bandoneon/, 'Organ'],
  [/bass/, 'Bass'],
  [/guitar|banjo|sitar|shamisen|koto/, 'Guitar'],
  [/violin|viola|cello|contrabass|string|harp|pizzicato/, 'Strings'],
  [/choir|voice|vox|aahs|oohs/, 'Voice'],
  [/trumpet|trombone|tuba|horn|brass/, 'Brass'],
  [/sax|oboe|bassoon|clarinet|piccolo|flute|recorder|whistle|ocarina|shanai|bagpipe|fiddle|bottle/, 'Winds'],
  [/pad|lead|synth|fx|atmosphere|brightness|goblins|echoes|sci_fi|crystal|soundtrack|rain/, 'Pads'],
];
export const categoryOf = (id) => RULES.find(([re]) => re.test(id))?.[1] ?? 'Other';

export function labelOf(id) {
  const s = id.replace(/^gm_/, '').replace(/epiano(\d*)/, (_, n) => 'electric piano ' + n).replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SYNTH = [
  ['sine', 'Sine wave: pure and smooth'], ['sawtooth', 'Sawtooth: bright and buzzy'], ['square', 'Square wave: hollow, retro'],
  ['triangle', 'Triangle wave: soft and mellow'], ['supersaw', 'Supersaw: several detuned saws, big trance lead'],
  ['pulse', 'Pulse wave: nasal and buzzy, like an old home-computer chip (shape it with Pulse width)'],
];

export const INSTRUMENTS = [
  ...SYNTH.map(([id, label]) => ({ id, label, cat: 'Synth', kind: 'synth' })),
  { id: 'piano', label: 'Piano (recorded)', cat: 'Keys', kind: 'sample' },
  ...Object.keys(gm).map((id) => ({ id, label: labelOf(id), cat: categoryOf(id), kind: 'soundfont' })),
];
const byId = new Map(INSTRUMENTS.map((i) => [i.id, i]));
export const instrumentOf = (id) => byId.get(id);
export const isInstrument = (id) => byId.has(id);
export function searchInstruments(query, cat) {
  const q = String(query || '').trim().toLowerCase();
  return INSTRUMENTS.filter((i) => (!cat || cat === 'All' || i.cat === cat) && (!q || i.id.includes(q) || i.label.toLowerCase().includes(q)));
}
