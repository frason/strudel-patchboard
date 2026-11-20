import { wake as wakeAnims } from './anim.js';
import './style.css';
// A pinch on a trackpad arrives as ctrl + wheel. The board zooms itself; whatever it does not handle must never zoom the whole page (that hides the top bar).
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
if (import.meta.env.DEV) import('./capture.js');   // developer-only audio capture; stripped from the build
import { createStore, storage } from './store.js';
import { createBoard, buildPalette, h, openSoundPicker } from './board.js';
import { createCodePanel } from './codepanel.js';
import { createEngine } from './engine.js';
import { createViews } from './views.js';
import { icon } from './icons.js';
import { presetCells } from './chords.js';
import { getPrefs, setPref, onPrefs, DEFAULT_PREFS } from './prefs.js';
import { loadCatalog, onCatalog, soundsFor, sampleItems, SAMPLE_CATS } from './catalog.js';
import { INSTRUMENTS, CATEGORIES as INST_CATS } from './instruments.js';
import { compile, EMPTY_NOTE } from './compile.js';
import { strudelFile, parseImport, b64 } from './io.js';
import { importStrudel } from './importer.js';
import { numberTarget } from './codenums.js';
import { applyCodeEdit } from './reconcile.js';
import { tapBpm } from './tap.js';
import { queryPatch, layoutSnapshot, drawSnapshot } from './snapshot.js';
import { patchText, checkSync } from './textsync.js';
import { LESSONS } from './starters.js';
import { patternToDrums } from './todrums.js';
import { CONVERTERS } from './convert.js';
import { openRecorder } from './recordui.js';
import { mergeGraph } from './recorder.js';
import { noteName } from './takecode.js';
import { parseMidi, pickGrid, isMidiFile } from './midifile.js';
import { cleanParams } from './validate.js';
import { getAI, setAI, clearAI, consumeAiNotice, AI_MODELS, askAI, extractCode, stripCode, reviewPrompt, parseReply, lintStarter, STARTER_SYSTEM, REFINE_SYSTEM, REVIEW_SYSTEM } from './ai.js';
import { defaultParams, FM_ALGORITHMS, fmLinkKey, SCALES, MELODY_TEMPLATES, DRUM_PRESETS, FM_PRESETS, SOMETIMES_FNS, EVERY_FNS, pitchModel, X_STATES, parseX, leafAt, stepHas, CATEGORIES, MODULES, MUTE_KIND, NOTE_NAMES, MAX_TRACKS, resizeTracks, resizeCells, fmt, cellNotes, noteRank } from './modules.js';
import { effectiveKey, makeNode, nodeById, wiresFrom, wiresInto, uid, validateShape, normalize, whyNot, clone, insertPlan } from './graph.js';

// Link to this app's source code (the AGPL asks public copies to offer it). Fill in once the repository exists.
const SOURCE_URL = 'https://github.com/frason/strudel-patchboard';

// ---------- state ----------
storage.capturePrevious(); // before the first autosave of this session overwrites it
const saved = storage.autosaved();
let startGraph;
let firstLesson = null;
try {
  if (saved) { startGraph = validateShape(saved); normalize(startGraph); }
} catch { startGraph = null; }
const droppedAtStart = startGraph && startGraph.dropped && startGraph.dropped.length ? startGraph : null;
if (!startGraph) { firstLesson = LESSONS[0]; startGraph = firstLesson.graph(); }

const store = createStore(startGraph);
setTimeout(() => { if (consumeAiNotice()) toast('For safety, saved API keys are no longer kept by default. If you use the AI helper, paste your key again (tick "Remember on this device" to keep it).', [], 14000); }, 1200);
setTimeout(() => droppedAtStart && noteDropped(droppedAtStart), 800);
const engine = createEngine();
if (import.meta.env.DEV) { window.__engine = engine; window.__lessons = () => LESSONS.map((l) => ({ title: l.title, code: compile(l.graph()).code })); }   // developer-only, for audio capture experiments
let showNotes = localStorage.getItem('pb.notes') !== '0';
let evaluated = { code: '', segments: [] };
let current = compile(store.graph);

// ---------- layout ----------
const app = document.getElementById('app');
const playBtn = h('button', { class: 'play-btn', id: 'play', title: 'Start (Space)', 'aria-label': 'Start' });
function setPlayUI(on) { playBtn.replaceChildren(icon(on ? 'stop' : 'play', 20)); playBtn.classList.toggle('on', on); playBtn.title = on ? 'Stop (Space)' : 'Start (Space)'; playBtn.setAttribute('aria-label', on ? 'Stop' : 'Start'); }
setPlayUI(false);
const statusEl = h('span', { class: 'status', id: 'status' }, 'ready');
const scopeCv = h('canvas', { class: 'out-scope', id: 'out-scope', width: 280, height: 64, title: 'The sound coming out, live (before the limiter). A pure tone is a smooth wave; flat tops mean the sound is too loud and is clipping.' });
const overEl = h('span', { class: 'over', id: 'over', title: 'The sound went past full volume a moment ago: turn the Output volume or a loud part down', hidden: true }, 'over');
const busyEl = h('span', { class: 'over busy', id: 'busy', title: 'The computer could not keep up and the sound broke up a moment ago. Fewer voices will fix it: shorter release times, a smaller reverb room, fewer layers, or turn Animations off in Settings.', hidden: true }, 'overloaded');
// ---- live output waveform in the top bar ----
const scopeBuf = new Float32Array(1024);
let scopeRaf = null;
function drawOutScope() {
  scopeRaf = null;
  const ctx = scopeCv.getContext('2d'), W = scopeCv.width, H = scopeCv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#2a3440'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  const live = engine.playing && engine.waveform(scopeBuf);
  if (live) {
    let s0 = 0; for (let i = 1; i < 512; i++) if (scopeBuf[i - 1] <= 0 && scopeBuf[i] > 0) { s0 = i; break; }   // start on a rising zero crossing so a steady tone holds still
    let pk = 0; for (let i = 0; i < scopeBuf.length; i++) pk = Math.max(pk, Math.abs(scopeBuf[i]));
    ctx.strokeStyle = pk > 1 ? '#ff6b6b' : '#f3c9a0'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let x = 0; x < W; x++) { const v = Math.max(-1.2, Math.min(1.2, scopeBuf[s0 + Math.floor((x * 512) / W)])); const y = H / 2 - v * (H / 2 - 5); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  }
  if (live || engine.playing) scopeRaf = requestAnimationFrame(drawOutScope);
}
const syncOutScope = () => {
  const on = getPrefs().outScope !== false && getPrefs().animations !== false;
  scopeCv.style.display = getPrefs().outScope === false ? 'none' : '';
  if (on && !scopeRaf) scopeRaf = requestAnimationFrame(drawOutScope);
  if (!on) { cancelAnimationFrame(scopeRaf); scopeRaf = null; scopeCv.getContext('2d').clearRect(0, 0, scopeCv.width, scopeCv.height); }
};
let lastOver = 0, lastBusy = 0, seenUnder = null, seenLate = 0, lastLate = 0;
// page stalls: the page did nothing for a moment (a heavy task, a throttled tab). While notes are playing, a stall of a fifth of a second makes Strudel skip notes.
const stalls = [], pageOpenedAt = Date.now(); let lastBeat = performance.now(), hiddenSince = 0;
setInterval(() => {
  const now = performance.now(), drift = now - lastBeat - 100; lastBeat = now;
  if (document.hidden) hiddenSince = now;
  else if (drift > 150 && now - hiddenSince > 2000) { stalls.push({ at: Date.now(), ms: Math.round(drift), playing: engine.playing }); if (stalls.length > 60) stalls.shift(); }
}, 100);
let clk0 = null;   // the audio clock against the page clock: they should run at the same speed
setInterval(() => { if (clk0) return; const au = engine.audioInfo(); if (au && engine.playing) clk0 = { p: performance.now(), t: au.time }; }, 1000);
// what this browser has stored for the page (it survives new sessions), and which settings differ from the defaults
const storageLine = () => {
  try {
    const sizes = Object.keys(localStorage).filter((k) => k.startsWith('pb.')).map((k) => [k.slice(3), Math.round((localStorage.getItem(k) || '').length / 1024)]).sort((a, b) => b[1] - a[1]);
    const total = sizes.reduce((t, x) => t + x[1], 0), prefs = getPrefs(), off = Object.entries(prefs).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(DEFAULT_PREFS[k])).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    return `stored ${total} KB (${sizes.slice(0, 4).map(([k, n]) => `${k} ${n}`).join(', ')}) · settings changed: ${off.join(', ') || 'none'}`;
  } catch { return 'stored: cannot read'; }
};
const healthText = () => {
  const au = engine.audioInfo(), ln = engine.lateNotes(), mins = Math.round((Date.now() - pageOpenedAt) / 60000), ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'less than a minute ago' : m + ' min ago'; };
  const playingStalls = stalls.filter((x) => x.playing), heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) + ' MB' : 'n/a';
  return [
    `page open ${mins >= 120 ? Math.round(mins / 60) + ' h' : mins + ' min'} · memory ${heap}`,
    au ? `audio ${au.state} · ${au.sampleRate} Hz · latency ${au.baseLatencyMs} ms (output ${au.outputLatencyMs} ms) · running ${au.seconds} s` : 'audio not started yet',
    (au && clk0 && performance.now() - clk0.p > 10000 ? `audio clock ${(((au.time - clk0.t) / ((performance.now() - clk0.p) / 1000))).toFixed(3)}× the page clock (1.000 is right)` : null),
    storageLine(),
    `notes skipped ${ln.count}${ln.count ? ' (last ' + ago(ln.at) + ')' : ''}`,
    `page stalls over 0.15 s: ${stalls.length}${stalls.length ? ', longest ' + Math.max(...stalls.map((x) => x.ms)) + ' ms, while playing ' + playingStalls.length + (playingStalls.length ? ' (last ' + ago(playingStalls[playingStalls.length - 1].at) + ')' : '') : ''}`,
  ].filter(Boolean).join('\n');
};
setInterval(() => {
  if (engine.playing && engine.peak() > 1.0) lastOver = Date.now();
  const show = Date.now() - lastOver < 2000;
  overEl.hidden = !show;
  if (show) overEl.textContent = engine.limiterOn() ? 'limiting' : 'clipping';
  const ln = engine.lateNotes(); if (ln.count > seenLate) lastLate = Date.now(); seenLate = ln.count;   // a note reached the player too late and was skipped
  const u = engine.playing ? engine.underruns() : null;
  if (u !== null && seenUnder !== null && u > seenUnder) lastBusy = Date.now();
  seenUnder = u;
  const skipped = Date.now() - lastLate < 6000, busy = Date.now() - lastBusy < 4000;
  busyEl.hidden = !(busy || skipped);
  busyEl.textContent = skipped ? 'notes skipped' : 'overloaded';
  busyEl.title = skipped ? 'A note reached the audio player after its moment had passed, so it was skipped. This happens when the page or the computer is too busy, or when the tab was in the background. Closing other tabs and turning Animations off in Settings usually helps.' : 'The computer could not keep up and the sound broke up a moment ago. Fewer voices will fix it: shorter release times, a smaller reverb room, fewer layers, or turn Animations off in Settings.';
}, 100);
const undoBtn = h('button', { class: 'btn', id: 'undo', title: 'Undo (Ctrl/⌘ Z)', onclick: () => doUndo() }, '↶ Undo');
const redoBtn = h('button', { class: 'btn', id: 'redo', title: 'Redo (Shift Ctrl/⌘ Z)', onclick: () => doRedo() }, '↷ Redo');
const newBtn = h('button', { class: 'btn', id: 'new-btn', title: 'Start an empty patch (undoable)', onclick: () => { store.replace({ v: 1, nodes: [], wires: [] }, 'new'); setBanner(null); board.fit(); toast('Empty patch', [undoAction], 5000); } }, 'New');
const learnBtn = h('button', { class: 'btn', id: 'learn-btn' }, 'Learn ▾');
const savesBtn = h('button', { class: 'btn', id: 'saves-btn' }, 'Saves ▾');
const exportBtn = h('button', { class: 'btn', id: 'export-btn' }, 'Export ▾');
const fileInput = h('input', { type: 'file', accept: '.json,.strudel,.txt,.js,.mid,.midi', style: 'display:none', id: 'import-file' });
const importBtn = h('button', { class: 'btn', id: 'import-btn', onclick: () => openImport() }, 'Import');
const aiBtn = h('button', { class: 'btn', id: 'ai-btn', title: 'AI helper: make a starter patch, or get a review of yours (bring your own key)', onclick: () => openAI() }, 'AI');
const popHost = h('div', { class: 'pop-host' });
const bpmInput = h('input', { type: 'number', id: 'bpm', min: 40, max: 220, step: 0.1, title: 'Tempo: beats per minute (the Output module\'s tempo knob). Decimals are fine: 62.5, 125.2.', class: 'bpm-input' });
bpmInput.addEventListener('keydown', (e) => e.stopPropagation());
bpmInput.addEventListener('change', () => {
  const out = store.graph.nodes.find((n) => n.type === 'output');
  const v = Math.min(220, Math.max(40, Math.round(Number(bpmInput.value) * 10) / 10));
  if (out && Number.isFinite(v)) hooks.setParam(out.id, 'bpm', v);
  syncBpm();
});
const bpmBox = h('label', { class: 'bpm' }, bpmInput, h('span', {}, 'BPM'));
// Tap tempo: tap along to a song and the Output's tempo follows (three taps or more; a pause of 2.5 s starts again)
let taps = [], tapReset = null;
const tapBtn = h('button', { class: 'btn sm tap-btn', id: 'tap', type: 'button', title: 'Tap along to the song to set the tempo (three taps or more)', 'aria-label': 'Tap tempo' }, 'Tap');
tapBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const out = store.graph.nodes.find((n) => n.type === 'output');
  if (!out) return toast('Add an Output module first: the tempo lives there.', [], 3000);
  taps.push(e.timeStamp || performance.now()); taps = taps.slice(-12);   // the event's own time, so a busy moment in the app never skews a tap
  clearTimeout(tapReset); tapReset = setTimeout(() => { taps = []; tapBtn.textContent = 'Tap'; }, 2500);
  const r = tapBpm(taps);
  if (!r) { tapBtn.textContent = taps.length + ' · tap on'; return; }
  const v = Math.min(220, Math.max(40, r.bpm));
  tapBtn.textContent = v + '';
  if (v !== out.params.bpm) hooks.setParam(out.id, 'bpm', v);
});
const beatsSel = h('select', { id: 'beats', class: 'beats-sel', title: 'Beats per cycle (the time signature)' }, [2, 3, 4, 5, 6, 8].map((v) => h('option', { value: v }, v)));
beatsSel.addEventListener('change', () => { const out = store.graph.nodes.find((n) => n.type === 'output'); if (out) hooks.setParam(out.id, 'beats', Number(beatsSel.value)); });
const beatsBox = h('label', { class: 'bpm' }, beatsSel, h('span', {}, 'B/C'));
const settingsBtn = h('button', { class: 'btn', id: 'settings-btn' });
const addBtn = h('button', { class: 'btn', id: 'add-btn', title: 'Add a module (Ctrl/⌘ K)' }, '+ Add');
const codeBtn = h('button', { class: 'btn', id: 'code-toggle', title: 'Show or hide the Strudel code (Ctrl/⌘ \\)', onclick: () => setCodeShown(!codeShown) }, '{ } Code');

