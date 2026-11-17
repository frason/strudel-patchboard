// Bring-your-own-key AI helper. The key is sent only to api.anthropic.com.
// Two jobs: write a starter patch from a description, and review the current patch. Both return Strudel code, which then goes
// through the normal importer (so anything the modules cannot express is listed, never guessed) and its preview dialog.
// The key is kept in memory only (this tab, until it is closed or reloaded). Storing it in the browser is an explicit choice ("remember"), because anything
// that can run script on this page can read browser storage.
const KEY_STORE = 'pb.aiKey', MODEL_STORE = 'pb.aiModel', LEGACY = 'pb.ai';
export const AI_MODELS = [
  ['claude-sonnet-5-5', 'Sonnet 5.5 (good balance)'],
  ['claude-haiku-5-5', 'Haiku 5.5 (fastest, cheapest)'],
  ['claude-opus-5-5', 'Opus 5.5 (best, costs more)'],
];
const okModel = (m) => (AI_MODELS.some(([x]) => x === m) ? m : AI_MODELS[0][0]);
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
let mem = { key: '', model: okModel(lsGet(MODEL_STORE)) };
let migrated = false;
{ // older versions stored the key in plain text: remove it (the model choice is kept); the key is asked for again, with the option to remember it
  const old = lsGet(LEGACY);
  if (old !== null) {
    try { const v = JSON.parse(old); if (v && v.model) { mem.model = okModel(v.model); lsSet(MODEL_STORE, mem.model); } migrated = !!(v && v.key); } catch { /* damaged: just remove it */ }
    lsDel(LEGACY);
  }
  const kept = lsGet(KEY_STORE);
  if (kept) mem.key = kept;
}
export const consumeAiNotice = () => { const m = migrated; migrated = false; return m; };
export function getAI() { return { key: mem.key, model: mem.model, remembered: lsGet(KEY_STORE) !== null }; }
export function setAI({ key, model, remember = false }) {
  mem = { key: String(key || '').trim(), model: okModel(model) };
  lsSet(MODEL_STORE, mem.model);
  if (remember && mem.key) lsSet(KEY_STORE, mem.key); else lsDel(KEY_STORE);
}
export function clearAI() { mem.key = ''; lsDel(KEY_STORE); lsDel(LEGACY); }

const SUBSET = `The editor can only read a small part of Strudel back into modules, so stay inside it:
- First line: setcpm(BPM/4). Then each part on its own line starting with "$:".
- Sounds: s("bd sd hh") with .bank("RolandTR909") (banks: RolandTR808, RolandTR909, RolandTR707, LinnDrum, AkaiLinn, CasioRZ1, KorgM1); drums bd sd hh oh cp rim. Synth waves for s(): sine sawtooth square triangle supersaw pulse (shape it with .pw .pwrate .pwsweep). Instruments: gm_ names such as gm_acoustic_bass, gm_electric_piano_1, gm_vibraphone, gm_string_ensemble_1, gm_flute, gm_sitar; also piano.
- Notes: note("c3 e3 g3") or n("0 2 4").scale("C3:minor"); chords: chord("<Am F C G>").mode("above:c3").voicing(). Mini-notation: ~ rest, [a b] squeeze, a*2 repeat, <a b> one per cycle, @2 hold.
- Rhythm: s("bd").struct("x ~ x ~"). Combine: stack(a, b), cat(a, b).
- Transforms: .fast(n) .slow(n) .late(0.02) (nudge later, in cycles; negative = earlier) .clip(0.5) (note length as a multiple of the step; legato is the same) .swingBy(1/3, 4) (swing feel) .rev() .euclid(5,8) .every(4, x=>x.transpose(12)) .sometimesBy(0.3, rev) .shuffle(4) .degrade()
- Shaping: .gain .pan .attack .decay .sustain .release .lpf .hpf .lpq .lpenv .room .roomsize .delay .delaytime .delayfeedback .vib .vibmod .distort .crush .phaser .vowel .detune (supersaw). FM (.fm, .fmh) only works on synth waves (sine, sawtooth...), never on gm_ instruments or samples.
Do not use anything else (no samples() calls, no await, no custom functions, no .p, no .piano() helpers).`;

