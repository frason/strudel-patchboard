// Module catalogue. Pure data + small helpers: no DOM, no Strudel.
// A module = typed ports + parameters. Each parameter with a `call` maps to one Strudel method argument.

export const PORT_TYPES = {
  notes: { color: '#f2b134', label: 'notes', hint: 'a melody: note names like c3 e3 g3' },
  trigger: { color: '#ef5b5b', label: 'trigger', hint: 'a rhythm: when things happen, no pitch or sound' },
  number: { color: '#4cc3f0', label: 'number', hint: 'a value or a changing value, plugs into a knob' },
  sound: { color: '#78d68b', label: 'sound', hint: 'something you can hear' },
  key: { color: '#e879c9', label: 'key', hint: 'a key and scale: which notes belong' },
};
export const PATTERN_TYPES = ['notes', 'trigger', 'sound'];

export function fmt(v) {
  if (typeof v !== 'number') return String(v);
  return String(Number(v.toFixed(3)));
}

export const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], 'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'major pentatonic': [0, 2, 4, 7, 9], 'minor pentatonic': [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10],
};
export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WAVES = ['sine', 'sawtooth', 'square', 'triangle', 'supersaw', 'piano'];
const BANKS = ['', 'RolandTR808', 'RolandTR909', 'RolandTR707', 'LinnDrum', 'AkaiLinn', 'CasioRZ1', 'KorgM1'];

// FM matrix routes that are not part of the plain chain 4 -> 3 -> 2 -> 1 -> note and are not feedback
export const ROUTES = [1, 2, 3, 4].flatMap((i) => [0, 1, 2, 3, 4].filter((j) => j !== i && i !== j + 1).map((j) => [i, j]));
// The Effects rack: one tile per effect, each with an on/off switch and an amount. Only switched-on tiles write a call.
export const FX_TILES = [
  { key: 'reverb', label: 'reverb', call: 'room', min: 0, max: 1, step: 0.01, def: 0.4, tip: 'how much room is mixed in (room)' },
  { key: 'delay', label: 'delay', call: 'delay', min: 0, max: 1, step: 0.01, def: 0.35, tip: 'how loud the echoes are (delay)' },
  { key: 'chorus', label: 'chorus', call: 'chorus', min: 0, max: 1, step: 0.01, def: 0.5, tip: 'how much detuned copy is mixed in (chorus)' },
  { key: 'distort', label: 'distortion', call: 'distort', min: 0, max: 10, step: 0.1, def: 2, tip: 'how hard the sound is overdriven (distort)' },
  { key: 'phaser', label: 'phaser', call: 'phaser', min: 0.05, max: 12, step: 0.05, def: 1, log: true, unit: 'Hz', tip: 'sweeps per second (phaser)' },
  { key: 'tremolo', label: 'tremolo', call: 'tremolo', min: 0.25, max: 32, step: 0.25, def: 4, log: true, unit: 'Hz', tip: 'volume wobbles per second (tremolo)' },
];
const ADSR = (def = {}) => [
  { key: 'attack', label: 'attack', kind: 'knob', min: 0, max: 2, step: 0.001, def: def.attack ?? 0.001, call: 'attack', unit: 's', log: true, tip: 'seconds to fade in' },
  { key: 'decay', label: 'decay', kind: 'knob', min: 0, max: 2, step: 0.01, def: def.decay ?? 0.05, call: 'decay', unit: 's', tip: 'seconds to fall to the sustain level' },
  { key: 'sustain', label: 'sustain', kind: 'knob', min: 0, max: 1, step: 0.01, def: def.sustain ?? 0.6, call: 'sustain', tip: 'level held while the note lasts' },
  { key: 'release', label: 'release', kind: 'knob', min: 0, max: 3, step: 0.01, def: def.release ?? 0.01, call: 'release', unit: 's', tip: 'seconds to fade out after the note ends' },
];


const stepsParam = { key: 'steps', label: 'steps', kind: 'select', def: 8, options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], num: true, fold: true };
const modeParam = {
  key: 'mode', label: 'play', kind: 'select', def: 'steps', fold: true,
  options: [['steps', 'all steps in a cycle'], ['turns', 'one step per cycle <>']],
};

// the Melody Sequencer's play options: the steps squeezed into one cycle, a steady pace (8 steps a cycle, so more steps make a longer loop), or one per cycle
const paceModeParam = { ...modeParam, options: [['steps', 'all steps in a cycle'], ['pace', 'steady pace (long loop)']] };
const melodyModeParam = { ...modeParam, options: [['steps', 'all steps in a cycle'], ['pace', 'steady pace (long loop)'], ['turns', 'one step per cycle <>']] };

export const EVERY_FNS = {
  rev: { code: 'rev', label: 'reverse', say: 'reverses the pattern' },
  fast2: { code: 'x=>x.fast(2)', label: 'fast ×2', say: 'plays it twice as fast' },
  slow2: { code: 'x=>x.slow(2)', label: 'slow ÷2', say: 'plays it half as fast' },
  ply2: { code: 'x=>x.ply(2)', label: 'repeat ×2', say: 'repeats every event twice' },
  up12: { code: 'x=>x.transpose(12)', label: 'up an octave', say: 'moves the notes up an octave', notesOnly: true },
};

// what Sometimes can do to the events it picks
export const SOMETIMES_FNS = {
  ply2: { code: 'x=>x.ply(2)', label: 'play twice', say: 'plays it twice' },
  up12: { code: 'x=>x.transpose(12)', label: 'up an octave', say: 'jumps it up an octave', notesOnly: true },
  down12: { code: 'x=>x.transpose(-12)', label: 'down an octave', say: 'drops it an octave', notesOnly: true },
  fast2: { code: 'x=>x.fast(2)', label: 'double speed', say: 'squeezes it to double speed' },
  rev: { code: 'rev', label: 'reverse', say: 'reverses it' },
};
const freezeParam = { key: 'loop', label: 'freeze', kind: 'knob', min: 0, max: 99, step: 1, def: 0, tip: '0: different every cycle. 1 and up: pick that variation and repeat it every cycle (.ribbon(n, 1)).' };