const iconify = (btn, name, label) => { btn.replaceChildren(icon(name)); btn.title = btn.title || label; btn.title = label + (btn.title && btn.title !== label ? '' : ''); btn.setAttribute('aria-label', label); btn.classList.add('icon-btn'); };
iconify(newBtn, 'newfile', 'New empty patch'); iconify(undoBtn, 'undo', 'Undo (Ctrl/⌘ Z)'); iconify(redoBtn, 'redo', 'Redo (Shift Ctrl/⌘ Z)');
iconify(learnBtn, 'book', 'Learning path'); iconify(savesBtn, 'folder', 'Saves and history'); iconify(exportBtn, 'download', 'Export'); iconify(importBtn, 'upload', 'Import a patch'); iconify(aiBtn, 'sparkle', 'AI helper');
iconify(addBtn, 'plus', 'Add a module (Ctrl/⌘ K)'); iconify(codeBtn, 'code', 'Show or hide the Strudel code (Ctrl/⌘ \\)'); iconify(settingsBtn, 'sliders', 'Display settings');
const top = h('header', { class: 'topbar' },
  h('div', { class: 'brand' }, h('b', {}, 'Strudel'), ' Patchboard'),
  h('div', { class: 'transport' }, playBtn, bpmBox, tapBtn, beatsBox, scopeCv, statusEl, overEl, busyEl),
  h('div', { class: 'toolbar' }, addBtn, newBtn, undoBtn, redoBtn, learnBtn, savesBtn, exportBtn, importBtn, aiBtn, settingsBtn, codeBtn), fileInput);

const paletteEl = h('aside', { class: 'palette' }, h('div', { class: 'pal-head' },
  h('button', { class: 'pal-burger', id: 'modules-toggle', title: 'Show or hide the module list', onclick: () => setPaletteShown(!paletteShown) }, '☰'),
  h('span', { class: 'pal-title' }, 'Modules'),
  h('button', { class: 'pal-collapse', title: 'Collapse the module list', onclick: () => setPaletteShown(false) }, '«')));
const boardEl = h('main', { class: 'board', id: 'board' });
const codeHead = h('div', { class: 'code-head' },
  h('b', {}, 'Strudel code'),
  h('span', { class: 'sp' }),
  h('label', { class: 'toggle', title: 'Show a plain-English note after each line' },
    h('input', { type: 'checkbox', id: 'notes-toggle', checked: showNotes, onchange: (e) => { showNotes = e.target.checked; localStorage.setItem('pb.notes', showNotes ? '1' : '0'); panel.setShowNotes(showNotes); } }), ' explain'),
  h('button', { class: 'btn sm', id: 'copy', onclick: copyCode }, 'Copy'),
  h('button', { class: 'btn sm', id: 'snapshot', title: 'Draw the rhythm of this patch over a few bars as a picture you can look at, download or share', onclick: () => openSnapshot() }, 'Snapshot'),
  h('button', { class: 'btn sm code-close', id: 'code-close', 'aria-label': 'Close the code', onclick: () => setCodeShown(false) }, 'Close'),
  h('button', { class: 'btn sm', id: 'open-cc', onclick: openInStrudel }, 'Open in strudel.cc ↗'));
const codeHost = h('div', { class: 'code-host', id: 'code-host' });
const issuesEl = h('div', { class: 'issues', id: 'issues' });
const syncEl = h('div', { class: 'sync-bar', id: 'sync-bar', hidden: true, role: 'status' });
const learnEl = h('div', { class: 'learn-banner', id: 'learn-banner', hidden: true });
const readOnlyNote = h('div', { class: 'ro-note', id: 'ro-note' });
const noteText = () => (getPrefs().codeEdit === 'numbers' ? 'The numbers are editable: click one, type, press Enter (↑ ↓ nudge it, Esc cancels). The rest follows the modules; to bring in whole code use Import.' : 'You can type anywhere in the code: the board follows what you write, and your comments and spacing are kept. A line the board cannot show stays in your text and does not play here.');
readOnlyNote.textContent = noteText();
const codeResizer = h('div', { class: 'code-resizer', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the code panel', tabindex: 0, title: 'Drag to resize the code panel (double-click to reset)' });
const codeCol = h('aside', { class: 'codecol' }, codeResizer, codeHead, codeHost, syncEl, learnEl, issuesEl, readOnlyNote);
const toastEl = h('div', { class: 'toasts', id: 'toasts' });
app.append(top, h('div', { class: 'main' }, paletteEl, boardEl, codeCol), popHost, toastEl);

// ---------- phone layout ----------
// On a narrow screen the board fills the screen, the code is a sheet that is closed to begin with (and not remembered), and a lesson's text moves over the board.
const narrowQuery = window.matchMedia('(max-width: 900px)');
const isNarrow = () => narrowQuery.matches;

// ---------- resizable code panel (desktop) ----------
{
  const MIN = 300, maxW = () => Math.round(window.innerWidth * 0.7);
  const setW = (w, save = true) => {
    if (w === null) { app.style.removeProperty('--codew'); try { localStorage.removeItem('pb.codeW'); } catch { /* private mode */ } }
    else { w = Math.min(maxW(), Math.max(MIN, Math.round(w))); app.style.setProperty('--codew', w + 'px'); if (save) { try { localStorage.setItem('pb.codeW', String(w)); } catch { /* private mode */ } } }
    requestAnimationFrame(() => { panel?.view.requestMeasure(); board?.drawCables(); });
  };
  const saved = Number(localStorage.getItem('pb.codeW'));
  if (saved >= MIN) setW(saved, false);
  codeResizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { codeResizer.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    codeResizer.classList.add('drag'); document.body.style.userSelect = 'none';
    const move = (ev) => setW(window.innerWidth - ev.clientX);
    const up = () => { codeResizer.classList.remove('drag'); document.body.style.userSelect = ''; codeResizer.removeEventListener('pointermove', move); codeResizer.removeEventListener('pointerup', up); codeResizer.removeEventListener('pointercancel', up); };
    codeResizer.addEventListener('pointermove', move); codeResizer.addEventListener('pointerup', up); codeResizer.addEventListener('pointercancel', up);
  });
  codeResizer.addEventListener('dblclick', () => setW(null));
  codeResizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault(); e.stopPropagation();
    setW(codeCol.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 96 : 24));
  });
  window.addEventListener('resize', () => { const cur = Number(localStorage.getItem('pb.codeW')); if (cur) setW(cur, false); });
}

// ---------- show / hide the code ----------
let codeShown = isNarrow() ? false : localStorage.getItem('pb.codeShown') !== '0';
function setCodeShown(v) {
  codeShown = v;
  if (!isNarrow()) { try { localStorage.setItem('pb.codeShown', v ? '1' : '0'); } catch { /* private mode */ } }
  app.classList.toggle('code-hidden', !v);
  codeBtn.classList.toggle('on', v);
  codeBtn.setAttribute('aria-pressed', String(v));
  requestAnimationFrame(() => { panel?.view.requestMeasure(); board?.drawCables(); });
}

let paletteShown = localStorage.getItem('pb.paletteShown') !== '0';
function setPaletteShown(v) {
  paletteShown = v;
  try { localStorage.setItem('pb.paletteShown', v ? '1' : '0'); } catch { /* private mode */ }
  app.classList.toggle('palette-hidden', !v);
  document.getElementById('modules-toggle')?.setAttribute('aria-expanded', String(v));
  requestAnimationFrame(() => board?.drawCables());
}
function syncBpm() {
  const out = store.graph.nodes.find((n) => n.type === 'output');
  bpmInput.disabled = !out;
  if (out && document.activeElement !== bpmInput) bpmInput.value = out.params.bpm;
  if (!out) bpmInput.value = '';
  beatsSel.disabled = !out;
  if (out) beatsSel.value = String(out.params.beats ?? 4);
}

// ---------- toasts ----------
function toast(text, actions = [], ms = 6000) {
  const el = h('div', { class: 'toast' }, h('span', {}, text),
    actions.map((a) => h('button', { class: 'btn sm', onclick: () => { a.fn(); el.remove(); } }, a.label)));
  toastEl.append(el);
  if (ms) setTimeout(() => el.remove(), ms);
  return el;
}
const undoAction = { label: 'Undo', fn: () => doUndo() };

