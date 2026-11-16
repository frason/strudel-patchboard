// The learning path. Each starter is an ordinary graph built only from palette modules, so it can be rebuilt by hand.
import { makeNode, normalize, emptyGraph } from './graph.js';
import { makeCells, FM_PRESETS } from './modules.js';
import WHOLE_SONG_GRAPH from './wholesong.js';

const mel = (notes, { vel = [], len = {}, steps, octave = 3, mode = 'steps' } = {}) => {
  const n = steps || notes.length;
  const cells = makeCells('melody', n).map((c, i) => ({ n: notes[i] || null, d: null, len: len[i] || 1, vel: vel[i] ?? 1 }));
  return { steps: n, octave, mode, cells, scale: 'off' };
};
const deg = (degrees, { vel = [], len = {}, octave = 3, mode = 'steps' } = {}) => ({
  steps: degrees.length, octave, mode, scale: 'major',
  cells: degrees.map((d, i) => ({ n: null, d: d === null ? null : d, len: len[i] || 1, vel: vel[i] ?? 1 })),
});
// a drum row from text: 'x', '~', 'x*2' (repeat), '[x ~ x]' (brackets)
const trk = (name, pattern) => ({
  name, mute: false,
  cells: pattern.match(/\[[^\]]*\]|\S+/g).map((tok) => {
    if (tok.startsWith('[')) { const subs = tok.slice(1, -1).trim().split(/\s+/).map((t) => ({ on: t === 'x' })); return { on: false, x: 'sub' + subs.length, sub: subs }; }
    const m = /^x\*(\d)$/.exec(tok);
    return m ? { on: true, x: 'rep' + m[1] } : { on: tok === 'x' };
  }),
});
const rhy = (pattern, mode = 'steps') => {
  const toks = pattern.split(/\s+/);
  return { steps: toks.length, mode, cells: toks.map((t) => ({ on: t === 'x', len: 1 })) };
};

function build(nodes, wires) {
  const g = emptyGraph();
  const byKey = {};
  for (const [key, type, x, y, params] of nodes) {
    const n = makeNode(type, x, y, params);
    byKey[key] = n;
    g.nodes.push(n);
  }
  wires.forEach(([a, b, port = 'in'], i) => {
    g.wires.push({ id: 'w' + i, from: { node: byKey[a].id, port: 'out' }, to: { node: byKey[b].id, port } });
  });
  const removed = normalize(g);
  if (removed.length) throw new Error('starter has illegal wires: ' + JSON.stringify(removed.map((r) => r.reason)));
  return g;
}