export const MODULES = {
  // ---------- sequencers ----------
  melody: {
    title: 'Melody Sequencer', cat: 'sequencer', out: 'notes',
    blurb: 'Writes a note pattern. Each step is a note or a rest.',
    inputs: [{ id: 'key', type: 'key', label: 'key', required: false }],
    params: [
      stepsParam, { key: 'octave', label: 'view octave', kind: 'view', def: 3 }, melodyModeParam,
      { key: 'root', label: 'key', kind: 'select', def: 'C', options: ROOTS, fold: true },
      { key: 'scale', label: 'scale', kind: 'select', def: 'major', options: [['off', 'off: note names'], ...Object.keys(SCALES)], fold: true },
    ],
    data: { cells: true },
  },
  randnotes: {
    title: 'Random Notes', cat: 'sequencer', out: 'notes',
    inputs: [{ id: 'key', type: 'key', label: 'key', required: false }],
    blurb: 'Writes a melody for you: every step is a random note of the scale, new every cycle. Range is how many scale steps up from the root the notes may reach. Turn freeze up to 1 or more to pick one variation and repeat it. Plug in a Key to change the scale for everything at once.',
    params: [
      stepsParam, paceModeParam,
      { key: 'range', label: 'range', kind: 'knob', min: 2, max: 14, step: 1, def: 7, always: true, tip: 'how many scale steps up from the root the notes can reach' },
      { key: 'octave', label: 'octave', kind: 'select', def: 3, options: [1, 2, 3, 4, 5], num: true },
      freezeParam,
      { key: 'root', label: 'key', kind: 'select', def: 'C', options: ROOTS, fold: true },
      { key: 'scale', label: 'scale', kind: 'select', def: 'minor', options: Object.keys(SCALES), fold: true },
    ],
  },
  randrhythm: {
    title: 'Random Rhythm', cat: 'sequencer', out: 'trigger',
    blurb: 'Writes a rhythm for you: each step may or may not hit, at random, new every cycle. Density is how likely a step is to hit. It has no pitch and no sound, so plug it into a Sample. Turn freeze up to 1 or more to repeat one variation.',
    params: [
      stepsParam, paceModeParam,
      { key: 'density', label: 'density', kind: 'knob', min: 0.05, max: 1, step: 0.05, def: 0.6, always: true, tip: 'how likely each step is to hit (1 = every step)' },
      freezeParam,
    ],
  },
  key: {
    title: 'Key', cat: 'sequencer', out: 'key',
    blurb: 'Sets the key and scale. Plug it into Melody Sequencers: their steps become scale degrees, so changing the key re-harmonises everything at once.',
    params: [
      { key: 'root', label: 'key', kind: 'select', def: 'C', options: ROOTS },
      { key: 'scale', label: 'scale', kind: 'select', def: 'minor', options: Object.keys(SCALES) },
    ],
  },
  chords: {
    title: 'Chord Sequencer', cat: 'sequencer', out: 'notes',
    blurb: 'Write a chord progression with chord names, or with numbers in a key (plug in a Key). Each chord is voiced for you, so plug it straight into an Instrument.',
    inputs: [{ id: 'key', type: 'key', label: 'key', required: false }],
    params: [
      { key: 'steps', label: 'chords', kind: 'select', def: 4, options: [1, 2, 3, 4, 5, 6, 7, 8], num: true, fold: true },
      { key: 'mode', label: 'play', kind: 'select', def: 'turns', options: [['steps', 'all chords in a cycle'], ['turns', 'one chord per cycle <>']], fold: true },
      { key: 'register', label: 'register', kind: 'select', def: '', options: [['', 'default'], ['above:c3', 'low'], ['above:c4', 'middle'], ['above:c5', 'high']], fold: true },
    ],
    data: { cells: true, chords: true },
  },
  arp: {
    title: 'Arpeggiate', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: ['notes'], label: 'notes', required: true }],
    blurb: 'Plays the notes of a chord one after another instead of together: arp("0 1 2 1") picks the lowest, middle, top, middle note.',
    params: [
      { key: 'style', label: 'pattern', kind: 'select', def: '0 1 2 1', options: [['0 1 2', 'up'], ['2 1 0', 'down'], ['0 1 2 1', 'up and down'], ['0 2 1 2', 'weave'], ['0 [1 2]', 'up, quick end'], ['custom', 'custom…']] },
      { key: 'custom', label: 'custom', kind: 'text', def: '0 1 2 3' },
    ],
  },
  rhythm: {
    title: 'Rhythm Sequencer', cat: 'sequencer', out: 'trigger',
    blurb: 'Writes a rhythm: when things happen. It has no pitch and no sound, so plug it into a Sample.',
    params: [stepsParam, melodyModeParam],
    data: { cells: true },
  },

  drums: {
    title: 'Drum Machine', cat: 'source', out: 'sound',
    blurb: 'A grid with one row per drum sound. Click steps to place hits; each row becomes s("bd").struct("x ~ x ~"), stacked together.',
    params: [
      stepsParam, paceModeParam,
      { key: 'bank', label: 'bank', kind: 'select', def: '', options: BANKS, call: 'bank', str: true, fold: true },
      { key: 'gain', label: 'gain', kind: 'knob', min: 0, max: 1.5, step: 0.01, def: 1, call: 'gain', wire: true, tip: 'volume of the whole machine' },
      { key: 'pan', label: 'pan', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'pan', wire: true, tip: 'where the whole machine sits: left (0) to right (1)' },

    ],
    data: { tracks: true },
  },

  // ---------- sound makers ----------
  synth: {
    title: 'Instrument', cat: 'source', out: 'sound', data: { envelope: true },
    blurb: 'Plays notes with an instrument: a synth wave, a recorded piano, or one of 125 General MIDI instruments (guitar, strings, flute...). Whatever you pick is just the sound name in s("..."). Then shape it with the envelope and filter.',
    inputs: [{ id: 'in', type: 'notes', label: 'notes', required: true }],
    params: [
      { key: 'wave', label: 'sound', kind: 'instrument', def: 'sawtooth', call: 's', str: true, always: true },
      ...ADSR().map((p) => ({ ...p, fold: true })),
      { key: 'lpf', label: 'lpf', kind: 'knob', min: 50, max: 20000, step: 1, def: 20000, call: 'lpf', unit: 'Hz', log: true, wire: true, tip: 'low-pass filter cutoff (20000 = open)' },
      { key: 'lpq', label: 'lpq', kind: 'knob', min: 0, max: 30, step: 0.1, def: 1, call: 'lpq', tip: 'filter resonance', fold: true },
      { key: 'detune', label: 'detune', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.18, call: 'detune', wire: true, onlyWave: 'supersaw', tip: 'spread of the stacked voices (supersaw only)', fold: true },
      { key: 'gain', label: 'gain', kind: 'knob', min: 0, max: 1.5, step: 0.01, def: 1, call: 'gain', wire: true, tip: 'volume' },
      { key: 'pan', label: 'pan', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'pan', wire: true, tip: 'left (0) to right (1)' },
    ],
  },
  sample: {
    title: 'Sample', cat: 'source', out: 'sound', data: { envelope: true },
    blurb: 'Plays drum or instrument samples by name. Type mini-notation like bd*2 [bd sd]. Optionally takes a rhythm. Turn fit on to stretch a loop sample so it fills exactly its step (.fit()), like top:1/2.',
    inputs: [{ id: 'in', type: 'trigger', label: 'rhythm', required: false }],
    params: [
      { key: 'name', label: 'sound', kind: 'text', def: 'bd', call: 's', str: true, always: true },
      { key: 'bank', label: 'bank', kind: 'select', def: '', options: BANKS, call: 'bank', str: true },
      { key: 'fit', label: 'fit', kind: 'select', def: 'off', options: [['off', 'off'], ['on', 'stretch to its step']], fold: true },
      { key: 'speed', label: 'speed', kind: 'knob', min: 0.25, max: 4, step: 0.05, def: 1, call: 'speed', log: true, tip: 'playback speed (changes pitch)' },
      { key: 'attack', label: 'attack', kind: 'knob', min: 0, max: 2, step: 0.001, def: 0.001, call: 'attack', unit: 's', log: true, tip: 'seconds to fade in', fold: true },
      { key: 'decay', label: 'decay', kind: 'knob', min: 0, max: 2, step: 0.01, def: 0.05, call: 'decay', unit: 's', tip: 'how long the sound takes to die away', fold: true },
      { key: 'release', label: 'release', kind: 'knob', min: 0, max: 3, step: 0.01, def: 0.01, call: 'release', unit: 's', tip: 'seconds to fade out', fold: true },
      { key: 'lpf', label: 'lpf', kind: 'knob', min: 50, max: 20000, step: 1, def: 20000, call: 'lpf', unit: 'Hz', log: true, wire: true, tip: 'low-pass filter cutoff (20000 = open)' },
      { key: 'gain', label: 'gain', kind: 'knob', min: 0, max: 1.5, step: 0.01, def: 1, call: 'gain', wire: true, tip: 'volume' },
      { key: 'pan', label: 'pan', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'pan', wire: true, tip: 'left (0) to right (1)' },
    ],
  },

  // ---------- transformers (keep the type of what comes in) ----------
  fast: {
    title: 'Fast', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Speeds a pattern up: fast(2) plays it twice per cycle.',
    params: [{ key: 'n', label: 'times', kind: 'knob', min: 0.25, max: 16, step: 0.25, def: 2, call: 'fast', always: true, wire: true }],
  },
  slow: {
    title: 'Slow', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Slows a pattern down: slow(2) stretches it over two cycles.',
    params: [{ key: 'n', label: 'times', kind: 'knob', min: 0.25, max: 8, step: 0.25, def: 2, call: 'slow', always: true, wire: true }],
  },
  rev: {
    title: 'Reverse', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Plays each cycle backwards.',
    params: [],
  },
  transpose: {
    title: 'Transpose', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: ['notes'], label: 'notes', required: true }],
    blurb: 'Moves every note up or down by a number of semitones.',
    params: [{ key: 'n', label: 'semitones', kind: 'knob', min: -24, max: 24, step: 1, def: 12, call: 'transpose', always: true, wire: true }],
  },
  ply: {
    title: 'Repeat', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Repeats every event: ply(2) plays each one twice in the same space.',
    params: [{ key: 'n', label: 'times', kind: 'knob', min: 1, max: 8, step: 1, def: 2, call: 'ply', always: true, wire: true }],
  },
  degrade: {
    title: 'Degrade', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Randomly drops some events: degradeBy(0.25) loses about a quarter of them, differently each cycle.',
    params: [{ key: 'n', label: 'drop', kind: 'knob', min: 0, max: 1, step: 0.05, def: 0.25, call: 'degradeBy', always: true, wire: true }],
  },
  shuffle: {
    title: 'Shuffle', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Cuts the pattern into slices and plays them in a new order every cycle. Shuffle plays every slice once; scramble picks slices at random, so some repeat and some are missing. Freeze picks one variation and repeats it.',
    params: [
      { key: 'mode', label: 'mode', kind: 'select', def: 'shuffle', options: [['shuffle', 'shuffle: each slice once'], ['scramble', 'scramble: slices may repeat']] },
      { key: 'n', label: 'slices', kind: 'knob', min: 2, max: 16, step: 1, def: 4, always: true, tip: 'how many slices the cycle is cut into' },
      freezeParam,
    ],
  },
  sometimes: {
    title: 'Sometimes', cat: 'transform', out: 'through',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Changes some events at random and leaves the rest alone: sometimesBy(0.3, ...) changes about 3 in 10. Pick what happens to the chosen ones. Freeze picks one variation and repeats it.',
    params: [
      { key: 'p', label: 'chance', kind: 'knob', min: 0, max: 1, step: 0.05, def: 0.3, always: true, tip: 'how likely each event is to be changed' },
      { key: 'fn', label: 'change', kind: 'select', def: 'ply2', options: Object.entries(SOMETIMES_FNS).map(([v, f]) => [v, f.label]) },
      freezeParam,
    ],
  },
  euclid: {
    title: 'Euclid', cat: 'transform', out: 'through', preview: 'euclid',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Spreads some hits as evenly as possible over some steps: euclid(3,8) is a classic rhythm.',
    params: [
      { key: 'pulses', label: 'hits', kind: 'knob', min: 1, max: 16, step: 1, def: 3, always: true },
      { key: 'steps', label: 'steps', kind: 'knob', min: 1, max: 16, step: 1, def: 8, always: true },
    ],
    call: 'euclid',
  },
  every: {
    title: 'Every N', cat: 'transform', out: 'through', preview: 'every',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'in', required: true }],
    blurb: 'Every Nth cycle, does something different to the pattern.',
    params: [
      { key: 'n', label: 'every', kind: 'knob', min: 2, max: 16, step: 1, def: 4, always: true },
      { key: 'fn', label: 'then', kind: 'select', def: 'rev', options: Object.entries(EVERY_FNS).map(([k, v]) => [k, v.label]) },
    ],
    call: 'every',
  },

  // ---------- combiners ----------
  stack: {
    title: 'Stack', cat: 'combine', out: 'through',
    inputs: 'multi', blurb: 'Plays several patterns at the same time: stack(a, b).',
    params: [{ key: 'n', label: 'inputs', kind: 'select', def: 2, options: [2, 3, 4, 5, 6], num: true }],
  },
  mixer: {
    title: 'Mixer', cat: 'combine', out: 'through', data: { mixer: true },
    inputs: 'multi', blurb: 'Plays several parts at the same time, like Stack, with a fader, pan, mute and solo for each. Volume scales the part after its effects (postgain), so it keeps its own balance.',
    params: [{ key: 'n', label: 'inputs', kind: 'select', def: 3, options: [2, 3, 4, 5, 6], num: true }],
  },
  cat: {
    title: 'Sequence', cat: 'combine', out: 'through',
    inputs: 'multi', blurb: 'Plays patterns one after another, one cycle each: cat(a, b).',
    params: [{ key: 'n', label: 'inputs', kind: 'select', def: 2, options: [2, 3, 4, 5, 6], num: true }],
  },

  arrange: {
    title: 'Arrange', cat: 'combine', out: 'through', data: { arrange: true },
    inputs: 'multi', blurb: 'Lays out a song: each input plays for its own number of cycles, one after another, then it starts over: arrange([4, a], [8, b]).',
    params: [{ key: 'n', label: 'sections', kind: 'select', def: 3, options: [2, 3, 4, 5, 6], num: true, fold: true }],
  },

  // ---------- effects ----------
  filter: {
    title: 'Filter', cat: 'effect', out: 'sound', preview: 'filter', data: { envelope: { a: 'fa', d: 'fd', s: 'fs', amt: 'env' } },
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Removes highs (lpf), lows (hpf) or everything but a band (bpf).',
    params: [
      { key: 'type', label: 'type', kind: 'select', def: 'lpf', options: [['lpf', 'low-pass'], ['hpf', 'high-pass'], ['bpf', 'band-pass']], icons: 'filter' },
      { key: 'cutoff', label: 'cutoff', kind: 'knob', min: 50, max: 20000, step: 1, def: 800, unit: 'Hz', log: true, always: true, wire: true, callFrom: 'type' },
      { key: 'q', label: 'resonance', kind: 'knob', min: 0, max: 30, step: 0.1, def: 1, callFrom: 'type', qSuffix: true },
      { key: 'ftype', label: 'slope', kind: 'select', def: '12db', options: [['12db', '12 dB (gentle)'], ['24db', '24 dB (steeper)'], ['ladder', 'ladder (aggressive)']], fold: true },
      { key: 'env', label: 'env', kind: 'knob', min: 0, max: 8, step: 0.1, def: 0, tip: 'filter envelope: how far each note opens the filter (0 = off)', fold: true },
      { key: 'fa', label: 'attack', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.01, unit: 's', tip: 'envelope attack', fold: true },
      { key: 'fd', label: 'decay', kind: 'knob', min: 0.01, max: 1, step: 0.01, def: 0.15, unit: 's', tip: 'envelope decay', fold: true },
      { key: 'fs', label: 'sustain', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.2, tip: 'envelope sustain level', fold: true },
    ],
  },
  delay: {
    title: 'Delay', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Echoes: delay is how loud, delaytime how far apart, delayfeedback how many repeats.',
    params: [
      { key: 'mix', label: 'mix', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.4, call: 'delay', always: true, wire: true },
      { key: 'time', label: 'time', kind: 'knob', min: 0.01, max: 1, step: 0.01, def: 0.25, call: 'delaytime', unit: 'cyc', wire: true },
      { key: 'feedback', label: 'feedback', kind: 'knob', min: 0, max: 0.95, step: 0.01, def: 0.5, call: 'delayfeedback', wire: true },
    ],
  },
  reverb: {
    title: 'Reverb', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Adds a room around the sound: room is how much, roomsize how big.',
    params: [
      { key: 'room', label: 'room', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'room', always: true, wire: true },
      { key: 'size', label: 'size', kind: 'knob', min: 0, max: 10, step: 0.1, def: 2, call: 'roomsize', wire: true },
    ],
  },
  distortion: {
    title: 'Distortion', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Crunch: distort overdrives the sound, crush lowers its bit depth.',
    params: [
      { key: 'amount', label: 'distort', kind: 'knob', min: 0, max: 10, step: 0.1, def: 2, call: 'distort', always: true, wire: true },
      { key: 'crush', label: 'crush', kind: 'knob', min: 1, max: 16, step: 1, def: 16, call: 'crush', tip: 'bit depth (16 = clean)' },
      { key: 'shape', label: 'shape', kind: 'knob', min: 0, max: 0.95, step: 0.01, def: 0, call: 'shape', tip: 'wave-shaping distortion (it can get loud)' },
    ],
  },

  vibrato: {
    title: 'Vibrato', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Wobbles the pitch up and down, like a singer or a violinist.',
    params: [
      { key: 'rate', label: 'speed', kind: 'knob', min: 0.5, max: 20, step: 0.1, def: 5, call: 'vib', unit: 'Hz', log: true, always: true, wire: true },
      { key: 'depth', label: 'depth', kind: 'knob', min: 0, max: 4, step: 0.05, def: 0.5, call: 'vibmod', unit: 'st', always: true, wire: true, tip: 'how far the pitch moves, in semitones' },
    ],
  },
  ring: {
    title: 'Ring mod', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Ring modulation: multiplies the sound by a tone, giving metallic, bell-like, robotic timbres.',
    params: [
      { key: 'mix', label: 'mix', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'ring', always: true, wire: true },
      { key: 'freq', label: 'freq', kind: 'knob', min: 20, max: 4000, step: 1, def: 220, call: 'ringf', unit: 'Hz', log: true, always: true, wire: true },
    ],
  },
  vowel: {
    title: 'Vowel', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'A formant filter that makes the sound talk: it shapes it into a vowel like "ah" or "oo".',
    params: [{ key: 'vowel', label: 'vowel', kind: 'select', def: 'a', options: ['a', 'e', 'i', 'o', 'u', 'ae', 'aa', 'oe', 'ue', 'y', 'uh', 'un', 'en', 'an', 'on'], call: 'vowel', str: true, always: true }],
  },
  djf: {
    title: 'DJ filter', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'One knob, like a DJ mixer: turn left of the middle for a low-pass, right of it for a high-pass.',
    params: [{ key: 'amount', label: 'filter', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'djf', always: true, wire: true, tip: 'below 0.5 low-pass, above 0.5 high-pass' }],
  },
  leslie: {
    title: 'Leslie', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Emulates a rotating speaker cabinet: a swirling, shimmering movement, great on organs.',
    params: [
      { key: 'wet', label: 'mix', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.7, call: 'leslie', always: true, wire: true },
      { key: 'rate', label: 'speed', kind: 'knob', min: 0.5, max: 7, step: 0.1, def: 2, call: 'lrate', always: true, tip: '0.7 slow, 6.7 fast' },
      { key: 'size', label: 'size', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'lsize', always: true, tip: 'cabinet size: more doppler warble' },
    ],
  },
  lofi: {
    title: 'Lo-fi', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Fake-resampling for a gritty, low-sample-rate sound (coarse), and a squeezed, pinched tone (squiz). Add bit-crushing with Distortion.',
    params: [
      { key: 'coarse', label: 'coarse', kind: 'knob', min: 1, max: 32, step: 1, def: 1, call: 'coarse', wire: true, tip: '1 = original, 2 = half the sample rate, ...' },
      { key: 'squiz', label: 'squiz', kind: 'knob', min: 1, max: 16, step: 1, def: 1, call: 'squiz', wire: true, tip: 'try 2, 4, 8' },
    ],
  },
  pitchenv: {
    title: 'Pitch env', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Bends the pitch of every note and settles back: a downward bend makes kick-drum thumps and laser zaps.',
    params: [
      { key: 'amount', label: 'bend', kind: 'knob', min: -24, max: 24, step: 1, def: 12, call: 'penv', unit: 'st', always: true, wire: true, tip: 'semitones at the start of the note' },
      { key: 'attack', label: 'attack', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.01, call: 'pattack', unit: 's', always: true },
      { key: 'decay', label: 'decay', kind: 'knob', min: 0.01, max: 1, step: 0.01, def: 0.2, call: 'pdecay', unit: 's', always: true },
    ],
  },
  fm: {
    title: 'FM', cat: 'effect', out: 'sound', data: { fmdiagram: true, envelope: true },
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'FM synthesis: one oscillator (the modulator) shakes the pitch of another (the note you hear) so fast that it adds new overtones, turning a plain sine into bells, electric pianos and growly basses. Index is how hard it shakes, harmonic is its pitch compared with the note, and decay and sustain say how long the brightness lasts. Use it after a synth wave, and start from a preset.',
    more: [
      ['What FM is', 'Frequency modulation: one oscillator (the modulator) wobbles the pitch of another (the carrier, the note you hear) hundreds of times a second. That is too fast to sound like vibrato. Instead it adds new overtones, so a plain sine wave can become a bell, an electric piano or a growling bass using only a few knobs. Put this module after an Instrument, ideally one set to a sine wave, because the sine is the cleanest thing to shake.'],
      ['The two knobs that matter', 'Index is how hard the modulator shakes. 0 is a pure sine; a little (1 to 3) adds warmth and edge; a lot (6 and up) is bright, harsh and metallic. Harmonic is the modulator\'s pitch compared with the note. Whole numbers (1, 2, 3, 4) keep the new overtones in tune with the note, so the sound is musical (bass, piano, organ). In-between values (3.5, 2.75) put the overtones between the notes, which is what bells, gongs and clangs sound like.'],
      ['Decay and sustain: the brightness envelope', 'These shape how the index changes over a note, so they control how bright it is over time, not how loud. A short decay with sustain 0 starts bright and goes soft at once: a pluck, a marimba, a piano tine. A long decay and a high sustain stays bright while the note is held: brass and organ. The Instrument\'s own envelope, above this module, shapes the loudness, and the two work together.'],
      ['Four modulators, two views', 'There are four modulators. In the "tune" view they stack in a chain: 4 shakes 3, 3 shakes 2, 2 shakes 1, and 1 shakes the note. Slide a disc sideways for its harmonic and up or down for its index. In the "routes" view you can wire them any way you like: drag from one disc to another (or onto "note you hear") to add an arrow, and drag the dot on an arrow up or down for how hard it shakes. Several routes into the same disc add together.'],
      ['Feedback (the orange ring)', 'Feedback makes a modulator shake itself. A little (0.05 to 0.3) adds a buzzy, sawtooth-like edge and a growl; a lot turns into noise. Tap a disc in the routes view to switch its feedback on or off. The orange arc or ring on a disc is its feedback amount.'],
      ['Presets and recipes', 'The Presets list at the top loads a ready-made sound: Electric piano, Bell, Bass, Brass, Marimba or Metal clang. Each one replaces all the FM settings, so use it as a starting point and then change it. Some recipes to try: a bass is index 3 to 4, harmonic 1, a short decay. A bell is harmonic 3.5 with a long decay and sustain 0. An electric piano is a soft 1:1 sound plus a second modulator at harmonic 14, a quick bright "tine". A glassy pad is low indexes with slow envelopes.'],
      ['Tips', 'Start with one modulator and get that right before adding more. If a sound is harsh or out of tune, lower the index or round the harmonic to a whole number. FM sounds change a lot with pitch, so listen at the pitch you will use. Give an FM part its own orbit if it has reverb or delay, so the effect stays on that part. Everything here is written as the .fm(), .fmh(), .fmdecay() and .fmsustain() methods (and fm2, fmh2 and so on) in the code panel, where you can see exactly what each knob does.'],
    ],
    params: [
      { key: 'index', label: 'index', kind: 'knob', min: 0, max: 16, step: 0.1, def: 1.5, log: true, call: 'fm', always: true, wire: true, tip: 'how strong the modulation is (brightness). 0.5 to 3 sounds musical; above 6 turns harsh and metallic. The dial is finest near zero.' },
      { key: 'harm', label: 'harmonic', kind: 'knob', min: 0.25, max: 16, step: 0.25, def: 1, call: 'fmh', always: true, wire: true, tip: 'modulator pitch relative to the note (whole numbers sound musical)' },
      { key: 'decay', label: 'decay', kind: 'knob', min: 0.01, max: 2, step: 0.01, def: 0.4, call: 'fmdecay', unit: 's', tip: 'how fast the brightness dies away', fold: true },
      { key: 'sustain', label: 'sustain', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.4, call: 'fmsustain', tip: 'how much of the modulation is held while the note lasts (1 = all of it)', fold: true },
      { key: 'index2', label: 'index 2', kind: 'knob', min: 0, max: 16, step: 0.1, def: 0, log: true, call: 'fm2', wire: true, tip: 'a second modulator on top of the first (0 = off): three-operator FM', fold: true },
      { key: 'fb1', label: 'feedback 1', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0, call: 'fm11', wire: true, tip: 'the first modulator feeds back into itself (0 = off); keep it small, 0.05 to 0.3', fold: true },
      { key: 'fb2', label: 'feedback 2', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0, call: 'fm22', wire: true, tip: 'the second modulator feeds back into itself (0 = off); keep it small, 0.05 to 0.3; needs index and index 2 above 0 to be heard', fold: true },
      { key: 'harm2', label: 'harmonic 2', kind: 'knob', min: 0.25, max: 16, step: 0.25, def: 1, call: 'fmh2', wire: true, tip: 'the second modulator\'s pitch relative to the note', fold: true },
      { key: 'index3', label: 'index 3', kind: 'knob', min: 0, max: 16, step: 0.1, def: 0, log: true, call: 'fm3', tip: 'a third modulator that shakes the second (0 = off)', fold: true },
      { key: 'harm3', label: 'harmonic 3', kind: 'knob', min: 0.25, max: 16, step: 0.25, def: 1, call: 'fmh3', tip: 'the third modulator\'s pitch relative to the note', fold: true },
      { key: 'index4', label: 'index 4', kind: 'knob', min: 0, max: 16, step: 0.1, def: 0, log: true, call: 'fm4', tip: 'a fourth modulator that shakes the third (0 = off)', fold: true },
      { key: 'harm4', label: 'harmonic 4', kind: 'knob', min: 0.25, max: 16, step: 0.25, def: 1, call: 'fmh4', tip: 'the fourth modulator\'s pitch relative to the note', fold: true },
      { key: 'fb3', label: 'feedback 3', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0, call: 'fm33', tip: 'the third modulator feeds back into itself (0 = off); keep it small', fold: true },
      { key: 'fb4', label: 'feedback 4', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0, call: 'fm44', tip: 'the fourth modulator feeds back into itself (0 = off); keep it small', fold: true },
      // the other routes of the 4x4 matrix: modulator i into j (0 = the note). Edited in the routing view, so they have no knob.
      ...ROUTES.map(([i, j]) => ({ key: 'r' + i + j, label: 'op ' + i + ' into ' + (j ? 'op ' + j : 'note'), kind: 'knob', hide: true, min: 0, max: 16, step: 0.1, def: 0, call: 'fm' + i + j })),
    ],
  },
  pan: {
    title: 'Pan', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Places the sound in the stereo field: 0 is hard left, 0.5 the middle, 1 hard right. Plug a Wave into it for an auto-pan.',
    params: [{ key: 'pan', label: 'pan', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'pan', always: true, wire: true }],
  },
  fx: {
    title: 'Effects', cat: 'effect', out: 'sound', data: { fxrack: true },
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'A rack of effects in one module: reverb, delay, chorus, distortion, phaser and tremolo. Tap a tile to switch it on or off, drag across it to set how much. Only the tiles that are on appear in the code.',
    params: FX_TILES.flatMap((t) => [
      { key: t.key, label: t.label, kind: 'knob', hide: true, min: t.min, max: t.max, step: t.step, def: t.def, call: t.call, always: true, ...(t.log ? { log: true } : {}), tip: t.tip },
      { key: t.key + '_on', label: t.label + ' on', kind: 'toggle', hide: true, def: false },
    ]),
  },
  orbit: {
    title: 'Orbit', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Picks the mix bus (orbit) a sound plays on. Reverb and delay are shared by everything on the same orbit, so give a part its own orbit to keep its reverb and delay separate: .orbit(2).',
    params: [{ key: 'n', label: 'orbit', kind: 'select', def: 2, options: [1, 2, 3, 4, 5, 6, 7, 8], num: true }],
  },
  tremolo: {
    title: 'Tremolo', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Amplitude modulation: the volume wobbles up and down. Set the speed in Hz, or lock it to the tempo.',
    params: [
      { key: 'sync', label: 'speed in', kind: 'select', def: 'hz', options: [['hz', 'Hz'], ['sync', 'wobbles per cycle']] },
      { key: 'rate', label: 'speed', kind: 'knob', min: 0.25, max: 32, step: 0.25, def: 4, log: true, always: true, wire: true, tip: 'how fast the volume wobbles' },
      { key: 'depth', label: 'depth', kind: 'knob', min: 0, max: 1, step: 0.01, def: 1, call: 'tremolodepth', wire: true, tip: 'how deep the dips go (1 = down to silence)' },
      { key: 'shape', label: 'shape', kind: 'select', def: '', options: ['', 'sine', 'triangle', 'square', 'sawtooth'], call: 'tremoloshape', str: true, icons: 'shape' },
    ],
  },
  phaser: {
    title: 'Phaser', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'A swirling, sweeping sound made by moving notches through the frequencies.',
    params: [
      { key: 'rate', label: 'speed', kind: 'knob', min: 0.05, max: 12, step: 0.05, def: 1, log: true, always: true, wire: true, tip: 'sweeps per second' },
      { key: 'depth', label: 'depth', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.75, call: 'phaserdepth', wire: true },
      { key: 'center', label: 'center', kind: 'knob', min: 100, max: 4000, step: 10, def: 1000, call: 'phasercenter', unit: 'Hz', log: true, tip: 'middle frequency of the sweep' },
      { key: 'sweep', label: 'sweep', kind: 'knob', min: 0, max: 4000, step: 10, def: 2000, call: 'phasersweep', tip: 'how far the sweep travels' },
    ],
  },
  chorus: {
    title: 'Chorus', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Thickens the sound with slightly detuned, delayed copies of itself.',
    params: [{ key: 'amount', label: 'mix', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, call: 'chorus', always: true, wire: true }],
  },
  compressor: {
    title: 'Compressor', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'Evens out the volume: anything louder than the threshold is turned down by the ratio. Written as compressor("threshold:ratio:knee:attack:release").',
    params: [
      { key: 'threshold', label: 'threshold', kind: 'knob', min: -60, max: 0, step: 1, def: -20, unit: 'dB', always: true },
      { key: 'ratio', label: 'ratio', kind: 'knob', min: 1, max: 20, step: 0.5, def: 4, always: true },
      { key: 'knee', label: 'knee', kind: 'knob', min: 0, max: 40, step: 1, def: 10, always: true, fold: true },
      { key: 'attack', label: 'attack', kind: 'knob', min: 0.001, max: 0.2, step: 0.001, def: 0.003, log: true, unit: 's', always: true, fold: true },
      { key: 'release', label: 'release', kind: 'knob', min: 0.01, max: 1, step: 0.01, def: 0.1, unit: 's', always: true, fold: true },
    ],
  },
  acid: {
    title: 'Acid', cat: 'effect', out: 'sound',
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true }],
    blurb: 'A 303-style squelch: a low filter that opens on every note and snaps shut again. Written as a small acidenv() helper at the top of the code, then .acidenv(amount). Plug a Slider into amount to play it live.',
    params: [{ key: 'amount', label: 'amount', kind: 'knob', min: 0, max: 1, step: 0.001, def: 0.5, call: 'acidenv', always: true, wire: true, tip: 'how far the filter opens on each note' }],
  },
  duck: {
    title: 'Duck', cat: 'effect', out: 'sound',
    inputs: [
      { id: 'kick', type: ['sound'], label: 'trigger', required: true, multi: true },
      { id: 'lead', type: ['sound'], label: 'ducked', required: true, multi: true },
    ],
    blurb: 'Sidechain: every hit of a trigger sound (usually the kick, but any sound works) dips the ducked sounds and lets them swell back. Plug one or several sounds into trigger and into ducked. The ducked sounds share one orbit (mix bus), which the triggers duck. Everything comes out together, so plug the output into Output.',
    params: [
      { key: 'orbit', label: 'orbit', kind: 'select', def: 3, options: [2, 3, 4, 5, 6, 7, 8], num: true },
      { key: 'depth', label: 'depth', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.8, call: 'duckdepth', always: true, wire: true, tip: 'how far the ducked sound dips (1 = silent)' },
      { key: 'attack', label: 'attack', kind: 'knob', min: 0.01, max: 1, step: 0.01, def: 0.16, call: 'duckattack', unit: 's', always: true, wire: true, tip: 'how long it takes to swell back after each kick' },
    ],
  },

  // ---------- views (they draw what is playing; they do not change the sound or the code) ----------
  pianoroll: {
    title: 'Piano Roll', cat: 'view', out: 'through', canvas: 'roll',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'watch', required: true }],
    blurb: 'Shows the notes (or drum hits) coming from the modules before it, scrolling past a playhead. View only: it passes the sound through untouched and adds nothing to the code.',
    params: [],
  },
  punchcard: {
    title: 'Punchcard', cat: 'view', out: 'through', canvas: 'punchcard',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'watch', required: true }],
    blurb: 'A grid of the events from the modules before it: one row per pitch or sound, time left to right, two cycles at a time. View only: it passes the sound through untouched and adds nothing to the code.',
    params: [],
  },
  spiral: {
    title: 'Spiral', cat: 'view', out: 'through', canvas: 'spiral',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'watch', required: true }],
    blurb: 'The events from the modules before it winding outwards, one turn per cycle, with a sweeping playhead. View only: it passes the sound through untouched and adds nothing to the code.',
    params: [],
  },
  pitchwheel: {
    title: 'Pitch Wheel', cat: 'view', out: 'through', canvas: 'pitchwheel',
    inputs: [{ id: 'in', type: PATTERN_TYPES, label: 'watch', required: true }],
    blurb: 'The twelve pitch classes on a circle; the notes sounding right now light up and join into a shape. View only: it passes the sound through untouched and adds nothing to the code.',
    params: [],
  },
  hydra: {
    title: 'Hydra Visuals', cat: 'view', single: true,
    blurb: 'Live visuals with Hydra. Whatever you write here runs after await initHydra(), exactly like strudel.cc. Show it behind the board, in a floating panel, or in its own window. Hydra is its own clock-free engine: it can read Strudel through H("<1 2>") but does not make sound.',
    params: [
      { key: 'mode', label: 'show', kind: 'select', def: 'panel', options: [['panel', 'floating panel'], ['background', 'behind the board'], ['window', 'separate window']] },
      { key: 'code', label: 'hydra', kind: 'code', def: 'osc(10, 0.1, 1.2)\n  .kaleid(4)\n  .out()' },
    ],
  },
  scope: {
    title: 'Scope', cat: 'view', out: 'through', canvas: 'scope',
    inputs: [{ id: 'in', type: ['sound'], label: 'watch', required: true }],
    blurb: 'An oscilloscope for this one sound. It writes .analyze(1), which tells Strudel to send a copy of the sound to analyser 1, and draws it.',
    params: [{ key: 'style', label: 'show', kind: 'select', def: 'wave', options: [['wave', 'waveform'], ['spectrum', 'spectrum']], ui: true }],
  },

  // ---------- number sources ----------
  slider: {
    title: 'Slider', cat: 'number', out: 'number',
    blurb: 'A number you can move while it plays: slider(value, min, max).',
    params: [
      { key: 'value', label: 'value', kind: 'knob', step: 1, def: 800, always: true, dyn: true, call: 'slider', tip: 'drag left and right while it plays' },
      { key: 'min', label: 'min', kind: 'num', def: 200 },
      { key: 'max', label: 'max', kind: 'num', def: 4000 },
      { key: 'step', label: 'step', kind: 'num', def: 0, hide: true },   // 0 = pick a step from the range; set when the slider is plugged into a knob so it moves in that knob's steps
    ],
  },
  macro: {
    title: 'Macro', cat: 'number', out: 'number',
    blurb: 'One control for many knobs. Plug it into several knobs: in "sweep" mode it moves each knob across its own whole range (so one move opens a filter and brightens an FM sound together); in "multiply" mode it scales whatever each knob is set to (so one move changes the volume of several parts and keeps their balance).',
    params: [
      { key: 'value', label: 'amount', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0.5, always: true, tip: 'drag left and right while it plays' },
      { key: 'mode', label: 'mode', kind: 'select', def: 'sweep', options: [['sweep', 'sweep each knob\'s range'], ['multiply', 'multiply each knob\'s setting']] },
    ],
  },
  wave: {
    title: 'Wave', cat: 'number', out: 'number', preview: 'wave',
    blurb: 'A number that moves by itself: sine.range(200, 2000).slow(4) sweeps up and down.',
    params: [
      { key: 'shape', label: 'shape', kind: 'select', def: 'sine', options: ['sine', 'saw', 'tri', 'square', 'rand'], icons: 'shape' },
      { key: 'min', label: 'low', kind: 'num', def: 200 },
      { key: 'max', label: 'high', kind: 'num', def: 2000 },
      { key: 'slow', label: 'cycles', kind: 'knob', min: 0.25, max: 16, step: 0.25, def: 4, unit: 'cyc', tip: 'cycles for one sweep' },
    ],
  },
  numpat: {
    title: 'Number Pattern', cat: 'number', out: 'number',
    blurb: 'A pattern of numbers in mini-notation, like <200 800> (one per cycle).',
    params: [{ key: 'text', label: 'numbers', kind: 'text', def: '<400 1200>' }],
  },

  // ---------- output ----------
  output: {
    title: 'Output', cat: 'output', out: null,
    inputs: [{ id: 'in', type: ['sound'], label: 'sound', required: true, multi: true }],
    blurb: 'The speakers. Every sound wired in becomes its own $: line, all playing together. The master knobs add one effect to everything at once: all(x => x.phaser(...)).',
    params: [
      { key: 'bpm', label: 'tempo', kind: 'knob', min: 40, max: 220, step: 1, def: 120, unit: 'bpm', always: true },
      { key: 'mvol', label: 'volume', kind: 'knob', min: 0, max: 1.5, step: 0.01, def: 1, master: true, wire: true, tip: 'master volume: scales every part together and keeps their balance (1 = unchanged). Plug a slider in to ride the volume while it plays.' },
      { key: 'beats', label: 'beats / cycle', kind: 'select', def: 4, options: [2, 3, 4, 5, 6, 8], num: true, fold: true },
      { key: 'mphaser', label: 'phaser', kind: 'knob', min: 0, max: 8, step: 0.1, def: 0, master: true, tip: 'master phaser on everything (0 = off)', fold: true },
      { key: 'mtrem', label: 'tremolo', kind: 'knob', min: 0, max: 20, step: 0.25, def: 0, master: true, tip: 'master tremolo on everything (0 = off)', fold: true },
      { key: 'mchorus', label: 'chorus', kind: 'knob', min: 0, max: 1, step: 0.01, def: 0, master: true, tip: 'master chorus on everything (0 = off)', fold: true },
    ],
    single: true,
  },
};