// A finished song in the allowed subset, for the AI to copy the shape of. A test checks it imports with nothing skipped and plays.
export const EXAMPLE = `setcpm(135/4)

$: arrange(
  [8, stack(
    s("bd ~ ~ bd ~ ~ bd ~ ~ ~ bd ~ ~ ~ ~ ~").bank("RolandTR909").gain(0.7),
    s("~ ~ ~ ~ cp ~ ~ ~ ~ ~ ~ ~ cp ~ ~ ~").bank("RolandTR909").gain(0.5).room(0.2),
    s("hh ~ hh hh ~ hh ~ hh hh ~ hh ~ hh hh ~ hh").bank("RolandTR909").gain(0.35).hpf(7000),
    note("<a1 a1 f1 g1>").s("sine").lpf(160).release(0.3).gain(0.7)
  )],
  [8, stack(
    chord("<Am F C G>").mode("above:c3").voicing().s("supersaw").detune(0.5).attack(1.2).release(2).lpf(1800).room(0.8).roomsize(4).distort(0.15).gain(0.5),
    note("<a1 f1 c2 g1>").s("sine").lpf(140).attack(0.4).release(2).gain(0.6)
  )]
)`;

const STYLE_GUIDE = `How to turn a description into this patch:
- Tempo: UK garage and 2-step 128-140 BPM; house 120-128; techno 125-140; trance 130-145; dubstep 140 (half-time feel); drum and bass 170-175; hip hop 80-95; lo-fi 70-90; ambient 60-90. If the description gives a BPM, use exactly that. setcpm(BPM/4) makes one cycle one 4-beat bar.
- Drum strings: 16 steps in one string is one bar of 16th notes. Four-on-the-floor kick = a hit every 4th step. 2-step / garage = kick on the first beat and a skipped kick just before beat 3, clap or snare on beats 2 and 4, hats that skip some 16ths (syncopated), quiet ghost hits (rim, perc) in the gaps. Metallic percussion = hats, rim, cowbell (cb), perc from RolandTR707/808 with .hpf(2000 or more).
- Warm detuned chord swell / pad: chord("<Am F C G>").mode("above:c3").voicing().s("supersaw").detune(0.4 to 0.7).attack(0.8 to 1.5).release(1.5 to 3).lpf(1200 to 2500).room(0.6 to 0.8).roomsize(3 to 5), plus .distort(0.1 to 0.2) for tape-like saturation. Supersaw is the polyphonic detuned synth: use it whenever the description says detuned, lush, warm, analog, swell or pad.
- Sub-bass: note("<a1 f1 c2 g1>").s("sine").lpf(120 to 180), gain 0.6 to 0.8. A growling bass: .s("sawtooth") with .lpf(300 to 600).
- Keys and plucks: s("piano"), gm_electric_piano_1, gm_vibraphone, gm_music_box. Grit or lo-fi: .crush(10 to 13). Movement: .phaser(0.4), .room(0.4).
- Structure: build the song with arrange([cycles, section], ...). Each section is a stack(...) of its parts; leave a part out of a section instead of muting it. "Halfway through, the drums drop out" means two sections (e.g. 8 cycles with drums, then 8 cycles of the swell without them). Typical shapes: intro 4-8 cycles, groove 8-16, drop or breakdown 8-16, outro 4-8; at most 6 sections. Never fake sections with cat() and .slow(), and never use gain(0) or silent placeholder parts.
- Mood: euphoric, sunrise or emotional = long attacks, long releases, big reverb, chords that move every cycle, an opening filter; dark or tense = minor, low, short, dry; nostalgic 90s rave = detuned saw stabs, piano chords, breakbeats.
- Words and singing cannot be made here (there are no vocal samples). For a vocal colour use .vowel("a e o") on a sawtooth, and say in LIMITS that the actual words are missing. A song title is only a loose hint: you cannot hear it, so rely on the description.`;

const REPLY_FORMAT = `Reply in exactly this shape and nothing else:
PLAN: three to five short lines: the key and tempo, the sections with their lengths, which sound plays each role, and how the mood in the description is achieved.
Then one fenced js code block with the whole patch.
LIMITS: one line naming anything the description asks for that this editor cannot do (for example real vocal samples or an exact melody), or "none".`;

export const STARTER_SYSTEM = `You write live-coding music in Strudel (strudel.cc) for a visual patch editor that turns the code into modules. A person describes the sound they want; your job is to get as close to that sound as this editor allows.
${SUBSET}
- Sections: arrange([8, stack(...)], [8, stack(...)]) is allowed (whole numbers of cycles, each section a pattern or stack(...); up to 6 sections).
Keep the mix modest: gain around 0.3 to 0.8 per part, at most 6 parts playing at once, short or medium releases except for deliberate swells, and no reverb above room 0.9.
${STYLE_GUIDE}
Here is a complete example of the shape of a good answer (a different song):
\`\`\`js
${EXAMPLE}
\`\`\`
${REPLY_FORMAT}`;