// ---------- code panel ----------
// a number edited (or nudged with the arrow keys) in the code panel goes to the knob it came from
function codeEdit({ seg, call, value, dir, big }) {
  const n = nodeById(store.graph, seg.node);
  if (!n) return;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v)), r4 = (v) => Number(v.toFixed(4)), nudge = dir ? { dir, big } : null;
  if (!nudge) { const t = numberTarget(store.graph, seg, call, value); if (t) hooks.setParam(t.id, t.key, t.value); return; }   // a typed number: same rules as a number typed anywhere in the code
  if (n.type === 'mixer' && seg.key === 'strips') {   // .postgain(x) and .pan(x) on a part are that strip's fader and pan
    const isPan = /^\.pan\(/.test(call), f = isPan ? 'pan' : 'vol';
    const strips = (n.params.strips || []).map((s) => ({ vol: 1, pan: 0.5, mute: false, solo: false, ...s }));
    if (!strips[seg.step]) return;
    const next = nudge ? strips[seg.step][f] + nudge.dir * (nudge.big ? 0.1 : 0.01) : value;
    strips[seg.step] = { ...strips[seg.step], [f]: r4(clamp(next, 0, isPan ? 1 : 1.5)) };
    hooks.setParam(n.id, 'strips', strips);
    return;
  }
  const spec = MODULES[n.type].params.find((p) => p.key === seg.key);
  if (!spec || spec.kind !== 'knob') return;
  let lo = spec.min, hi = spec.max;
  if (spec.dyn) { lo = Number(n.params.min); hi = Number(n.params.max); }
  if (n.type === 'macro') { lo = 0; hi = 1; }
  const step = spec.step || 0.01;
  let next = value;
  if (nudge) {
    const cur = Number(n.params[seg.key]);
    next = spec.log && lo > 0 ? cur * (1 + 0.015 * (nudge.big ? 5 : 1)) ** nudge.dir : cur + nudge.dir * step * (nudge.big ? 10 : 1);
    next = Math.round(next / step) * step;
    if (next === cur) next = cur + nudge.dir * step;
  }
  if (Number.isInteger(step) && step >= 1) next = Math.round(next);
  hooks.setParam(n.id, seg.key, r4(clamp(next, lo, hi)));
}
// The choices in the code: a sound name, a bank, a filter type ... Each one knows where it sits in the text and how to apply a new pick to its module.
function codeChoices(res) {
  const out = [], code = res.code;
  const asOptions = (spec) => spec.options.map((o) => (Array.isArray(o) ? { value: o[0], label: String(o[1]) } : { value: o, label: o === '' ? '(none)' : String(o) }));
  for (const s of res.segments) {
    if (!s.node) continue;
    const n = nodeById(store.graph, s.node);
    if (!n) continue;
    const text = code.slice(s.from, s.to), set = (key, v) => hooks.setParam(n.id, key, v);
    const quoted = () => { const a = text.indexOf('"'), z = text.lastIndexOf('"'); return a >= 0 && z > a ? [s.from + a + 1, s.from + z] : null; };
    // a Sample's pattern: every sound word in "bd*2 [hh sd]" is its own choice, and only that word is replaced
    if (s.role === 'mini' && n.type === 'sample' && !s.key && text.startsWith('"') && text === JSON.stringify(String(n.params.name || 'bd'))) {
      const re = /[A-Za-z_]\w*(?::\d+)?/g, inner = text.slice(1, -1);
      let w;
      while ((w = re.exec(inner))) {
        const at = w.index, len = w[0].length;
        out.push({ node: n.id, kind: 'sample', from: s.from + 1 + at, to: s.from + 1 + at + len, current: w[0].split(':')[0], apply: (id) => { const cur = String(nodeById(store.graph, n.id)?.params.name ?? ''); set('name', cur.slice(0, at) + id + cur.slice(at + len)); } });
      }
      continue;
    }
    if (s.role !== 'knob' || !s.key) continue;
    const spec = MODULES[n.type].params.find((p) => p.key === s.key);
    if (n.type === 'synth' && s.key === 'wave') { const q = quoted(); if (q) out.push({ node: n.id, kind: 'instrument', from: q[0], to: q[1], current: n.params.wave, apply: (id) => set('wave', id) }); continue; }
    if (spec?.kind === 'select' && spec.str) {   // a bank, a tremolo shape, a filter slope ...: a fixed list
      const q = quoted();
      if (q) out.push({ node: n.id, kind: 'menu', from: q[0], to: q[1], title: spec.label, options: asOptions(spec), current: n.params[s.key], apply: (v) => set(s.key, v) });
      continue;
    }
    let m;
    if (n.type === 'shuffle' && (m = /^\.(shuffle|scramble)\(/.exec(text))) {
      out.push({ node: n.id, kind: 'menu', from: s.from + 1, to: s.from + 1 + m[1].length, title: 'mode', current: n.params.mode, options: asOptions(MODULES.shuffle.params.find((p) => p.key === 'mode')), apply: (v) => set('mode', v) });
    } else if (n.type === 'sometimes' && (m = /^\.sometimesBy\([^,]+,\s*/.exec(text))) {
      out.push({ node: n.id, kind: 'menu', from: s.from + m[0].length, to: s.to - 1, title: 'what happens to the chosen events', current: n.params.fn, options: Object.entries(SOMETIMES_FNS).map(([value, f]) => ({ value, label: f.label })), apply: (v) => set('fn', v) });
    } else if (n.type === 'every' && (m = /^\.every\([^,]+,\s*/.exec(text))) {
      out.push({ node: n.id, kind: 'menu', from: s.from + m[0].length, to: s.to - 1, title: 'what happens on every nth cycle', current: n.params.fn, options: Object.entries(EVERY_FNS).map(([value, f]) => ({ value, label: f.label })), apply: (v) => set('fn', v) });
    } else if (n.type === 'filter' && (m = /^\.(lpf|hpf|bpf)\(/.exec(text))) {
      out.push({ node: n.id, kind: 'menu', from: s.from + 1, to: s.from + 1 + m[1].length, title: 'filter type', current: n.params.type, options: asOptions(MODULES.filter.params.find((p) => p.key === 'type')), apply: (v) => set('type', v) });
    }
  }
  return out;
}
let choiceAnchor = null;
function openChoice(c, rect) {
  choiceAnchor?.remove();
  const a = document.createElement('span');   // an invisible stand-in for the word, so the pickers open right under it
  a.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${Math.max(4, rect.right - rect.left)}px;height:${rect.bottom - rect.top}px;pointer-events:none`;
  document.body.append(a); choiceAnchor = a;
  if (c.kind === 'instrument') openSoundPicker({ anchor: a, items: INSTRUMENTS.map((i) => ({ ...i, pitched: true })), cats: INST_CATS, current: c.current, onPick: (id) => c.apply(id) });
  else if (c.kind === 'sample') openSoundPicker({ anchor: a, items: sampleItems(nodeById(store.graph, c.node)?.params.bank || ''), cats: SAMPLE_CATS, current: c.current, onPick: (id) => c.apply(id) });
  else showPop(a, h('div', { class: 'menu' }, h('div', { class: 'menu-h' }, c.title || 'Choose'),
    c.options.map((o) => h('button', { class: 'menu-item' + (String(o.value) === String(c.current) ? ' on' : ''), onclick: () => { c.apply(o.value); closePop(); } }, o.label))));
}
const panel = createCodePanel(codeHost, { onHover: (hv) => board.setHover(hv), onEdit: (e) => codeEdit(e), onNudge: (e) => codeEdit(e), choicesOf: codeChoices, onChoice: openChoice, isFree: () => getPrefs().codeEdit !== 'numbers', onText: (t) => codeTyped(t) });

// step through: plain -> x2 -> x3 -> x4 -> [2] -> [3] -> [4] -> plain. Keeps what was written when entering or leaving brackets.
function cycleX(c, pitched, f) { applyX(c, pitched, f, X_STATES[(X_STATES.indexOf(c.x || '') + 1) % X_STATES.length]); }
function applyX(c, pitched, f, next) {
  const had = parseX(c), has = (leaf) => (pitched ? cellNotes(leaf, f === 'd').length > 0 : !!leaf.on);
  const copy = (from, to) => { if (pitched) { to.n = from.n ?? null; to.d = from.d ?? null; } else to.on = !!from.on; };
  c.x = next || undefined;
  if (!next) delete c.x;
  const now = parseX(c);
  if (now.type === 'sub') {
    c.sub = c.sub || [];
    for (let k = 0; k < now.n; k++) c.sub[k] = c.sub[k] || (pitched ? { n: null, d: null } : { on: false });
    if (had.type !== 'sub' && has(c) && !c.sub.slice(0, now.n).some(has)) copy(c, c.sub[0]);
  } else if (had.type === 'sub' && !has(c)) {
    const first = (c.sub || []).slice(0, had.n).find(has);
    if (first) copy(first, c);
  }
}

// ---------- board hooks ----------
// ---- Number Pattern and the range of the dial it drives ----
// the numbers in a pattern like "<0.5 1*2 ~ 0..4>": the number at the start of each word
const patNumbers = (text) => String(text || '').split(/[\s\[\]<>,|()]+/).map((t) => /^-?\d*\.?\d+/.exec(t)?.[0]).filter((x) => x !== undefined).map(Number);
const outsideRange = (text, spec) => patNumbers(text).filter((v) => v < spec.min || v > spec.max);
// a first pattern that fits the dial: its own setting, then a second value inside the range
function starterPattern(spec, cur) {
  const span = spec.max - spec.min, q = spec.step || 0.01;
  const other = spec.log && spec.min > 0 ? Math.min(spec.max, cur * 2) : cur <= spec.min + span / 2 ? spec.min + span * 0.75 : spec.min + span * 0.25;
  const r = (v) => Number((Math.round(v / q) * q).toFixed(4));
  return `<${fmt(r(cur))} ${fmt(r(other))}>`;
}
// stretch the pattern's own lowest and highest number onto the dial's lowest and highest, keeping everything in between in proportion
function fitPattern(text, spec) {
  const nums = patNumbers(text);
  if (!nums.length) return text;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const map = hi > lo ? (v) => spec.min + ((v - lo) / (hi - lo)) * (spec.max - spec.min) : (v) => Math.min(spec.max, Math.max(spec.min, v));
  return text.replace(/(^|[\s\[\]<>,|(])(-?\d*\.?\d+)/g, (_, pre, num) => pre + fmt(Number(map(Number(num)).toFixed(4))));
}

const hooks = {
  preview: (item) => engine.preview(item),
  warm: () => engine.warm(),
  soundsReady: () => engine.isReady(),
  hover: (hv) => { board.setHover(hv); panel.setHover(hv); },
  addNode(type, x, y) {
    if (MODULES[type].single && store.graph.nodes.some((n) => n.type === type)) return toast(`Only one ${MODULES[type].title} is allowed.`);
    if (x === undefined) {
      const c = board.viewCenter();
      x = Math.round((c.x - 90 + (store.graph.nodes.length % 5) * 24) / 24) * 24;
      y = Math.round((c.y - 60 + (store.graph.nodes.length % 5) * 24) / 24) * 24;
    }
    const node = makeNode(type, x, y);
    store.update((g) => g.nodes.push(node), { label: 'add ' + type });
    board.select(node.id);
    board.reveal(node.id);   // in the phone flow view the new module opens and scrolls into view
  },
  cableHover(cx, cy, subject) { return board.cableHover(cx, cy, subject); },
  // Drop a module (new, or one already on the board) into a cable: the cable's start plugs into it and it plugs into the cable's end. One undo step.
  insertOnWire(wireId, subject, cx, cy) {
    let done = null;
    store.update((g) => {
      const w = g.wires.find((x) => x.id === wireId);
      if (!w) return;
      let node;
      if (subject.nodeId) node = nodeById(g, subject.nodeId);
      else { const p = cx === undefined ? { x: 0, y: 0 } : board.toWorld(cx, cy); node = makeNode(subject.type, Math.round((p.x - 90) / 24) * 24, Math.round((p.y - 20) / 24) * 24); }
      const plan = node && insertPlan(g, w, node);
      if (!plan) return;
      if (!subject.nodeId) g.nodes.push(node);
      g.wires = g.wires.filter((x) => x.id !== w.id);
      g.wires.push({ id: uid('w'), from: w.from, to: { node: node.id, port: plan.inPort } }, { id: uid('w'), from: { node: node.id, port: 'out' }, to: w.to });
      done = node;
    }, { label: 'drop into cable' });
    if (done) { board.select(done.id); board.reveal(done.id); toast(`${MODULES[done.type].title} is now in the cable`, [undoAction], 3500); }
    return !!done;
  },
  dropFromPalette(type, cx, cy) {
    const target = cx === undefined ? null : board.insertHighlight;
    board.cableHover(null, null, {});
    if (target && hooks.insertOnWire(target, { type }, cx, cy)) return;
    if (cx === undefined) hooks.addNode(type);
    else board.placeFromPalette(type, cx, cy);
  },
  removeNode(id) {
    const n = nodeById(store.graph, id);
    store.update((g) => { g.nodes = g.nodes.filter((x) => x.id !== id); g.wires = g.wires.filter((w) => w.from.node !== id && w.to.node !== id); });
    toast(`Removed ${MODULES[n.type].title}`, [undoAction]);
  },
  removeWire(id, msg = 'Cable removed') {
    store.update((g) => { g.wires = g.wires.filter((w) => w.id !== id); });
    board.clearWireSel();
    toast(msg, [undoAction], 4000);
  },
  connect(from, to, replacedId) {
    let warnRange = null, warnNum = null;
    const removed = store.update((g) => {
      if (replacedId) g.wires = g.wires.filter((w) => w.id !== replacedId);
      const port = MODULES[nodeById(g, to.node).type];
      const isMulti = !!(Array.isArray(port.inputs) && port.inputs.find((i) => i.id === to.port)?.multi);
      if (!isMulti) g.wires = g.wires.filter((w) => !(w.to.node === to.node && w.to.port === to.port));
      const fresh = !g.wires.some((w) => w.from.node === from.node);   // this number source has no cable yet
      g.wires.push({ id: uid('w'), from, to });
      // A new slider (or wave) plugged into a knob starts from that knob's own setting and range, so the sound does not jump.
      const src = nodeById(g, from.node), dst = nodeById(g, to.node);
      const spec = to.port.startsWith('p:') ? MODULES[dst.type].params.find((s) => s.key === to.port.slice(2)) : null;
      if (fresh && spec && !spec.dyn && Number.isFinite(spec.min) && Number.isFinite(spec.max) && (src.type === 'slider' || src.type === 'wave' || src.type === 'random')) {
        src.params.min = spec.min; src.params.max = spec.max;
        if (src.type === 'random' && spec.step >= 1 && spec.max - spec.min <= 100) src.params.whole = 'whole';   // a small dial that counts in whole steps (semitones, repeats) gets whole numbers; a wide one (Hz) stays smooth
        if (src.type === 'slider') src.params.step = spec.step || 0;
        if (src.type === 'slider') src.params.value = Math.min(spec.max, Math.max(spec.min, Number(dst.params[spec.key] ?? spec.def)));
      }
      // A Number Pattern plugged into an Arrange's order starts as the Arrange's own order and lengths: 1@4 2@4 3@4
      if (src.type === 'numpat' && dst.type === 'arrange' && to.port === 'order' && src.params.text === MODULES.numpat.params[0].def) {
        src.params.text = Array.from({ length: dst.params.n }, (_, i) => `${i + 1}@${Math.max(1, Math.round(Number(dst.params.lens?.[i]) || 4))}`).join(' ');
      }
      // A Number Pattern still on its starting numbers (made for a cutoff) takes the dial's setting; any other pattern is checked against the dial's range.
      if (src.type === 'numpat' && spec && !spec.dyn && Number.isFinite(spec.min) && Number.isFinite(spec.max)) {
        if (fresh && src.params.text === MODULES.numpat.params[0].def) src.params.text = starterPattern(spec, Number(dst.params[spec.key] ?? spec.def));
        else if (outsideRange(src.params.text, spec).length) warnNum = { src: src.id, spec };
      }
      // An already-used slider or wave keeps its range, which can reach past this knob's: warn, and offer a slider of its own.
      if (!fresh && spec && !spec.dyn && Number.isFinite(spec.min) && Number.isFinite(spec.max) && (src.type === 'slider' || src.type === 'wave') && (Number(src.params.min) < spec.min || Number(src.params.max) > spec.max)) {
        warnRange = { to, src: src.id, dst: dst.id, spec, lo: Number(src.params.min), hi: Number(src.params.max) };
      }
    });
    if (warnNum) {
      const { src, spec } = warnNum, txt = nodeById(store.graph, src)?.params.text;
      toast(`This Number Pattern has ${[...new Set(outsideRange(txt, spec))].join(', ')}, but "${spec.label}" only goes from ${fmt(spec.min)} to ${fmt(spec.max)}. Values outside that can be far too loud or turn the sound to noise.`,
        [{ label: 'Fit to range', fn: () => store.update((g) => { const n0 = nodeById(g, src); if (n0) n0.params.text = fitPattern(n0.params.text, spec); }) }], 12000);
    }
    if (warnRange) {
      const { to: t0, src, dst, spec, lo, hi } = warnRange;
      toast(`This ${MODULES[nodeById(store.graph, src).type].title.toLowerCase()} goes from ${fmt(lo)} to ${fmt(hi)}, but "${spec.label}" only goes from ${fmt(spec.min)} to ${fmt(spec.max)}. Values outside that can turn the sound to noise.`, [{
        label: 'Give it its own',
        fn: () => store.update((g) => {
          const s0 = nodeById(g, src), d0 = nodeById(g, dst);
          if (!s0 || !d0) return;
          const n = makeNode(s0.type, Math.max(0, d0.x - 260), d0.y + 40, { ...s0.params, min: spec.min, max: spec.max, step: spec.step || 0, ...(s0.type === 'slider' ? { value: Math.min(spec.max, Math.max(spec.min, Number(d0.params[spec.key] ?? spec.def))) } : {}) });
          g.nodes.push(n);
          g.wires = g.wires.filter((w) => !(w.to.node === t0.node && w.to.port === t0.port));
          g.wires.push({ id: uid('w'), from: { node: n.id, port: 'out' }, to: t0 });
        }),
      }], 10000);
    }
    removed?.forEach((r) => toast(`A cable was removed: ${r.reason}`, [undoAction]));
  },
  explain(fixed, jack, g) {
    const from = fixed.dir === 'out' ? fixed.node : jack.dataset.node;
    const to = fixed.dir === 'out' ? jack.dataset.node : fixed.node;
    const port = fixed.dir === 'out' ? jack.dataset.port : fixed.port;
    const why = whyNot(g, from, to, port);
    if (why) toast(`Can't connect: ${why}.`, [], 3500);
  },
  setParam(id, key, value) {
    store.update((g) => {
      const n = nodeById(g, id);
      if (!n) return; // the module was removed while a control was still being dragged
      n.params[key] = value;
      if (n.type === 'numpat' && key === 'text') growArrangeFor(g, n);
      if (key === 'steps' && n.params.tracks) n.params.tracks = resizeTracks(n.params.tracks, value);
      if (key === 'steps' && n.params.cells) n.params.cells = resizeCells(n.type, n.params.cells, value);
      if (key === 'steps' && ['melody', 'rhythm', 'drums', 'randnotes', 'randrhythm'].includes(n.type)) {   // more than 8 steps: keep the same pace and make the loop longer instead of squeezing it
        if (value > 8 && n.params.mode === 'steps') n.params.mode = 'pace';
        else if (value <= 8 && n.params.mode === 'pace') n.params.mode = 'steps';
      }
      if (n.type === 'slider' && key !== 'value') n.params.value = Math.min(Number(n.params.max), Math.max(Number(n.params.min), n.params.value));
    }, { coalesce: `p:${id}:${key}` });
  },
  setCell(id, i, op) {
    store.update((g) => {
      const n = nodeById(g, id);
      const c = n.params.cells[i];
      if (n.type === 'chords') {
        if (op.sym !== undefined) c.sym = op.sym;
        if (op.d !== undefined) c.d = op.d;
        if (op.rest) { c.sym = null; c.d = null; }
        if (op.cycleLen) c.len = ((c.len || 1) % Math.min(4, n.params.steps - i)) + 1;
        if (!(effectiveKey(g, n) ? c.d : c.sym)) c.len = 1;
        if (c.len > n.params.steps - i) c.len = n.params.steps - i;
        return;
      }
      const pitched = n.type === 'melody';
      const key = pitched ? effectiveKey(g, n) : null;
      const deg = !!key, f = deg ? 'd' : 'n';
      const leaf = op.sub !== undefined && op.sub >= 0 ? ((c.sub = c.sub || []), (c.sub[op.sub] = c.sub[op.sub] || {})) : c;
      if (op.row !== undefined) {
        const model = pitchModel(key, n.params.octave);
        const v = model.pitchAt(op.row);
        const cur = cellNotes(leaf, deg);
        const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v].sort((x, y) => model.rank(x) - model.rank(y));
        leaf[f] = next.length ? next : null;
      }
      if (op.toggle) leaf.on = !leaf.on;
      if (op.vel !== undefined) c.vel = op.vel;
      if (op.setX !== undefined) applyX(c, pitched, f, op.setX);
      if (op.cycleX) cycleX(c, pitched, f);
      if (op.cycleLen) {
        const max = Math.min(4, n.params.steps - i);
        c.len = ((c.len || 1) % max) + 1;
      }
      if (!stepHas(c, deg, pitched)) c.len = 1;
      if (c.len > n.params.steps - i) c.len = n.params.steps - i;
    }, { coalesce: `cell:${id}:${i}:${Object.keys(op)[0]}` });
  },
  setTrack(id, ti, op) {
    store.update((g) => {
      const n = nodeById(g, id);
      const ts = n.params.tracks;
      if (op.add) { if (ts.length < MAX_TRACKS) ts.push({ name: 'cp', mute: false, cells: Array.from({ length: n.params.steps }, () => ({ on: false })) }); return; }
      const t = ts[ti];
      if (!t) return;
      if (op.remove) ts.splice(ti, 1);
      if (op.name !== undefined) t.name = op.name;
      if (op.step !== undefined) {
        const c = t.cells[op.step];
        if (op.setX !== undefined) applyX(c, false, 'on', op.setX);
        else if (op.cycleX) cycleX(c, false, 'on');
        else { const leaf = op.sub !== undefined && op.sub >= 0 ? ((c.sub = c.sub || []), (c.sub[op.sub] = c.sub[op.sub] || {})) : c; leaf.on = !leaf.on; }
      }
      if (op.mute) t.mute = !t.mute;
    }, { coalesce: `track:${id}:${ti}:${Object.keys(op)[0]}` });
  },
  moveNodes(pos) {
    const ids = Object.keys(pos);
    store.update((g) => { for (const n of g.nodes) if (pos[n.id]) { n.x = pos[n.id].x; n.y = pos[n.id].y; } }, { coalesce: ids.length > 1 ? 'move:multi' : 'move:' + ids[0] });
  },
  setNodeWidth(id, w) {
    store.update((g) => { const n = nodeById(g, id); if (w) n.w = w; else delete n.w; }, { coalesce: 'resize:' + id });
  },
  groupNodes(ids) {
    if (ids.length < 2) return;
    store.update((g) => { g.groups = (g.groups || []).map((gr) => ({ ...gr, nodes: gr.nodes.filter((i) => !ids.includes(i)) })); g.groups.push({ id: uid('g'), name: 'Group', nodes: [...ids], collapsed: false }); }, { label: 'group' });
    board.select(null);
    toast(`Grouped ${ids.length} modules`, [undoAction], 3500);
  },
  ungroup(gid) { store.update((g) => { g.groups = (g.groups || []).filter((x) => x.id !== gid); }, { label: 'ungroup' }); },
  toggleGroup(gid) { store.update((g) => { const gr = (g.groups || []).find((x) => x.id === gid); if (gr) gr.collapsed = !gr.collapsed; }, { label: 'collapse group' }); },
  renameGroup(gid, name) { store.update((g) => { const gr = (g.groups || []).find((x) => x.id === gid); if (gr) gr.name = name; }, { coalesce: 'rename:' + gid }); },
  removeNodes(ids) {
    const set = new Set(ids);
    store.update((g) => { g.nodes = g.nodes.filter((x) => !set.has(x.id)); g.wires = g.wires.filter((w) => !set.has(w.from.node) && !set.has(w.to.node)); });
    toast(`Removed ${ids.length} modules`, [undoAction]);
  },
  duplicateNodes(ids) {
    const g0 = store.graph, picked = g0.nodes.filter((n) => ids.includes(n.id) && !MODULES[n.type].single);
    if (!picked.length) return toast('Nothing to copy: that kind of module is only allowed once.');
    const map = new Map(), copies = [];
    for (const src of picked) { const c = JSON.parse(JSON.stringify(src)); c.id = uid('n'); c.x += 56; c.y += 56; map.set(src.id, c.id); copies.push(c); }
    const wires = g0.wires.filter((w) => map.has(w.from.node) && map.has(w.to.node)).map((w) => ({ id: uid('w'), from: { node: map.get(w.from.node), port: w.from.port }, to: { node: map.get(w.to.node), port: w.to.port } }));
    store.update((g) => { g.nodes.push(...copies); g.wires.push(...wires); }, { label: 'duplicate' });
    board.select(copies.map((c) => c.id));
    toast(`Duplicated ${copies.length} module${copies.length > 1 ? 's' : ''}`, [undoAction], 3500);
  },
  collapseNodes(ids, collapsed) {
    store.update((g) => { for (const n of g.nodes) if (ids.includes(n.id)) { if (collapsed) n.collapsed = true; else delete n.collapsed; } }, { label: collapsed ? 'minimize' : 'expand' });
  },
  muteNodes(ids, muted) {
    store.update((g) => { for (const n of g.nodes) if (ids.includes(n.id) && MUTE_KIND[n.type]) { if (muted) n.muted = true; else delete n.muted; } }, { label: muted ? 'mute' : 'unmute' });
  },
  muteGroup(gid) {   // silence (or bring back) every sound and effect in a group with one click
    const gr = (store.graph.groups || []).find((x) => x.id === gid); if (!gr) return;
    const m = gr.nodes.map((id) => nodeById(store.graph, id)).filter((n) => n && MUTE_KIND[n.type]);
    if (m.length) hooks.muteNodes(gr.nodes, !m.every((n) => n.muted));
  },
  alignNodes(ids, mode) {
    const sel = store.graph.nodes.filter((n) => ids.includes(n.id));
    if (sel.length < 2) return;
    const edge = mode === 'left' ? Math.min(...sel.map((n) => n.x)) : Math.min(...sel.map((n) => n.y));
    store.update((g) => { for (const n of g.nodes) if (ids.includes(n.id)) { if (mode === 'left') n.x = edge; else n.y = edge; } }, { label: 'align' });
  },
  applyFmPreset(id, presetId) {
    const preset = FM_PRESETS.find((x) => x.id === presetId), def = MODULES.fm;
    if (!preset) return;
    store.update((g) => {
      const n = nodeById(g, id);
      for (const spec of def.params) n.params[spec.key] = spec.def;
      Object.assign(n.params, preset.params);
    }, { label: 'FM preset ' + preset.label });
    toast(`FM preset: ${preset.label}`, [undoAction], 2500);
  },
  // A Sample whose pattern names several sounds becomes a Drum Machine: one row per sound, the steps worked out from the pattern. The module keeps its place, cables and group.
  convertToDrums(id) {
    const n = nodeById(store.graph, id);
    if (!n || n.type !== 'sample') return;
    if (wiresInto(store.graph, id, 'in').length) return toast('This Sample is timed by a rhythm cable, which a Drum Machine does not take. Unplug the cable first.', [], 6000);
    const r = patternToDrums(n.params.name);
    if (r.error) return toast(r.error, [], 7000);
    const sdef = MODULES.sample.params;
    const lost = ['speed', 'attack', 'decay', 'release', 'lpf'].filter((k) => n.params[k] !== sdef.find((p) => p.key === k).def).concat(n.params.fit === 'on' ? ['fit'] : []);
    store.update((g) => {
      const s = nodeById(g, id);
      s.type = 'drums';
      s.params = { ...defaultParams('drums'), steps: r.steps, mode: 'steps', bank: n.params.bank, gain: n.params.gain, pan: n.params.pan, tracks: JSON.parse(JSON.stringify(r.tracks)) };
      g.wires = g.wires.filter((w) => !(w.to.node === id && w.to.port.startsWith('p:') && !['p:gain', 'p:pan'].includes(w.to.port)));   // cables into settings the Drum Machine does not have
    }, { label: 'convert to Drum Machine' });
    toast(`Now a Drum Machine: ${r.tracks.length} rows, ${r.steps} steps.${r.alternates ? ' The first cycle of the pattern was used.' : ''}${lost.length ? ` The Sample's ${lost.join(', ')} setting${lost.length > 1 ? 's' : ''} had no place on a Drum Machine.` : ''}`, [undoAction], 9000);
  },
  recordTake(id) { openRecord(id); },
  // the notes of a Take after a click or drag on its roll (one undo step for a whole drag)
  editTake(id, events) {
    store.update((g) => {
      const n = nodeById(g, id); if (!n || n.type !== 'take') return;
      n.params.events = cleanParams('take', { ...n.params, events }).events;
    }, { coalesce: 'take:' + id, label: 'edit a take' });
  },
  // a new recording for a Take: the notes it had are kept as an earlier take (the last five), so nothing you played is lost
  setTake(id, take, grid) {
    store.update((g) => {
      const n = nodeById(g, id); if (!n || n.type !== 'take') return;
      const old = { at: Date.now(), bpm: n.params.bpm, beats: n.params.beats, events: n.params.events || [] };
      const versions = old.events.length ? [old, ...(n.params.versions || [])] : (n.params.versions || []);
      Object.assign(n.params, cleanParams('take', { ...n.params, events: take.events, bpm: take.bpm, beats: take.beatsPerBar, grid: grid || n.params.grid, versions: versions.slice(0, 5) }));
    }, { label: 're-record a take' });
    toast('Take replaced. The one before is under Earlier takes.', [undoAction], 5000);
  },
  restoreTake(id, i) {
    store.update((g) => {
      const n = nodeById(g, id), v = n?.params.versions?.[i]; if (!n || !v) return;
      const cur = { at: Date.now(), bpm: n.params.bpm, beats: n.params.beats, events: n.params.events || [] }, rest = n.params.versions.filter((_, k) => k !== i);
      Object.assign(n.params, cleanParams('take', { ...n.params, events: v.events, bpm: v.bpm, beats: v.beats, versions: (cur.events.length ? [cur, ...rest] : rest).slice(0, 5) }));
    }, { label: 'go back to an earlier take' });
    toast('Earlier take restored. The one you had is kept too.', [undoAction], 4000);
  },
  convertSeq(id) {   // Melody Sequencer <-> Note Pattern, Rhythm Sequencer <-> Hit Pattern
    const n = nodeById(store.graph, id), cv = n && CONVERTERS[n.type];
    if (!cv) return;
    const r = cv.run(store.graph, n);
    if (r.error) return toast(r.error, [], 7000);
    store.update((g) => {
      const s = nodeById(g, id);
      s.type = r.type; s.params = r.params;
      g.wires = g.wires.filter((w) => w.to.node !== id);   // the new module has no inputs (a Key cable is no longer needed)
    }, { label: 'convert to ' + MODULES[r.type].title });
    toast(r.note, [undoAction], 7000);
  },
  applyFmAlgorithm(id, algoId) {
    const al = FM_ALGORITHMS.find((x) => x.id === algoId);
    if (!al) return;
    store.update((g) => {
      const n = nodeById(g, id), spec = (k) => MODULES.fm.params.find((s) => s.key === k);
      for (let i = 1; i <= 4; i++) for (let j = 0; j <= 4; j++) if (i !== j) { const k = fmLinkKey(i, j); if (spec(k)) n.params[k] = 0; }
      for (const [a, b, amt] of al.links) { const k = fmLinkKey(a, b); if (spec(k)) n.params[k] = amt; }
    }, { label: 'FM algorithm ' + al.label });
    toast(`FM algorithm: ${al.label}`, [undoAction], 2500);
  },
  applyMelodyTemplate(id, tplId) {
    const tpl = MELODY_TEMPLATES.find((x) => x.id === tplId);
    if (!tpl) return;
    store.update((g) => {
      const n = nodeById(g, id);
      n.params.steps = tpl.degrees.length;
      n.params.mode = tpl.degrees.length > 8 ? 'pace' : 'steps';
      if (tpl.octave) n.params.octave = tpl.octave;
      // a melody in "off: note names" mode has no scale to count steps in, so the tune is written out as notes of C major
      const noScale = !effectiveKey(g, n);
      const oct = n.params.octave || 3;
      const note = (d) => { const semi = SCALES.major[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); return NOTE_NAMES[semi % 12] + (oct + Math.floor(semi / 12)); };
      n.params.cells = tpl.degrees.map((d, i) => (noScale ? { n: d === null ? null : [note(d)], d: null, len: tpl.len[i] || 1, vel: 1 } : { n: null, d, len: tpl.len[i] || 1, vel: 1 }));
    }, { label: 'melody ' + tpl.label });
    toast(`Melody: ${tpl.label}`, [undoAction], 2500);
  },
  applyDrumPreset(id, presetId) {
    const preset = DRUM_PRESETS.find((x) => x.id === presetId);
    if (!preset) return;
    store.update((g) => { const n = nodeById(g, id); n.params.bank = preset.params.bank; n.params.steps = preset.params.steps; n.params.tracks = JSON.parse(JSON.stringify(preset.params.tracks)); }, { label: 'drum kit ' + preset.label });
    toast(`Drum kit: ${preset.label}`, [undoAction], 2500);
  },
  showHelp,
  moveNode(id, x, y) {
    store.update((g) => { const n = nodeById(g, id); n.x = x; n.y = y; }, { coalesce: 'move:' + id });
  },
  applyChordPreset(id, preset) {
    store.update((g) => { const n = nodeById(g, id); n.params.steps = preset.degrees.length; n.params.cells = presetCells(preset); }, { label: 'preset ' + preset.id });
  },
  layout(pos, merge = false) {
    const apply = (g) => { for (const n of g.nodes) if (pos[n.id]) { n.x = pos[n.id].x; n.y = pos[n.id].y; } };
    if (merge) store.amend(apply, { label: 'tidy' }); else store.update(apply, { label: 'tidy' });
    requestAnimationFrame(() => board.fit());
  },
  duplicate(id) {
    const src = nodeById(store.graph, id);
    if (!src || MODULES[src.type].single) return toast(`Only one ${MODULES[src.type].title} is allowed.`);
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid('n'); copy.x += 48; copy.y += 48;
    store.update((g) => g.nodes.push(copy), { label: 'duplicate' });
    board.select(copy.id);
  },
  toggleMute(id) {
    store.update((g) => { const n = nodeById(g, id); n.muted = !n.muted; if (!n.muted) delete n.muted; }, { label: 'mute' });
  },
  collapse(id) {
    store.update((g) => { const n = nodeById(g, id); n.collapsed = !n.collapsed; });
  },
};
const board = createBoard(boardEl, store, hooks);
if (import.meta.env.DEV) window.__app = { store, hooks, LESSONS, setPref, panel, engine };   // developer-only, for tests
const palette = buildPalette(paletteEl, hooks, () => store.graph);
const views = createViews({ board, store, engine, getEvaluated: () => evaluated });
views.start();
onCatalog(() => board.sync());
loadCatalog();

// ---------- compile -> panel -> engine ----------
let evalTimer = null;
// The person's own text. `textBase` is the board's code at the moment the text last agreed with the board.
let textBase = current.code, applying = false, syncState = { state: 'ok' };
const TEXT_KEY = 'pb.codeText';
const saveText = () => { try { if (panel.diverged) localStorage.setItem(TEXT_KEY, JSON.stringify({ text: panel.code, base: current.code })); else localStorage.removeItem(TEXT_KEY); } catch { /* private mode */ } };
const knownSounds = () => (name, bank) => soundsFor(bank || '').includes(name);   // a sound name is checked against the bank on its own Sample
function renderSync() {
  const s = syncState, kids = [];
  const btn = (label, fn) => h('button', { class: 'btn sm', onclick: fn }, label);
  const showBoard = () => { panel.setCompiled(current, showNotes); textBase = current.code; setSync({ state: 'ok' }); saveText(); };
  const makeBoardMatch = () => { codeTyped(panel.code, { full: true }); };
  if (s.state === 'error') kids.push(h('div', { class: 'sync-err' }, s.message, h('div', { class: 'sync-sub' }, 'The board keeps the last version that was valid. Fix the text and it will follow.')));
  else if (s.state === 'partial') {
    kids.push(h('div', { class: 'sync-warn' }, `${s.parts.length} part${s.parts.length === 1 ? ' of your code stays' : 's of your code stay'} in your text but ${s.parts.length === 1 ? 'does' : 'do'} not play here:`),
      ...s.parts.slice(0, 5).map((p) => h('div', { class: 'sync-item' }, (p.line ? 'line ' + p.line + ': ' : '') + String(p.text).slice(0, 60) + ' — ' + p.why)),
      ...(s.notes || []).map((n) => h('div', { class: 'sync-sub' }, n)),
      h('div', { class: 'sync-sub' }, '"Copy" and "Open in strudel.cc" use your full text, so they run in Strudel as written.'));
    if (s.differs) kids.push(h('div', { class: 'sync-warn' }, 'The text and the board also say different things elsewhere.'), h('div', { class: 'sync-row' }, btn('Make the text match the board', showBoard), btn('Make the board match the text', makeBoardMatch)));
  } else if (s.state === 'differs') {
    kids.push(h('div', { class: 'sync-warn' }, s.message || 'The text and the board say different things.'), h('div', { class: 'sync-row' }, btn('Make the text match the board', showBoard), btn('Make the board match the text', makeBoardMatch)));
  } else if (panel.diverged) {
    kids.push(h('div', { class: 'sync-sub' }, 'Your own spacing and comments are kept. Highlights and notes are off while your text differs from the board\'s code. ', btn('Show the board\'s code', showBoard)));
  }
  if (s.state === 'ok' || s.state === 'differs') for (const n of s.notes || []) kids.push(h('div', { class: 'sync-sub' }, n));   // what the reader noticed or changed on the way in (a long spelling made shorter, a sound that will be silent)
  syncEl.replaceChildren(...kids);
  syncEl.hidden = !kids.length;
}
function setSync(s) { syncState = s; renderSync(); }
// the person typed: apply their text to the board as the smallest change, then read the board back to check the text still says what the board says
function codeTyped(text, { full = false } = {}) {
  if (getPrefs().codeEdit === 'numbers') return;
  // an empty patch shows the board's own hint as a comment; once real code is typed beside it, the hint goes away (it was never the person's text)
  if (text.includes(EMPTY_NOTE) && text.replace(EMPTY_NOTE, '').trim() && !store.graph.nodes.some((n) => n.type === 'output')) { text = text.replace(EMPTY_NOTE, '').replace(/[ \t]+$/gm, ''); panel.patch(text); }
  const sounds = knownSounds();
  const res = applyCodeEdit(store.graph, text, { sounds, baseCode: full ? null : textBase });
  if (res.error) { setSync({ state: 'error', message: res.error }); return; }
  const ch = res.changes;
  if (ch.updated.length || ch.added.length || ch.removed.length) {
    applying = true;
    try { store.update((g) => { g.nodes = res.graph.nodes; g.wires = res.graph.wires; if (res.graph.groups) g.groups = res.graph.groups; else delete g.groups; }, { label: 'edit code', coalesce: 'code' }); }
    finally { applying = false; }
    if (res.via === 'replace') requestAnimationFrame(() => board.tidy({ merge: true }));   // a rebuilt board: lay the new modules out like an import does
  }
  textBase = current.code;
  setSync(checkSync(store.graph, text, { sounds }));
  saveText();
}
function afterChange(meta = {}) {
  const prev = current.code;
  current = compile(store.graph);
  if (applying) panel.sync(current, showNotes);
  else if (!panel.diverged || (meta.replaced && meta.label !== 'undo' && meta.label !== 'redo')) { panel.setCompiled(current, showNotes); textBase = current.code; if (syncState.state !== 'ok') setSync({ state: 'ok' }); else renderSync(); saveText(); }   // a whole new patch starts from the board's code
  else {   // a change made on the board, while the text has the person's own layout: carry it into their text as one small edit
    const patched = patchText(panel.code, prev, current.code);
    if (patched === null) { panel.sync(current, showNotes); setSync({ state: 'differs', message: 'The board changed where your text was edited, so the text was not updated.' }); }
    else { panel.patch(patched); panel.sync(current, showNotes); textBase = current.code; setSync(checkSync(store.graph, patched, { sounds: knownSounds() })); }
    saveText();
  }
  board.sync();
  syncBpm();
  views.dirty();
  palette.sync();
  undoBtn.disabled = !store.canUndo;
  redoBtn.disabled = !store.canRedo;
  renderIssues();
  if (engine.playing && current.code !== evaluated.code) {
    clearTimeout(evalTimer);
    evalTimer = setTimeout(runEval, 140);
  }
}
async function runEval() {
  evaluated = current;
  await engine.evaluate(current.code);
}
function renderIssues() {
  issuesEl.replaceChildren(...current.issues.map((i) => h('div', { class: 'issue', onmouseenter: () => hooks.hover({ node: i.node }), onmouseleave: () => hooks.hover(null) }, '• ' + i.msg)));
}
store.subscribe((g, meta) => {
  afterChange(meta);
  if (meta.removed?.length) meta.removed.forEach((r) => toast(`A cable was removed: ${r.reason}`, [undoAction]));
});

// slider modules move the live value immediately; the re-evaluation that follows keeps the code identical
function liveSlider() {
  for (const n of store.graph.nodes) {
    if (n.type !== 'slider' && n.type !== 'macro') continue;
    const lo = n.type === 'macro' ? 0 : Number(n.params.min), hi = n.type === 'macro' ? 1 : Number(n.params.max);
    // a slider plugged into several knobs is written once per cable: move every copy
    for (const seg of current.segments) {
      if (seg.node !== n.id || seg.role !== 'knob' || seg.key !== 'value') continue;
      engine.setSlider('slider_' + (seg.from + 'slider('.length), Math.min(hi, Math.max(lo, n.params.value)));
    }
  }
}
store.subscribe(liveSlider);
// the browser can refuse to save (its storage is full, or blocked): say so, because a refresh would lose the work
let lastSaveWarn = 0;
store.onSave((ok) => { if (!ok && Date.now() - lastSaveWarn > 300000) { lastSaveWarn = Date.now(); toast('This board could not be saved: the browser\'s storage is full or blocked. Export it now to keep your work.', [{ label: 'Export', fn: () => exportBtn.click() }], 25000); } });

// ---------- visuals from real events ----------
function segmentsAt(loc) {
  const hit = [];
  for (const s of evaluated.segments) if (loc.start >= s.from && loc.end <= s.to) hit.push(s);
  return hit;
}
engine.onHap(({ locations, delayMs, durMs }) => {
  if (getPrefs().animations === false) return;
  const nodes = new Set(), steps = [], ranges = [], textHits = [];
  for (const loc of locations) {
    for (const s of segmentsAt(loc)) {
      nodes.add(s.node);
      if (s.role === 'mini' && s.key === undefined && store.graph.nodes.find((x) => x.id === s.node)?.type === 'sample') textHits.push([s.node, loc.start - s.from - 1, loc.end - s.from - 1]);
      if (s.step !== undefined) steps.push([s.node, s.step, s.track]);
      if (s.role === 'mini') ranges.push(loc);
    }
  }
  if (!nodes.size) return;
  const g = store.graph;
  // BFS downstream from the modules that made the event: each hop is one cable pulse
  const depth = new Map([...nodes].map((n) => [n, 0]));
  const queue = [...nodes];
  const edges = [];
  while (queue.length) {
    const id = queue.shift();
    for (const w of wiresFrom(g, id)) {
      if (w.to.port.startsWith('p:')) continue;
      edges.push([w, depth.get(id)]);
      if (!depth.has(w.to.node)) { depth.set(w.to.node, depth.get(id) + 1); queue.push(w.to.node); }
    }
  }
  setTimeout(() => {
    nodes.forEach((n) => board.flashNode(n, Math.min(durMs, 260)));
    steps.forEach(([n, s, tr]) => board.flashStep(n, s, Math.min(Math.max(durMs, 120), 600), tr));
    if (ranges.length && !panel.diverged) panel.flash(ranges, Math.min(Math.max(durMs, 140), 700));
    textHits.forEach(([nid, a, b]) => board.flashText(nid, a, b, Math.min(Math.max(durMs, 120), 600)));
    for (const [w, d] of edges) {
      board.pulse(w.id, d * 170, 200);
      setTimeout(() => board.flashNode(w.to.node, 160), d * 170 + 200);
    }
  }, delayMs);
});

// ---------- engine / transport ----------
let statusFull = null;
function closeStatusFull() { statusFull?.remove(); statusFull = null; }
function toggleStatusFull() {
  if (statusFull) { closeStatusFull(); return; }
  if (!/^(status )?(error|warn)/.test(statusEl.className)) return;
  const r = statusEl.getBoundingClientRect();
  statusFull = h('div', { class: 'status-full', role: 'alert', style: `left:${Math.max(8, Math.min(r.left, window.innerWidth - 448))}px;top:${r.bottom + 6}px` }, statusEl.textContent,
    h('button', { class: 'btn sm', type: 'button', onclick: () => { try { navigator.clipboard.writeText(statusEl.textContent); } catch { /* no clipboard */ } } }, 'Copy'));
  document.body.append(statusFull);
}
statusEl.addEventListener('click', toggleStatusFull);
statusEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleStatusFull(); } });
document.addEventListener('pointerdown', (e) => { if (statusFull && !statusFull.contains(e.target) && e.target !== statusEl) closeStatusFull(); }, true);
engine.onStatus((s) => {
  if (s.state === 'playing') syncOutScope();
  statusEl.textContent = { idle: 'ready', loading: s.message, ok: 'ok', ready: 'stopped', playing: 'playing', error: 'error: ' + s.message, warn: s.message }[s.state] || s.state;
  statusEl.className = 'status ' + s.state;
  const long = (s.state === 'error' || s.state === 'warn') && s.message;   // the toolbar cuts long messages short: hover shows all of it, a click opens it in a box
  statusEl.title = long ? statusEl.textContent + '\n(click to read it in full)' : '';
  statusEl.tabIndex = long ? 0 : -1; statusEl.setAttribute('role', long ? 'button' : 'status');
  if (!long) closeStatusFull();
  setPlayUI(engine.playing);
});
playBtn.addEventListener('click', async () => {
  if (engine.playing) { engine.stop(); panel.clearFlashes(); board.clearPulses(); setPlayUI(false); return; }
  evaluated = current;
  try { await engine.start(current.code); } catch (e) { toast('Could not start audio: ' + e.message, [], 8000); }
  setPlayUI(engine.playing);
});