export const CATEGORIES = [
  ['sequencer', 'Write'], ['source', 'Sounds'], ['transform', 'Transform'], ['combine', 'Combine'],
  ['effect', 'Effects'], ['view', 'Views'], ['number', 'Numbers'], ['output', 'Output'],
];

export function defaultParams(type) {
  const def = MODULES[type];
  const p = {};
  for (const s of def.params) p[s.key] = s.def;
  if (def.data?.tracks) p.tracks = defaultTracks(p.steps);
  if (def.data?.arrange) p.lens = [4, 4, 4, 4, 4, 4];
  if (def.data?.mixer) p.strips = Array.from({ length: 6 }, () => ({ vol: 1, pan: 0.5, mute: false, solo: false }));
  if (def.data?.cells) {
    p.cells = makeCells(type, p.steps);
    if (type === 'melody') p.cells = p.cells.map((c, i) => (i % 2 === 0 ? { ...c, n: ['c', 'e', 'g', 'e'][(i / 2) % 4] + '3', d: [0, 2, 4, 2][(i / 2) % 4] } : c));
    if (type === 'rhythm') p.cells = p.cells.map((c, i) => ({ ...c, on: i % 2 === 0 }));
    if (type === 'chords') { const prog = [['C', 0], ['G', 4], ['Am', 5], ['F', 3]]; p.cells = p.cells.map((c, i) => ({ ...c, sym: prog[i % 4][0], d: { i: prog[i % 4][1], ext: '' } })); }
  }
  return p;
}

