// Bring-your-own-key AI helper. The key lives only in this browser (localStorage) and is sent only to api.anthropic.com.
// Two jobs: write a starter patch from a description, and review the current patch. Both return Strudel code, which then goes
// through the normal importer (so anything the modules cannot express is listed, never guessed) and its preview dialog.
const KEY = 'pb.ai';
export const AI_MODELS = [
  ['claude-sonnet-5-5', 'Sonnet 5.5 (good balance)'],
  ['claude-haiku-5-5', 'Haiku 5.5 (fastest, cheapest)'],
  ['claude-opus-5-5', 'Opus 5.5 (best, costs more)'],
];
export function getAI() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return { key: v.key || '', model: AI_MODELS.some(([m]) => m === v.model) ? v.model : AI_MODELS[0][0] }; } catch { return { key: '', model: AI_MODELS[0][0] }; }
}
export function setAI(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } }
export function clearAI() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

const SUBSET = `The editor can only read a small part of Strudel back into modules, so stay inside it:
- First line: setcpm(BPM/4). Then each part on its own line starting with "$:".
- Sounds: s("bd sd hh") with .bank("RolandTR909") (banks: RolandTR808, RolandTR909, RolandTR707, LinnDrum, AkaiLinn, CasioRZ1, KorgM1); drums bd sd hh oh cp rim. Synth waves for s(): sine sawtooth square triangle supersaw. Instruments: gm_ names such as gm_acoustic_bass, gm_electric_piano_1, gm_vibraphone, gm_string_ensemble_1, gm_flute, gm_sitar; also piano.
- Notes: note("c3 e3 g3") or n("0 2 4").scale("C3:minor"); chords: chord("<Am F C G>").mode("above:c3").voicing(). Mini-notation: ~ rest, [a b] squeeze, a*2 repeat, <a b> one per cycle, @2 hold.
- Rhythm: s("bd").struct("x ~ x ~"). Combine: stack(a, b), cat(a, b).
- Transforms: .fast(n) .slow(n) .rev() .euclid(5,8) .every(4, x=>x.transpose(12)) .sometimesBy(0.3, rev) .shuffle(4) .degrade()
- Shaping: .gain .pan .attack .decay .sustain .release .lpf .hpf .lpq .room .roomsize .delay .delaytime .delayfeedback .vib .vibmod .ring .distort. FM (.fm, .fmh) only works on synth waves (sine, sawtooth...), never on gm_ instruments or samples.
Do not use anything else (no samples() calls, no await, no custom functions, no .p, no .piano() helpers).`;

export const STARTER_SYSTEM = `You write live-coding music in Strudel (strudel.cc) for a visual patch editor that turns the code into modules.
${SUBSET}
Make it musical and not too loud: at most 4 parts, gain around 0.4 to 0.8 per part, short releases (under 1.5), modest reverb (room under 0.5).
Reply with ONLY one fenced \`\`\`js code block, no explanation.`;

export const REVIEW_SYSTEM = `You are a friendly music and sound-design coach for people learning Strudel in a visual patch editor.
You are given the current patch as Strudel code, any warnings the editor raised, and what the editor measured about the sound (clipping, overload).
Reply in plain language for a beginner: first what is good (one or two lines), then up to four concrete problems or improvements, most important first, each with the exact change to make (the module or the code to edit and a number). Think about loudness and clipping, too many long notes or big reverbs (they make the browser struggle), muddy low end, parts fighting for the same register, and rhythm that does not groove.
If you suggest a changed version, give the WHOLE patch once in a fenced \`\`\`js block that stays inside this subset:
${SUBSET}
Keep the whole reply under 300 words plus the optional code block.`;

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