// ---------- undo / redo ----------
function doUndo() { if (store.undo()) toast('Undone', [{ label: 'Redo', fn: doRedo }], 2500); }
function doRedo() { store.redo(); }

// ---------- copy / strudel.cc ----------
// Rhythm snapshot: the patch's rhythm over a few bars as a picture (lanes per sound, beat and bar lines at the current tempo, time in seconds)
async function openSnapshot() {
  if (!store.graph.nodes.some((n) => n.type === 'output')) return toast('Add an Output module first, so there is a rhythm to draw.', [], 3500);
  let cycles = 2, last = null;
  const canvas = h('canvas', { class: 'snap-canvas', id: 'snap-canvas', role: 'img', 'aria-label': 'Rhythm snapshot' });
  const msg = h('div', { class: 'menu-empty snap-msg', id: 'snap-msg' }, 'Drawing…');
  const bars = h('select', { id: 'snap-bars', title: 'How many bars to draw', onchange: () => { cycles = Number(bars.value); draw(); } }, [1, 2, 4, 8].map((n) => h('option', { value: n, selected: n === cycles }, n + (n === 1 ? ' bar' : ' bars'))));
  const draw = async () => {
    const out = store.graph.nodes.find((n) => n.type === 'output');
    if (!out) { msg.textContent = 'There is no Output module.'; return; }
    msg.textContent = 'Drawing…';
    try {
      const lay = layoutSnapshot(await queryPatch(current.code, cycles), { bpm: Number(out.params.bpm) || 120, beats: Number(out.params.beats) || 4, cycles });
      last = lay;
      if (!lay.hits) { canvas.width = 1; canvas.height = 1; msg.textContent = 'Nothing plays in these bars yet.'; return; }
      drawSnapshot(canvas, lay);
      msg.textContent = `${lay.hits} hits over ${lay.total.toFixed(2)} s at ${+lay.bpm.toFixed(2)} BPM. Teal lines are beats; the taller ones start each bar.`;
    } catch (e) { msg.textContent = 'Could not draw this: ' + e.message; }
  };
  const blob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));
  const download = async () => {
    const b = await blob(); if (!b || !last) return;
    const a = h('a', { href: URL.createObjectURL(b), download: `rhythm-snapshot-${+last.bpm.toFixed(1)}bpm.png` }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const copy = async () => {
    try { const b = await blob(); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Snapshot copied. Paste it where you want it.', [], 2500); }
    catch { toast('Copy was blocked by the browser. Use Download instead.', [], 4000); }
  };
  showModal('Rhythm snapshot', h('div', {},
    h('div', { class: 'modal-btns snap-row' }, bars, h('button', { class: 'btn', id: 'snap-download', onclick: download }, 'Download PNG'), h('button', { class: 'btn ghost', id: 'snap-copy', onclick: copy }, 'Copy image'), h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')),
    h('div', { class: 'snap-wrap' }, canvas), msg));
  modalEl.firstChild.style.width = 'min(1100px, 100%)';
  draw();
}
async function copyCode() {
  try { await navigator.clipboard.writeText(panel.code); toast('Code copied', [], 1800); }
  catch { toast('Copy blocked by the browser — select the code and copy it by hand.', [], 4000); }
}
function openInStrudel() { window.open('https://strudel.cc/#' + encodeURIComponent(b64(panel.code)), '_blank', 'noopener'); }

// ---------- popovers ----------
let openPop = null;
function showPop(anchor, content) {
  closePop();
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'pop', style: `top:${r.bottom + 6}px;left:${Math.min(r.left, window.innerWidth - 340)}px` }, content);
  popHost.append(pop);
  // keep it on screen: if it runs off the bottom, open it above the anchor (or slide it up), and scroll inside it if it is still too tall
  const pr = pop.getBoundingClientRect(), room = window.innerHeight - 16;
  if (pr.height > room) { pop.style.top = '8px'; pop.style.maxHeight = room + 'px'; pop.style.overflowY = 'auto'; }
  else if (pr.bottom > window.innerHeight - 8) { const above = r.top - pr.height - 6; pop.style.top = Math.max(8, above >= 8 ? above : window.innerHeight - pr.height - 8) + 'px'; }
  openPop = { pop, anchor };
}
function closePop() { openPop?.pop.remove(); openPop = null; }
document.addEventListener('pointerdown', (e) => { if (openPop && !openPop.pop.contains(e.target) && !openPop.anchor.contains(e.target)) closePop(); });

function setBanner(lesson) {
  if (!lesson) { learnEl.hidden = true; return; }
  learnEl.hidden = false;
  learnEl.replaceChildren(h('b', {}, lesson.title), h('div', {}, h('span', { class: 'learned' }, 'What you just learned: '), lesson.learned),
    h('div', { class: 'rebuild' }, 'Rebuild it by hand from the module list, or tweak this one.'));
}
function loadLesson(l) {
  store.replace(l.graph(), 'lesson ' + l.id);
  if (isNarrow()) { closePop(); toast(l.title, [{ label: 'Read the notes', fn: () => setCodeShown(true) }], 7000); }   // on a phone the lesson text is in the code sheet
  setBanner(l);
  closePop();
  requestAnimationFrame(() => board.tidy({ merge: true }));
}
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : { number: 'dev', commit: 'local', dirty: false, date: '' };
const BUILD_LABEL = `${BUILD.number} · ${BUILD.commit}${BUILD.dirty ? '+' : ''}${BUILD.date ? ' · ' + BUILD.date : ''}`;
function openSettings() {
  const seg = (key, label, options) => h('div', { class: 'set-row' }, h('span', { class: 'set-l' }, label),
    h('div', { class: 'seg' }, options.map(([v, t]) => h('button', { class: 'seg-btn' + (getPrefs()[key] === v ? ' on' : ''), onclick: (e) => { setPref(key, v); e.target.parentNode.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b === e.target)); } }, t))));
  showPop(settingsBtn, h('div', { class: 'menu wide' }, h('div', { class: 'menu-h' }, 'Display'),
    seg('colourful', 'Module colours', [[false, 'calm'], [true, 'colourful']]),
    seg('cables', 'Cable style', [['curved', 'curved'], ['step', 'stepped']]),
    seg('labels', 'Cable labels', [['hover', 'on hover'], ['always', 'always']]),
    seg('minimap', 'Board minimap', [[true, 'show'], [false, 'hide']]),
    seg('descriptions', 'Module descriptions', [['folded', 'fold away'], ['shown', 'always show']]),
    seg('jackHelp', 'Socket help (?)', [[true, 'show'], [false, 'hide']]),
    seg('outScope', 'Output waveform', [[true, 'show'], [false, 'hide']]),
    seg('animations', 'Animations', [[true, 'on'], [false, 'off']]),
    seg('codeEdit', 'Code panel', [['free', 'type anywhere'], ['numbers', 'numbers only']]),
    h('div', { class: 'menu-empty' }, 'Off stops the flashing steps, cable pulses, playheads and the live drawing in Piano Roll and Scope, which saves memory and processor time on a big patch. The sound is not affected.'),
    h('div', { class: 'menu-h' }, 'Sound'),
    seg('safeOutput', 'Safe output', [[true, 'on'], [false, 'off']]),
    h('div', { class: 'menu-empty' }, 'Safe output softly rounds off peaks above about 0.8 so a loud patch does not crackle. It is part of this app, not of the code, so it is not in the code panel and is not there on strudel.cc: on, the board sounds a little different from the same code elsewhere only when a patch is very loud.'),
    h('div', { class: 'menu-empty' }, 'These only change how the board looks. The patch and the code are untouched.'),
    h('div', { class: 'menu-empty build', title: 'Quote this when reporting a problem' }, 'Build ' + BUILD_LABEL),
    h('div', { class: 'menu-h' }, 'Audio health'),
    h('pre', { class: 'menu-empty health', id: 'health-text', title: 'Notes can be skipped when the page stalls. If notes go missing, copy this and send it with the problem.' }, healthText()),
    h('button', { class: 'btn sm', id: 'health-copy', onclick: async () => { const t = 'Build ' + BUILD_LABEL + '\n' + healthText(); try { await navigator.clipboard.writeText(t); toast('Audio health copied', [], 1800); } catch { toast('Could not copy', [], 2500); } } }, 'Copy'),
    h('div', { class: 'menu-empty about' }, 'An unofficial visual editor for ', h('a', { href: 'https://strudel.cc', target: '_blank', rel: 'noopener' }, 'Strudel'), ', not made or endorsed by the Strudel team. Built on Strudel (AGPL-3.0).', SOURCE_URL ? [' ', h('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, 'Source code')] : null)));
}
settingsBtn.addEventListener('click', openSettings);
const applyPrefs = () => { wakeAnims(); syncOutScope(); app.classList.toggle('colourful', !!getPrefs().colourful); app.classList.toggle('desc-shown', getPrefs().descriptions === 'shown'); app.classList.toggle('no-anim', getPrefs().animations === false); app.classList.toggle('jack-help', getPrefs().jackHelp !== false); board.clearPulses?.(); views?.dirty?.(); setTimeout(() => board.drawCables(), 0); };
onPrefs(applyPrefs);
applyPrefs();

function openAddMenu() {
  const search = h('input', { class: 'txt add-search', type: 'text', placeholder: 'add a module: filter, chords, drums…', spellcheck: 'false', autocomplete: 'off' });
  const list = h('div', { class: 'add-list' });
  const catName = Object.fromEntries(CATEGORIES);
  let hi = 0, shown = [];
  const render = () => {
    const q = search.value.trim().toLowerCase();
    shown = Object.entries(MODULES).filter(([t, d]) => !(d.single && store.graph.nodes.some((n) => n.type === t)) && (!q || d.title.toLowerCase().includes(q) || t.includes(q) || (catName[d.cat] || '').toLowerCase().includes(q) || d.blurb.toLowerCase().includes(q)))
      .sort(([, a], [, b]) => (a.title.toLowerCase().startsWith(q) ? 0 : 1) - (b.title.toLowerCase().startsWith(q) ? 0 : 1));
    hi = Math.min(hi, Math.max(shown.length - 1, 0));
    list.replaceChildren(...(shown.length ? shown.map(([t, d], i) => h('div', { class: 'add-item' + (i === hi ? ' cur' : ''), onpointerdown: (e) => { if (e.pointerType === 'mouse') { e.preventDefault(); pick(t); } }, onclick: () => pick(t) },
      h('span', { class: 'add-t' }, d.title), h('span', { class: 'add-c' }, catName[d.cat] || ''), h('span', { class: 'add-b' }, d.blurb.split('. ')[0].slice(0, 90)))) : [h('div', { class: 'menu-empty' }, 'No module matches.')]));
    list.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (t) => { closePop(); hooks.addNode(t); };
  search.addEventListener('input', () => { hi = 0; render(); });
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') closePop();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(shown.length, 1); render(); }
    else if (e.key === 'Enter' && shown[hi]) pick(shown[hi][0]);
  });
  showPop(addBtn, h('div', { class: 'menu add-menu' }, search, list));
  render();
  if (!isNarrow()) search.focus();   // on a phone the keyboard would cover the list: tap the search box when you want to type
}
addBtn.addEventListener('click', openAddMenu);

learnBtn.addEventListener('click', () => {
  showPop(learnBtn, h('div', { class: 'menu' }, h('div', { class: 'menu-h' }, 'Learning path'),
    h('button', { class: 'menu-item', onclick: () => { closePop(); showIntro(); } }, 'About this site'),
    LESSONS.flatMap((l, i) => [
      ...(l.section && l.section !== LESSONS[i - 1]?.section ? [h('div', { class: 'menu-h' }, l.section)] : []),
      h('button', { class: 'menu-item', dataset: { lesson: l.id }, onclick: () => loadLesson(l) }, l.title),
    ])));
});

// saves
function fmtTime(t) { return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
// A Hydra module in a saved or imported patch is not run here: tell the person, and keep its code reachable
function noteDropped(g) {
  if (g && g.removedFx && g.removedFx.length) toast(`This patch used ${g.removedFx.map((t) => ({ chorus: 'Chorus', ring: 'Ring mod', leslie: 'Leslie' }[t] || t)).join(', ')}, which Patchboard no longer has because the browser player cannot play it. It was taken out and the cables joined up.`, [], 9000);
  const d = g && g.dropped;
  if (!d || !d.length) return;
  const code = d.map((x) => x.code).filter(Boolean).join('\n\n');
  toast('This patch had a Hydra visuals module. Hydra does not run in Patchboard, so the module was left off the board. Your Hydra code is not lost.',
    code ? [{ label: 'Copy the Hydra code', fn: async () => { try { await navigator.clipboard.writeText(code); toast('Hydra code copied. Paste it into strudel.cc to run it.', [], 5000); } catch { toast('Could not copy the code.', [], 4000); } } }] : [], 16000);
}
function loadGraph(graph, label) {
  noteDropped(graph);
  try { store.replace(graph, label); setBanner(null); closePop(); requestAnimationFrame(() => board.fit()); toast(`Loaded ${label}`, [undoAction], 4000); }
  catch (e) { toast('Could not load: ' + e.message); }
}
savesBtn.addEventListener('click', () => {
  const name = h('input', { class: 'txt', id: 'save-name', placeholder: 'name this patch', spellcheck: 'false' });
  name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') save.click(); });
  const list = h('div', { class: 'menu-list' });
  const save = h('button', { class: 'btn sm', id: 'save-go', onclick: () => {
    const n = name.value.trim();
    if (!n) return name.focus();
    storage.putSave(n, clone(store.graph));
    toast(`Saved “${n}”`, [], 2500); render(); name.value = '';
  } }, 'Save');
  const render = () => {
    list.replaceChildren();
    const saves = storage.saves();
    const names = Object.keys(saves).sort((a, b) => saves[b].t - saves[a].t);
    list.append(h('div', { class: 'menu-h' }, 'Saved patches'));
    if (!names.length) list.append(h('div', { class: 'menu-empty' }, 'Nothing saved yet.'));
    for (const n of names) list.append(h('div', { class: 'menu-row' },
      h('span', { class: 'grow' }, n, h('small', {}, ' ' + fmtTime(saves[n].t))),
      h('button', { class: 'btn sm', onclick: () => loadGraph(saves[n].graph, n) }, 'Load'),
      h('button', { class: 'btn sm', title: 'Delete', onclick: () => {
        const old = storage.deleteSave(n); render();
        toast(`Deleted “${n}”`, [{ label: 'Undo', fn: () => { storage.restoreSave(n, old); } }]);
      } }, '×')));
    const prev = storage.previous();
    if (prev) list.append(h('div', { class: 'menu-h' }, 'Previous session'), h('div', { class: 'menu-row' }, h('span', { class: 'grow' }, 'Where you left off last time'), h('button', { class: 'btn sm', id: 'restore-prev', onclick: () => loadGraph(prev, 'previous session') }, 'Restore')));
    const hist = storage.history();
    list.append(h('div', { class: 'menu-h' }, 'Snapshots (autosaved history)'));
    if (!hist.length) list.append(h('div', { class: 'menu-empty' }, 'Snapshots appear as you edit.'));
    hist.slice(0, 8).forEach((s) => list.append(h('div', { class: 'menu-row' }, h('span', { class: 'grow' }, fmtTime(s.t), h('small', {}, ` ${s.graph.nodes.length} modules`)), h('button', { class: 'btn sm', onclick: () => loadGraph(s.graph, 'snapshot ' + fmtTime(s.t)) }, 'Restore'))));
  };
  render();
  showPop(savesBtn, h('div', { class: 'menu wide' }, h('div', { class: 'menu-row' }, name, save), list));
  name.focus();
});

// ---------- export / import ----------
function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
exportBtn.addEventListener('click', () => {
  showPop(exportBtn, h('div', { class: 'menu' },
    h('button', { class: 'menu-item', id: 'export-json', onclick: () => { download('patch.patchboard.json', JSON.stringify(store.graph, null, 2), 'application/json'); closePop(); } }, 'Patch file (.json) — exact graph'),
    h('button', { class: 'menu-item', id: 'export-strudel', onclick: () => { download('patch.strudel', strudelFile(store.graph)); closePop(); } }, 'Strudel code (.strudel) — with the patch embedded')));
});
// ---------- import: paste code or choose a file ----------
function loadImported(graph, label) {
  loadGraph(graph, label);
  requestAnimationFrame(() => board.tidy({ merge: true }));
}
function reportDialog(r, label, back) {
  const rep = r.report;
  const total = rep.done.length + new Set(rep.skipped.map((s) => s.line)).size;
  const list = rep.skipped.length
    ? h('div', { class: 'imp-list' }, rep.skipped.slice(0, 40).map((s) => h('div', { class: 'imp-row' }, h('span', { class: 'imp-line' }, s.line ? 'line ' + s.line : ''), h('code', {}, s.text), h('span', { class: 'imp-why' }, s.reason))))
    : null;
  const notes = rep.notes.length ? h('div', { class: 'imp-notes' }, rep.notes.map((n) => h('div', {}, '• ' + n))) : null;
  const go = h('button', { class: 'btn', id: 'import-go', onclick: () => { closeModal(); loadImported(r.graph, label); } }, rep.skipped.length ? 'Import what I can' : 'Import');
  const copySkipped = rep.skipped.length ? h('button', { class: 'btn ghost', id: 'import-copy-skipped', title: 'Copy the code that was left out, so nothing is lost', onclick: async () => { try { await navigator.clipboard.writeText([...new Set(rep.skipped.map((s) => s.full || s.text))].join('\n\n')); toast('Skipped code copied', [], 2500); } catch { toast('Could not copy the code.', [], 4000); } } }, 'Copy the skipped code') : null;
  const note = aiNote; aiNote = null;
  const still = (note?.left || []).filter((x) => !/cannot read this/.test(x));
  const aiBox = note && (note.plan || note.limits || still.length) ? h('div', { class: 'ai-note' },
    note.plan ? h('div', {}, h('b', {}, 'The AI\'s plan: '), note.plan) : null,
    note.limits ? h('div', {}, h('b', {}, 'What it could not do: '), note.limits) : null,
    still.length ? h('div', { class: 'ai-left' }, h('b', {}, 'Still not right after a rewrite: '), still.join(' ')) : null) : null;
  const body = h('div', {},
    aiBox,
    h('p', { class: 'imp-sum' }, r.empty ? 'Nothing in this code could be turned into modules.' : `Built ${r.graph.nodes.filter((n) => n.type !== 'output').length} modules from ${rep.done.length} pattern${rep.done.length === 1 ? '' : 's'}.`, rep.skipped.length ? ` ${rep.skipped.length} part${rep.skipped.length === 1 ? '' : 's'} could not be shown as modules:` : ' Everything was converted.'),
    list, notes,
    h('p', { class: 'imp-hint' }, 'Skipped parts are left out, not guessed. Importing replaces the board (Undo brings it back).'),
    h('div', { class: 'modal-btns' }, r.empty ? null : go, copySkipped, h('button', { class: 'btn ghost', onclick: back }, 'Back')));
  void total;
  showModal('What the import found', body);
}
let modalEl = null;
// the long description of a module (its "more" sections) in a panel on the right, over the code column, so the module itself stays short
let helpEl = null;
function closeHelp() { helpEl?.remove(); helpEl = null; }
function showHelp(type) {
  const def = MODULES[type];
  if (!def?.more) return;
  closeHelp();
  helpEl = h('aside', { class: 'help-drawer', role: 'dialog', 'aria-label': def.title + ' in depth' },
    h('div', { class: 'help-head' }, h('b', {}, def.title + ' in depth'), h('button', { class: 'btn sm', type: 'button', onclick: closeHelp }, 'Close')),
    h('div', { class: 'help-body' }, ...def.more.map(([hd, tx]) => h('section', {}, h('h4', {}, hd), h('p', {}, tx)))));
  document.body.append(helpEl);
  helpEl.querySelector('.help-body').focus?.();
}
const modalCloseHooks = [];   // things a window cleans up when it closes (a recording window stops listening to the keyboard)
function closeModal() { modalEl?.remove(); modalEl = null; while (modalCloseHooks.length) { try { modalCloseHooks.pop()(); } catch { /* ignore */ } } }
function showModal(title, body) {
  closeModal();
  modalEl = h('div', { class: 'modal-back', onpointerdown: (e) => { if (e.target === modalEl) closeModal(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-label': title }, h('h3', {}, title), body));
  document.body.append(modalEl);
}
function importText(text, label, back) {
  const t = text.trim();
  if (!t) return toast('Paste some Strudel code first.', [], 3000);
  try {
    if (t.startsWith('{')) { loadGraph(parseImport(t).graph, label); return closeModal(); }
    const m = parseImport(t);
    if (m.graph && !m.error) { closeModal(); return loadGraph(m.graph, label); }
    // exported by this app but edited, or code from anywhere else: read the code itself
    const code = t.replace(/\/\*\s*patchboard-patch v1[\s\S]*?\*\/\s*$/, '').replace(/^\/\/ Strudel Patchboard export.*\n/, '');
    const r = importStrudel(code, { sounds: (name, bank) => soundsFor(bank || '').includes(name) });
    if (r.error) return toast(r.error, [], 9000);
    reportDialog(r, label, back);
  } catch (e) { toast('Could not read that: ' + e.message, [], 8000); }
}
// Read the code this board writes and build the board again from it. Pasting code into the code panel only applies what changed, so a board made by an
// older import keeps its old shape; this makes the board the way an import would make it now (shared synths, Note Patterns, and so on).
function rebuildFromCode() {
  const before = store.graph.nodes.length;
  if (!before) return toast('The board is empty, so there is nothing to rebuild.', [], 3000);
  const r = importStrudel(compile(store.graph).code, { sounds: (name, bank) => soundsFor(bank || '').includes(name) });
  if (r.error) return toast('Could not rebuild: ' + r.error, [], 8000);
  const after = r.graph.nodes.length, lost = r.report.skipped.length;
  const body = h('div', {},
    h('p', { class: 'imp-hint' }, `The board is read back from its own code and built again: ${before} modules become ${after}. It plays the same, but module positions, colours, collapsed and muted states, and settings the code does not carry are reset.`),
    lost ? h('p', { class: 'imp-hint' }, `${lost} part${lost === 1 ? '' : 's'} of the code could not be turned into modules and would be left out.`) : h('p', { class: 'imp-hint' }, 'Everything in the code can be turned into modules.'),
    h('div', { class: 'modal-btns' },
      h('button', { class: 'btn', id: 'rebuild-go', onclick: () => { closeModal(); loadGraph(r.graph, `rebuilt board (${before} → ${after} modules)`); } }, 'Rebuild'),
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel')));
  showModal('Rebuild this board from its code?', body);
}
// Record from a MIDI keyboard (or the computer keyboard). A new recording becomes a Take module (plugged into an Instrument); with replaceId it replaces that Take's notes,
// and the one it replaces is kept under Earlier takes.
function openRecord(replaceId = null) {
  const out = store.graph.nodes.find((n) => n.type === 'output'), target = replaceId ? nodeById(store.graph, replaceId) : null;
  openRecorder({
    h, showModal, closeModal, onClose: (fn) => modalCloseHooks.push(fn),
    addLabel: target ? 'Use this take' : 'Add to the board',
    getTempo: () => ({ bpm: Number(out?.params.bpm) || 120, beatsPerBar: Number(out?.params.beats) || 4 }),
    onAdd(take, grid) {
      if (target) return hooks.setTake(replaceId, take, grid);
      const names = new Set(store.graph.nodes.filter((n) => n.type === 'take').map((n) => n.params.name));
      let k = 1; while (names.has('Take ' + k)) k++;
      const t = makeNode('take', 0, 0, cleanParams('take', { name: 'Take ' + k, grid, bpm: take.bpm, beats: take.beatsPerBar, events: take.events, versions: [] }));
      const sy = makeNode('synth', 0, 0, { wave: 'triangle' }), o = makeNode('output', 0, 0);
      const g = { v: 1, nodes: [t, sy, o], wires: [{ id: uid('w'), from: { node: t.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: uid('w'), from: { node: sy.id, port: 'out' }, to: { node: o.id, port: 'in' } }] };
      let added = [];
      store.update((cur) => { added = mergeGraph(cur, g); }, { label: 'add a recorded take' });
      requestAnimationFrame(() => added[0] && board.reveal?.(added[0]));
      toast(`Added "Take ${k}": ${take.events.length} note${take.events.length === 1 ? '' : 's'}. Press Re-record on it to play it again.`, [undoAction], 7000);
    },
  });
}
function openImport() {
  const area = h('textarea', { class: 'imp-area', id: 'import-text', spellcheck: 'false', placeholder: 'Paste Strudel code here, e.g.\n\nsetcpm(120/4)\n\$: s("bd*2 ~ sd").bank("RolandTR909")' });
  area.addEventListener('keydown', (e) => e.stopPropagation());
  const body = h('div', {},
    h('p', { class: 'imp-hint' }, 'Any Strudel code works: from strudel.cc, a .strudel file, or a patch exported from here. A MIDI file (.mid) works too: each part becomes a Take. Parts that modules cannot express are listed, never guessed.'),
    area,
    h('div', { class: 'modal-btns' },
      h('button', { class: 'btn', id: 'import-paste-go', onclick: () => importText(area.value, 'pasted code', openImport) }, 'Import this code'),
      h('button', { class: 'btn ghost', id: 'import-choose', onclick: () => fileInput.click() }, 'Choose a file…'),
      h('button', { class: 'btn ghost', id: 'import-record', title: 'Play a MIDI keyboard (or the computer keyboard) and add what you play to the board', onclick: () => { closeModal(); openRecord(); } }, 'Record notes…'),
      h('button', { class: 'btn ghost', id: 'import-rebuild', title: 'Read the code this board writes and build the board again from it, the way an import would make it now. Useful for a board made by an older import.', onclick: () => { closeModal(); rebuildFromCode(); } }, 'Rebuild this board'),
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel')));
  showModal('Import', body);
  setTimeout(() => area.focus(), 0);
}
// A MIDI file: each track (and channel) becomes a Take plugged into its own Instrument, so the notes play as written and can be edited on the Take's roll.
function openMidiImport(name, r) {
  if (r.error) return toast(`${name}: ${r.error}`, [], 8000);
  const out = store.graph.nodes.find((n) => n.type === 'output'), rows = r.tracks.map((t) => ({ t, on: !t.drums && t.events.length > 0 }));
  const boxes = rows.map((x, i) => h('input', { type: 'checkbox', id: 'midi-track-' + i, checked: x.on, onchange: (e) => { x.on = e.target.checked; sync(); } }));
  const tempo = h('input', { type: 'checkbox', id: 'midi-tempo', checked: !!out });
  const go = h('button', { class: 'btn', id: 'midi-add' }, 'Add to the board');
  const nm = (n) => noteName(n);
  const list = rows.map((x, i) => h('label', { class: 'field rec-field' }, boxes[i], h('span', {}, `${x.t.name}: ${x.t.total} notes, ${nm(x.t.low)} to ${nm(x.t.high)}, ${Math.max(1, Math.ceil(x.t.beats / r.beatsPerBar))} bar${Math.ceil(x.t.beats / r.beatsPerBar) > 1 ? 's' : ''}${x.t.drums ? ' (drums: they play as notes of a synth here)' : ''}${x.t.trimmed ? `, only the first ${x.t.events.length} kept` : ''}`)));
  const sync = () => { const k = rows.filter((x) => x.on).length; go.disabled = !k; go.textContent = k > 1 ? `Add ${k} takes to the board` : 'Add to the board'; };
  go.addEventListener('click', () => {
    const picked = rows.filter((x) => x.on).map((x) => x.t); if (!picked.length) return;
    const names = new Set(store.graph.nodes.filter((n) => n.type === 'take').map((n) => n.params.name));
    const g = { v: 1, nodes: [], wires: [] }, o = makeNode('output', 0, 0); g.nodes.push(o);
    picked.forEach((t, i) => {
      let nmx = t.name, k = 2; while (names.has(nmx)) nmx = `${t.name} ${k++}`; names.add(nmx);
      const tk = makeNode('take', 0, i * 200, cleanParams('take', { name: nmx, grid: pickGrid(t.events), bpm: r.bpm, beats: r.beatsPerBar, events: t.events, versions: [] })), sy = makeNode('synth', 300, i * 200, { wave: 'triangle' });
      g.nodes.push(tk, sy);
      g.wires.push({ id: uid('w'), from: { node: tk.id, port: 'out' }, to: { node: sy.id, port: 'in' } }, { id: uid('w'), from: { node: sy.id, port: 'out' }, to: { node: o.id, port: 'in' } });
    });
    let added = [];
    store.update((cur) => {
      added = mergeGraph(cur, g);
      const co = cur.nodes.find((n) => n.type === 'output');
      if (tempo.checked && co) { co.params.bpm = r.bpm; co.params.beats = r.beatsPerBar; }
    }, { label: 'import a MIDI file' });
    closeModal();
    requestAnimationFrame(() => added[0] && board.reveal?.(added[0]));
    toast(`Added ${picked.length} take${picked.length === 1 ? '' : 's'} from ${name}.${tempo.checked ? '' : ` The file is at ${r.bpm} BPM; the board keeps its own tempo.`}`, [undoAction], 7000);
  });
  const body = h('div', { class: 'rec' },
    h('p', { class: 'imp-hint' }, `${name}: ${r.tracks.length} part${r.tracks.length === 1 ? '' : 's'}, ${r.bpm} BPM, ${r.beatsPerBar} beats a bar. Pick the parts to add; each becomes a Take on its own Instrument.`),
    ...list,
    out ? h('label', { class: 'field rec-field' }, tempo, h('span', {}, `set the board's tempo to ${r.bpm} BPM, ${r.beatsPerBar} beats a bar`)) : '',
    ...r.warnings.map((w) => h('p', { class: 'imp-hint' }, w)),
    h('div', { class: 'modal-btns' }, go, h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel')));
  sync();
  showModal('Import a MIDI file', body);
}
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  fileInput.value = '';
  if (!f) return;
  if (f.size > 2_000_000) return toast(`That file is too large (${Math.round(f.size / 1000)} KB; the limit is 2000 KB).`, [], 7000);
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (isMidiFile(f.name, bytes)) return openMidiImport(f.name, parseMidi(bytes));
    importText(new TextDecoder().decode(bytes), f.name, openImport);
  }
  catch (e) { toast('Could not read that file: ' + e.message, [], 8000); }
});

// A Number Pattern on an Arrange's "order" can name a section the Arrange does not have yet: give it that many sections (never fewer)
function growArrangeFor(g, np) {
  for (const w of g.wires) {
    if (w.from.node !== np.id || w.to.port !== 'order') continue;
    const ar = nodeById(g, w.to.node);
    if (!ar || ar.type !== 'arrange') continue;
    const top = Math.max(0, ...String(np.params.text || '').split(/\s+/).map((t) => Number(/^(\d+)/.exec(t)?.[1] || 0)));
    if (top > ar.params.n) ar.params.n = Math.min(6, top);
  }
}

// ---------- AI helper (bring your own key) ----------
const noKeys = (el) => { el.addEventListener('keydown', (e) => e.stopPropagation()); return el; };
function openAI(view) {
  const ai = getAI();
  if (!ai.key || view === 'key') return aiKeyDialog();
  const desc = noKeys(h('textarea', { class: 'imp-area ai-desc', id: 'ai-desc', rows: 3, spellcheck: 'false', placeholder: 'Describe a song, e.g. "a slow lo-fi hip hop loop with soft piano chords and a dusty beat"' }));
  const status = h('div', { class: 'ai-status', id: 'ai-status', 'aria-live': 'polite' });
  const buttons = [];
  const busy = (on, text = '') => { buttons.forEach((b) => { b.disabled = on; }); status.textContent = text; };
  const refineBox = noKeys(h('textarea', { class: 'imp-area ai-desc', id: 'ai-refine-text', rows: 2, spellcheck: 'false', placeholder: 'Change what is on the board, e.g. "make the hats more syncopated", "bigger, slower swell", "darker bass"' }));
  const refine = h('button', { class: 'btn', id: 'ai-refine', onclick: async () => {
    const q = refineBox.value.trim();
    if (!q) return toast('Say what to change first.', [], 3000);
    if (!store.graph.nodes.length) return toast('The board is empty: make a starter first.', [], 4000);
    busy(true, 'Changing your patch…');
    try { await aiRefine(q, (t) => busy(true, t)); } catch (e) { busy(false, e.message); }
  } }, 'Change my patch');
  const make = h('button', { class: 'btn', id: 'ai-make', onclick: async () => {
    const q = desc.value.trim();
    if (!q) return toast('Describe the song first.', [], 3000);
    busy(true, 'Writing a patch…');
    try { await aiStarter(q, (t) => busy(true, t)); } catch (e) { busy(false, e.message); }
  } }, 'Make a starter patch');
  const review = h('button', { class: 'btn', id: 'ai-review', onclick: async () => {
    if (!store.graph.nodes.length) return toast('The board is empty: add something or make a starter first.', [], 4000);
    busy(true, 'Listening to your patch…');
    try { await aiReview(); } catch (e) { busy(false, e.message); }
  } }, 'Review my patch');
  buttons.push(make, review, refine);
  showModal('AI helper', h('div', { class: 'ai-box' },
    h('p', { class: 'imp-hint' }, 'Make a starter from a description, or get plain-language feedback on the patch on the board. The AI writes Strudel code and it comes in through Import, so you see what was understood before anything changes (Undo brings your board back).'),
    desc, h('div', { class: 'modal-btns' }, make),
    h('hr', { class: 'ai-hr' }),
    h('p', { class: 'imp-hint' }, 'Already have something on the board? Ask for a change and the AI rewrites the patch with it.'),
    refineBox, h('div', { class: 'modal-btns' }, refine),
    h('hr', { class: 'ai-hr' }),
    h('p', { class: 'imp-hint' }, 'Review sends the code of your patch, any warnings, and whether it clipped or overloaded.'),
    h('div', { class: 'modal-btns' }, review, h('button', { class: 'btn ghost', onclick: () => openAI('key') }, 'Key and model'), h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')),
    status));
  setTimeout(() => desc.focus(), 0);
}
function aiKeyDialog() {
  const ai = getAI();
  const key = noKeys(h('input', { class: 'txt', id: 'ai-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-ant-…', value: ai.key }));
  const model = h('select', { class: 'sel', id: 'ai-model' }, AI_MODELS.map(([v, t]) => h('option', { value: v, selected: v === ai.model }, t)));
  const remember = h('input', { type: 'checkbox', id: 'ai-remember', checked: ai.remembered });
  showModal('AI helper: your key', h('div', { class: 'ai-box' },
    h('p', { class: 'imp-hint' }, 'This uses your own Anthropic API key (create one at console.anthropic.com). Usage is billed to your account, so set a spending limit there.'),
    h('ul', { class: 'ai-notes' },
      h('li', {}, 'By default the key is kept only in this tab\'s memory: it is forgotten when you close or reload the page. It is never sent to this site or anywhere except api.anthropic.com.'),
      h('li', {}, 'Ticking "Remember on this device" stores it in this browser so you do not have to paste it again. Anything that can run script on this page, and anyone who can use this browser profile, could then read it. Leave it off on a shared computer.'),
      h('li', {}, 'What you type, and for a review the code of your patch, is sent to Anthropic. Nothing else is.'),
      h('li', {}, 'Use a key you can delete or limit, not your main one.')),
    h('label', { class: 'set-l' }, 'API key'), key,
    h('label', { class: 'set-l' }, 'Model'), model,
    h('label', { class: 'ai-remember' }, remember, ' Remember on this device (stored in this browser)'),
    h('div', { class: 'modal-btns' },
      h('button', { class: 'btn', id: 'ai-save', onclick: () => { const k = key.value.trim(); if (!k) return toast('Paste your API key first.', [], 3000); setAI({ key: k, model: model.value, remember: remember.checked }); toast(remember.checked ? 'Key saved in this browser.' : 'Key kept for this tab only.', [], 2500); openAI(); } }, 'Save'),
      ai.key ? h('button', { class: 'btn ghost', onclick: () => { clearAI(); toast('Key removed.', [], 3000); closeModal(); } }, 'Remove key') : null,
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Cancel'))));
  setTimeout(() => key.focus(), 0);
}
// One attempt = the AI's reply, read by the importer, plus everything that is wrong with it (what could not be read, the editor's own warnings, and the checks in ai.js)
function judgeAttempt(reply, desc) {
  const p = parseReply(reply);
  if (!p.code) return { ...p, problems: ['The reply had no code block.'], r: null };
  const r = importStrudel(p.code, { sounds: (name, bank) => soundsFor(bank || '').includes(name) });
  const problems = lintStarter(p.code, desc);
  if (r.error) problems.push(r.error);
  else {
    r.report.skipped.forEach((s) => problems.push(`line ${s.line}: ${s.reason || s.text} (the editor cannot read this)`));
    try { compile(r.graph).issues.forEach((i) => problems.push(i.msg)); } catch { /* the import dialog will say */ }
  }
  return { ...p, problems, r };
}
let aiNote = null;   // the AI's plan and limits, shown at the top of the import dialog
async function aiGenerate({ system, user, desc, say }) {
  let a = judgeAttempt(await askAI({ system, user, maxTokens: 4000 }), desc);
  if (a.problems.length) {   // one rewrite, with every problem spelled out
    say('Improving it (' + a.problems.length + (a.problems.length === 1 ? ' problem' : ' problems') + ' found)…');
    try {
      const b = judgeAttempt(await askAI({ system, user: `${user}\n\nYour earlier attempt:\n\`\`\`js\n${a.code}\n\`\`\`\n\nProblems with it:\n- ${a.problems.join('\n- ')}\n\nFix every one of them and return the whole patch in the same reply shape.`, maxTokens: 4000 }), desc);
      if (b.code && b.problems.length <= a.problems.length) a = b;
    } catch { /* keep the first attempt: the import dialog lists what was left out */ }
  }
  if (!a.code) throw new Error('The answer had no code in it. Try again, or describe it differently.');
  aiNote = { plan: a.plan, limits: a.limits, left: a.problems };
  importText(a.code, 'AI patch', () => openAI());
}
const aiStarter = (desc, say) => aiGenerate({ system: STARTER_SYSTEM, user: desc, desc, say });
const aiRefine = (request, say) => aiGenerate({ system: REFINE_SYSTEM, user: `Current patch:\n\`\`\`js\n${current.code}\n\`\`\`\n\nChange requested: ${request}`, desc: request, say });
async function aiReview() {
  const measured = [];
  if (Date.now() - lastOver < 8000) measured.push(engine.limiterOn() ? 'the sound reached full volume and the limiter had to work' : 'the sound clipped');
  if (Date.now() - lastBusy < 20000) measured.push('the computer could not keep up and the audio broke up (too many voices, long releases or big reverbs)');
  if (!engine.playing) measured.push('the patch was not playing while this was measured');
  const text = await askAI({ system: REVIEW_SYSTEM, user: reviewPrompt({ code: current.code, issues: current.issues.map((i) => i.msg), measured }) });
  const code = extractCode(text), say = stripCode(text);
  showModal('AI review', h('div', { class: 'ai-box' },
    h('div', { class: 'ai-answer', id: 'ai-answer' }, say || 'No comments.'),
    h('p', { class: 'imp-hint' }, 'This is an AI\'s opinion and it can be wrong. It has not heard the sound either; it read the code and what the editor measured.'),
    h('div', { class: 'modal-btns' },
      code ? h('button', { class: 'btn', id: 'ai-try', onclick: () => importText(code, 'AI suggestion', () => openAI()) }, 'Try the suggested version') : null,
      h('button', { class: 'btn ghost', onclick: () => openAI() }, 'Back'),
      h('button', { class: 'btn ghost', onclick: closeModal }, 'Close'))));
}

// ---------- keyboard ----------
let spaceTimer = null;
window.addEventListener('keyup', (e) => {
  if (e.key !== ' ' || board.tool !== 'select') return;
  if (spaceTimer) { clearTimeout(spaceTimer); spaceTimer = null; if (!e.target.closest?.('input, textarea, select, [contenteditable]')) playBtn.click(); }   // a quick tap: play or stop
  else board.holdHand(false);                                                                                                                                  // it was held: back to the Select tool
});
window.addEventListener('blur', () => { clearTimeout(spaceTimer); spaceTimer = null; board.holdHand(false); });
window.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openAddMenu(); return; }
  if (mod && e.key === '\\') { e.preventDefault(); setCodeShown(!codeShown); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if (typing) return;
  if ((e.key === 'Delete' || e.key === 'Backspace')) {
    if (board.selectedWire) { e.preventDefault(); hooks.removeWire(board.selectedWire); }
    else if (board.selection.length > 1) { e.preventDefault(); hooks.removeNodes(board.selection); }
    else if (board.selected) { e.preventDefault(); hooks.removeNode(board.selected); }
  }
  if (mod && e.key.toLowerCase() === 'd' && board.selection.length > 1) { e.preventDefault(); hooks.duplicateNodes(board.selection); return; }
  if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); if (board.selection.length > 1) hooks.groupNodes(board.selection); return; }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); board.selectAll(); return; }
  if (!mod && !e.altKey && (e.key === 'v' || e.key === 'V' || e.key === 'h' || e.key === 'H')) {   // V: select tool (drag empty canvas to box-select); H: hand tool (drag to move the canvas)
    const sel = e.key.toLowerCase() === 'v';
    if (board.tool !== (sel ? 'select' : 'hand')) { board.setTool(sel ? 'select' : 'hand'); toast(sel ? 'Select tool: drag on empty canvas to box-select. H for the hand, or hold Space.' : 'Hand tool: drag the canvas to move it. V to select.', [], 2600); }
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    if (board.tool === 'select') { if (!e.repeat && !spaceTimer) spaceTimer = setTimeout(() => { spaceTimer = null; board.holdHand(true); }, 220); return; }   // in the Select tool a quick tap still plays; holding Space is the hand
    if (!e.repeat) playBtn.click();
  }
  if (e.key === 'Escape') { closePop(); closeModal(); closeHelp(); closeIntro(); board.select(null); }
});
window.addEventListener('beforeunload', () => store.flush());

// ---------- boot ----------
setCodeShown(codeShown);
setPaletteShown(paletteShown);
// the person's own text survives a reload when the board is still exactly what it was written against
let savedText = null;
try { savedText = JSON.parse(localStorage.getItem(TEXT_KEY) || 'null'); } catch { /* none */ }
afterChange();
if (savedText && typeof savedText.text === 'string' && savedText.text.length < 300000 && savedText.base === current.code && savedText.text !== current.code && getPrefs().codeEdit !== 'numbers') {
  panel.patch(savedText.text); panel.sync(current, showNotes); textBase = savedText.base;
  setSync(checkSync(store.graph, savedText.text, { sounds: knownSounds() })); saveText();
}
onPrefs((p, k) => {
  if (k !== 'codeEdit') return;
  panel.setFree(p.codeEdit !== 'numbers');
  readOnlyNote.textContent = noteText();
  if (p.codeEdit === 'numbers' && panel.diverged) { panel.setCompiled(current, showNotes); textBase = current.code; setSync({ state: 'ok' }); saveText(); toast('The code panel shows the board\'s code again; your own text was replaced.', [], 5000); }
  else renderSync();
});

if (firstLesson) setBanner(firstLesson);
requestAnimationFrame(() => (firstLesson ? board.tidy({ merge: true }) : board.fit()));
// ---------- intro page ----------
// Shown on a first visit and from the brand name or the Learn menu: what this is, and which button opens the learning path.
const TOOL_TOUR = [['plus', 'Add', false], ['newfile', 'New', false], ['undo', 'Undo', false], ['redo', 'Redo', false], ['book', 'Learn', true], ['folder', 'Saves', false], ['download', 'Export', false], ['upload', 'Import', false], ['sliders', 'Settings', false], ['code', 'Code', false]];
// where the toolbar really is right now: along the bottom of the screen on a narrow window (a phone, or a small desktop window), top right otherwise
const toolbarWhere = () => {
  const r = document.querySelector('.toolbar')?.getBoundingClientRect();
  return r && r.top > window.innerHeight / 2 ? 'The toolbar, along the bottom of the screen' : 'The toolbar, top right';
};
const refreshIntroWhere = () => { const el = document.getElementById('intro-where'); if (el) el.textContent = toolbarWhere(); };
window.addEventListener('resize', refreshIntroWhere);
let introEl = null;
function closeIntro() { introEl?.remove(); introEl = null; try { localStorage.setItem('pb.introSeen', '1'); } catch { /* private mode */ } }
function showIntro() {
  closeIntro();
  const step = (n, title, text) => h('li', {}, h('b', {}, n + '  ' + title), h('span', {}, text));
  introEl = h('div', { class: 'intro-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'About Strudel Patchboard', onpointerdown: (e) => { if (e.target === introEl) closeIntro(); } },
    h('div', { class: 'intro' },
      h('h2', {}, h('b', {}, 'Strudel'), ' Patchboard'),
      h('p', { class: 'intro-lead' }, 'Learn ', h('a', { href: 'https://strudel.cc', target: '_blank', rel: 'noopener' }, 'Strudel'), ', the live-coding music language, by seeing what the code means. Every module you build is shown as the Strudel code it writes, line by line, and the code can be changed and played right here.'),
      h('ol', { class: 'intro-steps' },
        step('1', 'Build it with modules', 'Add a melody, a drum machine or an instrument and drag cables between them. Turn knobs and draw notes, and it plays as you go.'),
        step('2', 'Read the code it writes', 'The panel shows the Strudel code for your patch, with a plain-English note on each line. Each piece of code lines up with the module that made it, so you can see what every word does.'),
        step('3', 'Change the code, see it update', 'Click a number in the code and type a new one, or pick another sound or option from its dropdown. The module and the sound change straight away. You can also paste in Strudel code you already have, and it turns into modules.')),
      h('div', { class: 'intro-tools', role: 'group', 'aria-label': 'The toolbar' },
        h('div', { class: 'intro-tools-h', id: 'intro-where' }, toolbarWhere()),
        h('div', { class: 'intro-icons' }, TOOL_TOUR.map(([name, label, on]) => h('div', { class: 'intro-ic' + (on ? ' on' : '') }, h('span', { class: 'intro-ic-box' }, icon(name, on ? 26 : 20)), h('small', {}, label)))),
        h('p', { class: 'intro-tools-note' }, h('b', {}, 'Learning path: '), `${LESSONS.length} short lessons teach Strudel one idea at a time, from a single drum sound to layering, harmony, FM synthesis and effects. Each lesson is a patch you can open, change and rebuild by hand.`)),
      h('div', { class: 'intro-btns' },
        h('button', { class: 'btn primary', id: 'intro-start', type: 'button', onclick: () => { closeIntro(); loadLesson(LESSONS[0]); requestAnimationFrame(() => board.tidy({ merge: true })); } }, 'Start the first lesson'),
        h('button', { class: 'btn', type: 'button', onclick: closeIntro }, 'Look around')),
      h('p', { class: 'intro-foot' }, 'An unofficial tool, not made or endorsed by the Strudel team. Free and open source (AGPL-3.0). Sound plays in your browser; nothing is uploaded.')));
  document.body.append(introEl);
  introEl.querySelector('#intro-start')?.focus();
}
document.querySelector('.brand')?.addEventListener('click', showIntro);
document.querySelector('.brand')?.setAttribute('title', 'About this site');
let introSeen = false;
try { introSeen = localStorage.getItem('pb.introSeen') === '1'; } catch { /* private mode */ }
if (!introSeen) showIntro();

window.addEventListener('resize', () => board.drawCables());
// the lesson text sits in the code column: under the code on a wide screen, at the top of the code sheet on a phone (so it is gone when the sheet is closed)
function placeLearn() {
  if (isNarrow()) codeCol.insertBefore(learnEl, codeHost);
  else codeCol.insertBefore(learnEl, issuesEl);
}
narrowQuery.addEventListener('change', () => {
  placeLearn();
  setCodeShown(isNarrow() ? false : localStorage.getItem('pb.codeShown') !== '0');   // a phone starts with the code closed; a wide screen goes back to what was chosen
  requestAnimationFrame(() => board.fit());
});
placeLearn();