export function makeCells(type, n) {
  return Array.from({ length: n }, () => (type === 'chords' ? { sym: null, d: null, len: 1 } : type === 'melody' ? { n: null, d: null, len: 1, vel: 1 } : { on: false, len: 1 }));
}

// Making a pattern longer repeats what is already there (8 steps become 16 by playing the same 8 twice), so it can be varied from a working loop.
const copyOf = (c) => JSON.parse(JSON.stringify(c));
export function resizeCells(type, cells, n) {
  const out = cells.slice(0, n);
  const have = out.length;
  while (out.length < n) out.push(have ? copyOf(cells[out.length % have]) : makeCells(type, 1)[0]);
  return out;
}

// Port list for one node: [{id, dir:'in'|'out', type|accept, label, required, multi, param?}]
export function portsOf(node) {
  const def = MODULES[node.type];
  const ports = [];
  if (def.inputs === 'multi') {
    for (let i = 1; i <= node.params.n; i++) ports.push({ id: 'in' + i, dir: 'in', accept: 'same', label: 'in ' + i, required: false });
  } else if (def.inputs) {
    for (const p of def.inputs) ports.push({ id: p.id, dir: 'in', accept: Array.isArray(p.type) ? p.type : [p.type], label: p.label, required: !!p.required, multi: !!p.multi });
  }
  for (const s of def.params) {
    if (s.wire) ports.push({ id: 'p:' + s.key, dir: 'in', accept: ['number'], label: s.label, param: s.key });
  }
  if (def.out) ports.push({ id: 'out', dir: 'out', label: 'out' });
  return ports;
}