export const LESSONS = [
  {
    id: 'one-drum', title: '1 · One drum sound',
    learned: 's("bd") plays the sample called bd once per cycle. $: starts a pattern; the Output module writes it for you.',
    graph: () => build([['s', 'sample', 60, 120, { name: 'bd' }], ['o', 'output', 380, 120, {}]], [['s', 'o']]),
  },
  {
    id: 'sequence', title: '2 · Sequence: one pattern after another',
    learned: 'Sequence plays its inputs one after another, one cycle each, then starts over: cat(a, b). Here the first cycle is the top Sample (bd sd, a kick then a snare) and the second cycle is the lower Sample (four hi-hats). Then it begins again. Stack plays things at the same time; Sequence plays them in turn. The "inputs" setting says how many it cycles through. Lesson 3 then looks inside the quotes.',
    graph: () => build([
      ['k', 'sample', 40, 40, { name: 'bd sd' }],
      ['h', 'sample', 40, 300, { name: 'hh hh hh hh' }],
      ['sq', 'cat', 400, 170, { n: 2 }],
      ['o', 'output', 700, 170, { bpm: 120 }],
    ], [['k', 'sq', 'in1'], ['h', 'sq', 'in2'], ['sq', 'o']]),
  },
  {
    id: 'repeats', title: '3 · Repeats and brackets',
    learned: 'Inside the quotes, bd*2 repeats a sound, and [bd sd] squeezes several sounds into one step. This tiny language is called mini-notation.',
    graph: () => build([['s', 'sample', 60, 120, { name: 'bd*2 [bd sd]' }], ['o', 'output', 380, 120, {}]], [['s', 'o']]),
  },
  {
    id: 'grid', title: '4 · The same rhythm on a grid',
    learned: 'This is the rhythm from lesson 3, drawn instead of typed. Each row of the Drum Machine is one sound and each step is an x or a rest. bd*2 is the kick on steps 1 and 3, [bd sd] puts a kick on step 5 and a snare on step 7. Open the code and you will find the same events, written as a stack of two .struct() lines. Type it when you know it, draw it when you want to see it. Click a step to change the rhythm.',
    graph: () => build([
      ['d', 'drums', 60, 100, { steps: 8, tracks: [trk('bd', 'x ~ x ~ x ~ ~ ~'), trk('sd', '~ ~ ~ ~ ~ ~ x ~')] }],
      ['o', 'output', 520, 100, { bpm: 120 }],
    ], [['d', 'o']]),
  },
  {
    id: 'layers', title: '5 · Layers: many sounds in one pattern',
    learned: 'One Sample can play several layers at once. In the pattern, a comma starts a new layer that plays at the same time as the one before. Here there are two: [bd]*4 is a kick four times, and [cp east] 808lt 808lc is a second layer of three steps, one after another: a clap with "east" squeezed into the first step, then 808lt, then 808lc (two toms). Press Start and watch each word light up in the box as it plays. Typing a beat like this is quick, but it is hard to see. Press the "→ Drum Machine" button under the pattern and the same beat appears as a grid, one row per sound, that plays exactly the same thing.',
    graph: () => build([['s', 'sample', 60, 120, { name: '[bd]*4, [cp east] 808lt 808lc', gain: 0.6 }], ['o', 'output', 440, 120, {}]], [['s', 'o']]),
  },
  {
    id: 'banks', title: '6 · Banks and chaining',
    learned: 'Methods chain with dots: .bank() picks a drum machine, .gain() sets the volume and .decay() shortens the tail. Each knob is one method.',
    graph: () => build([['s', 'sample', 60, 80, { name: 'bd sd', bank: 'RolandTR909', gain: 0.8, decay: 0.2 }], ['o', 'output', 420, 80, {}]], [['s', 'o']]),
  },
  {
    id: 'stack', title: '7 · Layering with stack()',
    learned: 'stack(a, b) plays patterns at the same time. Wiring each sound into Output separately does the same thing with $: lines.',
    graph: () => build([
      ['k', 'sample', 40, 40, { name: 'bd*2', bank: 'RolandTR909', gain: 0.6 }],
      ['h', 'sample', 40, 380, { name: 'hh*4', bank: 'RolandTR909', gain: 0.4 }],
      ['st', 'stack', 340, 170, {}],
      ['o', 'output', 600, 170, {}],
    ], [['k', 'st', 'in1'], ['h', 'st', 'in2'], ['st', 'o']]),
  },
  {
    id: 'notes', title: '8 · Notes, <> turns and fast',
    learned: 'note("c3 e3") plays pitches. Angle brackets <a b c> take one step per cycle instead of all at once, and .fast(2) doubles the speed.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c3', 'e3', 'g3', 'b3'], { mode: 'turns' })],
      ['f', 'fast', 400, 120, { n: 2 }],
      ['sy', 'synth', 640, 60, { wave: 'sawtooth', lpf: 2000 }],
      ['o', 'output', 940, 120, {}],
    ], [['m', 'f'], ['f', 'sy'], ['sy', 'o']]),
  },
  {
    id: 'filter', title: '9 · Filter, resonance, delay',
    learned: '.lpf() cuts the highs, .lpq() adds a peak at the cutoff and .delay() adds echoes. Order in the chain is the order in the signal path.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c2', null, 'c2', 'g2', null, 'c2', 'eb2', 'g2'], { octave: 2 })],
      ['sy', 'synth', 400, 60, { wave: 'sawtooth' }],
      ['f', 'filter', 700, 100, { type: 'lpf', cutoff: 700, q: 8 }],
      ['d', 'delay', 970, 100, { mix: 0.4, time: 0.25, feedback: 0.5 }],
      ['o', 'output', 1240, 100, {}],
    ], [['m', 'sy'], ['sy', 'f'], ['f', 'd'], ['d', 'o']]),
  },
  {
    id: 'sliders', title: '10 · Sliders: a live parameter',
    learned: 'A number cable replaces a knob value with something that can change: slider(...) is a number you drag while the music plays.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c2', null, 'c2', 'g2', null, 'c2', 'eb2', 'g2'], { octave: 2 })],
      ['sy', 'synth', 400, 60, { wave: 'sawtooth' }],
      ['sl', 'slider', 400, 470, { value: 960, min: 200, max: 4000 }],
      ['f', 'filter', 720, 100, { type: 'lpf', cutoff: 800, q: 6 }],
      ['o', 'output', 1000, 100, {}],
    ], [['m', 'sy'], ['sy', 'f'], ['sl', 'f', 'p:cutoff'], ['f', 'o']]),
  },
  {
    id: 'song', title: '11 · Putting it together',
    learned: 'Several $: lines play together; .every(4, rev) changes a pattern on every 4th cycle; .euclid(5,8) spreads hits evenly; .room() puts it all in a space.',
    graph: () => build([
      ['kd', 'sample', 40, 40, { name: 'bd hh sd hh', bank: 'RolandTR909', gain: 0.45 }],
      ['hh', 'sample', 40, 330, { name: 'hh', bank: 'RolandTR909', gain: 0.35 }],
      ['eu', 'euclid', 340, 330, { pulses: 5, steps: 8 }],
      ['bm', 'melody', 40, 600, mel(['c2', null, 'c2', 'g2', null, 'c2', 'eb2', 'f2'], { octave: 2 })],
      ['ev', 'every', 340, 600, { n: 4, fn: 'rev' }],
      ['bs', 'synth', 640, 600, { wave: 'sawtooth', lpf: 600, lpq: 4, gain: 0.5 }],
      ['lm', 'melody', 40, 900, mel(['e4', 'g4', 'b4', 'g4'], { octave: 4, mode: 'turns', vel: [1, 0.6, 0.8, 0.6] })],
      ['ls', 'synth', 340, 900, { wave: 'triangle', release: 0.4, gain: 0.7 }],
      ['rv', 'reverb', 640, 900, { room: 0.7, size: 4 }],
      ['o', 'output', 1000, 400, { bpm: 110 }],
    ], [['kd', 'o'], ['hh', 'eu'], ['eu', 'o'], ['bm', 'ev'], ['ev', 'bs'], ['bs', 'o'], ['lm', 'ls'], ['ls', 'rv'], ['rv', 'o']]),
  },
  {
    id: 'harmony', title: '12 · Harmony: one key for everything',
    learned: 'n("0 2 4").scale("A3:minor") writes scale degrees instead of note names. One Key module can steer several melodies, so changing the key changes them all and they always fit together.',
    graph: () => build([
      ['k', 'key', 40, 40, { root: 'A', scale: 'minor' }],
      ['lm', 'melody', 40, 240, deg([0, 2, 4, null, 7, 4, 2, null], { vel: [1, 0.7, 0.8, 1, 1, 0.7, 0.8, 1] })],
      ['ls', 'synth', 420, 240, { wave: 'triangle', release: 0.3 }],
      ['bm', 'melody', 40, 620, deg([-7, null, -7, -4], { octave: 3 })],
      ['bs', 'synth', 420, 620, { wave: 'sawtooth', lpf: 600, lpq: 3, gain: 0.8 }],
      ['o', 'output', 760, 400, { bpm: 100 }],
    ], [['k', 'lm', 'key'], ['k', 'bm', 'key'], ['lm', 'ls'], ['bm', 'bs'], ['ls', 'o'], ['bs', 'o']]),
  },
  {
    id: 'subdiv', title: '13 · Repeats and brackets in the grids',
    learned: 'x*2 plays a step twice and [x ~ x] squeezes three tiny steps into one. In the grids, the rep row sets them (shift-click a step in the Drum Machine). It is the same mini-notation as bd*2 [bd sd].',
    graph: () => build([
      ['dm', 'drums', 40, 60, { bank: 'RolandTR909', gain: 0.28, steps: 8, tracks: [trk('bd', 'x ~ ~ ~ x ~ [x x] ~'), trk('sd', '~ ~ x ~ ~ ~ x ~'), trk('hh', 'x*2 x x*3 x x*2 x [x ~ x] x')] }],
      ['o', 'output', 480, 60, {}],
    ], [['dm', 'o']]),
  },
  {
    id: 'views', title: '14 · Views: watch the music',
    learned: 'Piano Roll and Scope do not change the sound: they sit in the chain and draw what passes through them. The Piano Roll shows the notes (or drum hits) coming, scrolling past a playhead. The Scope draws the wave of one sound. Plug them in anywhere to see what a part is doing, and take them out again without changing a note. In the code they only add .pianoroll() and .analyze(1).',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c3', 'e3', 'g3', 'e3', 'c4', 'g3', 'e3', 'g3'])],
      ['sy', 'synth', 380, 60, { wave: 'sawtooth', release: 0.2, gain: 0.6 }],
      ['pr', 'pianoroll', 680, 60, {}],
      ['kk', 'sample', 40, 520, { name: 'bd*4', bank: 'RolandTR909' }],
      ['sc', 'scope', 380, 520, { style: 'wave' }],
      ['o', 'output', 1000, 300, { bpm: 110 }],
    ], [['m', 'sy'], ['sy', 'pr'], ['pr', 'o'], ['kk', 'sc'], ['sc', 'o']]),
  },
  {
    id: 'duck', title: '15 · Ducking: the kick makes room',
    learned: 'Ducking (sidechain) lowers one sound every time another one hits, so a kick drum can push a bass or pad out of its way and let it swell back. The Duck module has two inputs: "trigger" (the sound that does the pushing, usually the kick) and "ducked" (the sound that gets pushed down). Depth is how far it dips (1 is silent), attack is how long the swell back takes. In the code the trigger gets .duck("3") and the ducked sound is put on orbit 3, the mix bus that .duck() dips. This is the pumping of dance music.',
    graph: () => build([
      ['kk', 'sample', 40, 60, { name: 'bd*4', bank: 'RolandTR909' }],
      ['m', 'melody', 40, 330, mel(['g2', null, null, null], { len: { 0: 4 } })],
      ['sy', 'synth', 380, 330, { wave: 'sawtooth', attack: 0.01, sustain: 1, release: 0.2, gain: 0.5 }],
      ['d', 'duck', 700, 200, { orbit: 3, depth: 0.8, attack: 0.16 }],
      ['o', 'output', 1000, 200, { bpm: 128 }],
    ], [['kk', 'd', 'kick'], ['m', 'sy'], ['sy', 'd', 'lead'], ['d', 'o']]),
  },
  {
    id: 'trance', title: '16 · Trance: acid, ducking and views',
    learned: 'This brings together what the lessons before it introduced: a Key shared by two melodies, a Slider and a Wave moving knobs, Duck pushing the sound down on every kick, and the Piano Roll and Scope to watch it. Plus register() adds your own method (acidenv). .duck() on the kick dips whatever is on the same .orbit(), and .analyze() feeds the Scope. A break loop with fit on is stretched to fill its step. Two layers use the same Key and one rand-driven detune. In the original video the kick (tbd) and top loop come from the author\'s own sample folder, so the kick here is a TR909 and the loop is the public-domain breaks library.',
    graph: () => build([
      ['k', 'key', 40, 40, { root: 'G', scale: 'minor' }],
      ['m', 'melody', 40, 250, deg([0, 4, 0, 9, 7], { mode: 'turns' })],
      ['f', 'fast', 420, 250, { n: 16 }],
      ['t', 'transpose', 420, 420, { n: -12 }],
      ['sy', 'synth', 700, 250, { wave: 'sawtooth' }],
      ['sl', 'slider', 700, 620, { value: 0.546, min: 0, max: 1 }],
      ['ac', 'acid', 980, 250, { amount: 0.546 }],
      ['pr', 'pianoroll', 1250, 250, {}],
      ['kk', 'sample', 700, 880, { name: 'bd*4', bank: 'RolandTR909' }],
      ['sc', 'scope', 1000, 880, { style: 'wave' }],
      ['tp', 'sample', 1000, 1150, { name: 'breaks:1/2', fit: 'on', gain: 0.6 }],
      ['m2', 'melody', 40, 560, deg(Array(16).fill(0))],
      ['t2', 'transpose', 420, 560, { n: -24 }],
      ['wv', 'wave', 700, 760, { shape: 'rand', min: 0, max: 1, slow: 1 }],
      ['sy2', 'synth', 700, 560, { wave: 'supersaw' }],
      ['sl2', 'slider', 980, 760, { value: 0.717, min: 0, max: 1 }],
      ['ac2', 'acid', 980, 560, { amount: 0.717 }],
      ['pr2', 'pianoroll', 1250, 560, {}],
      ['d', 'duck', 1500, 480, { orbit: 3, depth: 0.8, attack: 0.16 }],
      ['o', 'output', 1800, 480, { bpm: 136 }],
    ], [['k', 'm', 'key'], ['m', 'f'], ['f', 't'], ['t', 'sy'], ['sy', 'ac'], ['sl', 'ac', 'p:amount'], ['ac', 'pr'], ['pr', 'd', 'lead'], ['tp', 'd', 'lead'], ['k', 'm2', 'key'], ['m2', 't2'], ['t2', 'sy2'], ['wv', 'sy2', 'p:detune'], ['sy2', 'ac2'], ['sl2', 'ac2', 'p:amount'], ['ac2', 'pr2'], ['pr2', 'd', 'lead'], ['kk', 'sc'], ['sc', 'd', 'kick'], ['d', 'o']]),
  },
  {
    id: 'instruments', title: '17 · Instruments: guitar, strings, flute',
    learned: 'Every sound is just a name in s("..."): a synth wave, a recorded piano, or a General MIDI instrument like gm_flute. Swap the name and the same notes come out on a different instrument.',
    graph: () => build([
      ['k', 'key', 40, 40, { root: 'D', scale: 'minor' }],
      ['ch', 'melody', 40, 230, { ...deg([0, null, 2, null], { mode: 'steps', len: { 0: 2, 2: 2 } }), cells: [{ n: null, d: [0, 2, 4], len: 2, vel: 0.9 }, { n: null, d: null, len: 1, vel: 1 }, { n: null, d: [-1, 1, 3], len: 2, vel: 0.9 }, { n: null, d: null, len: 1, vel: 1 }] }],
      ['st', 'synth', 420, 230, { wave: 'gm_string_ensemble_1', release: 1.2, gain: 0.7 }],
      ['ld', 'melody', 40, 640, deg([7, 6, 4, null, 6, 4, 2, null], { octave: 3 })],
      ['fl', 'synth', 420, 640, { wave: 'gm_flute', gain: 0.9 }],
      ['gt', 'melody', 40, 1040, deg([0, 4, 7, 4, 0, 4, 7, 4], { octave: 3 })],
      ['gi', 'synth', 420, 1040, { wave: 'gm_acoustic_guitar_nylon', gain: 0.8 }],
      ['o', 'output', 780, 640, { bpm: 90 }],
    ], [['k', 'ch', 'key'], ['k', 'ld', 'key'], ['k', 'gt', 'key'], ['ch', 'st'], ['ld', 'fl'], ['gt', 'gi'], ['st', 'o'], ['fl', 'o'], ['gi', 'o']]),
  },
  {
    id: 'chords', title: '18 · Chords and arpeggios',
    learned: 'chord("<Am F C G>").voicing() writes a chord progression with chord names and turns each into well-spaced notes. With a Key plugged in, the same steps are numbers (i VI III VII), so changing the key changes every chord. .arp("0 1 2 1") plays a chord one note at a time.',
    graph: () => build([
      ['k', 'key', 40, 40, { root: 'A', scale: 'minor' }],
      ['ch', 'chords', 40, 240, { steps: 4, mode: 'turns', register: 'above:c4', cells: [0, 5, 2, 6].map((i) => ({ sym: null, d: { i, ext: '' }, len: 1 })) }],
      ['ep', 'synth', 420, 240, { wave: 'gm_epiano1', release: 0.8, gain: 0.8 }],
      ['ar', 'arp', 420, 520, { style: '0 1 2 1' }],
      ['fa', 'fast', 640, 520, { n: 4 }],
      ['gt', 'synth', 860, 520, { wave: 'gm_acoustic_guitar_nylon', gain: 0.7 }],
      ['o', 'output', 1180, 380, { bpm: 90 }],
    ], [['k', 'ch', 'key'], ['ch', 'ep'], ['ch', 'ar'], ['ar', 'fa'], ['fa', 'gt'], ['ep', 'o'], ['gt', 'o']]),
  },
  // ---------- FM synthesis path ----------
  {
    id: 'fm-basics', section: 'FM synthesis', title: '19 · FM: one wave shakes another',
    learned: 'FM (frequency modulation) makes one oscillator wobble the pitch of another, so a plain sine grows new overtones. The FM module\'s "index" is how hard it shakes: 0 is a pure sine, higher is brighter and edgier. In the picture, drag the disc up or down (or fill the blue arc on its left) to change the index, and listen to the same four notes get brighter.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c3', 'e3', 'g3', 'e3'])],
      ['sy', 'synth', 400, 60, { wave: 'sine' }],
      ['fm', 'fm', 700, 60, { index: 3, harm: 1, decay: 0.3, sustain: 0.4 }],
      ['o', 'output', 1100, 140, { bpm: 100 }],
    ], [['m', 'sy'], ['sy', 'fm'], ['fm', 'o']]),
  },
  {
    id: 'fm-presets', section: 'FM synthesis', title: '20 · FM sounds side by side',
    learned: 'The same four notes, four different FM sounds, one after another (a Sequence plays one input per cycle): an electric piano, a bell, a bass and a brass. Only the FM module\'s settings differ, and a little in the Instrument\'s envelope. Click each FM module and look at its picture: the electric piano is a soft tone plus a quick high tine, the bell uses an in-between harmonic (3.5) so its overtones do not line up with the note, the bass is bright for an instant, the brass keeps its brightness while the note is held. Every FM module has a "Presets" list at the top: pick one to load a sound like these, then change it.',
    graph: () => {
      const P = (id) => ({ ...Object.fromEntries(FM_PRESETS.map((x) => [x.id, x.params]))[id] });
      return build([
        ['m', 'melody', 40, 470, mel(['c3', 'e3', 'g3', 'e3'])],
        ['s1', 'synth', 380, 40, { wave: 'sine', attack: 0.001, decay: 0.7, sustain: 0.2, release: 0.5, gain: 0.8 }],
        ['f1', 'fm', 700, 40, P('epiano')],
        ['s2', 'synth', 380, 420, { wave: 'sine', attack: 0.001, decay: 1, sustain: 0, release: 1.5, gain: 0.7 }],
        ['f2', 'fm', 700, 420, P('bell')],
        ['s3', 'synth', 380, 800, { wave: 'sine', attack: 0.001, decay: 0.3, sustain: 0.5, release: 0.15, gain: 0.8 }],
        ['f3', 'fm', 700, 800, P('bass')],
        ['s4', 'synth', 380, 1180, { wave: 'sine', attack: 0.06, decay: 0.3, sustain: 0.9, release: 0.2, gain: 0.6 }],
        ['f4', 'fm', 700, 1180, P('brass')],
        ['sq', 'cat', 1040, 620, { n: 4 }],
        ['o', 'output', 1340, 620, { bpm: 90 }],
      ], [['m', 's1'], ['m', 's2'], ['m', 's3'], ['m', 's4'], ['s1', 'f1'], ['s2', 'f2'], ['s3', 'f3'], ['s4', 'f4'],
        ['f1', 'sq', 'in1'], ['f2', 'sq', 'in2'], ['f3', 'sq', 'in3'], ['f4', 'sq', 'in4'], ['sq', 'o']]);
    },
  },
  {
    id: 'fm-harmonic', section: 'FM synthesis', title: '21 · FM harmonic: bells and basses',
    learned: 'The harmonic is the pitch of the shaking wave compared with the note. Whole numbers (1, 2, 3) keep it musical, like a bass or an electric piano. In-between values like 3.5 give clangy, inharmonic bells. Slide a disc sideways to change it: the wave drawn inside the disc shows how many times it wiggles per note.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c4', null, 'e4', null, 'g4', null, 'b4', null], { mode: 'turns' })],
      ['sy', 'synth', 400, 60, { wave: 'sine', release: 1.2 }],
      ['fm', 'fm', 700, 60, { index: 6, harm: 3.5, decay: 0.8, sustain: 0 }],
      ['m2', 'melody', 40, 500, mel(['c2', null, 'c2', 'g2'])],
      ['sy2', 'synth', 400, 500, { wave: 'sine', release: 0.2 }],
      ['fm2', 'fm', 700, 500, { index: 3, harm: 1, decay: 0.25, sustain: 0.3 }],
      ['o', 'output', 1150, 300, { bpm: 90 }],
    ], [['m', 'sy'], ['sy', 'fm'], ['fm', 'o'], ['m2', 'sy2'], ['sy2', 'fm2'], ['fm2', 'o']]),
  },
  {
    id: 'fm-envelopes', section: 'FM synthesis', title: '22 · FM envelopes: pluck and pad',
    learned: 'Two envelopes shape an FM sound. The Instrument\'s one is the loudness (attack, decay, sustain, release): drag the corners of its drawn shape. The FM module\'s decay and sustain shape the brightness: how fast the extra overtones die away. A pluck is a quick attack with the brightness falling fast. A pad fades in slowly and holds its brightness.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c3', 'e3', 'g3', 'c4'])],
      ['sy', 'synth', 400, 60, { wave: 'sine', attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 }],
      ['fm', 'fm', 700, 60, { index: 8, harm: 2, decay: 0.15, sustain: 0 }],
      ['m2', 'melody', 40, 520, mel(['c3', null, null, null], { len: { 0: 4 } })],
      ['sy2', 'synth', 400, 520, { wave: 'sine', attack: 0.5, decay: 0.3, sustain: 0.8, release: 0.8, gain: 0.7 }],
      ['fm2', 'fm', 700, 520, { index: 2, harm: 1, decay: 1, sustain: 1 }],
      ['o', 'output', 1150, 300, { bpm: 90 }],
    ], [['m', 'sy'], ['sy', 'fm'], ['fm', 'o'], ['m2', 'sy2'], ['sy2', 'fm2'], ['fm2', 'o']]),
  },
  {
    id: 'fm-stack', section: 'FM synthesis', title: '23 · A second modulator and feedback',
    learned: 'A second modulator (index 2) shakes the first one, so the chain is modulator 2 → modulator 1 → the note. More stages, more overtones: this is where growly basses come from. Feedback makes a modulator shake itself: keep it small (the gauge below about a third), or it turns to noise. In the picture, tap the dashed "+" disc to switch the second modulator on.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c2', 'c2', 'eb2', 'g2'])],
      ['sy', 'synth', 400, 60, { wave: 'sine', release: 0.15 }],
      ['fm', 'fm', 700, 60, { index: 5, harm: 1, decay: 0.4, sustain: 0.4, index2: 4, harm2: 2, fb1: 0.15, fb2: 0.1 }],
      ['o', 'output', 1100, 140, { bpm: 100 }],
    ], [['m', 'sy'], ['sy', 'fm'], ['fm', 'o']]),
  },
  {
    id: 'fm-orbits', section: 'FM synthesis', title: '24 · FM parts, each on its own orbit',
    learned: 'Reverb and delay are shared by everything on the same orbit (mix bus). Give each part its own orbit, and a part\'s reverb stays its own: here the bell is on orbit 1 with a big reverb, and the bass on orbit 2 stays dry. This is how a four-part FM patch keeps its parts from blurring together.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c4', null, 'e4', null, 'g4', null, 'b4', null], { mode: 'turns' })],
      ['sy', 'synth', 400, 60, { wave: 'sine', release: 1.2 }],
      ['fm', 'fm', 700, 60, { index: 6, harm: 3.5, decay: 0.8, sustain: 0 }],
      ['rv', 'reverb', 1000, 60, { room: 0.8 }],
      ['ob', 'orbit', 1300, 60, { n: 1 }],
      ['m2', 'melody', 40, 560, mel(['c2', 'c2', 'eb2', 'g2'])],
      ['sy2', 'synth', 400, 560, { wave: 'sine', release: 0.15 }],
      ['fm2', 'fm', 700, 560, { index: 5, harm: 1, decay: 0.4, sustain: 0.4, index2: 4, harm2: 2 }],
      ['ob2', 'orbit', 1000, 560, { n: 2 }],
      ['o', 'output', 1600, 300, { bpm: 90 }],
    ], [['m', 'sy'], ['sy', 'fm'], ['fm', 'rv'], ['rv', 'ob'], ['ob', 'o'], ['m2', 'sy2'], ['sy2', 'fm2'], ['fm2', 'ob2'], ['ob2', 'o']]),
  },
  {
    id: 'fm-routing', section: 'FM synthesis', title: '25 · Four operators and routing',
    learned: 'The FM module has four modulators. In the "tune" view they stack in a chain: 4 shakes 3, 3 shakes 2, 2 shakes 1, and 1 shakes the note. Switch to the "routes" view to wire them any way you like: drag from one disc to another to connect them, drag the dot on an arrow up or down for how hard it shakes, and tap a disc to turn its feedback on or off. This patch is a soft, glassy plucked tone: every harmonic is a whole number (1, 2, 3, 4) and the indexes get smaller up the chain, so each modulator adds a little brightness that fades quickly. Try adding a route from modulator 3 straight to the note, or turning on feedback on a disc, and listen to what changes. An orange ring on a disc is its feedback; the number on an arrow is how hard it shakes. A modulator that nothing hears has no effect, so a route only matters once its target is connected onward.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c3', 'eb3', 'g3', 'bb3', 'c4', 'bb3', 'g3', 'eb3'])],
      ['sy', 'synth', 400, 60, { wave: 'sine', attack: 0.001, decay: 0.5, sustain: 0.2, release: 0.5, gain: 0.7 }],
      ['fm', 'fm', 700, 60, { index: 2, harm: 1, decay: 0.45, sustain: 0.15, index2: 1.2, harm2: 2, index3: 0.8, harm3: 3, index4: 0.6, harm4: 4 }],
      ['rv', 'reverb', 1000, 60, { room: 0.5 }],
      ['o', 'output', 1300, 140, { bpm: 100 }],
    ], [['m', 'sy'], ['sy', 'fm'], ['fm', 'rv'], ['rv', 'o']]),
  },
  // ---------- mixing and control ----------
  {
    id: 'fx-rack', section: 'Mixing and control', title: '26 · The effects rack',
    learned: 'The Effects module is a rack: reverb, delay, chorus, distortion, phaser and tremolo in one place. Tap a tile\'s name to switch it on or off, and drag across its bar for how much. Only the tiles that are on write code, in the order the rack lists them (.room(), .delay() ...). Here a music box gets a big reverb, an echo and a little chorus. Switch the tiles off one at a time to hear what each adds, then try the tremolo and the phaser.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['e4', 'g4', 'a4', 'b4', 'a4', 'g4', 'e4', 'd4'], { vel: [1, 0.7, 0.8, 1, 0.7, 0.8, 0.9, 0.7] })],
      ['sy', 'synth', 400, 60, { wave: 'gm_music_box', release: 0.6, gain: 0.8 }],
      ['fx', 'fx', 700, 60, { reverb_on: true, reverb: 0.6, delay_on: true, delay: 0.35, chorus_on: true }],
      ['o', 'output', 1100, 140, { bpm: 96 }],
    ], [['m', 'sy'], ['sy', 'fx'], ['fx', 'o']]),
  },
  {
    id: 'mixer', section: 'Mixing and control', title: '27 · The mixer: faders, pan, mute and solo',
    learned: 'The Mixer is a Stack with a strip for each input, in the colour of its jack. A fader writes .postgain(): it scales the part after its effects, so the part keeps its own balance (1 is unchanged). Pan writes .pan(). Mute leaves a strip out, and solo leaves out every strip that is not solo. Try soloing the bass, then the drums.',
    graph: () => build([
      ['k', 'sample', 40, 40, { name: 'bd*2', bank: 'RolandTR909', gain: 0.7 }],
      ['bm', 'melody', 40, 330, mel(['c2', null, 'c2', 'g2', null, 'c2', 'eb2', 'f2'], { octave: 2 })],
      ['bs', 'synth', 380, 330, { wave: 'sawtooth', lpf: 600, lpq: 4, gain: 0.6 }],
      ['lm', 'melody', 40, 640, mel(['e4', 'g4', 'b4', 'g4'], { octave: 4, mode: 'turns' })],
      ['ls', 'synth', 380, 640, { wave: 'triangle', release: 0.4, gain: 0.6 }],
      ['mx', 'mixer', 720, 300, { n: 3, strips: [{ vol: 0.9, pan: 0.5, mute: false, solo: false }, { vol: 0.7, pan: 0.5, mute: false, solo: false }, { vol: 0.6, pan: 0.7, mute: false, solo: false }, ...Array.from({ length: 3 }, () => ({ vol: 1, pan: 0.5, mute: false, solo: false }))] }],
      ['o', 'output', 1100, 300, { bpm: 110 }],
    ], [['k', 'mx', 'in1'], ['bm', 'bs'], ['bs', 'mx', 'in2'], ['lm', 'ls'], ['ls', 'mx', 'in3'], ['mx', 'o']]),
  },
  {
    id: 'macro', section: 'Mixing and control', title: '28 · Macro: one control for many knobs',
    learned: 'A Macro is one number from 0 to 1 that you plug into several knobs. In "sweep" mode it moves each knob across that knob\'s own whole range: here one macro sets the FM index (0 to 16) and the reverb (0 to 1) together. In "multiply" mode it scales whatever each knob is set to, which keeps balance, so it suits volume across several parts. Move the macro while it plays.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c3', 'e3', 'g3', 'e3'])],
      ['sy', 'synth', 400, 60, { wave: 'sine', release: 0.3 }],
      ['fm', 'fm', 700, 60, { index: 3, harm: 2, decay: 0.4, sustain: 0.4 }],
      ['rv', 'reverb', 1000, 60, { room: 0.3 }],
      ['mc', 'macro', 700, 440, { value: 0.3, mode: 'sweep' }],
      ['o', 'output', 1300, 140, { bpm: 100 }],
    ], [['m', 'sy'], ['sy', 'fm'], ['fm', 'rv'], ['rv', 'o'], ['mc', 'fm', 'p:index'], ['mc', 'rv', 'p:room']]),
  },
  // ---------- randomness ----------
  {
    id: 'random-notes', section: 'Randomness', title: '29 · Random notes and rhythm',
    learned: 'Random Notes writes a melody for you: every step is a random note of the scale (irand picks a step number, scale turns it into a note), and it picks again on every cycle. Random Rhythm does the same for when things happen: density is how likely each step is to hit. Freeze (1 and up) takes one variation and repeats it forever, which is how you keep a random line you like. A Key plugged in changes the scale of every random melody at once.',
    graph: () => build([
      ['k', 'key', 40, 40, { root: 'D', scale: 'dorian' }],
      ['rn', 'randnotes', 340, 40, { steps: 8, range: 7, octave: 3, loop: 0 }],
      ['sy', 'synth', 700, 40, { wave: 'triangle', release: 0.3, gain: 0.5 }],
      ['rr', 'randrhythm', 340, 380, { steps: 8, density: 0.6, loop: 0 }],
      ['hh', 'sample', 700, 380, { name: 'hh', bank: 'RolandTR909', gain: 0.4 }],
      ['kk', 'sample', 700, 660, { name: 'bd*4', bank: 'RolandTR909', gain: 0.45 }],
      ['o', 'output', 1060, 300, { bpm: 110 }],
    ], [['k', 'rn', 'key'], ['rn', 'sy'], ['sy', 'o'], ['rr', 'hh'], ['hh', 'o'], ['kk', 'o']]),
  },
  {
    id: 'shuffle-sometimes', section: 'Randomness', title: '30 · Shuffle and sometimes',
    learned: 'Shuffle cuts a pattern into slices and plays them in a new order every cycle (scramble may repeat or skip slices). Sometimes changes only some of the events, picked at random: here about one note in three jumps up an octave. Both are transformers, so they work on any melody or rhythm you write. Freeze picks one variation and repeats it.',
    graph: () => build([
      ['m', 'melody', 40, 60, mel(['c3', 'e3', 'g3', 'b3', 'g3', 'e3', 'd3', 'f3'])],
      ['sh', 'shuffle', 400, 60, { mode: 'shuffle', n: 4, loop: 0 }],
      ['so', 'sometimes', 700, 60, { p: 0.35, fn: 'up12', loop: 0 }],
      ['sy', 'synth', 1000, 60, { wave: 'sawtooth', lpf: 1800, release: 0.2, gain: 0.55 }],
      ['o', 'output', 1360, 140, { bpm: 100 }],
    ], [['m', 'sh'], ['sh', 'so'], ['so', 'sy'], ['sy', 'o']]),
  },
  {
    id: 'whole-song', section: 'A whole song', title: '31 · A whole song, with four new tricks',
    learned: 'Four parts play together: a vibraphone melody (the "Melody" group), a sitar that writes a new tune every four cycles, supersaw chords and a drum beat made from three Sample and Rhythm pairs. It brings in things that have not come up yet. Euclid spreads 5 hits as evenly as it can over 8 steps, so the vibraphone gets a lopsided groove without drawing it. Ring modulation multiplies a sound by a tone (here 1376 Hz), which turns it metallic and bell-like. Vibrato wobbles the pitch of the chords, and the filter\'s env knob lets the filter open and close over each note, a quick wah on every chord. Try muting a part, or turn Euclid to 8 and hear the groove go square. It is a busy patch with long releases and a big reverb: if your computer struggles, shorten a release or turn Animations off in Settings.',
    graph: () => JSON.parse(JSON.stringify(WHOLE_SONG_GRAPH)),
  },
];

export const lessonGraph = (id) => LESSONS.find((l) => l.id === id)?.graph();