export const REFINE_SYSTEM = `You change an existing live-coding patch in Strudel (strudel.cc) for a visual patch editor, exactly as the person asks, keeping everything else as it is.
${SUBSET}
- Sections: arrange([8, stack(...)], [8, stack(...)]) is allowed.
${STYLE_GUIDE}
Make the smallest change that does what was asked, but make it clearly audible (a real change of pattern, level or sound, not a tiny tweak). Return the WHOLE updated patch.
Reply in exactly this shape: PLAN: one or two lines on what you changed and why; then one fenced js code block with the whole patch; then LIMITS: one line (or "none").`;

export const REVIEW_SYSTEM = `You are a friendly music and sound-design coach for people learning Strudel in a visual patch editor.
You are given the current patch as Strudel code, any warnings the editor raised, and what the editor measured about the sound (clipping, overload).
Reply in plain language for a beginner: first what is good (one or two lines), then up to four concrete problems or improvements, most important first, each with the exact change to make (the module or the code to edit and a number). Think about loudness and clipping, too many long notes or big reverbs (they make the browser struggle), muddy low end, parts fighting for the same register, and rhythm that does not groove.
If you suggest a changed version, give the WHOLE patch once in a fenced \`\`\`js block that stays inside this subset:
${SUBSET}
Keep the whole reply under 300 words plus the optional code block.`;

// "PLAN: ... ```js ... ``` LIMITS: ..." -> the three parts
export function parseReply(text) {
  const t = text || '';
  const plan = (/PLAN:\s*([\s\S]*?)(?=```|LIMITS:|$)/i.exec(t)?.[1] || '').trim();
  const limits = (/LIMITS:\s*([^\n]*)/i.exec(t)?.[1] || '').trim();
  return { plan, code: extractCode(t), limits: /^none\.?$/i.test(limits) ? '' : limits };
}

// Things that make a starter sound unlike the description. Pure: the caller adds the editor's own complaints (unreadable lines, warnings).
export function lintStarter(code, desc = '') {
  const out = [];
  if (/\bgain\(\s*0\s*\)/.test(code)) out.push('A part uses gain(0) as a silent placeholder. Leave a part out of a section instead of muting it.');
  if (/\bcat\(/.test(code) && /\.slow\(\s*[2-9]/.test(code) && !/arrange\(/.test(code)) out.push('Sections are faked with cat() and .slow(). Use arrange([cycles, section], ...) for the structure.');
  if (/(halfway|half way|then\b|drop|build|breakdown|first half|second half|section|intro|outro|changes? to)/i.test(desc) && !/arrange\(/.test(code)) out.push('The description has a change over time, but there is no arrange(). Use arrange() with one stack(...) per section.');
  const bpm = /(\d{2,3})\s*bpm/i.exec(desc)?.[1], cpm = /setcpm\(\s*(\d+(?:\.\d+)?)\s*\/\s*4\s*\)/.exec(code)?.[1];
  if (bpm && (!cpm || Math.abs(Number(cpm) - Number(bpm)) > 2)) out.push(`The description says ${bpm} BPM, so the first line must be setcpm(${bpm}/4).`);
  if (/(detun|supersaw|polyphon|lush|warm|analog|analogue|swell|pad)/i.test(desc) && !/supersaw|gm_pad|gm_choir|gm_string|sawtooth/.test(code)) out.push('The description asks for a lush, detuned or warm synth: use s("supersaw") with .detune() and a slow .attack().');
  if (!/setcpm\(/.test(code)) out.push('The first line must be setcpm(BPM/4).');
  return out;
}

export const extractCode = (text) => { const m = /```(?:js|javascript|strudel)?\s*\n([\s\S]*?)```/i.exec(text || ''); return m ? m[1].trim() : ''; };
export const stripCode = (text) => (text || '').replace(/```[\s\S]*?```/g, '').trim();

export function reviewPrompt({ code, issues = [], measured = [] }) {
  return `Current patch:\n\`\`\`js\n${code}\n\`\`\`\n\nEditor warnings: ${issues.length ? issues.join(' | ') : 'none'}\nMeasured: ${measured.length ? measured.join('; ') : 'nothing unusual'}`;
}

export async function askAI({ system, user, maxTokens = 2500 }) {
  const { key, model } = getAI();
  if (!key) throw new Error('Add your API key first.');
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    });
  } catch { throw new Error('Could not reach Anthropic. Check your connection (or an ad blocker).'); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const why = data?.error?.message || res.statusText;
    if (res.status === 401) throw new Error('Anthropic did not accept that key (401). Check it, or make a new one.');
    if (res.status === 429) throw new Error('Rate limit or spending limit reached (429): ' + why);
    throw new Error(`Anthropic said ${res.status}: ${why}`);
  }
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!text) throw new Error('The answer was empty. Try again.');
  return text;
}