// A melody step holds zero or more pitches (a chord): note names in n, scale degrees in d (used when a key is set).
export const cellNotes = (c, deg = false) => { const v = deg ? c.d : c.n; return Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]; };
export const noteRank = (name) => {
  const m = /^([a-g]#?)(-?\d+)$/.exec(name);
  return m ? Number(m[2]) * 12 + NOTE_NAMES.indexOf(m[1]) : 0;
};

export const MAX_TRACKS = 8;
export function defaultTracks(steps) {
  const hits = { bd: [0, 4], sd: [2, 6], hh: [0, 2, 4, 6] };
  return Object.entries(hits).map(([name, at]) => ({ name, mute: false, cells: Array.from({ length: steps }, (_, i) => ({ on: at.includes(i * (8 / steps)) })) }));
}
// A drum row from text: 'x' hit, '~' rest, 'x*2' repeat, '[x x]' brackets.
export const drumRow = (name, pattern) => ({
  name, mute: false,
  cells: pattern.match(/\[[^\]]*\]|\S+/g).map((tok) => {
    if (tok.startsWith('[')) { const subs = tok.slice(1, -1).trim().split(/\s+/).map((t) => ({ on: t === 'x' })); return { on: false, x: 'sub' + subs.length, sub: subs }; }
    const m = /^x\*(\d)$/.exec(tok);
    return m ? { on: true, x: 'rep' + m[1] } : { on: tok === 'x' };
  }),
});
// Ready-made drum kits for the Drum Machine: a drum bank plus a groove. Loading one replaces the bank, steps and rows (gain and pan stay).
const kit = (id, label, tip, bank, rows) => ({ id, label, tip, params: { bank, steps: rows[0][1].match(/\[[^\]]*\]|\S+/g).length, tracks: rows.map(([n, p]) => drumRow(n, p)) } });
export const DRUM_PRESETS = [
  kit('rock', 'Rock beat', 'Kick on 1 and 3, snare on 2 and 4, steady hats (LinnDrum)', 'LinnDrum', [['bd', 'x ~ ~ ~ x ~ ~ ~'], ['sd', '~ ~ x ~ ~ ~ x ~'], ['hh', 'x x x x x x x x']]),
  kit('house', 'House (four on the floor)', 'Kick on every beat, clap on 2 and 4, open hats between (TR-909)', 'RolandTR909', [['bd', 'x ~ x ~ x ~ x ~'], ['cp', '~ ~ x ~ ~ ~ x ~'], ['oh', '~ x ~ x ~ x ~ x'], ['hh', 'x x x x x x x x']]),
  kit('techno', 'Techno', 'Driving kick, off-beat open hat, busy closed hats (TR-909)', 'RolandTR909', [['bd', 'x ~ x ~ x ~ x ~'], ['oh', '~ x ~ x ~ x ~ x'], ['hh', 'x*2 x x*2 x x*2 x x*2 x'], ['cp', '~ ~ ~ ~ x ~ ~ ~']]),
  kit('hiphop', 'Boom bap (hip hop)', 'Swung-feel kick pattern with a snare on 2 and 4 (TR-808)', 'RolandTR808', [['bd', 'x ~ ~ x ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~'], ['sd', '~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~'], ['hh', 'x x x x x x x x x x x x x x x x']]),
  kit('trap', 'Trap', 'Sparse kick, snare on 3, rolling hats (TR-808)', 'RolandTR808', [['bd', 'x ~ ~ ~ ~ ~ x ~ ~ ~ x ~ ~ ~ ~ ~'], ['sd', '~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~'], ['hh', 'x x x x x x x x x x x [x x] x x [x x x] x']]),
  kit('disco', 'Disco', 'Four-on-the-floor kick, open hat on the off-beat, snare on 2 and 4 (LinnDrum)', 'LinnDrum', [['bd', 'x ~ x ~ x ~ x ~'], ['sd', '~ ~ x ~ ~ ~ x ~'], ['oh', '~ x ~ x ~ x ~ x'], ['hh', 'x x x x x x x x']]),
  kit('breakbeat', 'Breakbeat', 'Syncopated kicks with a ghosted snare (TR-707)', 'RolandTR707', [['bd', 'x ~ ~ ~ ~ ~ x ~ ~ x x ~ ~ ~ ~ ~'], ['sd', '~ ~ ~ ~ x ~ ~ ~ ~ x ~ ~ x ~ ~ ~'], ['hh', 'x ~ x ~ x ~ x ~ x ~ x ~ x ~ x ~']]),
  kit('dnb', 'Drum and bass', 'Fast two-step: kick, then snare on 2 and 4 (TR-909)', 'RolandTR909', [['bd', 'x ~ ~ ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~ ~ ~'], ['sd', '~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~'], ['hh', 'x ~ x ~ x ~ x ~ x ~ x ~ x ~ x ~']]),
  kit('reggae', 'Reggae one drop', 'Nothing on beat 1; kick and snare land together on 3 (TR-707)', 'RolandTR707', [['bd', '~ ~ ~ ~ x ~ ~ ~'], ['sd', '~ ~ ~ ~ x ~ ~ ~'], ['hh', 'x x x x x x x x']]),
  kit('electro', 'Electro', 'Booming kick, clap, crisp hats (TR-808)', 'RolandTR808', [['bd', 'x ~ ~ ~ ~ ~ x ~ x ~ ~ ~ ~ ~ ~ ~'], ['cp', '~ ~ ~ ~ x ~ ~ ~ ~ ~ ~ ~ x ~ ~ ~'], ['hh', 'x ~ x x x ~ x x x ~ x x x ~ x x']]),
];

// Ready-made tunes for the Melody Sequencer, as scale degrees (0 is the key's root, null is a rest). Loading one sets the steps and notes;
// the key and scale stay. More than 8 steps run as a longer loop at the same pace.
const tune = (id, label, tip, degrees, { len = {}, octave } = {}) => ({ id, label, tip, octave, degrees, len });
export const MELODY_TEMPLATES = [
  tune('scale-up', 'Scale up', 'Eight steps climbing the scale', [0, 1, 2, 3, 4, 5, 6, 7]),
  tune('scale-down', 'Scale down', 'Eight steps walking back down', [7, 6, 5, 4, 3, 2, 1, 0]),
  tune('arp', 'Arpeggio', 'Root, third, fifth, octave and back: the notes of a chord one at a time', [0, 2, 4, 7, 4, 2, 0, null]),
  tune('hook', 'Pop hook', 'A short, catchy phrase that repeats and resolves home', [4, 4, 5, 4, 2, 0, null, 2]),
  tune('ostinato', 'Ostinato', 'A repeating figure that rocks between the root and a neighbour', [0, null, 0, 2, null, 0, null, 4]),
  tune('bassline', 'Bass line', 'Root and fifth, low down (try a bass or sine Instrument)', [0, null, 0, null, 4, null, 3, null], { octave: 2 }),
  tune('call', 'Call and answer', 'Sixteen steps: a question that rises, then an answer that settles', [0, 2, 4, 2, 0, 2, 4, null, 4, 5, 4, 2, 1, null, 0, null]),
  tune('lullaby', 'Lullaby', 'Slow, rocking and gentle, with long notes (16 steps)', [4, null, 4, null, 2, null, 4, null, 5, null, 3, null, 2, null, 0, null], { len: { 0: 2, 4: 2, 8: 2, 12: 2 } }),
  tune('riff', 'Minor riff', 'A gritty riff that leans on the low notes (works best in a minor key)', [0, 0, null, 2, 0, null, 3, null, 0, 0, null, 4, 3, null, 2, null]),
  tune('syncopated', 'Syncopated', 'Off-beat hits that push against the pulse', [0, null, null, 2, null, 4, null, null, 3, null, 2, null, null, 0, null, null]),
];

export function resizeTracks(tracks, n) {
  return tracks.map((t) => {
    const cells = t.cells.slice(0, n), have = cells.length;
    while (cells.length < n) cells.push(have ? copyOf(t.cells[cells.length % have]) : { on: false });
    return { ...t, cells };
  });
}

export const scaleCode = (root, scale) => `${root}3:${scale.replace(/ /g, ':')}`;
const mod = (a, b) => ((a % b) + b) % b;
// What the melody grid shows: chromatic note names, or the degrees of a scale. Same interface either way.
export function pitchModel(key, octave) {
  if (!key) {
    return {
      degree: false, rows: 13, pitchAt: (i) => NOTE_NAMES[i % 12] + (octave + Math.floor(i / 12)),
      label: (i) => NOTE_NAMES[i % 12].toUpperCase(), black: (i) => NOTE_NAMES[i % 12].includes('#'),
      rank: noteRank, view: (v) => Math.min(5, Math.max(1, Math.floor(noteRank(v) / 12))),
    };
  }
  const iv = SCALES[key.scale] || SCALES.major, len = iv.length, start = (octave - 3) * len;
  const rootPc = NOTE_NAMES.indexOf(key.root.toLowerCase());
  return {
    degree: true, rows: len + 1, len, pitchAt: (i) => start + i,
    label: (i) => { const d = start + i; return `${mod(d, len) + 1} ${NOTE_NAMES[(rootPc + iv[mod(d, len)]) % 12].toUpperCase()}`; },
    black: () => false, rank: (v) => v, view: (v) => Math.min(5, Math.max(1, 3 + Math.floor(v / len))),
  };
}

// ---- repeats and brackets ----
// A step may carry x: 'rep2'..'rep4' (the step plays that many times: x*3) or 'sub2'..'sub4' (the step is split
// into that many sub-steps: [x ~ x]). Sub-steps live in cell.sub: objects shaped like the cell itself ({n,d} or {on}).
export const X_STATES = ['', 'rep2', 'rep3', 'rep4', 'sub2', 'sub3', 'sub4'];
export const parseX = (c) => { const m = /^(rep|sub)(\d)$/.exec(c.x || ''); return m ? { type: m[1], n: Number(m[2]) } : { type: '', n: 1 }; };
export const xLabel = (c) => { const x = parseX(c); return x.type === 'rep' ? '×' + x.n : x.type === 'sub' ? '[' + x.n + ']' : '–'; };
export const leafAt = (c, k) => (k < 0 || k === undefined ? c : (c.sub && c.sub[k]) || {});
export const leafHas = (leaf, deg, pitched) => (pitched ? cellNotes(leaf, deg).length > 0 : !!leaf.on);
export function stepHas(c, deg, pitched) {
  const x = parseX(c);
  if (x.type === 'sub') return Array.from({ length: x.n }, (_, k) => leafHas(leafAt(c, k), deg, pitched)).some(Boolean);
  return leafHas(c, deg, pitched);
}
// width in px of a step slot that holds n sub-buttons
export const slotWidth = (n) => (n <= 1 ? 20 : n * 14 + (n - 1) * 2);

// What the speaker / power button on a module does: 'silence' mutes a source, 'bypass' lets the sound through untouched.
export const MUTE_KIND = Object.fromEntries([
  ...['melody', 'rhythm', 'chords', 'drums', 'synth', 'sample', 'hydra', 'randnotes', 'randrhythm'].map((t) => [t, 'silence']),
  ...['fast', 'slow', 'rev', 'transpose', 'ply', 'degrade', 'euclid', 'every', 'arp', 'filter', 'delay', 'reverb', 'distortion', 'acid', 'vibrato', 'ring', 'vowel', 'djf', 'leslie', 'lofi', 'pitchenv', 'fm', 'pan', 'tremolo', 'phaser', 'chorus', 'compressor', 'orbit', 'fx', 'shuffle', 'sometimes'].map((t) => [t, 'bypass']),
]);

// FM presets: every FM knob is reset to its default and then these are applied, so a preset always sounds the same whatever was set before.
// They are starting points to hear what FM can do (the Instrument's envelope matters too: a bell wants a long release, a bass a short one).
export const FM_PRESETS = [
  { id: 'epiano', label: 'Electric piano', tip: 'a soft tone (1:1) with a bright, quick "tine" on top (harmonic 14) that fades fast', params: { index: 2, harm: 1, decay: 0.5, sustain: 0.1, index2: 0.8, harm2: 14 } },
  { id: 'bell', label: 'Bell', tip: 'an in-between harmonic (3.5) makes clangy overtones that do not line up with the note, which is what a bell sounds like', params: { index: 5, harm: 3.5, decay: 1.2, sustain: 0 } },
  { id: 'bass', label: 'Bass', tip: 'a 1:1 shake that is bright for an instant and then settles: a tight, punchy bass', params: { index: 3.5, harm: 1, decay: 0.18, sustain: 0.25, fb1: 0.1 } },
  { id: 'brass', label: 'Brass', tip: 'a 1:1 shake that stays on while the note is held, so the tone stays bright and buzzy', params: { index: 3, harm: 1, decay: 0.6, sustain: 0.7 } },
  { id: 'marimba', label: 'Marimba', tip: 'a high harmonic (4) with a very short burst of brightness: a wooden "tok"', params: { index: 2.5, harm: 4, decay: 0.12, sustain: 0 } },
  { id: 'clang', label: 'Metal clang', tip: 'a big index with two in-between harmonics: harsh, metallic and not in tune', params: { index: 9, harm: 2.75, decay: 0.5, sustain: 0, index2: 4, harm2: 1.5 } },
];
