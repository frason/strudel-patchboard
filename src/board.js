// The patchboard: pannable/zoomable page, module panels with real controls, typed jacks, cables.
import { MUTE_KIND, cellNotes, noteRank as pitchRank, pitchModel, SCALES, parseX, leafAt, stepHas, slotWidth, xLabel, MODULES, PORT_TYPES, NOTE_NAMES, fmt, portsOf, CATEGORIES, PALETTE_GROUPS, DRUM_PRESETS, MELODY_TEMPLATES, parseArrangeOrder, withOrderLen, FM_WAVE_NAMES, OWAVE, fmWaveFn } from './modules.js';
import { soundsFor, isValidSound, describe, sampleItems, sampleCategoryOf, SAMPLE_CATS } from './catalog.js';
import { isFav, toggleFav, favCount } from './favorites.js';
import { getPrefs, onPrefs, setPref } from './prefs.js';
import { drawPreview } from './previews.js';
import { ROOT_NAMES, CHORD_QUALITIES, EXTENSIONS, chordSymbol, romanName, degreeCount, chordHas, chordSemis, chordNoteNames, PRESETS, presetRoman } from './chords.js';
import { INSTRUMENTS, CATEGORIES as INST_CATS, instrumentOf } from './instruments.js';
import { buildFmDiagram } from './fmdiagram.js';
import { buildPulseDiagram } from './pulsediagram.js';
import { FXPICS } from './fxpics.js';
import { ROLLS } from './rollview.js';
import { CONVERTERS } from './convert.js';
import { HARMPICS, NOTEFILTERPICS } from './harmpic.js';
import { TAKEPICS } from './takepic.js';
const openText = new Set();   // text boxes the person pinned open (a long text otherwise folds to one line)
const autosize = (ta) => { ta.style.height = 'auto'; if (ta.scrollHeight) ta.style.height = ta.scrollHeight + 2 + 'px'; };   // a text box that grows with its lines
const PICS = { ...FXPICS, ...ROLLS, ...HARMPICS, ...NOTEFILTERPICS, ...TAKEPICS };   // every small picture a module can show, by the flag it sets in its data
import { soundIconSvg, hasSoundIcon, soundGlyph } from './soundicons.js';
import { icon } from './icons.js';
import { buildFxRack } from './fxrack.js';
import { buildMixer } from './mixer.js';
import { effectiveKey, makeNode, nodeById, outType, whyNot, wiresInto, uid, flowOrder, legalTargets, legalSources, insertPlan } from './graph.js';

const SNAP = 24;
const NS = 'http://www.w3.org/2000/svg';
const accent = () => (getComputedStyle(document.getElementById('app') || document.body).getPropertyValue('--accent') || '#f3c9a0').trim();

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
const svg = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

// ---------- knob value mapping ----------
function toVal(spec, range, t) {
  const { min, max } = range;
  let v;
  if (spec.log && min > 0) v = min * Math.pow(max / min, t);
  else if (spec.log) v = min + (max - min) * t * t * t;
  else v = min + (max - min) * t;
  const step = spec.step || 0.01;
  v = Math.round(v / step) * step;
  return Math.min(max, Math.max(min, Number(v.toFixed(6))));
}
function toT(spec, range, v) {
  const { min, max } = range;
  if (max === min) return 0;
  let t;
  if (spec.log && min > 0) t = Math.log(Math.max(v, min) / min) / Math.log(max / min);
  else if (spec.log) t = Math.cbrt((v - min) / (max - min));
  else t = (v - min) / (max - min);
  return Math.min(1, Math.max(0, t));
}

function makeKnob(spec, onChange) {
  const R = 17, C = 24;
  const body = svg('svg', { viewBox: '0 0 48 48', class: 'knob-svg', width: 48, height: 48 });
  const arcPath = (a0, a1, r) => {
    const p = (a) => [C + r * Math.sin(a), C - r * Math.cos(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const MIN = -2.36, MAX = 2.36;
  const track = svg('path', { d: arcPath(MIN, MAX, 21), class: 'k-track' });
  const fill = svg('path', { class: 'k-fill' });
  const cap = svg('circle', { cx: C, cy: C, r: R, class: 'k-cap' });
  const dot = svg('line', { x1: C, y1: C - 5, x2: C, y2: C - R + 3, class: 'k-ind' });
  body.append(track, fill, cap, dot);
  const el = h('div', { class: 'knob', tabindex: 0, role: 'slider', 'aria-label': spec.label, title: (spec.tip || spec.label) + ' (click, then ↑ ↓ for one step, Shift for ten)' }, body);
  let range = { min: spec.min, max: spec.max }, value = spec.def, disabled = false;

  const draw = () => {
    const t = toT(spec, range, value);
    const a = MIN + (MAX - MIN) * t;
    dot.setAttribute('transform', `rotate(${(a * 180) / Math.PI} ${C} ${C})`);
    el.setAttribute('aria-valuemin', range.min); el.setAttribute('aria-valuemax', range.max); el.setAttribute('aria-valuenow', value);
    fill.setAttribute('d', t > 0.005 ? arcPath(MIN, a, 21) : '');
  };
  const set = (v) => { value = v; draw(); };
  const commit = (v) => { if (v !== value) { value = v; draw(); onChange(v); } };

  el.addEventListener('pointerdown', (e) => {
    if (disabled) return;
    e.preventDefault(); e.stopPropagation();
    el.focus({ preventScroll: true });   // preventDefault stops the browser doing this, and the arrow keys need the focus
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, t0 = toT(spec, range, value);
    el.classList.add('turning');
    const move = (ev) => {
      const k = ev.shiftKey ? 700 : 170;
      commit(toVal(spec, range, Math.min(1, Math.max(0, t0 + (y0 - ev.clientY) / k))));
    };
    const up = () => { el.classList.remove('turning'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => !disabled && commit(spec.def));
  el.addEventListener('wheel', (e) => {
    if (disabled) return;
    e.preventDefault(); e.stopPropagation();
    commit(toVal(spec, range, Math.min(1, Math.max(0, toT(spec, range, value) + (e.deltaY < 0 ? 1 : -1) * 0.03))));
  }, { passive: false });
  // Keyboard: the arrow keys move the dial one step at a time (Shift or Page Up/Down: ten steps), Home and End go to the ends.
  // A knob on a log scale (a cutoff in Hz) moves by a small percentage instead, so each press is audible but still fine.
  const nudge = (d, big) => {
    const step = spec.step || 0.01;
    let next = spec.log && range.min > 0 ? value * (1 + 0.015 * (big ? 5 : 1)) ** d : value + d * step * (big ? 10 : 1);
    next = Math.min(range.max, Math.max(range.min, Number((Math.round(next / step) * step).toFixed(6))));
    if (next === value) next = Math.min(range.max, Math.max(range.min, Number((value + d * step).toFixed(6))));
    return next;
  };
  el.addEventListener('keydown', (e) => {
    if (disabled) return;
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); e.stopPropagation(); commit(e.key === 'Home' ? range.min : range.max); return; }
    const d = { ArrowUp: 1, ArrowRight: 1, PageUp: 1, ArrowDown: -1, ArrowLeft: -1, PageDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    commit(nudge(d, e.shiftKey || e.key.startsWith('Page')));
  });
  draw();
  return { el, set, step(d, big) { if (!disabled) commit(nudge(d, big)); }, setRange(r) { range = r; draw(); }, setDisabled(d) { disabled = !!d; el.classList.toggle('off', disabled); } };
}

// ---------- repeat / bracket picker (icons, like the retrig rate on a hardware drum machine) ----------
const X_PICK = ['', 'rep2', 'rep3', 'rep4', 'sub2', 'sub3', 'sub4'];
const X_NAME = { '': 'plain', rep2: 'play twice', rep3: 'play 3 times', rep4: 'play 4 times', sub2: 'split in 2', sub3: 'split in 3', sub4: 'split in 4' };
export function xIcon(state) {
  const m = /^(rep|sub)(\d)$/.exec(state || '');
  const t = m ? m[1] : '', n = m ? Number(m[2]) : 1;
  const el = svg('svg', { viewBox: '0 0 24 14', width: 24, height: 14, class: 'xicon' });
  if (t === 'sub') {
    el.append(svg('rect', { x: 1, y: 1, width: 22, height: 12, rx: 2.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3 }));
    for (let k = 0; k < n; k++) {
      const w = 20 / n;
      if (k) el.append(svg('line', { x1: 2 + w * k, y1: 1, x2: 2 + w * k, y2: 13, stroke: 'currentColor', 'stroke-width': 1, opacity: 0.6 }));
      el.append(svg('rect', { x: 2 + w * k + w * 0.25, y: 4, width: w * 0.5, height: 6, rx: 1, fill: 'currentColor' }));
    }
  } else {
    const bars = t === 'rep' ? n : 1;
    for (let k = 0; k < bars; k++) {
      const slot = 20 / bars;
      const w = bars === 1 ? 8 : Math.min(4, slot * 0.55);
      el.append(svg('rect', { x: 2 + slot * k + (slot - w) / 2, y: 2, width: w, height: 10, rx: 1.2, fill: 'currentColor', opacity: t ? 1 : 0.45 }));
    }
  }
  return el;
}
let openPicker = null;
export function openXPicker(anchor, current, pick) {
  openPicker?.remove();
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'xpick', style: `left:${Math.max(8, Math.min(r.left - 8, window.innerWidth - 330))}px;top:${r.bottom + 6}px` },
    X_PICK.map((st) => h('button', { class: 'xpick-btn' + ((current || '') === st ? ' cur' : ''), title: X_NAME[st], onclick: () => { pick(st); pop.remove(); openPicker = null; } },
      xIcon(st), h('span', {}, st === '' ? 'plain' : st.startsWith('rep') ? '×' + st[3] : '[' + st[3] + ']'))));
  document.body.append(pop);
  openPicker = pop;
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); openPicker = null; document.removeEventListener('pointerdown', away, true); } };
  document.addEventListener('pointerdown', away, true);
}
// A text box that only accepts what is on its list: suggestions as you type, arrows and Enter to choose, and anything
// else snaps back to the last valid value when you leave the box.
function makeTypeahead({ options, valid, commit, onHover }) {
  const input = h('input', { class: 'txt trk-name', type: 'text', spellcheck: 'false', autocomplete: 'off' });
  let pop = null, idx = -1, last = '', hoverT = null;
  const items = () => {
    const q = input.value.trim().toLowerCase().split(':')[0];
    const all = options();
    const ranked = [...all.filter((o) => o.startsWith(q)), ...all.filter((o) => !o.startsWith(q) && o.includes(q))];
    return [...ranked.filter(isFav), ...ranked.filter((o) => !isFav(o))].slice(0, 14);
  };
  const close = () => { pop?.remove(); pop = null; idx = -1; };
  const pick = (o) => { input.value = o; last = o; commit(o); close(); };
  const open = () => {
    pop?.remove();
    const list = items();
    if (!list.length) { pop = null; return; }
    const r = input.getBoundingClientRect();
    pop = h('div', { class: 'ta-pop', style: `left:${r.left}px;top:${r.bottom + 3}px;min-width:${Math.max(210, r.width)}px` },
      list.map((o, i) => h('div', { class: 'ta-item' + (i === idx ? ' cur' : ''), onpointerdown: (e) => { e.preventDefault(); pick(o); }, onpointerenter: () => { clearTimeout(hoverT); hoverT = setTimeout(() => onHover?.(o), 160); }, onpointerleave: () => clearTimeout(hoverT) }, h('span', { class: 'ta-name' }, (isFav(o) ? '★ ' : '') + o), h('span', { class: 'ta-desc' }, describe(o)))));
    document.body.append(pop);
  };
  input.addEventListener('input', () => { idx = -1; open(); });
  input.addEventListener('focus', () => { input.select(); open(); onHover && soundHooks.warm?.(); });
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const list = items();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % Math.max(list.length, 1); open(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (idx >= 0 && list[idx]) pick(list[idx]); else if (valid(input.value)) { input.value = input.value.trim(); last = input.value; commit(last); close(); } }
    else if (e.key === 'Escape') { input.value = last; close(); input.blur(); }
  });
  input.addEventListener('blur', () => {
    close();
    const v = input.value.trim();
    if (valid(v)) { input.value = v; if (v !== last) { last = v; commit(v); } } else input.value = last;
  });
  return { el: input, setValue(v) { last = v; if (document.activeElement !== input) input.value = v; } };
}

// Sound picker (Instrument and Sample): search, category chips, stars, and a hover preview. Rows say what each sound is.
let soundPop = null;
let soundHooks = {};
export function openSoundPicker({ anchor, items, cats, current, onPick }) {
  soundPop?.remove();
  soundHooks.warm?.();
  const CAP = 240;   // a bank can hold hundreds of sounds: draw the first ones and ask for a search for the rest
  let cat = 'All', hi = 0, list = [], timer = null;
  const search = h('input', { class: 'txt ip-search', type: 'text', placeholder: items.some((i) => i.pitched === false) ? 'search: snare, clap, hat, 808…' : 'search: flute, guitar, piano, organ…', spellcheck: 'false', autocomplete: 'off' });
  const chips = h('div', { class: 'ip-chips' });
  const box = h('div', { class: 'ip-grid', role: 'listbox' });
  const foot = h('div', { class: 'ip-foot' });
  const r = anchor.getBoundingClientRect();
  const width = Math.min(740, window.innerWidth - 16);
  const top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 560));
  const viewBtn = (v, label, title) => h('button', { class: 'ip-view', type: 'button', title, 'aria-label': title, 'aria-pressed': String(getPrefs().soundView === v), onclick: () => { setPref('soundView', v); viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === getPrefs().soundView))); render(); search.focus(); }, 'data-v': v }, label);
  const viewBtns = [viewBtn('cards', '▦', 'Show as cards'), viewBtn('list', '☰', 'Show as a list')];
  const closeBtn = h('button', { class: 'btn ip-close', type: 'button', 'aria-label': 'Close the sound list' }, 'Close');   // a keyboard can press Esc; a phone cannot
  const pop = h('div', { class: 'ip-pop wide', style: `left:${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px;top:${top}px;width:${width}px;max-height:calc(100vh - ${top}px - 12px)` }, h('div', { class: 'ip-top' }, search, h('div', { class: 'ip-views', role: 'group', 'aria-label': 'Layout' }, viewBtns), closeBtn), chips, box, foot);
  closeBtn.addEventListener('click', () => close());
  const close = () => { clearTimeout(timer); pop.remove(); soundPop = null; document.removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const choose = (it) => { onPick(it.id); close(); };
  const filtered = () => {
    const q = search.value.trim().toLowerCase();
    const out = items.filter((i) => (cat === 'All' || (cat === '★' ? isFav(i.id) : i.cat === cat)) && (!q || i.id.toLowerCase().includes(q) || i.label.toLowerCase().includes(q)));
    return [...out.filter((i) => isFav(i.id)), ...out.filter((i) => !isFav(i.id))];
  };
  const columns = () => Math.max(1, getComputedStyle(box).gridTemplateColumns.split(' ').length);
  const picture = (i) => {
    const wave = WAVE_ICONS.find(([wid]) => wid === i.id);   // the synth waves show their own shape
    const el = h('span', { class: 'ip-pic' });
    el.innerHTML = wave
      ? `<svg viewBox="0 0 24 14" width="${getPrefs().soundView === 'list' ? 34 : 30}" height="${getPrefs().soundView === 'list' ? 20 : 18}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${wave[1]}"/></svg>`
      : soundIconSvg(i.kind === 'sample' && i.id !== 'piano' ? soundGlyph(i.id, i.cat) : i.cat, getPrefs().soundView === 'list' ? 24 : 26);
    return el;
  };
  const render = () => {
    box.classList.toggle('list', getPrefs().soundView === 'list');
    list = filtered();
    hi = Math.min(hi, Math.max(list.length - 1, 0));
    chips.replaceChildren(...['All', '★', ...cats].map((c) => {
      const chip = h('button', { class: 'ip-chip' + (c === cat ? ' on' : ''), title: c === '★' ? 'your starred sounds' : '', onclick: () => { cat = c; hi = 0; render(); search.focus(); } });
      if (c !== 'All' && c !== '★' && hasSoundIcon(c)) { const ic = h('span', { class: 'ip-chipic' }); ic.innerHTML = soundIconSvg(c, 15); chip.append(ic); }
      chip.append(c === '★' ? '★ ' + favCount() : c);
      return chip;
    }));
    const shown = list.slice(0, CAP);
    box.replaceChildren(...(shown.length ? shown.map((i, n) => {
      const [title, ...rest] = String(i.label).split(':'), desc = rest.join(':').trim();
      return h('div', {
        class: 'ip-card' + (n === hi ? ' cur' : '') + (i.id === current ? ' sel' : ''), role: 'option', 'aria-selected': String(i.id === current), title: i.label,
        onpointerdown: (e) => { e.preventDefault(); choose(i); },
        onpointerenter: () => { clearTimeout(timer); timer = setTimeout(() => soundHooks.preview?.(i), 160); },
        onpointerleave: () => clearTimeout(timer),
      },
      h('button', { class: 'ip-star' + (isFav(i.id) ? ' on' : ''), title: 'star this sound', onpointerdown: (e) => { e.preventDefault(); e.stopPropagation(); toggleFav(i.id); render(); } }, isFav(i.id) ? '★' : '☆'),
      picture(i),
      h('span', { class: 'ip-name' }, title.trim()),
      desc ? h('span', { class: 'ip-desc' }, desc) : null,
      h('span', { class: 'ip-meta' }, h('span', { class: 'ip-id' }, i.id), h('span', { class: 'ip-kind k-' + i.kind }, i.kind === 'soundfont' ? 'General MIDI' : i.kind === 'sample' ? 'recorded' : 'synth')));
    }) : [h('div', { class: 'menu-empty ip-empty' }, cat === '★' ? 'Star a sound with the ☆ and it will wait here.' : 'Nothing matches. Try another word or category.')]));
    const more = list.length > CAP ? ` Showing ${CAP} of ${list.length}: type to narrow it down.` : '';
    foot.textContent = (soundHooks.soundsReady?.() ? 'Hover a sound to hear it. Click to use it. Arrow keys move, Enter picks.' : 'Loading sounds… hovering will play them in a moment.') + more;
    box.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
  };
  search.addEventListener('input', () => { hi = 0; render(); });
  search.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const n = Math.min(list.length, CAP), cols = columns();
    const move = (d) => { if (!n) return; hi = Math.min(n - 1, Math.max(0, hi + d)); render(); if (list[hi]) soundHooks.preview?.(list[hi]); };
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(cols); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-cols); }
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !search.value) { e.preventDefault(); move(e.key === 'ArrowRight' ? 1 : -1); }   // with text in the box the arrows move the caret
    else if (e.key === 'Enter' && list[hi]) choose(list[hi]);
  });
  document.body.append(pop);
  document.addEventListener('pointerdown', away, true);
  soundPop = pop;
  render();
  search.focus();
  const poll = setInterval(() => { if (!soundPop) return clearInterval(poll); const m = list.length > CAP ? ` Showing ${CAP} of ${list.length}: type to narrow it down.` : ''; foot.textContent = (soundHooks.soundsReady?.() ? 'Hover a sound to hear it. Click to use it. Arrow keys move, Enter picks.' : 'Loading sounds… hovering will play them in a moment.') + m; }, 800);
}

// tiny picture of a chord: one dot per note, higher notes higher up
function chordShapeSvg(sym, w = 38, hgt = 12) {
  const semis = chordSemis(sym);
  const el = svg('svg', { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, class: 'cshape' });
  if (!semis.length) return el;
  const lo = Math.min(...semis), span = Math.max(...semis) - lo || 1;
  semis.forEach((s, i) => el.append(svg('circle', { cx: semis.length === 1 ? w / 2 : 3 + (i * (w - 6)) / (semis.length - 1), cy: hgt - 2.5 - ((s - lo) / span) * (hgt - 5), r: 1.7, fill: 'currentColor' })));
  return el;
}
// a small piano keyboard with the chord's notes lit
function keyboardSvg(sym) {
  const semis = new Set(chordSemis(sym));
  const W = 10, N = 30, WHITE = [0, 2, 4, 5, 7, 9, 11];
  let whites = 0;
  const el = svg('svg', { viewBox: `0 0 ${W * 18} 30`, width: W * 18, height: 30, class: 'kbd' });
  const blacks = [];
  for (let s = 0; s < N; s++) {
    if (WHITE.includes(s % 12)) { el.append(svg('rect', { x: whites * W, y: 0, width: W - 1, height: 30, rx: 1.5, fill: semis.has(s) ? '#f3c9a0' : '#dfe3e8' })); whites++; }
    else blacks.push([s, whites]);
  }
  for (const [s, wi] of blacks) el.append(svg('rect', { x: wi * W - 3, y: 0, width: 6, height: 18, rx: 1, fill: semis.has(s) ? '#e9967a' : '#20262d' }));
  return el;
}
function openPresets(anchor, nodeId) {
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'cpick presets', style: `left:${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px;top:${Math.min(r.bottom + 6, window.innerHeight - 280)}px` },
    h('div', { class: 'cp-h' }, 'Chord progressions (in the Key, or C major)'),
    h('div', { class: 'preset-grid' }, PRESETS.map((p) => {
      const lo = 0, hi = 6, w = 70, hh = 22;
      const sv = svg('svg', { viewBox: `0 0 ${w} ${hh}`, width: w, height: hh });
      const pts = p.degrees.map((d, i) => [4 + (i * (w - 8)) / Math.max(p.degrees.length - 1, 1), hh - 3 - ((d - lo) / (hi - lo)) * (hh - 6)]);
      sv.append(svg('polyline', { points: pts.map((q) => q.join(',')).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 1, opacity: 0.5 }));
      pts.forEach(([x, y]) => sv.append(svg('circle', { cx: x, cy: y, r: 2, fill: 'currentColor' })));
      return h('button', { class: 'preset-card', onclick: () => { close(); soundHooks.applyChordPreset(nodeId, p); } }, sv, h('b', {}, p.name), h('small', {}, presetRoman(p)));
    })));
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  document.body.append(pop);
  document.addEventListener('pointerdown', away, true);
}

// "What plugs in here?": the kinds of cable an input takes, and the modules that make them
let jackTip = null;
function openJackHelp(anchor, node, port) {
  jackTip?.remove();
  const types = port.accept === 'same' ? PATTERN_TYPES_LIST : port.accept;
  const mods = Object.values(MODULES).filter((d) => d.out && types.includes(d.out)).map((d) => d.title);
  const through = Object.values(MODULES).some((d) => d.out === 'through');
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'jack-tip', style: `left:${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px;top:${Math.min(r.bottom + 6, window.innerHeight - 200)}px` },
    h('div', { class: 'jt-h' }, `${port.label || 'in'} input${port.required ? ' (needed)' : ''}`),
    h('div', {}, 'Takes: ', ...types.flatMap((t, i) => [i ? ', ' : '', h('b', { style: `color:${PORT_TYPES[t]?.color || 'inherit'}` }, PORT_TYPES[t]?.label || t)]), '. ', types.map((t) => PORT_TYPES[t]?.hint).filter(Boolean).join('; ') + '.'),
    mods.length ? h('div', { class: 'jt-l' }, 'From: ', mods.slice(0, 9).join(', '), mods.length > 9 ? `, and ${mods.length - 9} more` : '', through ? ', or a transform or effect that passes one along' : '', '.') : null,
    h('div', { class: 'jt-f' }, 'Drag from a round jack on the other module to this one. Matching jacks light up while you drag.'));
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', away, true); if (jackTip === pop) jackTip = null; };
  const away = (e) => { if (!pop.contains(e.target)) close(); };
  jackTip = pop;
  document.body.append(pop);
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
}
const PATTERN_TYPES_LIST = ['notes', 'trigger', 'sound'];

// Melody templates: a card per tune, drawn as the shape of its notes
function openMelodyTemplates(anchor, nodeId) {
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'cpick presets', style: `left:${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px;top:${Math.min(r.bottom + 6, window.innerHeight - 300)}px` },
    h('div', { class: 'cp-h' }, 'Melody templates (they follow the key and scale)'),
    h('div', { class: 'preset-grid' }, MELODY_TEMPLATES.map((p) => {
      const w = 70, hh = 22, ds = p.degrees.filter((d) => d !== null), hi = Math.max(7, ...ds);
      const sv = svg('svg', { viewBox: `0 0 ${w} ${hh}`, width: w, height: hh });
      p.degrees.forEach((d, i) => { if (d !== null) sv.append(svg('circle', { cx: 4 + (i * (w - 8)) / Math.max(p.degrees.length - 1, 1), cy: hh - 3 - (d / hi) * (hh - 6), r: 2, fill: 'currentColor' })); });
      return h('button', { class: 'preset-card', title: p.tip, onclick: () => { close(); soundHooks.applyMelodyTemplate(nodeId, p.id); } }, sv, h('b', {}, p.label), h('small', {}, `${p.degrees.length} steps`));
    })));
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  document.body.append(pop);
  document.addEventListener('pointerdown', away, true);
}

// Drum templates: a card per pattern, drawn as its rows of hits
function openDrumTemplates(anchor, nodeId) {
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'cpick presets', style: `left:${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px;top:${Math.min(r.bottom + 6, window.innerHeight - 340)}px` },
    h('div', { class: 'cp-h' }, 'Drum templates (they set the bank, the rows and the steps)'),
    h('div', { class: 'preset-grid' }, DRUM_PRESETS.map((p) => {
      const w = 70, rows = p.params.tracks, steps = p.params.steps, rh = Math.min(7, 22 / rows.length), hh = 22;
      const sv = svg('svg', { viewBox: `0 0 ${w} ${hh}`, width: w, height: hh });
      rows.forEach((t, ti) => t.cells.forEach((c, i) => { if (c.on || c.sub?.some((x) => x.on)) sv.append(svg('rect', { x: 3 + (i * (w - 6)) / steps, y: 1 + ti * rh, width: Math.max(1.6, (w - 6) / steps - 1), height: Math.max(1.6, rh - 1.5), rx: 0.6, fill: 'currentColor' })); }));
      return h('button', { class: 'preset-card', title: p.tip, onclick: () => { close(); soundHooks.applyDrumPreset(nodeId, p.id); } }, sv, h('b', {}, p.label), h('small', {}, `${steps} steps · ${rows.length} rows`));
    })));
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  document.body.append(pop);
  document.addEventListener('pointerdown', away, true);
}

// Chord picker: chord names (root + quality), or numbers in the key when a Key is plugged in.
let chordPop = null;
let boardStore = null;
function openChordPicker(anchor, nodeId, i) {
  chordPop?.remove();
  const nodeNow = () => boardStore.graph.nodes.find((x) => x.id === nodeId);
  const r = anchor.getBoundingClientRect();
  const pop = h('div', { class: 'cpick', style: `left:${Math.max(8, Math.min(r.left, window.innerWidth - 330))}px;top:${Math.min(r.bottom + 6, window.innerHeight - 330)}px` });
  const close = () => { pop.remove(); chordPop = null; document.removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const set = (op) => { soundHooks.setCell(nodeId, i, op); render(); };
  const render = () => {
    const n = nodeNow();
    if (!n) return close();
    const c = n.params.cells[i], key = effectiveKey(boardStore.graph, n);
    const kids = [];
    if (key) {
      const cur = c.d || { i: 0, ext: '' };
      kids.push(h('div', { class: 'cp-h' }, `Chord ${i + 1}, in ${key.root} ${key.scale}`),
        h('div', { class: 'cp-row' }, Array.from({ length: degreeCount(key) }, (_, k) => { const d = { i: k, ext: cur.ext || '' }; return h('button', { class: 'cp-btn' + (c.d && c.d.i === k ? ' on' : ''), onclick: () => set({ d }) }, h('b', {}, romanName(key, d)), h('small', {}, chordSymbol(key, d))); })),
        h('div', { class: 'cp-h' }, 'Fullness'),
        h('div', { class: 'cp-row' }, EXTENSIONS.map(([e, label]) => h('button', { class: 'cp-chip' + ((c.d?.ext || '') === e ? ' on' : ''), onclick: () => set({ d: { i: c.d?.i ?? 0, ext: e } }) }, label))));
    } else {
      const m = /^([A-G]#?)(.*)$/.exec(c.sym || 'C');
      const root = m[1], qual = m[2];
      kids.push(h('div', { class: 'cp-h' }, `Chord ${i + 1}: root`),
        h('div', { class: 'cp-row' }, ROOT_NAMES.map((rn) => h('button', { class: 'cp-chip' + (c.sym && rn === root ? ' on' : ''), onclick: () => set({ sym: rn + (c.sym ? qual : '') }) }, rn))),
        h('div', { class: 'cp-h' }, 'Kind'),
        h('div', { class: 'cp-row' }, CHORD_QUALITIES.map(([q, label]) => h('button', { class: 'cp-chip' + (c.sym && q === qual ? ' on' : ''), title: root + q, onclick: () => set({ sym: root + q }) }, label))));
    }
    const symNow = key ? chordSymbol(key, c.d) : c.sym;
    if (symNow) kids.push(h('div', { class: 'cp-h' }, 'Notes: ' + chordNoteNames(symNow).join(' ')), keyboardSvg(symNow));
    kids.push(h('div', { class: 'cp-row cp-foot' }, h('button', { class: 'cp-chip', onclick: () => set({ rest: true }) }, 'rest (silence)'), h('button', { class: 'cp-chip', onclick: close }, 'done')));
    pop.replaceChildren(...kids);
  };
  document.body.append(pop);
  document.addEventListener('pointerdown', away, true);
  chordPop = pop;
  render();
}

// the repeat bars drawn inside a pad
const setBars = (el, n) => { if (n > 1) el.replaceChildren(...Array.from({ length: n }, () => h('i'))); else if (el.firstChild) el.textContent = ''; };

// ---------- melody minimap ----------
// the whole note range (every octave the view can reach), and which slice of it the grid shows
function windowOf(key, o) { const m = pitchModel(key, o); return [m.rank(m.pitchAt(0)), m.rank(m.pitchAt(m.rows - 1))]; }
function mmRange(key) { return { lo: windowOf(key, 1)[0], hi: windowOf(key, 5)[1] }; }
function drawMinimap(s, node, key, deg) {
  const { canvas, H } = s.mm, W = canvas.width;
  const ctx = canvas.getContext('2d');
  const { lo, hi } = mmRange(key), span = hi - lo;
  const y = (r) => (1 - (r - lo) / span) * H;
  const [wl, wh] = windowOf(key, node.params.octave);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0b0f13';
  ctx.fillRect(0, 0, W, H);
  // octave guides
  ctx.strokeStyle = '#1b232c'; ctx.lineWidth = 1;
  for (let o = 1; o <= 6; o++) { const [r] = windowOf(key, Math.min(o, 5)); const rr = o === 6 ? windowOf(key, 5)[1] : r; ctx.beginPath(); ctx.moveTo(0, Math.round(y(rr)) + 0.5); ctx.lineTo(W, Math.round(y(rr)) + 0.5); ctx.stroke(); }
  // the window the grid shows
  ctx.fillStyle = (accent() + '28'); ctx.fillRect(0, y(wh), W, Math.max(2, y(wl) - y(wh)));
  ctx.strokeStyle = accent(); ctx.lineWidth = 1.5; ctx.strokeRect(0.75, y(wh) + 0.75, W - 1.5, Math.max(2, y(wl) - y(wh)) - 1.5);
  // every note in the pattern
  const n = node.params.cells.length;
  node.params.cells.forEach((c, i) => {
    const pitches = [...cellNotes(c, deg), ...(c.sub || []).flatMap((sc) => cellNotes(sc, deg))];
    const x = 5 + ((i + 0.5) / n) * (W - 10);
    for (const p of pitches) {
      const r = (key ? p : pitchRank(p));
      const inView = r >= wl && r <= wh;
      ctx.fillStyle = inView ? '#ffffff' : accent();
      ctx.beginPath(); ctx.arc(x, y(r), inView ? 3 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// Which steps start a group. The steps are grouped in bars of B/C steps, the beats-per-cycle setting in the top bar: at 4, 8 steps are two groups of 4
// and 16 steps four groups of 4; at 6, 8 steps are a group of 6 and a group of 2; at 3, groups of 3. (This is the usual step-sequencer view, a drawing
// aid only: the sound and the code do not change.) When each step is a whole cycle ("one step per cycle") a bar of steps means nothing, so
// null keeps the plain groups of four.
function beatStarts(steps, beats, mode) {
  if (mode === 'turns' || !beats || !steps) return null;
  const s = new Set([0]);
  for (let i = beats; i < steps; i += beats) s.add(i);
  return s;
}
const beatsNow = () => boardStore?.graph.nodes.find((n) => n.type === 'output')?.params.beats ?? 4;
// Columns for a row of steps with a small gap at the start of each group (so the beat is easy to read). Every row of a module uses
// the same columns, so pads, velocity, length and the playhead dots all line up.
function layoutCols(widths, lead, starts = null) {
  const cols = lead ? [lead] : [];
  const idx = [];
  widths.forEach((w, i) => { if (i > 0 && (starts ? starts.has(i) : i % 4 === 0)) cols.push('6px'); idx.push(cols.length + 1); cols.push(w); });
  return { template: cols.join(' '), col: (i) => idx[i] };
}
const dotsRow = (L, steps) => { const dots = []; const row = h('div', { class: 'ph-row', style: `grid-template-columns: ${L.template}` }); for (let i = 0; i < steps; i++) { const d = h('i', { class: 'ph-dot' }); d.style.gridColumn = L.col(i); dots.push(d); row.append(d); } return { row, dots }; };
const fmtKnob = (spec, v) => { if (spec.unit === 'Hz' && v >= 1000) { const k = v / 1000; return Number(k.toFixed(k >= 10 ? 1 : 2)) + 'k'; } return fmt(v); };
// pictures for options that are really shapes
const ICON_SETS = {
  shape: {
    sine: 'M1 7 C4.5 -2, 8.5 -2, 12 7 S19.5 16, 23 7', saw: 'M1 12 L9 2 L9 12 L17 2 L17 12 L23 6', sawtooth: 'M1 12 L9 2 L9 12 L17 2 L17 12 L23 6',
    tri: 'M1 7 L6 2 L12 12 L18 2 L23 7', triangle: 'M1 7 L6 2 L12 12 L18 2 L23 7', square: 'M1 12 V2 H8 V12 H15 V2 H22 V12',
    rand: 'M1 9 H5 V4 H9 V11 H13 V6 H17 V12 H22',
  },
  filter: { lpf: 'M1 4 H11 C15 4 16 10 22 12', hpf: 'M2 12 C8 10 9 4 13 4 H23', bpf: 'M1 12 C6 12 8 4 12 4 C16 4 18 12 23 12' },
};
const WAVE_ICONS = [
  ['sine', 'M1 7 C4.5 -2, 8.5 -2, 12 7 S19.5 16, 23 7'], ['triangle', 'M1 7 L6 2 L12 12 L18 2 L23 7'],
  ['sawtooth', 'M1 12 L9 2 L9 12 L17 2 L17 12 L23 6'], ['square', 'M1 12 V2 H8 V12 H15 V2 H22 V12'],
  ['supersaw', 'M1 12 L9 2 L9 12 L17 2 L17 12 L23 6 M1 9 L9 4 M9 9 L17 4'],
  ['pulse', 'M1 12 V2 H6 V12 H13 V2 H18 V12 H23'],
];
// the sound names inside a pattern like "bd*2 [bd:3 sd]": bd, sd (numbers and symbols are not names)
const soundNames = (t) => [...new Set(String(t || '').split(/[\s\[\]<>*!@?,~(){}.|]+/).filter((x) => /^(?=.*[a-z_])[a-z0-9_]\w*(:\d+)?$/i.test(x)).map((x) => x.split(':')[0]))];
const waveSvg = (d) => { const el = svg('svg', { viewBox: '0 0 24 14', width: 24, height: 14 }); el.append(svg('path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })); return el; };
const speakerSvg = (muted) => { const el = svg('svg', { viewBox: '0 0 16 16', width: 14, height: 14 }); el.append(svg('path', { d: 'M2 6h3l4-3v10l-4-3H2z', fill: 'currentColor' })); el.append(svg('path', { d: muted ? 'M11.5 5.5l3 5M14.5 5.5l-3 5' : 'M11.5 5.5c1.3 1.5 1.3 3.5 0 5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' })); return el; };
const powerSvg = () => { const el = svg('svg', { viewBox: '0 0 16 16', width: 14, height: 14 }); el.append(svg('path', { d: 'M8 2v5M4.5 4.2a5 5 0 1 0 7 0', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round' })); return el; };

let nodeMenu = null;
function openNodeMenu(anchor, id) {
  nodeMenu?.remove();
  const n = boardStore.graph.nodes.find((x) => x.id === id);
  if (!n) return;
  const r = anchor.getBoundingClientRect();
  const item = (label, fn, cls = '') => h('button', { class: 'menu-item ' + cls, onclick: () => { close(); fn(); } }, label);
  const pop = h('div', { class: 'pop', style: `left:${Math.max(8, Math.min(r.left - 100, window.innerWidth - 200))}px;top:${r.bottom + 4}px;min-width:170px` }, h('div', { class: 'menu' },
    MODULES[n.type].single ? null : item('Duplicate', () => soundHooks.duplicate(id)),
    MODULES[n.type].out && !['number', 'key'].includes(MODULES[n.type].out) && n.type !== 'output' && soundHooks.xray ? item('Show what comes out', () => soundHooks.xray(id)) : null,
    MUTE_KIND[n.type] ? item(n.muted ? (MUTE_KIND[n.type] === 'bypass' ? 'Switch on' : 'Unmute') : (MUTE_KIND[n.type] === 'bypass' ? 'Bypass' : 'Mute'), () => soundHooks.toggleMute(id)) : null,
    item(n.collapsed ? 'Expand' : 'Collapse', () => soundHooks.collapse(id)),
    item('Delete', () => soundHooks.removeNode(id), 'danger')));
  const close = () => { pop.remove(); nodeMenu = null; document.removeEventListener('pointerdown', away, true); };
  const away = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  document.body.append(pop);
  document.addEventListener('pointerdown', away, true);
  nodeMenu = pop;
}

const REG_NAME = { 'above:c3': 'low', 'above:c4': 'middle', 'above:c5': 'high' };
function foldSummary(node, g) {
  const p = node.params, cyc = p.mode === 'turns' ? 'one per cycle' : p.mode === 'pace' && p.steps > 8 ? `${fmt(p.steps / 8)} cycles` : 'all in a cycle';
  const key = effectiveKey(g, node);
  switch (node.type) {
    case 'melody': return `${p.steps} steps · ${cyc} · ${key ? key.root + ' ' + key.scale : 'note names'}`;
    case 'rhythm': return `${p.steps} steps · ${cyc}`;
    case 'chords': return `${p.steps} chords · ${cyc}${p.register ? ' · ' + REG_NAME[p.register] : ''}`;
    case 'synth': return `envelope ${fmt(p.attack)} / ${fmt(p.decay)} / ${fmt(p.sustain)} / ${fmt(p.release)}`;
    case 'sample': return `${p.fit === 'on' ? 'fit · ' : ''}attack ${fmt(p.attack)} · decay ${fmt(p.decay)} · release ${fmt(p.release)}`;
    case 'filter': return `${p.ftype} · envelope ${p.env > 0 ? fmt(p.env) : 'off'}`;
    case 'fm': { const ops = 1 + [p.index2, p.index3, p.index4].filter((v) => v > 0).length; const routes = Object.keys(p).filter((k) => /^r\d\d$/.test(k) && p[k] > 0).length; return `decay ${fmt(p.decay)} · sustain ${fmt(p.sustain)} · ${ops} modulator${ops > 1 ? 's' : ''}${routes ? ' · ' + routes + ' extra route' + (routes > 1 ? 's' : '') : ''}${[p.fb1, p.fb2, p.fb3, p.fb4].some((v) => v > 0) ? ' · feedback' : ''}`; }
    case 'compressor': return `knee ${fmt(p.knee)} · attack ${fmt(p.attack)} · release ${fmt(p.release)}`;
    case 'output': return `${p.mvol !== 1 ? 'volume ' + fmt(p.mvol) + ' · ' : ''}${p.beats} beats · master effects ${p.mphaser > 0 || p.mtrem > 0 ? 'on' : 'off'}`;
    case 'arrange': return `${p.n} sections · ${p.lens.slice(0, p.n).reduce((a, x) => a + x, 0)} cycles`;
    case 'drums': return `${p.steps} steps · ${p.bank || 'no bank'}`;
    default: return 'settings';
  }
}

// A left-to-right slider (used by the Slider module). Same interface as a knob, so the rest of the board treats them alike.
function makeHSlider(spec, onChange) {
  const fill = h('div', { class: 'hs-fill' }), thumb = h('div', { class: 'hs-thumb' });
  const track = h('div', { class: 'hs-track' }, fill, thumb);
  const el = h('div', { class: 'hslider', tabindex: 0, role: 'slider', title: spec.tip || spec.label }, track);
  let range = { min: spec.min ?? 0, max: spec.max ?? 1 }, value = spec.def, disabled = false;
  const stepOf = () => { if (range.step > 0) return range.step; const span = range.max - range.min; return span >= 100 ? 1 : span >= 10 ? 0.1 : 0.01; };
  const draw = () => {
    const p = Math.min(1, Math.max(0, range.max === range.min ? 0 : (value - range.min) / (range.max - range.min))) * 100;
    fill.style.width = p + '%'; thumb.style.left = p + '%';
    el.setAttribute('aria-valuemin', range.min); el.setAttribute('aria-valuemax', range.max); el.setAttribute('aria-valuenow', value);
  };
  const fromX = (x) => {
    const r = track.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (x - r.left) / r.width)), st = stepOf();
    return Math.min(range.max, Math.max(range.min, Math.round((range.min + t * (range.max - range.min)) / st) * st));
  };
  const commit = (v) => { v = Number(v.toFixed(4)); if (v !== value) { value = v; draw(); onChange(v); } };
  el.addEventListener('pointerdown', (e) => {
    if (disabled) return;
    e.preventDefault(); e.stopPropagation();
    el.focus({ preventScroll: true });
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    el.classList.add('turning');
    commit(fromX(e.clientX));
    const move = (ev) => commit(fromX(ev.clientX));
    const up = () => { el.classList.remove('turning'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => !disabled && commit(Math.min(range.max, Math.max(range.min, spec.def))));
  el.addEventListener('wheel', (e) => { if (disabled) return; e.preventDefault(); e.stopPropagation(); commit(Math.min(range.max, Math.max(range.min, value + (e.deltaY < 0 ? 1 : -1) * stepOf() * 5))); }, { passive: false });
  el.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!d || disabled) return;
    e.preventDefault(); e.stopPropagation();
    commit(Math.min(range.max, Math.max(range.min, value + d * stepOf() * (e.shiftKey ? 10 : 1))));
  });
  draw();
  return { el, set(v) { value = v; draw(); }, step(d, big) { if (!disabled) commit(Math.min(range.max, Math.max(range.min, value + d * stepOf() * (big ? 10 : 1)))); }, setRange(r) { range = r; draw(); }, setDisabled(d) { disabled = !!d; el.classList.toggle('off', disabled); } };
}

// ---------- the board ----------
const CAT_COLOR = { sequencer: '#f2b134', source: '#78d68b', transform: '#b48cf2', combine: '#8fa0b3', effect: '#ef8f5b', number: '#4cc3f0', output: '#e6ebf0', view: '#7aa2ff' };

export function createBoard(root, store, hooks) {
  soundHooks = hooks;
  boardStore = store;
  const world = h('div', { class: 'world' });
  const cableSvg = svg('svg', { class: 'cables', width: 1, height: 1 });
  const cableLayer = svg('g'), pulseLayer = svg('g'), ghost = svg('path', { class: 'cable ghost', d: '' });
  cableSvg.append(cableLayer, ghost, pulseLayer);
  world.append(cableSvg);
  const hint = h('div', { class: 'board-hint' }, 'Drag a module from the left onto the board, or click one to drop it in. Drag from a round jack to make a cable.');
  const zoomUI = h('div', { class: 'zoom' },
    h('button', { title: 'Zoom out', onclick: () => zoomBy(1 / 1.2) }, '−'),
    h('span', { class: 'zoom-val' }, '100%'),
    h('button', { title: 'Zoom in', onclick: () => zoomBy(1.2) }, '+'),
    h('button', { title: 'Fit all modules', onclick: () => fit({ overview: true }) }, 'fit'),
    h('button', { title: 'Tidy: arrange the modules by signal flow', onclick: () => api.tidy() }, 'tidy'));
  const selbar = h('div', { class: 'selbar' });
  function paintSelbar() {
    selbar.style.display = selection.size > 1 ? 'flex' : 'none';
    if (selection.size < 2) return;
    const ids = [...selection], nodes = store.graph.nodes.filter((n) => selection.has(n.id));
    const allCollapsed = nodes.every((n) => n.collapsed);
    const muteable = nodes.filter((n) => MUTE_KIND[n.type]);
    const allMuted = muteable.length > 0 && muteable.every((n) => n.muted);
    const btn = (label, title, fn, ic) => h('button', { class: 'btn sm sel-btn', title, 'aria-label': label, onclick: fn }, ic ? icon(ic, 15) : null, label);
    selbar.replaceChildren(h('span', { class: 'sel-count' }, `${selection.size} selected`),
      btn('Group', 'Group the selected modules so they move and fold together (Ctrl/⌘ G)', () => hooks.groupNodes(ids), 'group'),
      btn('Duplicate', 'Copy the selected modules and the wires between them (Ctrl/⌘ D)', () => hooks.duplicateNodes(ids), 'duplicate'),
      btn(allCollapsed ? 'Expand' : 'Minimize', allCollapsed ? 'Open all the selected modules' : 'Fold all the selected modules down to their title bars', () => hooks.collapseNodes(ids, !allCollapsed), allCollapsed ? 'expand' : 'collapse'),
      muteable.length ? btn(allMuted ? 'Unmute' : 'Mute', allMuted ? 'Switch the selected modules back on' : 'Mute the selected sounds and bypass the selected effects', () => hooks.muteNodes(ids, !allMuted), allMuted ? 'unmute' : 'mute') : null,
      btn('Align left', 'Line the selected modules up on their left edge', () => hooks.alignNodes(ids, 'left'), 'alignleft'),
      btn('Align top', 'Line the selected modules up on their top edge', () => hooks.alignNodes(ids, 'top'), 'aligntop'),
      btn('Delete', 'Delete the selected modules (Delete key)', () => hooks.removeNodes(ids), 'trash'),
      btn('Clear', 'Deselect (Esc)', () => selectNode(null), 'close'));
  }
  const mini = h('canvas', { class: 'minimap', width: 190, height: 120, title: 'Minimap of the whole board. Click or drag to move the view.' });
  root.append(world, hint, zoomUI, mini, selbar);

  const view = { x: 40, y: 20, z: 1 };
  const views = new Map(); // node id -> NodeView
  const selTrack = new Map(); // drum machine node id -> selected row (view state only)
  const foldOpen = new Set(); // modules whose settings footer is expanded (view state only)
  const aboutOpen = new Set(); // modules whose description is open (the Settings choice "always show" opens them all)
  const selection = new Set();
  const groupEls = new Map();
  const sizeCache = new Map(); // last known module sizes, for hidden (collapsed-group) members
  let hover = null;
  let wireEls = new Map();

  let miniMap = null;
  function drawMini() {
    const on = getPrefs().minimap !== false;
    mini.style.display = on ? 'block' : 'none';
    if (!on) return;
    const ctx = mini.getContext('2d'), W = mini.width, H = mini.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#12171cdd'; ctx.fillRect(0, 0, W, H);
    const g = store.graph, r = root.getBoundingClientRect();
    const vx = -view.x / view.z, vy = -view.y / view.z, vw = r.width / view.z, vh = r.height / view.z;
    const boxes = g.nodes.map((n) => { const el = views.get(n.id)?.el; return { id: n.id, x: n.x, y: n.y, w: el?.offsetWidth || 200, h: el?.offsetHeight || 150 }; });
    let x0 = vx, y0 = vy, x1 = vx + vw, y1 = vy + vh;
    for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const pad = 30; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const sc = Math.min(W / (x1 - x0), H / (y1 - y0));
    const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    miniMap = { sc, x0, y0, ox, oy };
    const A = accent();
    // each module is drawn in its category colour, whatever the colourful setting says; selected ones get a white outline
    const MM = { sequencer: '#f2b134', source: '#78d68b', transform: '#b48cf2', combine: '#8fa0b3', effect: '#ef8f5b', number: '#4cc3f0', output: '#e6ebf0', view: '#7aa2ff' };
    const colorOf = (id) => {
      const el = views.get(id)?.el;
      const cls = el ? [...el.classList].find((c) => c.startsWith('cat-')) : null;
      return MM[cls ? cls.slice(4) : ''] || '#6b7886';
    };
    for (const b of boxes) {
      const px = ox + (b.x - x0) * sc, py = oy + (b.y - y0) * sc, pw = Math.max(3, b.w * sc), ph = Math.max(3, b.h * sc), sel = selection.has(b.id);
      ctx.globalAlpha = sel ? 1 : 0.7; ctx.fillStyle = colorOf(b.id); ctx.fillRect(px, py, pw, ph);
      ctx.globalAlpha = 1;
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(px, py, pw, ph); }
    }
    ctx.strokeStyle = A; ctx.lineWidth = 1.5; ctx.strokeRect(ox + (vx - x0) * sc, oy + (vy - y0) * sc, vw * sc, vh * sc);
  }
  mini.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    try { mini.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const go = (ev) => {
      if (!miniMap) return;
      const q = mini.getBoundingClientRect();
      const wx = miniMap.x0 + ((ev.clientX - q.left) * (mini.width / q.width) - miniMap.ox) / miniMap.sc, wy = miniMap.y0 + ((ev.clientY - q.top) * (mini.height / q.height) - miniMap.oy) / miniMap.sc;
      const r = root.getBoundingClientRect();
      view.x = r.width / 2 - wx * view.z; view.y = r.height / 2 - wy * view.z;
      applyView();
    };
    go(e);
    mini.addEventListener('pointermove', go);
    mini.addEventListener('pointerup', () => mini.removeEventListener('pointermove', go), { once: true });
  });
  const applyBoardPrefs = () => { cableSvg.classList.toggle('labels-always', getPrefs().labels === 'always'); drawMini(); };
  onPrefs(() => { applyBoardPrefs(); drawCables(); });
  const applyView = () => {
    world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
    root.style.setProperty('--grid', `${SNAP * view.z}px`);
    root.style.setProperty('--wk', String(Math.min(4, Math.max(1, 1 / view.z))));   // the delete button keeps a usable size when the board is zoomed out
    root.style.backgroundPosition = `${view.x}px ${view.y}px`;
    zoomUI.querySelector('.zoom-val').textContent = Math.round(view.z * 100) + '%';
    drawMini();
  };
  const toWorld = (cx, cy) => {
    const r = root.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
  };
  const narrow = () => root.clientWidth < 600;   // a phone-sized board
  const minZoom = () => (narrow() ? 0.15 : 0.3);

  // ---------- phone "flow" view: one column in signal-flow order, every module folded until you open it ----------
  const flowOpen = new Set();   // modules opened in the flow view (this is not saved with the patch)
  const phoneQuery = window.matchMedia('(max-width: 900px)');   // the same width the phone layout (bottom bar, sheets) starts at
  // The layout is the person's choice (Flow | Board); until they choose, a phone gets Flow and a bigger screen gets the Board
  const flowMode = () => (getPrefs().layout ?? (phoneQuery.matches ? 'flow' : 'board')) === 'flow';
  const isCol = (n) => (flowMode() ? !flowOpen.has(n.id) : !!n.collapsed);
  // a module's name for chips and sheets: its title, plus what makes two of the same kind different (the sound, the wave, the filter type)
  const titleOf = (n) => {
    const p = n.params || {}, d = [p.name, p.wave, p.ftype && p.type, p.type].find((x) => typeof x === 'string' && x && x.length < 22);
    return MODULES[n.type].title + (d && !['sequencer'].includes(MODULES[n.type].cat) ? ' · ' + d : '');
  };
  const flowGroupOpen = new Set();   // groups opened in the flow view; all start folded into one card
  const flowGroupEls = new Map();
  const groupOfNode = (id) => (store.graph.groups || []).find((gr) => gr.nodes.includes(id));
  const groupMuted = (gr) => { const m = gr.nodes.map((id) => nodeById(store.graph, id)).filter((n) => n && MUTE_KIND[n.type]); return m.length > 0 && m.every((n) => n.muted); };
  function flowGroupCard(gr) {
    let e = flowGroupEls.get(gr.id);
    if (e) return e;
    const led = h('span', { class: 'fg-led', title: 'Lights up when this group is playing' });
    const name = h('span', { class: 'fg-name' });
    const count = h('span', { class: 'fg-count' });
    const tog = h('span', { class: 'fg-tog', 'aria-hidden': 'true' });
    const ung = h('button', { class: 'n-btn', type: 'button', title: 'Ungroup (keeps all the modules)', 'aria-label': 'Ungroup', onclick: (ev) => { ev.stopPropagation(); flowGroupOpen.delete(gr.id); hooks.ungroup(gr.id); } }, '×');
    const mute = h('button', { class: 'n-btn n-mute', type: 'button', onclick: (ev) => { ev.stopPropagation(); hooks.muteGroup(gr.id); } });
    const head = h('div', { class: 'fg-head', role: 'button', tabindex: 0, 'aria-label': `Group ${gr.name || ''}: tap to open or fold` }, led, name, count, tog, mute, ung);
    const toggle = () => { if (flowGroupOpen.has(gr.id)) flowGroupOpen.delete(gr.id); else flowGroupOpen.add(gr.id); sync(); };
    head.addEventListener('click', (ev) => { if (!ev.target.closest('button')) toggle(); });
    head.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); toggle(); } });
    const chips = h('div', { class: 'fg-chips' });
    const el = h('div', { class: 'fgroup', dataset: { gid: gr.id } }, head, chips);
    world.append(el);
    e = { el, led, name, count, tog, chips, mute };
    flowGroupEls.set(gr.id, e);
    return e;
  }
  function toggleOpen(id) { if (flowOpen.has(id)) flowOpen.delete(id); else flowOpen.add(id); sync(); }
  function scrollToNode(id) {
    const el = views.get(id)?.el;
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 1000);
  }
  // A sheet that lists every legal place to connect to (or from), so no cable has to be dragged
  let connectSheet = null;
  function openConnectSheet({ fromNode, toNode, toPort }) {
    connectSheet?.remove();
    const g = store.graph;
    const has = (a, bn, bp) => g.wires.some((w) => w.from.node === a && w.to.node === bn && w.to.port === bp);
    let head, rows;
    if (fromNode) {
      head = `Send ${titleOf(nodeById(g, fromNode))} to…`;
      rows = legalTargets(g, fromNode).filter((t) => !has(fromNode, t.node, t.port)).map((t) => ({ label: `${titleOf(nodeById(g, t.node))} · ${t.label}`, go: () => hooks.connect({ node: fromNode, port: 'out' }, { node: t.node, port: t.port }) }));
    } else {
      const port = portsOf(nodeById(g, toNode)).find((p) => p.id === toPort);
      head = `Plug into ${titleOf(nodeById(g, toNode))} · ${port?.label || 'in'}, from…`;
      rows = legalSources(g, toNode, toPort).filter((id) => !has(id, toNode, toPort)).map((id) => ({ label: titleOf(nodeById(g, id)), go: () => hooks.connect({ node: id, port: 'out' }, { node: toNode, port: toPort }) }));
    }
    const close = () => { connectSheet?.remove(); connectSheet = null; document.removeEventListener('pointerdown', away, true); };
    const away = (e) => { if (connectSheet && !connectSheet.contains(e.target)) close(); };
    connectSheet = h('div', { class: 'cpick connect-sheet', role: 'dialog', 'aria-label': head },
      h('div', { class: 'cp-h' }, head),
      rows.length ? h('div', { class: 'cs-list' }, rows.map((r) => h('button', { class: 'cs-row', onclick: () => { close(); r.go(); } }, r.label)))
        : h('div', { class: 'menu-empty' }, 'Nothing else on the board fits here yet. Add a module first (the + button).'),
      h('button', { class: 'btn ghost', onclick: close }, 'Cancel'));
    document.body.append(connectSheet);
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  }
  // Tap-to-connect on the board: tap a jack, the jacks it can plug into light up, tap one. (Dragging a cable still works.)
  let tapMode = null;
  const tapBanner = h('div', { class: 'tap-banner' }, h('span', {}, 'Tap a glowing jack to connect'), h('button', { class: 'btn sm', onclick: () => endTap() }, 'Cancel'));
  function endTap() {
    if (!tapMode) return;
    tapMode = null; tapBanner.remove();
    root.classList.remove('wiring');
    root.querySelectorAll('.jack').forEach((j) => j.classList.remove('ok', 'no', 'hot'));
  }
  function startTap(fixed, test) { tapMode = { fixed, test, at: Date.now() }; root.append(tapBanner); }
  root.addEventListener('click', (e) => { if (tapMode && Date.now() - tapMode.at > 200 && !e.target.closest('.jack, .tap-banner')) endTap(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') endTap(); });
  // flow view: a tap (not a scroll) on a module's header opens or folds it
  root.addEventListener('click', (e) => {
    if (!flowMode()) return;
    const head = e.target.closest('.n-head');
    if (head && !e.target.closest('.jack, button, input, select, textarea')) toggleOpen(head.closest('.node').dataset.id);
  });
  const viewUI = h('div', { class: 'view-toggle', role: 'group', 'aria-label': 'How the modules are laid out' },
    h('button', { type: 'button', class: 'vt-flow', onclick: () => setPref('layout', 'flow') }, 'Flow'),
    h('button', { type: 'button', class: 'vt-board', onclick: () => setPref('layout', 'board') }, 'Board'));
  const paintViewUI = () => { const f = flowMode(); viewUI.querySelector('.vt-flow').classList.toggle('on', f); viewUI.querySelector('.vt-board').classList.toggle('on', !f); };
  // ---- tools: Hand (drag the canvas to move it) and Select (drag the canvas to draw a selection box) ----
  let tool = 'hand', spaceHeld = false, insertHi = null;
  const toolUI = h('div', { class: 'tool-toggle', role: 'group', 'aria-label': 'Canvas tool' },
    h('button', { type: 'button', class: 'tt-hand', title: 'Hand: drag the canvas to move around (H)', 'aria-label': 'Hand tool', onclick: () => api.setTool('hand') }, icon('hand', 18)),
    h('button', { type: 'button', class: 'tt-select', title: 'Select: drag on empty canvas to box-select modules (V). Hold Space to move the canvas.', 'aria-label': 'Select tool', onclick: () => api.setTool('select') }, icon('select', 18)));
  const paintTool = () => { toolUI.querySelector('.tt-hand').classList.toggle('on', tool === 'hand'); toolUI.querySelector('.tt-select').classList.toggle('on', tool === 'select'); root.classList.toggle('tool-select', tool === 'select'); root.classList.toggle('space-hand', spaceHeld); };
  const toolsBar = h('div', { class: 'board-tools' }, viewUI, toolUI);
  root.append(toolsBar); paintViewUI(); paintTool();
  let wasFlow = false;
  // Switching layouts keeps your place: Board -> Flow scrolls to the module nearest the middle of the board; Flow -> Board shows the module that was at the top of the list
  const visibleNodes = () => [...views].filter(([, v]) => v.el.offsetWidth && !v.el.classList.contains('gh') && !v.el.classList.contains('fg-hidden'));
  function focusNode(id) {
    const n = nodeById(store.graph, id), el = views.get(id)?.el;
    if (!n || !el) return fit();
    const r = root.getBoundingClientRect();
    view.z = Math.min(1, Math.max(0.5, (r.width - 24) / (el.offsetWidth || 260)));
    view.x = 12 - n.x * view.z; view.y = 12 - n.y * view.z;
    applyView();
  }
  const relayout = () => {
    const f = flowMode();
    if (f === wasFlow) return;
    const rr = root.getBoundingClientRect();
    let keep = null;
    if (wasFlow) keep = visibleNodes().filter(([, v]) => v.el.getBoundingClientRect().bottom > rr.top + 20).sort((a, b) => a[1].el.getBoundingClientRect().top - b[1].el.getBoundingClientRect().top)[0]?.[0];
    else keep = visibleNodes().sort((a, b) => { const d = (v) => { const q = v.el.getBoundingClientRect(); return Math.hypot(q.x + q.width / 2 - (rr.x + rr.width / 2), q.y + q.height / 2 - (rr.y + rr.height / 2)); }; return d(a[1]) - d(b[1]); })[0]?.[0];
    wasFlow = f; paintViewUI(); sync();
    setTimeout(() => { if (f) { if (keep) { const el = views.get(keep)?.el; el?.scrollIntoView({ block: 'start' }); } } else if (keep) focusNode(keep); else fit(); }, 0);
  };
  window.addEventListener('resize', relayout);
  onPrefs((p, k) => { if (k === 'layout') relayout(); });
  function zoomAt(f, cx, cy) {
    const z = Math.min(2, Math.max(minZoom(), view.z * f));
    const r = root.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    view.x = px - ((px - view.x) / view.z) * z;
    view.y = py - ((py - view.y) / view.z) * z;
    view.z = z;
    applyView();
  }
  function zoomBy(f) { const r = root.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); }
  // On a phone the whole patch at once would be too small to read. So by default show the first module (the leftmost) at a readable size and let the
  // person pan along; the "fit" button still gives the overview.
  function focusStart() {
    const g = store.graph, first = [...g.nodes].sort((a, b2) => a.x - b2.x || a.y - b2.y)[0];
    const el = views.get(first.id)?.el, w = el?.offsetWidth || 260, r = root.getBoundingClientRect();
    view.z = Math.min(1, Math.max(0.5, (r.width - 24) / w));
    view.x = 12 - first.x * view.z;
    view.y = 12 - first.y * view.z;
    applyView();
  }
  function fit(opts = {}) {
    const g = store.graph;
    if (!g.nodes.length) { Object.assign(view, { x: 40, y: 20, z: 1 }); return applyView(); }
    if (narrow() && !opts.overview) return focusStart();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of g.nodes) {
      const el = views.get(n.id)?.el;
      const w = el?.offsetWidth || 220, hh = el?.offsetHeight || 160;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + hh);
    }
    const r = root.getBoundingClientRect();
    const z = Math.min(1.1, Math.max(minZoom(), Math.min((r.width - 80) / (x1 - x0), (r.height - 80) / (y1 - y0))));
    view.z = z;
    view.x = (r.width - (x1 - x0) * z) / 2 - x0 * z;
    view.y = (r.height - (y1 - y0) * z) / 2 - y0 * z;
    applyView();
  }

  root.addEventListener('wheel', (e) => {
    if (flowMode()) return;   // the flow view scrolls like a page
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
  }, { passive: false });

  // Panning and pinching. One finger (or the mouse) on empty board pans it; two fingers pinch to zoom and pan together. The finger tracking is
  // registered in the capture phase so a finger that lands on a module still counts towards a pinch.
  const touches = new Map();   // pointerId -> last position, for fingers only
  let pan = null, pinch = null;
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  function beginPinch() {
    const [p, q] = [...touches.values()];
    pan = null;
    pinch = { d0: Math.max(1, dist(p, q)), z0: view.z, mid0: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, vx0: view.x, vy0: view.y };
    root.classList.add('pinching');
  }
  function updatePinch() {
    const [p, q] = [...touches.values()], r = root.getBoundingClientRect();
    const z = Math.min(2, Math.max(minZoom(), pinch.z0 * (dist(p, q) / pinch.d0)));
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    // keep the point of the board that was between the fingers at the start between them now
    const wx = (pinch.mid0.x - r.left - pinch.vx0) / pinch.z0, wy = (pinch.mid0.y - r.top - pinch.vy0) / pinch.z0;
    view.z = z; view.x = mid.x - r.left - wx * z; view.y = mid.y - r.top - wy * z;
    applyView();
  }
  function endPinch() {
    pinch = null; root.classList.remove('pinching');
    if (touches.size === 1) { const [[id, p]] = [...touches]; pan = { id, sx: p.x - view.x, sy: p.y - view.y }; }   // the finger left on the board carries on panning, without a jump
  }
  function startPan(e, keepSelection = false) {
    if (pinch || touches.size >= 2) return;
    if (!keepSelection) selectNode(null);
    try { root.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    pan = { id: e.pointerId, sx: e.clientX - view.x, sy: e.clientY - view.y };
    root.classList.add('panning');
  }
  // a press anywhere except on the selected cable (or its delete button) deselects the cable, which hides its delete button
  root.addEventListener('pointerdown', (e) => { if (selectedWire && !e.target.closest('.cable-hit, .wdel')) { selectedWire = null; drawCables(); } }, true);
  root.addEventListener('pointerdown', (e) => {
    if (flowMode()) return;
    if (e.pointerType === 'touch') { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (touches.size === 2) beginPinch(); }
  }, true);
  root.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) { if (touches.size >= 2) updatePinch(); return; }
    if (pan && e.pointerId === pan.id) { view.x = e.clientX - pan.sx; view.y = e.clientY - pan.sy; applyView(); }
  });
  const endPointer = (e) => {
    touches.delete(e.pointerId);
    if (pinch && touches.size < 2) endPinch();
    if (pan && e.pointerId === pan.id) { pan = null; root.classList.remove('panning'); }
    if (!pan) root.classList.remove('panning');
  };
  root.addEventListener('pointerup', endPointer);
  root.addEventListener('pointercancel', endPointer);
  // pan by dragging empty board
  root.addEventListener('pointerdown', (e) => {
    if (flowMode()) return;   // the flow view scrolls; there is no panning or box selecting
    if (e.target.closest('.node, .zoom, .cable-hit, .minimap, .selbar, .board-tools, .tap-banner')) return;   // the Flow/Board switch and the connect banner are buttons on the board: a press on them must not start a pan (it captures the pointer, so the click never reaches the button). The selection bar is on the board, so a click on it must not count as a click on empty board (that would clear the selection first)
    if (e.shiftKey || e.metaKey || e.ctrlKey || (tool === 'select' && !spaceHeld)) return startMarquee(e);   // Select tool: dragging empty canvas draws a selection box. Space held turns it into the hand for a moment
    startPan(e);
  });

  // drag a box with Shift (or Ctrl/⌘) held to select several modules
  function startMarquee(e) {
    const rr = root.getBoundingClientRect();
    const x0 = e.clientX, y0 = e.clientY;
    const box = h('div', { class: 'marquee' });
    root.append(box);
    try { root.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const keep = e.shiftKey ? new Set(selection) : null;   // Shift adds to the current selection
    const draw = (ev) => Object.assign(box.style, { left: Math.min(x0, ev.clientX) - rr.left + 'px', top: Math.min(y0, ev.clientY) - rr.top + 'px', width: Math.abs(ev.clientX - x0) + 'px', height: Math.abs(ev.clientY - y0) + 'px' });
    const up = (ev) => {
      draw(ev);
      const b = box.getBoundingClientRect();
      box.remove();
      selection.clear();
      keep?.forEach((k) => selection.add(k));
      views.forEach((v, k) => { const r = v.el.getBoundingClientRect(); if (v.el.offsetWidth && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top) selection.add(k); });
      paintSelection();
      root.removeEventListener('pointermove', draw); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up);
    };
    root.addEventListener('pointermove', draw);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  }
  function paintSelection() { views.forEach((v, k) => v.el.classList.toggle('selected', selection.has(k))); paintSelbar(); drawMini(); }
  const hiddenGroup = (id) => (store.graph.groups || []).find((gr) => gr.collapsed && gr.nodes.includes(id));
  function selectNode(id) { selection.clear(); if (Array.isArray(id)) id.forEach((i) => selection.add(i)); else if (id) selection.add(id); paintSelection(); }

  // ---------- jacks & cables ----------
  function jackPos(nodeId, portId) {
    const hg = hiddenGroup(nodeId);
    if (hg && groupEls.get(hg.id)?.rect) { const r = groupEls.get(hg.id).rect; return portId === 'out' ? { x: r.x + r.w, y: r.y + r.h / 2 } : { x: r.x, y: r.y + r.h / 2 }; }
    const v = views.get(nodeId);
    if (!v) return null;
    let j = v.el.querySelector(`.jack[data-port="${CSS.escape(portId)}"]`);
    if (!j || !j.offsetParent) j = v.el.querySelector('.jack.in:not(.param)') || v.el.querySelector('.jack.out') || j;
    if (!j) return null;
    const wr = world.getBoundingClientRect(), r = j.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - wr.left) / view.z, y: (r.top + r.height / 2 - wr.top) / view.z };
  }
  const cablePath = (a, b) => {
    const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
    const sag = Math.min(70, 18 + Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
    return `M${a.x} ${a.y} C${a.x + dx} ${a.y + sag},${b.x - dx} ${b.y + sag},${b.x} ${b.y}`;
  };

  function stepPath(a, b) {
    const dy = b.y - a.y;
    if (b.x - a.x < 70) return cablePath(a, b);
    if (Math.abs(dy) < 3) return `M${a.x} ${a.y} H${b.x}`;
    const mx = a.x + Math.max(30, (b.x - a.x) / 2), dir = Math.sign(dy);
    const r = Math.min(12, Math.abs(dy) / 2, mx - a.x, b.x - mx);
    return `M${a.x} ${a.y} H${mx - r} Q${mx} ${a.y} ${mx} ${a.y + dir * r} V${b.y - dir * r} Q${mx} ${b.y} ${mx + r} ${b.y} H${b.x}`;
  }
  function drawCables() {
    const g = store.graph;
    const seen = new Set();
    for (const w of g.wires) {
      const ga = hiddenGroup(w.from.node), gb = hiddenGroup(w.to.node);
      if (ga && ga === gb) continue; // both ends inside one collapsed group
      const a = jackPos(w.from.node, w.from.port), b = jackPos(w.to.node, w.to.port);
      if (!a || !b) continue;
      seen.add(w.id);
      let e = wireEls.get(w.id);
      if (!e) {
        const grp = svg('g', { class: 'wire' });
        const hit = svg('path', { class: 'cable-hit' });
        const cab = svg('path', { class: 'cable' });
        hit.addEventListener('dblclick', () => hooks.removeWire(w.id));
        hit.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); selectWire(w.id); });
        hit.addEventListener('pointerenter', () => hooks.hoverWire?.(w.id));
        const lab = svg('g', { class: 'wlabel' });
        const lr = svg('rect', { height: 14, rx: 7, y: -7 });
        const lt = svg('text', { 'text-anchor': 'middle', y: 3.5 });
        lab.append(lr, lt);
        // the delete button: appears in the middle of the cable once it is selected (a tap or click on the cable), so a cable can be removed without a keyboard
        const del = svg('g', { class: 'wdel', role: 'button', 'aria-label': 'Delete this connection' });
        del.append(svg('title', {}), svg('circle', { r: 13 }), svg('path', { d: 'M-4.5 -4.5L4.5 4.5M4.5 -4.5L-4.5 4.5' }));
        del.firstChild.textContent = 'Delete this connection';
        del.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); ev.preventDefault(); });
        del.addEventListener('click', (ev) => { ev.stopPropagation(); selectedWire = null; hooks.removeWire(w.id); });
        grp.append(cab, hit, lab, del);
        cableLayer.append(grp);
        e = { grp, cab, hit, lab, lr, lt, del };
        wireEls.set(w.id, e);
      }
      const d = getPrefs().cables === 'step' ? stepPath(a, b) : cablePath(a, b);
      e.cab.setAttribute('d', d); e.hit.setAttribute('d', d);
      e.grp.dataset.type = outType(g, w.from.node) || 'sound';
      const label = w.to.port.startsWith('p:') ? 'number → ' + w.to.port.slice(2) : e.grp.dataset.type;
      if (e.lt.textContent !== label) { e.lt.textContent = label; e.lr.setAttribute('width', label.length * 5.6 + 12); e.lr.setAttribute('x', -(label.length * 5.6 + 12) / 2); }
      try { const pt = e.cab.getPointAtLength(e.cab.getTotalLength() / 2); e.lab.setAttribute('transform', `translate(${pt.x},${pt.y})`); e.del.setAttribute('transform', `translate(${pt.x},${pt.y})`); } catch { /* not laid out yet */ }
      e.grp.classList.toggle('selwire', w.id === selectedWire);
    }
    for (const [id, e] of wireEls) if (!seen.has(id)) { e.grp.remove(); wireEls.delete(id); }
  }
  let selectedWire = null;
  function selectWire(id) { selectedWire = id; drawCables(); }

  // ---------- cable dragging ----------
  function beginCable(jack, e) {
    e.preventDefault(); e.stopPropagation();
    const g = store.graph;
    if (tapMode) {   // second tap of a tap-to-connect
      const t = tapMode; endTap();
      if (jack.dataset.dir !== t.fixed.dir && t.test(jack)) {
        const from = t.fixed.dir === 'out' ? { node: t.fixed.node, port: 'out' } : { node: jack.dataset.node, port: 'out' };
        const to = t.fixed.dir === 'out' ? { node: jack.dataset.node, port: jack.dataset.port } : { node: t.fixed.node, port: t.fixed.port };
        hooks.connect(from, to);
      }
      return;
    }
    const nodeId = jack.dataset.node, portId = jack.dataset.port, dir = jack.dataset.dir;
    let fixed; // the end that stays: {node, port, dir}
    if (dir === 'in') {
      const existing = wiresInto(g, nodeId, portId);
      if (existing.length && !(portsOf(nodeById(g, nodeId)).find((p) => p.id === portId)?.multi)) {
        const w = existing[0];
        fixed = { node: w.from.node, port: 'out', dir: 'out', pickedUp: w };
      } else fixed = { node: nodeId, port: portId, dir: 'in' };
    } else fixed = { node: nodeId, port: 'out', dir: 'out' };

    // legality of every jack for this drag, shown while dragging
    const test = (j) => {
      const jd = j.dataset.dir;
      if (jd === fixed.dir) return false;
      const base = fixed.pickedUp ? { ...g, wires: g.wires.filter((w) => w.id !== fixed.pickedUp.id) } : g;
      return fixed.dir === 'out' ? !whyNot(base, fixed.node, j.dataset.node, j.dataset.port) : !whyNot(base, j.dataset.node, fixed.node, fixed.port);
    };
    const jacks = [...root.querySelectorAll('.jack')];
    const legal = new Map(jacks.map((j) => [j, test(j)]));
    root.classList.add('wiring');
    jacks.forEach((j) => { j.classList.toggle('ok', legal.get(j)); j.classList.toggle('no', !legal.get(j)); });
    const fixedPort = fixed.dir === 'in' ? portsOf(nodeById(g, fixed.node)).find((p) => p.id === fixed.port) : null;
    ghost.dataset.type = fixed.dir === 'out' ? outType(g, fixed.node) || 'sound' : (Array.isArray(fixedPort?.accept) ? fixedPort.accept[0] : 'sound');
    let pickedHidden = null;
    if (fixed.pickedUp) { pickedHidden = wireEls.get(fixed.pickedUp.id); pickedHidden?.grp.classList.add('lifted'); }

    const anchor = jackPos(fixed.node, fixed.port);
    const targetJack = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      let j = el?.closest?.('.jack');
      if (j && legal.get(j)) return j;
      const nodeEl = el?.closest?.('.node');
      if (nodeEl) {
        const cands = [...nodeEl.querySelectorAll('.jack')].filter((x) => legal.get(x) && x.offsetParent);
        cands.sort((a, b) => (a.classList.contains('param') ? 1 : 0) - (b.classList.contains('param') ? 1 : 0));
        return cands[0] || null;
      }
      return null;
    };
    let over = null;
    const move = (ev) => {
      const p = toWorld(ev.clientX, ev.clientY);
      over?.classList.remove('hot');
      over = targetJack(ev);
      over?.classList.add('hot');
      const end = over ? jackPos(over.dataset.node, over.dataset.port) : p;
      ghost.setAttribute('d', fixed.dir === 'out' ? cablePath(anchor, end) : cablePath(end, anchor));
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!fixed.pickedUp && !targetJack(ev) && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 8) {   // a tap, not a drag: wait for a second tap on a glowing jack
        ghost.setAttribute('d', '');
        return startTap(fixed, test);
      }
      const noJack = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.jack.no');
      root.classList.remove('wiring');
      jacks.forEach((j) => j.classList.remove('ok', 'no', 'hot'));
      ghost.setAttribute('d', '');
      pickedHidden?.grp.classList.remove('lifted');
      const t = targetJack(ev);
      if (t) {
        const from = fixed.dir === 'out' ? { node: fixed.node, port: 'out' } : { node: t.dataset.node, port: 'out' };
        const to = fixed.dir === 'out' ? { node: t.dataset.node, port: t.dataset.port } : { node: fixed.node, port: fixed.port };
        hooks.connect(from, to, fixed.pickedUp?.id);
      } else if (fixed.pickedUp) {
        const moved = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 6;
        if (moved) hooks.removeWire(fixed.pickedUp.id, 'Cable unplugged');
      } else if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 30) {
        if (noJack) hooks.explain?.(fixed, noJack, store.graph);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    move(e);
  }

  // ---------- node views ----------
  function paramLabel(def, spec, node) {
    if (spec.callFrom) return spec.qSuffix ? node.params[spec.callFrom].replace('f', 'q') : node.params[spec.callFrom];
    return spec.call || spec.label || spec.key;   // a dial with no code call of its own shows its plain name (volume, chance, freeze) instead of an internal key
  }
  // What a knob is being driven to right now, when its cable comes from a Slider or a Macro (it follows them). A Wave moves by itself, so it has no single value to show.
  function drivenValue(g, node, spec, key) {
    const w = wiresInto(g, node.id, 'p:' + key)[0], src = w && nodeById(g, w.from.node);
    if (!src) return null;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    if (src.type === 'slider') return clamp(Number(src.params.value), Number(src.params.min), Number(src.params.max));
    if (src.type === 'macro') {   // the same maths the code uses: .mul(setting), or .range(lo, hi) with .pow(3) on a log knob
      const v = clamp(Number(src.params.value), 0, 1);
      return src.params.mode === 'multiply' ? v * Number(node.params[key]) : spec.min + (spec.log ? v ** 3 : v) * (spec.max - spec.min);
    }
    return null;
  }
  const knobRange = (node, spec) => (spec.dyn ? { min: Number(node.params.min), max: Number(node.params.max), step: Number(node.params.step) || 0 } : { min: spec.min, max: spec.max });

  function buildNode(node) {
    const def = MODULES[node.type];
    const el = h('div', { class: `node cat-${def.cat}`, dataset: { id: node.id, type: node.type } });
    const rz = h('div', { class: 'n-resize', title: 'Drag to make this module wider. Double-click to reset.' });
    rz.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { rz.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      const keep = el.style.width; el.style.width = ''; const minW = el.offsetWidth; el.style.width = keep;
      const startW = el.offsetWidth, x0 = e.clientX;
      const move = (ev) => hooks.setNodeWidth(node.id, Math.max(minW, Math.round((startW + (ev.clientX - x0) / view.z) / 12) * 12));
      const up = () => { rz.removeEventListener('pointermove', move); rz.removeEventListener('pointerup', up); };
      rz.addEventListener('pointermove', move); rz.addEventListener('pointerup', up);
    });
    rz.addEventListener('dblclick', (e) => { e.stopPropagation(); hooks.setNodeWidth(node.id, null); });
    el.append(rz);
    const mk = MUTE_KIND[node.type];
    const muteBtn = mk ? h('button', { class: 'n-btn n-mute' + (node.muted ? ' on' : ''), title: node.muted ? (mk === 'bypass' ? 'Bypassed: click to switch it on' : 'Muted: click to unmute') : (mk === 'bypass' ? 'Bypass this effect' : 'Mute this module'), onclick: (e) => { e.stopPropagation(); hooks.toggleMute(node.id); } }, mk === 'bypass' ? powerSvg() : speakerSvg(!!node.muted)) : null;
    const menuBtn = h('button', { class: 'n-btn', title: 'More', onclick: (e) => { e.stopPropagation(); openNodeMenu(menuBtn, node.id); } }, '⋯');
    const makeJack = (p) => {
      const out = p === 'out';
      const acc = out ? [] : (p.accept === 'same' ? [] : p.accept);
      const jack = h('div', { class: 'jack ' + (out ? 'out' : 'in'), dataset: { node: node.id, port: out ? 'out' : p.id, dir: out ? 'out' : 'in' }, title: out ? 'output' : `${p.label} input${acc.length ? ' (' + acc.join(' / ') + ')' : ''}` });
      jack.addEventListener('pointerdown', (e) => beginCable(jack, e));
      return jack;
    };
    // a "?" beside an empty input of the selected module: what plugs in here (Settings → Socket help)
    const makeQ = (p) => {
      const q = h('button', { class: 'jack-q', type: 'button', title: 'What plugs in here?', 'aria-label': `What plugs into the ${p.label} input`, dataset: { node: node.id, port: p.id } }, '?');
      q.addEventListener('pointerdown', (e) => e.stopPropagation());
      q.addEventListener('click', (e) => { e.stopPropagation(); openJackHelp(q, node, p); });
      return q;
    };
    const ins = portsOf(node).filter((p) => p.dir === 'in' && !p.param);
    const inHeader = ins.length <= 1; // one input and one output sit in the title bar; modules with several inputs keep a rail
    const headKids = [h('span', { class: 'n-title' }, def.title), muteBtn, h('button', { class: 'n-btn', title: 'Collapse / expand', onclick: (e) => { e.stopPropagation(); if (flowMode()) toggleOpen(node.id); else hooks.collapse(node.id); } }, isCol(node) ? '▸' : '▾'), menuBtn];
    if (inHeader) {
      if (ins[0]) { const j = makeJack(ins[0]); j.classList.add('hj-l'); const q = makeQ(ins[0]); q.classList.add('hq'); headKids.unshift(j, q); }
      if (def.out) { const j = makeJack('out'); j.classList.add('hj-r'); headKids.push(j); }
    }
    const head = h('div', { class: 'n-head' }, headKids);
    el.append(head);
    el.classList.toggle('muted', !!node.muted);
    if (!inHeader) {
      const inRail = h('div', { class: 'rail rail-in' });
      ins.forEach((p, i) => inRail.append(h('div', { class: 'rail-row' + (node.type === 'arrange' || node.type === 'mixer' ? ' arr-in' : ''), style: node.type === 'arrange' || node.type === 'mixer' ? `--hue: ${(i * 57 + 200) % 360}` : '' }, makeJack(p), makeQ(p), h('span', { class: 'rail-label' }, p.label))));
      const outRail = def.out ? h('div', { class: 'rail rail-out' }, h('div', { class: 'rail-row' }, h('span', { class: 'rail-label' }, 'out'), makeJack('out'))) : null;
      el.append(h('div', { class: 'ports' }, inRail, h('span', { class: 'sp' }), outRail));
    }

    const body = h('div', { class: 'n-body' });
    if (!isCol(node)) el.append(body);
    const ctl = { knobs: {}, inputs: {}, node };
    const row = h('div', { class: 'controls' });
    for (const spec of def.params) {
      if (spec.hide) continue;
      if (spec.kind === 'knob') {
        const isH = (node.type === 'slider' || node.type === 'macro') && spec.key === 'value';
        const knob = isH ? makeHSlider(spec, (v) => hooks.setParam(node.id, spec.key, v)) : makeKnob(spec, (v) => hooks.setParam(node.id, spec.key, v));
        const cell = h('div', { class: 'kcell' + (isH ? ' wide' : ''), dataset: { key: spec.key } });
        if (spec.wire) {
          const jack = h('div', { class: 'jack in param', dataset: { node: node.id, port: 'p:' + spec.key, dir: 'in' }, title: `${spec.label}: plug a number cable here` });
          jack.addEventListener('pointerdown', (e) => beginCable(jack, e));
          cell.append(jack);
        }
        const val = h('div', { class: 'k-val' });
        const lab = h('div', { class: 'k-label' });
        // up and down arrows beside the value. They are laid over the value line (absolute, so nothing around them moves) and only appear
        // while this dial is the one you clicked (it has the focus); clicking them keeps that focus. Click = one step, Shift-click = ten, hold = repeat.
        const stepBtn = (d) => {
          const bt = h('button', { class: 'k-step ' + (d > 0 ? 'up' : 'down'), type: 'button', tabindex: -1, title: `${d > 0 ? 'up' : 'down'} one step (Shift: ten, hold: repeat)`, 'aria-label': `${spec.label} ${d > 0 ? 'up' : 'down'}` }, d > 0 ? '▲' : '▼');
          let wait = null, rep = null;
          // The module can be redrawn while the button is held (the button is then replaced and never sees its pointerup),
          // so the repeat is ended by a pointerup anywhere (or a cancel, or the window losing focus), not by the button's own.
          const stop = () => { clearTimeout(wait); clearInterval(rep); wait = rep = null; window.removeEventListener('pointerup', stop, true); window.removeEventListener('pointercancel', stop, true); window.removeEventListener('blur', stop); };
          bt.addEventListener('pointerdown', (e) => {
            e.stopPropagation(); e.preventDefault();   // preventDefault keeps the focus on the dial, so the arrows stay visible
            stop();
            try { bt.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
            window.addEventListener('pointerup', stop, true); window.addEventListener('pointercancel', stop, true); window.addEventListener('blur', stop);
            const tick = () => knob.step(d, e.shiftKey);
            tick();
            wait = setTimeout(() => { rep = setInterval(tick, 70); }, 420);
          });
          for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) bt.addEventListener(ev, stop);
          return bt;
        };
        const valRow = h('div', { class: 'k-valrow' }, val, h('div', { class: 'k-steps' }, stepBtn(-1), stepBtn(1)));
        cell.append(knob.el, valRow, lab);
        cell.addEventListener('mouseenter', () => hooks.hover?.({ node: node.id, key: spec.key }));
        cell.addEventListener('mouseleave', () => hooks.hover?.({ node: node.id }));
        ctl.knobs[spec.key] = { knob, val, lab, cell, spec };
        row.append(cell);
      } else if (spec.kind === 'instrument') {
        const btn = h('button', { class: 'inst-btn', title: 'choose the sound this instrument plays' });
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.addEventListener('click', () => openSoundPicker({ anchor: btn, items: INSTRUMENTS.map((i) => ({ ...i, pitched: true })), cats: INST_CATS, current: store.graph.nodes.find((x) => x.id === node.id)?.params[spec.key], onPick: (id) => hooks.setParam(node.id, spec.key, id) }));
        btn.classList.add('card');
        const wrap = h('div', { class: 'field soundfield' }, btn);   // the sound comes first in the module: placed at the top below
        wrap.addEventListener('mouseenter', () => hooks.hover?.({ node: node.id, key: spec.key }));
        wrap.addEventListener('mouseleave', () => hooks.hover?.({ node: node.id }));
        ctl.inst = { btn, key: spec.key };
        ctl.soundField = wrap;
        if (node.type === 'synth') {
          // the waveform buttons are only shown while the sound is one of the synth waves (they mean nothing for a piano or a flute)
          const waves = h('div', { class: 'wave-row' }, WAVE_ICONS.map(([wid, path]) => { const wb = h('button', { class: 'wave-btn', title: wid, dataset: { wave: wid } }, waveSvg(path)); wb.addEventListener('pointerdown', (e) => e.stopPropagation()); wb.addEventListener('click', () => hooks.setParam(node.id, spec.key, wid)); return wb; }));
          ctl.inst.waves = waves;
          ctl.wavesEl = waves;
        }
      } else if (spec.kind === 'select' && spec.icons) {
        const row = h('div', { class: 'wave-row icon-choice', title: spec.label });
        for (const o of spec.options) {
          const val = Array.isArray(o) ? o[0] : o, name = Array.isArray(o) ? o[1] : o;
          const path = ICON_SETS[spec.icons][val];
          const b = h('button', { class: 'wave-btn', title: val === '' ? 'automatic' : name, dataset: { opt: String(val) } }, path ? waveSvg(path) : h('span', { class: 'wb-t' }, val === '' ? 'auto' : name));
          b.addEventListener('pointerdown', (e) => e.stopPropagation());
          b.addEventListener('click', () => hooks.setParam(node.id, spec.key, spec.num ? Number(val) : val));
          row.append(b);
        }
        (ctl.iconRows ||= {})[spec.key] = row;
        body.append(h('div', { class: 'field icons' }, h('span', {}, spec.label), row));
      } else if (spec.kind === 'select') {
        const sel = h('select', { class: 'sel', onchange: (e) => hooks.setParam(node.id, spec.key, spec.num ? Number(e.target.value) : e.target.value) },
          spec.options.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o === '' ? '(none)' : o))));
        const wrap = h('label', { class: 'field' }, h('span', {}, spec.label), sel);
        wrap.addEventListener('mouseenter', () => hooks.hover?.({ node: node.id, key: spec.key }));
        wrap.addEventListener('mouseleave', () => hooks.hover?.({ node: node.id }));
        ctl.inputs[spec.key] = sel;
        body.append(wrap);
      } else if (spec.kind === 'code') {
        const ta = h('textarea', { class: 'txt code-area', rows: 5, spellcheck: 'false', oninput: (e) => hooks.setParam(node.id, spec.key, e.target.value) });
        ta.addEventListener('keydown', (e) => e.stopPropagation());
        const wrap = h('label', { class: 'field col' }, h('span', {}, spec.label), ta);
        ctl.inputs[spec.key] = ta;
        body.append(wrap);
      } else if (spec.kind === 'text' || spec.kind === 'code') {
        // wrap: a long pattern breaks onto new lines inside the box (and the box grows) instead of scrolling sideways or stretching the module
        const inp = spec.wrap
          ? h('textarea', { class: 'txt wrapbox', rows: 1, spellcheck: 'false', oninput: (e) => { const t = e.target.value.replace(/\s*\n\s*/g, ' '); if (t !== e.target.value) e.target.value = t; autosize(e.target); hooks.setParam(node.id, spec.key, t); } })
          : h('input', { class: 'txt', type: 'text', spellcheck: 'false', oninput: (e) => hooks.setParam(node.id, spec.key, e.target.value) });
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (spec.wrap && e.key === 'Enter') e.preventDefault(); });
        if (spec.wrap && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => autosize(inp)).observe(inp);
        // collapse: a long text shows as one line and opens to its full size when you click into it or press the arrow
        let collapseBtn = null;
        if (spec.collapse) {
          const pin = `${node.id}:${spec.key}`;
          inp.classList.add('collapsible'); if (openText.has(pin)) inp.classList.add('open');
          inp.addEventListener('focus', () => { inp.classList.add('open'); autosize(inp); });
          inp.addEventListener('blur', () => { if (!openText.has(pin)) { inp.classList.remove('open'); autosize(inp); } });
          collapseBtn = h('button', { type: 'button', class: 'txt-toggle', title: 'Show the whole text, or fold it to one line', 'aria-label': 'Show or fold the text' }, '⌄');
          collapseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
          collapseBtn.addEventListener('click', (e) => { e.preventDefault(); if (openText.has(pin)) { openText.delete(pin); inp.classList.remove('open'); } else { openText.add(pin); inp.classList.add('open'); } collapseBtn.classList.toggle('on', openText.has(pin)); autosize(inp); });
          collapseBtn.classList.toggle('on', openText.has(pin));
        }
        // A Sample's pattern box lights up the word that is playing: a see-through layer over the text, with a mark where each sound sounds now
        let hlWrap = null;
        if (node.type === 'sample' && spec.key === 'name') {
          const hl = h('div', { class: 'txt-hl', 'aria-hidden': 'true' });
          hlWrap = h('span', { class: 'hlwrap' }, inp, hl);
          const active = new Set();
          const paint = () => {
            const cs = getComputedStyle(inp);
            Object.assign(hl.style, { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, letterSpacing: cs.letterSpacing, paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderWidth: cs.borderWidth, lineHeight: cs.lineHeight });
            const t = inp.value, cuts = [...new Set([0, t.length, ...[...active].flatMap((r) => [Math.max(0, Math.min(t.length, r.from)), Math.max(0, Math.min(t.length, r.to))])])].sort((a, b) => a - b);
            const out = [];
            for (let i = 0; i < cuts.length - 1; i++) {
              const seg = t.slice(cuts[i], cuts[i + 1]); if (!seg) continue;
              const on = [...active].some((r) => r.from <= cuts[i] && r.to >= cuts[i + 1]);
              out.push(on ? h('mark', {}, seg) : document.createTextNode(seg));
            }
            hl.replaceChildren(...out); hl.scrollLeft = inp.scrollLeft;
          };
          inp.addEventListener('scroll', () => { hl.scrollLeft = inp.scrollLeft; });
          ctl.hlText = {
            flash(from, to, ms) { const r = { from, to }; active.add(r); paint(); setTimeout(() => { active.delete(r); paint(); }, ms); },
          };
        }
        const wrap = h('label', { class: 'field' }, h('span', {}, spec.label), collapseBtn ? h('span', { class: 'collwrap' }, inp, collapseBtn) : (hlWrap || inp));
        wrap.addEventListener('mouseenter', () => hooks.hover?.({ node: node.id, key: spec.key }));
        wrap.addEventListener('mouseleave', () => hooks.hover?.({ node: node.id }));
        ctl.inputs[spec.key] = inp;
        if (node.type === 'sample' && spec.key === 'name') {
          // the sound comes first: a card with a graphic (it opens the picker), then the pattern box and the bank under it
          const card = h('button', { class: 'inst-btn card', title: 'choose a sound: hover one to hear it, click to add it' });
          card.addEventListener('pointerdown', (e) => e.stopPropagation());
          card.addEventListener('click', (e) => {
            e.preventDefault();
            const cur = store.graph.nodes.find((x) => x.id === node.id)?.params;
            openSoundPicker({ anchor: card, items: sampleItems(cur?.bank || ''), cats: SAMPLE_CATS, current: soundNames(cur?.name)[0] || '',
              onPick: (id) => { const t = String(cur?.name || '').trim(); hooks.setParam(node.id, 'name', !t || /^[\w:]+$/.test(t) ? id : t + ' ' + id); } });
          });
          ctl.sampleCard = card;
          ctl.toDrums = h('button', { class: 'btn sm to-drums', type: 'button', hidden: true, title: 'This pattern uses several different sounds: turn the module into a Drum Machine with one row per sound' }, '→ Drum Machine');
          ctl.toDrums.addEventListener('pointerdown', (e) => e.stopPropagation());
          ctl.toDrums.addEventListener('click', () => hooks.convertToDrums(node.id));
          ctl.soundField = h('div', { class: 'soundfield sample-group' }, card, wrap, ctl.toDrums);
        } else body.append(wrap);
      } else if (spec.kind === 'num') {
        const inp = h('input', { class: 'txt num', type: 'number', oninput: (e) => e.target.value !== '' && hooks.setParam(node.id, spec.key, Number(e.target.value)) });
        inp.addEventListener('keydown', (e) => e.stopPropagation());
        ctl.inputs[spec.key] = inp;
        body.append(h('label', { class: 'field' }, h('span', {}, spec.label), inp));
      }
    }
    if (row.children.length) body.append(row);
    if (def.preview && !isCol(node)) { ctl.preview = h('canvas', { class: 'previewcanvas', width: 240, height: 72 }); body.prepend(ctl.preview); }
    if (def.canvas && !isCol(node)) { ctl.canvas = h('canvas', { class: 'viewcanvas', width: 260, height: 110 }); body.prepend(ctl.canvas); }
    if (def.data?.arrange && !isCol(node)) body.prepend(buildArrange(node, ctl));
    if (def.data?.mixer && !isCol(node)) body.prepend(buildMixer(node, ctl, { store, hooks, h }));
    if (def.data?.fxrack && !isCol(node)) body.prepend(buildFxRack(node, ctl, { store, hooks, h }));
    if (def.data?.envelope && !isCol(node)) { ctl.envEl = buildEnvelope(node, ctl, def); body.prepend(ctl.envEl); }
    if (def.data?.fmdiagram && !isCol(node)) body.prepend(buildFmDiagram(node, ctl, { store, hooks, h, relayout: () => setTimeout(drawCables, 0) }));
    if (def.data?.pulsepic && !isCol(node)) body.prepend(buildPulseDiagram(node, ctl, { store, h }));
    for (const [flag, build] of Object.entries(PICS)) if (def.data?.[flag] && !isCol(node)) body.prepend(build(node, ctl, { store, hooks, h }));
    if (def.data?.chords && !isCol(node)) body.prepend(buildChords(node, ctl));
    else if (def.data?.cells && !isCol(node)) body.prepend(buildSequencer(node, ctl));
    if (def.data?.tracks && !isCol(node)) body.prepend(buildDrums(node, ctl));
    if (CONVERTERS[node.type] && !isCol(node)) {   // step grid <-> text module
      const cv = CONVERTERS[node.type];
      ctl.convert = h('button', { class: 'btn sm to-text', type: 'button', title: cv.title }, cv.label);
      ctl.convert.addEventListener('pointerdown', (e) => e.stopPropagation());
      ctl.convert.addEventListener('click', () => hooks.convertSeq(node.id));
      body.append(h('div', { class: 'convert-row' }, ctl.convert));
    }
    if (node.type === 'sample' && ctl.soundField && ctl.inputs.bank) ctl.soundField.prepend(ctl.inputs.bank.closest('.field'));   // the bank decides which sounds exist, so it comes first, above the sound
    // order for a sound maker: the sound first, then the envelope, then (for a synth wave only) the wave buttons, then the knobs
    if (ctl.wavesEl) { if (ctl.envEl) ctl.envEl.after(ctl.wavesEl); else body.prepend(ctl.wavesEl); }
    if (ctl.soundField) body.prepend(ctl.soundField);
    const foldSpecs = def.params.filter((sp) => sp.fold && (ctl.inputs[sp.key] || ctl.knobs[sp.key]));
    if (foldSpecs.length && !isCol(node)) {
      const foldBody = h('div', { class: 'fold-body' });
      foldSpecs.filter((sp) => ctl.inputs[sp.key]).forEach((sp) => foldBody.append(ctl.inputs[sp.key].closest('.field')));
      const foldKnobs = foldSpecs.filter((sp) => ctl.knobs[sp.key]);
      if (foldKnobs.length) foldBody.append(h('div', { class: 'controls' }, foldKnobs.map((sp) => ctl.knobs[sp.key].cell)));
      if (ctl.arrange) foldBody.append(ctl.arrange.field); // the total sits under "sections" inside the drop-down
      const sum = h('span', { class: 'fold-sum' });
      const head = h('button', { class: 'fold-head', title: 'Show or hide these settings' }, sum, h('span', { class: 'fold-chev' }, '▾'));
      const fold = h('div', { class: 'fold' + (foldOpen.has(node.id) ? ' open' : '') }, head, foldBody);
      head.addEventListener('pointerdown', (e) => e.stopPropagation());
      head.addEventListener('click', () => { if (foldOpen.has(node.id)) foldOpen.delete(node.id); else foldOpen.add(node.id); fold.classList.toggle('open', foldOpen.has(node.id)); setTimeout(drawCables, 0); });
      ctl.foldSum = sum;
      body.append(fold);
    }
    if (!isCol(node)) {
      // the description folds away like the settings do; Settings → Module descriptions can keep them all open
      const head = h('button', { class: 'fold-head', title: 'What this module does' }, h('span', { class: 'fold-sum' }, 'about this module'), h('span', { class: 'fold-chev' }, '▾'));
      const about = h('div', { class: 'fold about' + (aboutOpen.has(node.id) ? ' open' : '') }, head, h('div', { class: 'fold-body' }, h('div', { class: 'blurb' }, def.blurb), def.more ? h('button', { class: 'btn sm blurb-readmore', type: 'button', onclick: (e) => { e.stopPropagation(); hooks.showHelp(node.type); } }, `Read more about ${def.title} ▸`) : null));
      head.addEventListener('pointerdown', (e) => e.stopPropagation());
      head.addEventListener('click', () => { if (aboutOpen.has(node.id)) aboutOpen.delete(node.id); else aboutOpen.add(node.id); about.classList.toggle('open', aboutOpen.has(node.id)); setTimeout(drawCables, 0); });
      body.append(about);
    }
    el.addEventListener('pointerdown', (e) => onNodePointerDown(e, node.id, el));
    el.addEventListener('mouseenter', () => hooks.hover?.({ node: node.id }));
    el.addEventListener('mouseleave', () => hooks.hover?.(null));
    return { el, ctl, sig: sigOf(node), steps: ctl.steps };
  }

  function buildSequencer(node, ctl) {
    const pitched = node.type === 'melody';
    const steps = node.params.steps;
    const cellsData = node.params.cells;
    const nOf = (i) => { const x = parseX(cellsData[i]); return x.type === 'sub' ? x.n : 1; };
    const widths = Array.from({ length: steps }, (_, i) => slotWidth(nOf(i)) + 'px');
    const B = beatStarts(steps, beatsNow(), node.params.mode);
    const L = layoutCols(widths, 'var(--lab, 26px)', B), L0 = layoutCols(widths, null, B);
    const wrap = h('div', { class: 'seq', style: `--steps:${steps}` });
    const model = pitched ? pitchModel(effectiveKey(store.graph, node), node.params.octave) : null;
    const rows = pitched ? model.rows : 1;
    wrap.style.setProperty('--lab', pitched && model.degree ? '40px' : '26px');
    const grid = h('div', { class: 'seq-grid', style: `grid-template-columns: ${L.template}` });
    const cells = [], labels = [];
    for (let r = 0; r < rows; r++) {
      const idx = rows - 1 - r; // high notes on top
      const label = pitched ? h('div', { class: 'key-label' + (model.black(idx) ? ' black' : '') }, model.label(idx)) : h('div', { class: 'key-label' }, 'hit');
      labels[idx] = label;
      grid.append(label);
      for (let i = 0; i < steps; i++) {
        const n = nOf(i);
        const slot = h('div', { class: 'slot', style: `grid-column:${L.col(i)}` });
        for (let k = 0; k < n; k++) {
          const sub = n > 1 ? k : -1;
          const c = h('button', { class: 'cell' + (pitched && model.black(idx) ? ' black' : '') + ((B ? B.has(i) : i % 4 === 0) && k === 0 ? ' beat' : ''), dataset: { step: i, row: idx, sub }, title: pitched ? 'click to add a note to this step (several rows = a chord); click again to remove it' : 'click to toggle a hit' });
          c.addEventListener('pointerdown', (e) => e.stopPropagation());
          c.addEventListener('click', () => {
            if (c.dataset.hid) return hooks.setParam(node.id, 'octave', Number(c.dataset.hid));
            hooks.setCell(node.id, i, pitched ? { row: idx, sub } : { toggle: true, sub });
          });
          slot.append(c);
          cells.push(c);
        }
        grid.append(slot);
      }
    }
    const extras = h('div', { class: 'seq-extra' });
    const rowStyle = `grid-template-columns: ${L0.template}`;
    const velRow = pitched ? h('div', { class: 'vel-row', style: rowStyle }) : null;
    const lenRow = h('div', { class: 'len-row', style: rowStyle });
    const xRow = h('div', { class: 'len-row', style: rowStyle });
    const velBars = [], lenBtns = [], xBtns = [];
    for (let i = 0; i < steps; i++) {
      if (pitched) {
        const bar = h('div', { class: 'vel', title: 'velocity: drag up and down' }, h('i'));
        bar.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); e.preventDefault();
          bar.setPointerCapture(e.pointerId);
          const set = (ev) => {
            const r = bar.getBoundingClientRect();
            hooks.setCell(node.id, i, { vel: Math.round(Math.min(1, Math.max(0.1, 1 - (ev.clientY - r.top) / r.height)) * 10) / 10 });
          };
          set(e);
          bar.addEventListener('pointermove', set);
          bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', set), { once: true });
        });
        bar.style.gridColumn = L0.col(i); velBars.push(bar); velRow.append(bar);
      }
      const lb = h('button', { class: 'len', title: 'length in steps (click to cycle)', onclick: () => hooks.setCell(node.id, i, { cycleLen: true }) }, '1');
      lb.addEventListener('pointerdown', (e) => e.stopPropagation());
      lb.style.gridColumn = L0.col(i); lenBtns.push(lb); lenRow.append(lb);
      const xb = h('button', { class: 'len xbtn', title: 'repeat or split this step (click to choose)' });
      xb.addEventListener('click', () => openXPicker(xb, store.graph.nodes.find((x) => x.id === node.id)?.params.cells[i]?.x, (st) => hooks.setCell(node.id, i, { setX: st })));
      xb.addEventListener('pointerdown', (e) => e.stopPropagation());
      xb.style.gridColumn = L0.col(i); xBtns.push(xb); xRow.append(xb);
    }
    if (pitched) extras.append(h('div', { class: 'row-line' }, h('span', { class: 'row-label' }, 'vel'), velRow));
    extras.append(h('div', { class: 'row-line' }, h('span', { class: 'row-label' }, 'len'), lenRow));
    const repLine = h('div', { class: 'row-line rep-line' }, h('span', { class: 'row-label' }, 'rep'), xRow);
    let mm = null, octLabel = null, main = grid;
    if (pitched) {
      const H = rows * 16 - 2;
      const canvas = h('canvas', { class: 'mm', width: 44, height: H, title: 'minimap of every octave: your notes are the dots, the box is what the grid shows. Drag or click to scroll (snaps to octaves). Mouse wheel over the grid works too.', tabindex: 0 });
      canvas.style.height = H + 'px';
      octLabel = h('div', { class: 'oct-label' });
      const nodeNow = () => store.graph.nodes.find((x) => x.id === node.id);
      const setOct = (o) => { const cur = nodeNow()?.params.octave; if (o !== cur) hooks.setParam(node.id, 'octave', o); };
      const octAt = (ev) => {
        const n = nodeNow(), key = effectiveKey(store.graph, n);
        const { lo, hi } = mmRange(key);
        const rect = canvas.getBoundingClientRect();
        const r = lo + (1 - Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height))) * (hi - lo);
        let best = 1, bd = 1e9;
        for (let o = 1; o <= 5; o++) { const [wl, wh] = windowOf(key, o); const d = Math.abs((wl + wh) / 2 - r); if (d < bd) { bd = d; best = o; } }
        return best;
      };
      canvas.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        setOct(octAt(e));
        const move = (ev) => setOct(octAt(ev));
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', () => canvas.removeEventListener('pointermove', move), { once: true });
      });
      canvas.addEventListener('keydown', (e) => {
        const d = { ArrowUp: 1, ArrowDown: -1 }[e.key];
        if (!d) return;
        e.preventDefault(); e.stopPropagation();
        setOct(Math.min(5, Math.max(1, (nodeNow()?.params.octave ?? 3) + d)));
      });
      grid.addEventListener('wheel', (e) => {
        e.preventDefault(); e.stopPropagation();
        const cur = nodeNow()?.params.octave ?? 3;
        setOct(Math.min(5, Math.max(1, cur + (e.deltaY < 0 ? 1 : -1))));
      }, { passive: false });
      mm = { canvas, H };
      main = h('div', { class: 'seq-main' }, grid, h('div', { class: 'oct-col' }, canvas, octLabel));
    }
    const ph = dotsRow(L0, steps);
    wrap.append(h('div', { class: 'row-line ph-line' }, h('span', { class: 'row-label' }), ph.row), repLine, main, extras);
    if (pitched) {
      const tb = h('button', { class: 'cpre-btn', title: 'Pick a ready-made tune: it sets the steps and the notes' }, '♪ templates');
      tb.addEventListener('pointerdown', (e) => e.stopPropagation());
      tb.addEventListener('click', () => openMelodyTemplates(tb, node.id));
      wrap.prepend(tb);
    }
    ctl.seq = { cells, velBars, lenBtns, xBtns, steps, rows, pitched, mm, octLabel, labels, dots: ph.dots };
    return wrap;
  }

  // The envelope picture: the loudness of one note over time, drawn as a shape with a handle on each corner.
  // Drag the top corner sideways for the attack, the second corner sideways for the decay and up/down for the sustain level,
  // the last corner sideways for the release. It only shows the stages the module has (FM has just decay and sustain).
  // The Filter's envelope has no release but an amount: its top corner also moves up and down for how far the filter opens.
  function buildEnvelope(node, ctl, def) {
    const NS = 'http://www.w3.org/2000/svg', W = 240, H = 84, PAD = 12, TOP = 12, BASE = H - 18, SEG = 54, HOLD = 34;
    const el = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); kids.forEach((c) => e.append(c)); return e; };
    const fmOp = node.type === 'fm' ? Math.min(4, Math.max(1, Number(node.params.envop) || 1)) : 0;   // FM: which operator's brightness envelope is drawn
    const fmSfx = fmOp > 1 ? String(fmOp) : '';
    const K = node.type === 'fm' ? { a: 'attack' + fmSfx, d: 'decay' + fmSfx, s: 'sustain' + fmSfx } : def.data.envelope === true ? { a: 'attack', d: 'decay', s: 'sustain', r: 'release' } : def.data.envelope;   // which parameters hold each stage
    const spec = (k) => (k ? def.params.find((p) => p.key === k) : null);
    const A = spec(K.a), D = spec(K.d), S = spec(K.s), R = spec(K.r), AMT = spec(K.amt);
    const peakOf = (p) => (AMT ? Math.max(0.12, Math.min(1, p[K.amt] / AMT.max)) : 1);   // how tall the top corner is (the filter's amount; always full for loudness)
    const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
    const set = (k, v) => { if (paramsOf()[k] !== v) hooks.setParam(node.id, k, v); };
    const wOf = (t, sp) => Math.max(2, SEG * Math.sqrt(Math.max(0, t) / sp.max));            // seconds -> pixels (square-root scale, so short times stay draggable)
    const tOf = (dx, sp) => { const t = sp.max * (Math.max(0, dx) / SEG) ** 2; const q = t < 0.1 ? 0.001 : 0.01; return Math.min(sp.max, Math.max(sp.min ?? 0, Math.round(t / q) * q)); };
    const yOf = (l) => BASE - l * (BASE - TOP);
    const svg = el('svg', { class: 'envdiagram', viewBox: `0 0 ${W} ${H}`, role: 'img' });
    const fill = el('path', { class: 'env-fill' }), line = el('path', { class: 'env-line' }), base = el('line', { class: 'env-base', x1: PAD, x2: W - PAD, y1: BASE, y2: BASE });
    const hold = el('line', { class: 'env-hold' });
    const read = el('text', { class: 'env-read', x: 6, y: H - 3 });
    svg.append(base, fill, hold, line);
    const handles = {};
    const mkHandle = (name, tip) => {   // a big invisible circle around the visible dot makes it easy to hit with a finger
      const g = el('g', { class: 'env-h', tabindex: '0', role: 'slider', 'aria-label': tip }, el('circle', { class: 'env-hit', r: 14 }), el('circle', { class: 'env-handle', r: 5 }, el('title', {}, tip)));
      handles[name] = g; svg.append(g); return g;
    };
    // keyboard: arrow keys move a handle (shift = bigger steps)
    const nudge = (key, sp, dir, shift) => { const cur = paramsOf()[key], w = wOf(cur, sp) + dir * (shift ? 6 : 1.5); return tOf(w, sp); };
    const onKeys = (g, fn) => g.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (!d) return;
      e.preventDefault(); fn(d, e.shiftKey);
    });
    const drag = (target, onMove) => target.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const box = svg.getBoundingClientRect(), sx = W / box.width, y0 = e.clientY, start = { ...paramsOf() };
      target.setPointerCapture(e.pointerId);
      const move = (ev) => onMove({ x: (ev.clientX - box.left) * sx, y: (ev.clientY - box.top) * sx, dy: (y0 - ev.clientY) * sx, start });
      const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); };
      target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
    });
    // where each stage starts, in pixels, given the current values
    const layout = (p) => {
      const x0 = PAD, xa = x0 + (A ? wOf(p[K.a], A) : 0);
      const xd = xa + (D ? wOf(p[K.d], D) : 0);
      const pk = peakOf(p), lvl = S ? p[K.s] * pk : (D ? 0 : pk);
      const xh = xd + (S || !D ? HOLD : 0), xr = xh + (R ? wOf(p[K.r], R) : 0);
      return { x0, xa, xd, xh, xr, lvl, pk };
    };
    if (A) drag(mkHandle('a', AMT ? 'Attack and amount: sideways for how fast the filter opens, up or down for how far it opens' : 'Attack: drag sideways for how fast the sound fades in'), ({ x, y }) => {
      set(K.a, tOf(x - PAD, A));
      if (AMT) set(K.amt, Math.min(AMT.max, Math.max(AMT.min ?? 0, Math.round(((BASE - y) / (BASE - TOP)) * AMT.max * 10) / 10)));
    });
    if (D) drag(mkHandle('d', S ? 'Decay and sustain: sideways for how fast it falls, up or down for the level it holds' : 'Decay: drag sideways for how long the sound takes to die away'), ({ x, y, start }) => {
      const xa = PAD + (A ? wOf(start[K.a], A) : 0);
      set(K.d, tOf(x - xa, D));
      if (S) set(K.s, Math.min(1, Math.max(0, Math.round((((BASE - y) / (BASE - TOP)) / peakOf(start)) * 100) / 100)));
    });
    if (R) drag(mkHandle('r', 'Release: drag sideways for how long the sound rings after the note ends'), ({ x, start }) => {
      const l = layout(start);
      set(K.r, tOf(x - l.xh, R));
    });
    if (handles.a) onKeys(handles.a, ([dx, dy], sh) => { if (dx) set(K.a, nudge(K.a, A, dx, sh)); if (dy && AMT) set(K.amt, Math.min(AMT.max, Math.max(AMT.min ?? 0, Math.round((paramsOf()[K.amt] + dy * (sh ? 1 : 0.2)) * 10) / 10))); });
    if (handles.d) onKeys(handles.d, ([dx, dy], sh) => { if (dx) set(K.d, nudge(K.d, D, dx, sh)); if (dy && S) set(K.s, Math.min(1, Math.max(0, Math.round((paramsOf()[K.s] + dy * (sh ? 0.1 : 0.02)) * 100) / 100))); });
    if (handles.r) onKeys(handles.r, ([dx], sh) => dx && set(K.r, nudge(K.r, R, dx, sh)));
    ctl.envelope = {
      draw(p) {
        const l = layout(p);
        const pts = [[l.x0, A ? BASE : yOf(l.pk)]];
        if (A) pts.push([l.xa, yOf(l.pk)]);
        if (D) pts.push([l.xd, yOf(l.lvl)]);
        pts.push([l.xh, yOf(l.lvl)]);
        if (R) pts.push([l.xr, BASE]);
        const d = 'M' + pts.map((q) => q.join(' ')).join('L');
        line.setAttribute('d', d);
        fill.setAttribute('d', d + `L${pts[pts.length - 1][0]} ${BASE}L${l.x0} ${BASE}Z`);
        hold.setAttribute('x1', l.xd); hold.setAttribute('x2', l.xh); hold.setAttribute('y1', yOf(l.lvl)); hold.setAttribute('y2', yOf(l.lvl));
        const at = (n, x, y) => { if (handles[n]) handles[n].querySelectorAll('circle').forEach((c) => { c.setAttribute('cx', x); c.setAttribute('cy', y); }); };
        at('a', l.xa, yOf(l.pk)); at('d', l.xd, yOf(l.lvl)); at('r', l.xr, BASE);
        if (handles.a) handles.a.setAttribute('aria-valuetext', `attack ${p[K.a]} seconds${AMT ? ', opens by ' + p[K.amt] : ''}`);
        if (handles.d) handles.d.setAttribute('aria-valuetext', `decay ${p[K.d]} seconds${S ? ', sustain ' + Math.round(p[K.s] * 100) + ' percent' : ''}`);
        if (handles.r) handles.r.setAttribute('aria-valuetext', `release ${p[K.r]} seconds`);
        const f = (v) => (v < 0.1 ? Math.round(v * 1000) + 'ms' : (+v.toFixed(2)) + 's');
        read.textContent = AMT && !(p[K.amt] > 0) ? 'envelope off: drag the top corner up to open the filter' : [AMT && 'opens ' + p[K.amt], A && 'attack ' + f(p[K.a]), D && 'decay ' + f(p[K.d]), S && 'sustain ' + Math.round(p[K.s] * 100) + '%', R && 'release ' + f(p[K.r])].filter(Boolean).join('  ');
      },
    };
    svg.append(read);
    ['a', 'd', 'r'].forEach((n) => handles[n] && svg.append(handles[n]));   // handles on top
    ctl.envelope.draw(node.params);
    if (node.type === 'fm') {   // one envelope per operator: pick which one to draw
      const idxKey = (i) => (i === 1 ? 'index' : 'index' + i);
      const steady = (p) => fmOp > 1 && p[K.a] === A.def && p[K.d] === D.def && p[K.s] === S.def;
      const baseDraw = ctl.envelope.draw;
      ctl.envelope.draw = (p) => { baseDraw(p); if (steady(p)) read.textContent = `operator ${fmOp} is steady: drag the corner to shape its brightness`; };
      ctl.envelope.draw(node.params);
      const chips = h('div', { class: 'fm-envops', role: 'group', 'aria-label': 'Which operator\'s brightness envelope to edit' }, h('span', { class: 'fm-envl' }, 'envelope of'),
        [1, 2, 3, 4].map((i) => h('button', { type: 'button', class: 'fm-envop' + (i === fmOp ? ' on' : '') + (node.params[idxKey(i)] > 0 ? '' : ' off'), title: `Operator ${i}${node.params[idxKey(i)] > 0 ? '' : ' (off: its index is 0)'}`, onclick: () => hooks.setParam(node.id, 'envop', i) }, String(i))));
      const waveGlyph = (name) => {
        const NSs = 'http://www.w3.org/2000/svg', sv = document.createElementNS(NSs, 'svg'), pa = document.createElementNS(NSs, 'path');
        sv.setAttribute('viewBox', '0 0 24 14'); sv.setAttribute('width', 24); sv.setAttribute('height', 14);
        let d = ''; for (let k = 0; k <= 48; k++) d += (k ? 'L' : 'M') + (1 + (22 * k) / 48).toFixed(1) + ' ' + (7 - fmWaveFn(name, k / 48) * 5).toFixed(1);
        pa.setAttribute('d', d); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', 'currentColor'); pa.setAttribute('stroke-width', '1.6'); pa.setAttribute('stroke-linejoin', 'round');
        sv.append(pa); return sv;
      };
      const waveKey = OWAVE[fmOp - 1];
      const wbtns = FM_WAVE_NAMES.map((w) => h('button', { type: 'button', class: 'fm-wv' + ((node.params[waveKey] || 'sine') === w ? ' on' : ''), title: `Operator ${fmOp} plays a ${w} wave` + (w === 'sine' ? ' (the cleanest)' : ' (adds overtones of its own)'), 'aria-label': `${w} wave`, onclick: () => hooks.setParam(node.id, waveKey, w) }, waveGlyph(w)));
      const wrow = h('div', { class: 'fm-waverow', role: 'group', 'aria-label': `The wave operator ${fmOp} plays` }, h('span', { class: 'fm-envl' }, `wave of ${fmOp}`), wbtns);
      const drawWithWave = ctl.envelope.draw;
      ctl.envelope.draw = (p) => { drawWithWave(p); FM_WAVE_NAMES.forEach((w, i) => wbtns[i].classList.toggle('on', (p[waveKey] || 'sine') === w)); };
      ctl.envelope.draw(node.params);
      return h('div', { class: 'fmwrap' }, chips, wrow, svg);
    }
    return h('div', { class: 'fmwrap' }, svg);
  }
  // The song strip: one block per section, as wide as its cycle count, in the same colour as its input.
  // The strip always fills the module, so a section can be any length: dragging a block's right edge makes the
  // edge follow the pointer (the other blocks shrink to make room); double-click a block to type an exact number.
  const ARR_MAX = 9999;
  function buildArrange(node, ctl) {
    const strip = h('div', { class: 'arr-strip', title: 'the sections of the song, as wide as their cycles; drag a right edge to change a length, double-click to type one' });
    const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
    const setLen = (i, v) => { const cur = paramsOf().lens; const next = Math.min(ARR_MAX, Math.max(1, Math.round(v))); if (next !== cur[i]) { const l = [...cur]; l[i] = next; hooks.setParam(node.id, 'lens', l); } };
    const blocks = Array.from({ length: node.params.n }, (_, i) => {
      const lab = h('span', { class: 'arr-lab' });
      const grip = h('span', { class: 'arr-grip', title: 'drag to change how many cycles this section lasts (or focus it and use the arrow keys)', tabindex: '0', role: 'slider', 'aria-label': 'cycles in section ' + (i + 1) });
      grip.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'ArrowRight' || k.key === 'ArrowUp') { k.preventDefault(); setLen(i, (paramsOf().lens[i] ?? 4) + (k.shiftKey ? 10 : 1)); } else if (k.key === 'ArrowLeft' || k.key === 'ArrowDown') { k.preventDefault(); setLen(i, (paramsOf().lens[i] ?? 4) - (k.shiftKey ? 10 : 1)); } else if (k.key === 'Enter') { k.preventDefault(); blk.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); } });
      const blk = h('div', { class: 'arr-block' }, lab, grip);
      const col = h('div', { class: 'arr-col', style: `--hue: ${(i * 57 + 200) % 360}`, title: 'section ' + (i + 1) }, blk);
      grip.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        const p0 = paramsOf(), n = p0.n, lens0 = [...p0.lens];
        const before = lens0.slice(0, i).reduce((a, x) => a + x, 0);
        const others = lens0.slice(0, n).reduce((a, x) => a + x, 0) - lens0[i];
        const box = strip.getBoundingClientRect();
        grip.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const f = Math.min(0.9995, Math.max(0, (ev.clientX - box.left) / box.width)); // where the pointer is along the strip
          // the block's right edge sits at (before + L) / (others + L) of the width; solve for the L that puts it under the pointer
          setLen(i, (f * others - before) / (1 - f));
        };
        const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      });
      blk.addEventListener('pointerdown', (e) => e.stopPropagation());
      blk.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const inp = h('input', { class: 'arr-num', type: 'number', min: 1, max: ARR_MAX, value: paramsOf().lens[i] ?? 4 });
        inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') inp.blur(); if (k.key === 'Escape') { inp.value = paramsOf().lens[i]; inp.blur(); } });
        inp.addEventListener('blur', () => { if (inp.value !== '') setLen(i, Number(inp.value)); inp.remove(); lab.style.display = ''; });
        lab.style.display = 'none'; blk.prepend(inp); inp.focus(); inp.select();
      });
      strip.append(col);
      return { col, lab, grip };
    });
    // the total: typing a new one stretches or shrinks every section in proportion (each stays at least 1 cycle)
    const setTotal = (T) => {
      const p = paramsOf(), n = p.n, cur = p.lens.slice(0, n), sum = cur.reduce((a, x) => a + x, 0);
      T = Math.min(ARR_MAX, Math.max(n, Math.round(T)));
      if (T === sum) return;
      const next = cur.map((x) => Math.max(1, Math.floor((x * T) / sum)));
      let diff = T - next.reduce((a, x) => a + x, 0);
      const order = cur.map((_, i) => i).sort((a, c) => cur[c] - cur[a]);
      for (let k = 0; diff !== 0 && k < 100000; k++) { const i = order[k % n]; if (diff > 0) { next[i]++; diff--; } else if (next[i] > 1) { next[i]--; diff++; } }
      hooks.setParam(node.id, 'lens', [...next, ...p.lens.slice(n)]);
    };
    const totalInp = h('input', { class: 'txt num', type: 'number', min: 1, max: ARR_MAX });
    totalInp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') totalInp.blur(); });
    totalInp.addEventListener('change', () => { if (totalInp.value !== '') setTotal(Number(totalInp.value)); });
    const field = h('label', { class: 'field', title: 'how long the whole song is before it starts over; typing a new total stretches every section in proportion' }, h('span', {}, 'cycles'), totalInp);
    const orderNote = h('div', { class: 'arr-order', hidden: true });
    // With a Number Pattern on "order" the order decides everything: this strip shows each step of it (a section for some cycles), and dragging an edge rewrites the pattern
    const orderStrip = h('div', { class: 'arr-strip arr-ordered', hidden: true, title: 'the order from the Number Pattern, as wide as its cycles; drag a right edge to change a length (it rewrites the pattern), double-click to type one' });
    const paintOrder = (os, plan) => {
      const items = plan.items, total = items.reduce((a, x) => a + x.len, 0);
      const setTokLen = (tok, v) => { const cur = nodeById(store.graph, os.id)?.params.text; const t = withOrderLen(cur, tok, Math.min(ARR_MAX, Math.max(1, v))); if (t !== cur) hooks.setParam(os.id, 'text', t); };
      orderStrip.replaceChildren(...items.map((it, i) => {
        const lab = h('span', { class: 'arr-lab' }, String(it.len));
        const grip = h('span', { class: 'arr-grip', tabindex: '0', role: 'slider', 'aria-label': `cycles in step ${i + 1} (section ${String.fromCharCode(64 + it.sec)})`, 'aria-valuenow': it.len, title: 'drag to change how many cycles this step lasts (or focus it and use the arrow keys)' });
        grip.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'ArrowRight' || k.key === 'ArrowUp') { k.preventDefault(); setTokLen(it.tok, it.len + (k.shiftKey ? 10 : 1)); } else if (k.key === 'ArrowLeft' || k.key === 'ArrowDown') { k.preventDefault(); setTokLen(it.tok, it.len - (k.shiftKey ? 10 : 1)); } });
        const blk = h('div', { class: 'arr-block' }, h('span', { class: 'arr-sec' }, String.fromCharCode(64 + it.sec)), lab, grip);
        const col = h('div', { class: 'arr-col', style: `--hue: ${((it.sec - 1) * 57 + 200) % 360}`, title: `section ${String.fromCharCode(64 + it.sec)}, ${it.len} cycles` }, blk);
        grip.addEventListener('pointerdown', (e) => {
          e.stopPropagation(); e.preventDefault();
          const before = items.slice(0, i).reduce((a, x) => a + x.len, 0), others = total - it.len, box = orderStrip.getBoundingClientRect();
          grip.setPointerCapture(e.pointerId);
          const move = (ev) => { const f = Math.min(0.9995, Math.max(0, (ev.clientX - box.left) / box.width)); setTokLen(it.tok, Math.round((f * others - before) / (1 - f))); };
          const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
          grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
        });
        blk.addEventListener('pointerdown', (e) => e.stopPropagation());
        blk.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          const inp = h('input', { class: 'arr-num', type: 'number', min: 1, max: ARR_MAX, value: it.len });
          inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') inp.blur(); if (k.key === 'Escape') { inp.value = it.len; inp.blur(); } });
          inp.addEventListener('blur', () => { if (inp.value !== '') setTokLen(it.tok, Number(inp.value)); inp.remove(); lab.style.display = ''; });
          lab.style.display = 'none'; blk.prepend(inp); inp.focus(); inp.select();
        });
        col.style.flexGrow = it.len;
        return col;
      }));
    };
    ctl.arrange = {
      field,
      draw(params) {
        {   // an Arrange with a Number Pattern on "order" plays that order: show it in words
          const g = store.graph, ow = wiresInto(g, node.id, 'order')[0], os = ow && nodeById(g, ow.from.node);
          const ordered = !!(os && os.type === 'numpat');
          strip.hidden = ordered; orderStrip.hidden = !ordered;
          totalInp.disabled = ordered; totalInp.title = ordered ? 'set by the order from the Number Pattern' : '';
          field.parentElement?.querySelectorAll('select').forEach((s) => { s.disabled = ordered; s.title = ordered ? 'the order from the Number Pattern decides which sections are used' : ''; });
          if (ordered) {
            const plan = parseArrangeOrder(os.params.text, params.n, params.lens);
            paintOrder(os, plan);
            if (document.activeElement !== totalInp) totalInp.value = plan.items.reduce((a, x) => a + x.len, 0);
            const L = (s) => String.fromCharCode(64 + s);
            orderNote.hidden = false;
            orderNote.textContent = (plan.items.length ? 'Order: ' + plan.items.map((x) => `${L(x.sec)} ${x.len}`).join(' → ') + ` (${plan.items.reduce((a, x) => a + x.len, 0)} cycles)` : 'Order: nothing readable yet') + (plan.problems.length ? ' · ' + plan.problems[0] : '');
            orderNote.classList.toggle('bad', plan.problems.length > 0);
            return;
          } else orderNote.hidden = true;
        }
        let sum = 0;
        blocks.forEach(({ col, lab }, i) => {
          const len = params.lens?.[i] ?? 4;
          sum += len;
          col.style.flexGrow = len;
          lab.textContent = len;
          blocks[i]?.grip?.setAttribute('aria-valuenow', len);
        });
        if (document.activeElement !== totalInp) totalInp.value = sum;
      },
    };
    ctl.arrange.draw(node.params);
    return h('div', { class: 'arrange' }, strip, orderStrip, orderNote);
  }

  function buildChords(node, ctl) {
    const steps = node.params.steps;
    const L0 = layoutCols(Array(steps).fill('minmax(44px, 1fr)'), null, beatStarts(steps, beatsNow(), node.params.mode));
    const tmpl = `grid-template-columns: ${L0.template}`;
    const row = h('div', { class: 'chord-row', style: tmpl }), lenRow = h('div', { class: 'chord-row', style: tmpl });
    const btns = [], lenBtns = [];
    for (let i = 0; i < steps; i++) {
      const b = h('button', { class: 'cstep', title: 'click to choose this chord', dataset: { step: i } });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', () => openChordPicker(b, node.id, i));
      b.style.gridColumn = L0.col(i); btns.push(b); row.append(b);
      const lb = h('button', { class: 'len', title: 'length in chords (click to cycle)', onclick: () => hooks.setCell(node.id, i, { cycleLen: true }) }, '1');
      lb.addEventListener('pointerdown', (e) => e.stopPropagation());
      lb.style.gridColumn = L0.col(i); lenBtns.push(lb); lenRow.append(lb);
    }
    const ph = dotsRow(L0, steps);
    ctl.chords = { btns, lenBtns, steps, dots: ph.dots };
    const pre = h('button', { class: 'cpre-btn', title: 'Pick a ready-made chord progression' }, '♪ progressions');
    pre.addEventListener('pointerdown', (e) => e.stopPropagation());
    pre.addEventListener('click', () => openPresets(pre, node.id));
    return h('div', { class: 'chords' }, pre, ph.row, row, lenRow);
  }

  function buildDrums(node, ctl) {
    const steps = node.params.steps;
    const tracks = node.params.tracks;
    const subN = (c) => { const x = parseX(c); return x.type === 'sub' ? x.n : 1; };
    const slotN = Array.from({ length: steps }, (_, i) => Math.max(...tracks.map((t) => subN(t.cells[i] || {}))));
    const BD = beatStarts(steps, beatsNow(), 'steps');
    const L0 = layoutCols(slotN.map((n) => slotWidth(n) + 'px'), null, BD);
    const template = L0.template;
    const wrap = h('div', { class: 'drums', style: `--steps:${steps}` });
    const rows = [];
    const sel = { i: Math.min(selTrack.get(node.id) ?? 0, tracks.length - 1) };
    const select = (ti) => { sel.i = ti; selTrack.set(node.id, ti); const gg = store.graph.nodes.find((x) => x.id === node.id); if (gg) syncNode(views.get(node.id), gg); };
    tracks.forEach((t, ti) => {
      const bankOf = () => store.graph.nodes.find((x) => x.id === node.id)?.params.bank || '';
      const ta = makeTypeahead({ options: () => soundsFor(bankOf()), valid: (v) => isValidSound(bankOf(), v), commit: (v) => hooks.setTrack(node.id, ti, { name: v }), onHover: (o) => soundHooks.preview?.({ id: o.split(':')[0], kind: 'sample', bank: bankOf(), pitched: false }) });
      const name = ta.el;
      const mute = h('button', { class: 'trk-btn', title: 'mute this row', onclick: () => hooks.setTrack(node.id, ti, { mute: true }) }, 'm');
      const del = h('button', { class: 'trk-btn', title: 'remove this row', onclick: () => hooks.setTrack(node.id, ti, { remove: true }) }, '×');
      const slots = [];
      const grid = h('div', { class: 'trk-cells', style: `grid-template-columns: ${template}` });
      for (let i = 0; i < steps; i++) {
        const n = subN(t.cells[i] || {});
        const slot = h('div', { class: 'slot', style: `grid-column:${L0.col(i)}` });
        const btns = [];
        for (let k = 0; k < n; k++) {
          const c = h('button', { class: 'cell' + ((BD ? BD.has(i) : i % 4 === 0) && k === 0 ? ' beat' : ''), dataset: { step: i, track: ti, sub: n > 1 ? k : -1 }, title: 'click to toggle a hit. Shift-click: repeat ×2 ×3 ×4, or split into [2] [3] [4] sub-steps' });
          c.addEventListener('pointerdown', (e) => e.stopPropagation());
          c.addEventListener('click', (e) => { select(ti); if (e.shiftKey) return openXPicker(c, store.graph.nodes.find((x) => x.id === node.id)?.params.tracks[ti]?.cells[i]?.x, (st) => hooks.setTrack(node.id, ti, { step: i, setX: st })); hooks.setTrack(node.id, ti, { step: i, sub: n > 1 ? k : -1 }); });
          btns.push(c); slot.append(c);
        }
        slots.push(btns); grid.append(slot);
      }
      const trkEl = h('div', { class: 'trk' }, name, grid, mute, del);
      trkEl.addEventListener('pointerdown', () => select(ti), true);
      wrap.append(trkEl);
      rows.push({ name, ta, mute, slots, el: trkEl });
    });
    const xRow = h('div', { class: 'trk-div', style: `grid-template-columns: ${template}` });
    const xBtns = [];
    for (let i = 0; i < steps; i++) {
      const xb = h('button', { class: 'len xbtn', title: 'repeat or split this step for the selected row (click to choose)' });
      xb.style.gridColumn = L0.col(i);
      xb.addEventListener('pointerdown', (e) => e.stopPropagation());
      xb.addEventListener('click', () => openXPicker(xb, store.graph.nodes.find((x) => x.id === node.id)?.params.tracks[sel.i]?.cells[i]?.x, (st) => hooks.setTrack(node.id, sel.i, { step: i, setX: st })));
      xBtns.push(xb); xRow.append(xb);
    }
    wrap.prepend(xRow);
    const ph = dotsRow(L0, steps);
    ph.row.classList.add('trk-div');
    wrap.prepend(ph.row);
    { const tb = h('button', { class: 'cpre-btn', title: 'Pick a ready-made drum pattern: it sets the bank, the rows and the steps' }, '♪ templates'); tb.addEventListener('pointerdown', (e) => e.stopPropagation()); tb.addEventListener('click', () => openDrumTemplates(tb, node.id)); wrap.prepend(tb); }
    wrap.append(h('div', { class: 'trk-foot' }, h('button', { class: 'btn sm trk-add', disabled: node.params.tracks.length >= 8, onclick: () => hooks.setTrack(node.id, 0, { add: true }) }, '+ row'), h('span', { class: 'hintline' }, 'top bar: repeat / split the selected row')));
    ctl.drums = { rows, steps, xBtns, sel, dots: ph.dots };
    return wrap;
  }

  const sigOf = (n) => {
    const k = effectiveKey(store.graph, n);
    const xs = n.params.cells ? n.params.cells.map((c) => c.x || '').join(',') : n.params.tracks ? n.params.tracks.map((t) => t.cells.map((c) => c.x || '').join(',')).join(';') : '';
    return [n.type, n.params.steps, n.params.n, n.params.tracks?.length, k ? (SCALES[k.scale] || []).length : 0, xs, isCol(n) ? 1 : 0, n.params.cells || n.params.tracks ? beatsNow() : '', n.params.envop || ''].join('|');   // a sequencer is redrawn when the beats per cycle change
  };

  function syncNode(v, node) {
    v.ctl.node = node;
    const def = MODULES[node.type];
    v.el.style.transform = `translate(${node.x}px,${node.y}px)`;
    v.el.classList.toggle('collapsed', isCol(node));
    v.el.classList.toggle('muted', !!node.muted);
    v.el.style.width = node.w ? node.w + 'px' : '';
    const mb = v.el.querySelector('.n-mute');
    if (mb) mb.classList.toggle('on', !!node.muted);
    const g = store.graph;
    for (const [key, k] of Object.entries(v.ctl.knobs)) {
      const spec = k.spec;
      const range = knobRange(node, spec);
      k.knob.setRange(range);
      const wired = !!(spec.wire && wiresInto(g, node.id, 'p:' + key).length > 0);
      const value = node.params[key];
      const driven = wired ? drivenValue(g, node, spec, key) : null;
      k.knob.set(driven ?? value);   // a wired dial follows its Slider or Macro
      k.knob.setDisabled(wired);
      k.cell.classList.toggle('wired', wired);
      k.cell.classList.toggle('is-default', !wired && !spec.always && value === spec.def);
      k.val.textContent = wired ? (driven != null ? '↯ ' + fmtKnob(spec, driven) : '↯ wired') : fmtKnob(spec, value);
      k.lab.textContent = paramLabel(def, spec, node);
      k.cell.title = (spec.tip ? spec.tip + ' — ' : '') + (spec.unit ? 'unit: ' + spec.unit : '');
      const jack = k.cell.querySelector('.jack');
      if (jack) jack.classList.toggle('plugged', wired);
      if (spec.onlyWave) k.cell.classList.toggle('inactive', node.params.wave !== spec.onlyWave);
      if (spec.onlyIf) k.cell.classList.toggle('inactive', spec.onlyIf.is !== undefined ? node.params[spec.onlyIf.key] !== spec.onlyIf.is : node.params[spec.onlyIf.key] === spec.onlyIf.not);
    }
    if (v.ctl.iconRows) for (const [k, row] of Object.entries(v.ctl.iconRows)) row.querySelectorAll('.wave-btn').forEach((b) => b.classList.toggle('on', b.dataset.opt === String(node.params[k])));
    if (v.ctl.preview) drawPreview(MODULES[node.type].preview, v.ctl.preview, node.params, { accent: accent(), phase: v.phase ?? null, driven: wiresInto(g, node.id, 'p:cutoff').length > 0 });
    if (v.ctl.foldSum) v.ctl.foldSum.textContent = foldSummary(node, g);
    if (v.ctl.inst) {
      const id = node.params[v.ctl.inst.key], it = instrumentOf(id);
      const wave = WAVE_ICONS.find(([wid]) => wid === id), pic = h('span', { class: 'ib-pic' });
      pic.innerHTML = wave ? `<svg viewBox="0 0 24 14" width="30" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${wave[1]}"/></svg>` : it ? soundIconSvg(it.cat, 30) : '<b>?</b>';
      const [title, ...rest] = String(it ? it.label : id).split(':');
      v.ctl.inst.btn.replaceChildren(pic, h('span', { class: 'ib-text' }, h('span', { class: 'ib-name' }, title.trim()), h('span', { class: 'ib-sub' }, it ? `${id} · ${it.kind === 'soundfont' ? 'General MIDI' : it.kind === 'sample' ? 'recorded' : 'synth'}${rest.length ? ' · ' + rest.join(':').trim() : ''}` : 'not a known instrument')), h('i', { class: 'ti ti-chevron-down' }));
      v.ctl.inst.btn.classList.toggle('bad', !it);
      if (v.ctl.inst.waves) { v.ctl.inst.waves.classList.toggle('dim', !wave); v.ctl.inst.waves.title = wave ? '' : 'The sound is not a synth wave: click one to switch to it'; v.ctl.inst.waves.querySelectorAll('.wave-btn').forEach((b) => b.classList.toggle('on', b.dataset.wave === id)); }
      v.ctl.inst.btn.title = it ? it.cat + ' · ' + (it.kind === 'soundfont' ? 'General MIDI instrument' : it.kind === 'sample' ? 'recorded sample' : 'synth wave') : id + ' is not a known instrument';
    }
    if (v.ctl.convert) {   // a grid can always become text; text only while it is a plain list that fits a grid
      const r = CONVERTERS[node.type].run(g, node);
      v.ctl.convert.disabled = !!r.error && (node.type === 'notetext' || node.type === 'hitpattern');
      v.ctl.convert.title = v.ctl.convert.disabled ? r.error : CONVERTERS[node.type].title;
    }
    if (v.ctl.toDrums) v.ctl.toDrums.hidden = !(soundNames(node.params.name).length >= 2 && !wiresInto(g, node.id, 'in').length);   // several different sounds typed in, and no rhythm cable: offer the Drum Machine
    if (v.ctl.sampleCard) {
      const names = soundNames(node.params.name), first = names[0] || '', bank = node.params.bank || '';
      const all = soundsFor(bank), unknown = names.filter((x) => !all.includes(x));
      const known = !!first && all.includes(first);
      const pic = h('span', { class: 'ib-pic' });
      let title, sub;
      if (names.length >= 2) {   // several sounds in the pattern: a little mosaic of them, the count, and every name
        pic.classList.add('multi');
        const shown = names.length > 4 ? names.slice(0, 3) : names.slice(0, 4);
        pic.innerHTML = shown.map((x) => `<span class="mo">${all.includes(x) ? soundIconSvg(soundGlyph(x, sampleCategoryOf(x)), 17) : '<b>?</b>'}</span>`).join('') + (names.length > 4 ? `<span class="mo more">+${names.length - 3}</span>` : '');
        title = `${names.length} sounds`;
        sub = names.join(' · ') + (bank ? ' · ' + bank : '') + (unknown.length ? ` · ${unknown.length} not in this bank` : '');
        v.ctl.sampleCard.title = 'In this pattern: ' + names.join(', ') + '. Click to add another sound.';
      } else {
        pic.innerHTML = known ? soundIconSvg(soundGlyph(first, sampleCategoryOf(first)), 30) : '<b>?</b>';
        title = first ? (describe(first) || first) : 'Pick a sound';
        sub = first ? `${first}${bank ? ' · ' + bank : ''}${known ? '' : ' · not in this bank'}` : 'click to choose';
        v.ctl.sampleCard.title = 'choose a sound: hover one to hear it, click to add it';
      }
      v.ctl.sampleCard.replaceChildren(pic, h('span', { class: 'ib-text' }, h('span', { class: 'ib-name' }, title), h('span', { class: 'ib-sub' }, sub)), h('i', { class: 'ti ti-chevron-down' }));
      v.ctl.sampleCard.classList.toggle('bad', unknown.length > 0);
    }
    if (node.type === 'sample' && v.ctl.inputs.name) {
      const driven = wiresInto(g, node.id, 'in').length > 0;
      const field = v.ctl.inputs.name.closest('.field');
      field.classList.toggle('driven', driven);
      field.firstChild.textContent = driven ? 'sounds' : 'pattern';
      v.ctl.inputs.name.title = driven ? 'The rhythm cable sets WHEN hits happen. Here, pick WHICH sounds: each hit plays the sound at its place in the cycle (bd sd: first half bd, second half sd).' : 'Sound names plus timing, in mini-notation: bd*2 [bd sd]';
    }
    for (const [key, inp] of Object.entries(v.ctl.inputs)) {
      const val = node.params[key];
      if (document.activeElement !== inp) inp.value = val;
      if (inp.classList.contains('wrapbox')) autosize(inp);
    }
    v.ctl.arrange?.draw(node.params);
    v.ctl.fmdiagram?.draw(node.params);
    v.ctl.pulsepic?.draw(node.params);
    for (const flag of Object.keys(PICS)) v.ctl[flag]?.draw(node.params);
    v.ctl.fxrack?.draw(node.params);
    v.ctl.mixer?.draw(node.params);
    v.ctl.envelope?.draw(node.params);
    const chs = v.ctl.chords;
    if (chs) {
      const key = effectiveKey(g, node), cells = node.params.cells;
      const covered = new Set();
      cells.forEach((c, i) => { if (chordHas(c, !!key)) for (let k = 1; k < (c.len || 1) && i + k < chs.steps; k++) covered.add(i + k); });
      chs.btns.forEach((b, i) => {
        const c = cells[i], text = key ? chordSymbol(key, c.d) : c.sym;
        b.replaceChildren(...[h('b', {}, text || '–'), text ? chordShapeSvg(text) : null, key && c.d ? h('small', {}, romanName(key, c.d)) : null].filter(Boolean));
        b.classList.toggle('rest', !text);
        b.classList.toggle('tied', covered.has(i));
      });
      chs.lenBtns.forEach((b, i) => { const c = cells[i]; b.textContent = c.len || 1; b.classList.toggle('rest', !chordHas(c, !!key)); b.classList.toggle('covered', covered.has(i)); });
    }
    const dr = v.ctl.drums;
    if (dr) {
      node.params.tracks.forEach((t, ti) => {
        const r = dr.rows[ti];
        if (!r) return;
        r.ta.setValue(t.name);
        const okSound = isValidSound(node.params.bank || '', t.name);
        r.name.classList.toggle('bad', !okSound);
        r.name.title = okSound ? (describe(t.name) ? describe(t.name) + '. ' : '') + 'Type to search what is available' + (node.params.bank ? ' in ' + node.params.bank : '') : '"' + t.name + '" is not available' + (node.params.bank ? ' in ' + node.params.bank : '') + ' — pick another';
        r.mute.classList.toggle('active', !!t.mute);
        r.name.classList.toggle('muted', !!t.mute);
        r.el.classList.toggle('selected', ti === dr.sel.i);
        r.slots.forEach((btns, i) => {
          const c = t.cells[i] || {}, x = parseX(c);
          btns.forEach((b, k) => {
            const on = !!leafAt(c, x.type === 'sub' ? k : -1).on;
            b.classList.toggle('on', on);
            setBars(b, on && x.type === 'rep' ? x.n : 0);
          });
        });
      });
    }
    if (dr) {
      const t = node.params.tracks[Math.min(dr.sel.i, node.params.tracks.length - 1)];
      dr.xBtns.forEach((b, i) => { b.replaceChildren(xIcon(t?.cells[i]?.x)); b.classList.toggle('active', !!t?.cells[i]?.x); });
    }
    const s = v.ctl.seq;
    if (s) {
      const cellsData = node.params.cells;
      const key = s.pitched ? effectiveKey(g, node) : null;
      const deg = !!key;
      const model = s.pitched ? pitchModel(key, node.params.octave) : null;
      const covered = new Set();
      cellsData.forEach((c, i) => {
        if (stepHas(c, deg, s.pitched)) for (let k = 1; k < (c.len || 1) && i + k < s.steps; k++) covered.add(i + k);
      });
      const octave = node.params.octave;
      if (s.mm) {
        drawMinimap(s, node, key, deg);
        s.octLabel.textContent = deg ? (octave === 3 ? '±0' : (octave > 3 ? '+' : '') + (octave - 3)) : 'C' + octave;
        s.labels.forEach((l, idx) => { l.textContent = model.label(idx); });
      }
      const keyWired = !!key?.wired;
      for (const kk of ['root', 'scale']) {
        const f = v.ctl.inputs[kk]?.closest('.field');
        if (f) {
          const sel = v.ctl.inputs[kk];
          f.classList.toggle('driven', keyWired);
          sel.disabled = keyWired;
          if (keyWired) sel.value = key[kk]; // show what is actually in effect, not the stale local choice
          sel.title = keyWired ? 'set by the Key module plugged into this sequencer' : '';
        }
      }
      const ownsLeaf = (leaf, row) => (s.pitched ? cellNotes(leaf, deg).includes(model.pitchAt(row)) : !!leaf.on);
      const ownsStep = (c, row) => { const x = parseX(c); return x.type === 'sub' ? Array.from({ length: x.n }, (_, k) => ownsLeaf(leafAt(c, k), row)).some(Boolean) : ownsLeaf(c, row); };
      const lo = s.pitched ? model.rank(model.pitchAt(0)) : 0, hi = s.pitched ? model.rank(model.pitchAt(model.rows - 1)) : 0;
      s.cells.forEach((el) => {
        const i = Number(el.dataset.step), row = Number(el.dataset.row), sub = Number(el.dataset.sub);
        const c = cellsData[i], x = parseX(c);
        const leaf = leafAt(c, sub);
        const active = ownsLeaf(leaf, row) && !covered.has(i);
        el.classList.toggle('on', active);
        let tied = covered.has(i);
        if (s.pitched) {
          let owner = -1;
          for (let k = i - 1; k >= 0 && owner < 0; k--) if (stepHas(cellsData[k], deg, true) && k + (cellsData[k].len || 1) > i) owner = k;
          tied = owner >= 0 && ownsStep(cellsData[owner], row);
        }
        el.classList.toggle('tied', tied);
        const barsN = active && x.type === 'rep' ? x.n : 0;
        let hidden = [];
        if (s.pitched && (row === 0 || row === model.rows - 1)) hidden = cellNotes(leaf, deg).filter((nn) => (row === 0 ? model.rank(nn) < lo : model.rank(nn) > hi));
        el.classList.toggle('hid', hidden.length > 0);
        if (hidden.length) {
          el.textContent = row === 0 ? '▼' : '▲';
          el.dataset.hid = String(model.view(hidden[0]));
          el.title = `also plays ${hidden.join(', ')} (outside this view). Click to scroll the view there.`;
        } else {
          setBars(el, barsN);
          if (el.dataset.hid) { delete el.dataset.hid; el.title = 'click to add a note to this step (several rows = a chord); click again to remove it'; }
        }
      });
      s.velBars.forEach((bar, i) => {
        const c = cellsData[i];
        bar.firstChild.style.height = (c.vel ?? 1) * 100 + '%';
        bar.classList.toggle('rest', !stepHas(c, deg, true) || covered.has(i));
      });
      s.lenBtns.forEach((b, i) => {
        const c = cellsData[i];
        b.textContent = c.len || 1;
        b.classList.toggle('rest', !stepHas(c, deg, s.pitched));
        b.classList.toggle('covered', covered.has(i));
      });
      s.xBtns.forEach((b, i) => {
        const c = cellsData[i];
        b.replaceChildren(xIcon(c.x));
        b.classList.toggle('active', !!parseX(c).type);
        b.classList.toggle('covered', covered.has(i));
      });
    }
  }

  function onNodePointerDown(e, id, el) {
    if (flowMode()) {   // flow view: tapping a header opens or folds the module; modules are not dragged
      if (!e.target.closest('.jack, .knob, input, textarea, select, button, .cell, .vel, .len')) selectNode(id);
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (e.target.closest('.jack, .knob, input, textarea, select, button, .cell, .vel, .len, .n-resize')) {
      if (!selection.has(id)) selectNode(id);
      return;
    }
    if (e.pointerType === 'touch' && !additive && !e.target.closest('.n-head')) {   // on a touch screen the body of a module is most of the screen: a finger there pans the board
      if (!selection.has(id)) selectNode(id);
      startPan(e, true);
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (additive) { if (selection.has(id)) selection.delete(id); else selection.add(id); paintSelection(); return; }
    if (!selection.has(id)) selectNode(id);
    if (!e.target.closest('.n-head')) return;
    const ids = [...selection];
    const starts = Object.fromEntries(ids.map((i) => { const n = nodeById(store.graph, i); return [i, { x: n.x, y: n.y }]; }));
    const start = toWorld(e.clientX, e.clientY);
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    el.classList.add('dragging');
    const move = (ev) => {
      if (pinch) return;   // two fingers are zooming the board, not dragging this module
      const p = toWorld(ev.clientX, ev.clientY);
      let dx = p.x - start.x, dy = p.y - start.y;
      if (!ev.altKey) { dx = Math.round((starts[id].x + dx) / SNAP) * SNAP - starts[id].x; dy = Math.round((starts[id].y + dy) / SNAP) * SNAP - starts[id].y; }
      hooks.moveNodes(Object.fromEntries(ids.map((i) => [i, { x: starts[i].x + dx, y: starts[i].y + dy }])));
      if (loose) api.cableHover(ev.clientX, ev.clientY, { nodeId: id });   // a module with no cables of its own can be dropped onto a cable
    };
    const loose = ids.length === 1 && !store.graph.wires.some((w) => w.from.node === id || w.to.node === id);
    const up = () => {
      el.classList.remove('dragging'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      const target = api.insertHighlight; api.cableHover(null, null, {});
      if (loose && target) hooks.insertOnWire(target, { nodeId: id });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  // frames drawn behind grouped modules; a collapsed group hides its members and shows one block
  function syncGroups() {
    const gs = store.graph.groups || [];
    const live = new Set(gs.map((x) => x.id));
    for (const [id, e] of groupEls) if (!live.has(id)) { e.el.remove(); groupEls.delete(id); }
    views.forEach((v) => v.el.classList.remove('gh'));
    for (const gr of gs) {
      const mem = gr.nodes.filter((id) => views.has(id));
      if (!mem.length) continue;
      let e = groupEls.get(gr.id);
      if (!e) {
        const name = h('input', { class: 'g-name', type: 'text', spellcheck: 'false', title: 'Name this group' });
        name.addEventListener('keydown', (ev) => ev.stopPropagation());
        name.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        name.addEventListener('input', () => hooks.renameGroup(gr.id, name.value));
        const count = h('span', { class: 'g-count' });
        const col = h('button', { class: 'g-btn', title: 'Collapse or expand the group', onclick: (ev) => { ev.stopPropagation(); hooks.toggleGroup(gr.id); } });
        const ung = h('button', { class: 'g-btn', title: 'Ungroup (keeps all modules)', onclick: (ev) => { ev.stopPropagation(); hooks.ungroup(gr.id); } }, '×');
        const mute = h('button', { class: 'g-btn g-mute', type: 'button', onclick: (ev) => { ev.stopPropagation(); hooks.muteGroup(gr.id); } });
        col.addEventListener('pointerdown', (ev) => ev.stopPropagation()); ung.addEventListener('pointerdown', (ev) => ev.stopPropagation()); mute.addEventListener('pointerdown', (ev) => ev.stopPropagation());
        const head = h('div', { class: 'g-head' }, name, count, mute, col, ung);
        const el = h('div', { class: 'gframe' }, head);
        head.addEventListener('pointerdown', (ev) => {
          if (ev.target.closest('input, textarea, button')) return;
          ev.preventDefault(); ev.stopPropagation();
          const cur = (store.graph.groups || []).find((x) => x.id === gr.id);
          if (!cur) return;
          const starts = Object.fromEntries(cur.nodes.map((i) => { const n = nodeById(store.graph, i); return [i, { x: n.x, y: n.y }]; }));
          const p0 = toWorld(ev.clientX, ev.clientY);
          try { head.setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ }
          const move = (m) => {
            const p = toWorld(m.clientX, m.clientY);
            const first = Object.values(starts)[0];
            let dx = p.x - p0.x, dy = p.y - p0.y;
            if (!m.altKey) { dx = Math.round((first.x + dx) / SNAP) * SNAP - first.x; dy = Math.round((first.y + dy) / SNAP) * SNAP - first.y; }
            hooks.moveNodes(Object.fromEntries(Object.entries(starts).map(([i, s0]) => [i, { x: s0.x + dx, y: s0.y + dy }])));
          };
          const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
          head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
        });
        world.prepend(el);
        e = { el, name, count, col, mute };
        groupEls.set(gr.id, e);
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const id of mem) {
        const n = nodeById(store.graph, id), el = views.get(id).el;
        if (el.offsetWidth) sizeCache.set(id, { w: el.offsetWidth, h: el.offsetHeight });
        const sz = sizeCache.get(id) || { w: 220, h: 160 };
        x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + sz.w); y1 = Math.max(y1, n.y + sz.h);
      }
      if (document.activeElement !== e.name) e.name.value = gr.name;
      e.count.textContent = mem.length + ' modules';
      e.col.textContent = gr.collapsed ? '▸' : '▾';
      const gm = groupMuted(gr);
      e.mute.replaceChildren(speakerSvg(gm)); e.mute.classList.toggle('on', gm);
      e.mute.title = gm ? 'This group is muted: click to switch it back on' : 'Mute this group (silence its sounds, bypass its effects)';
      e.el.classList.toggle('muted', gm);
      e.el.classList.toggle('collapsed', !!gr.collapsed);
      if (gr.collapsed) {
        mem.forEach((id) => views.get(id).el.classList.add('gh'));
        e.rect = { x: x0, y: y0, w: 240, h: 74 };
      } else e.rect = { x: x0 - 24, y: y0 - 42, w: x1 - x0 + 48, h: y1 - y0 + 66 };
      Object.assign(e.el.style, { left: e.rect.x + 'px', top: e.rect.y + 'px', width: e.rect.w + 'px', height: e.rect.h + 'px' });
    }
  }

  // flow view: the column order, and under each header the cables as chips (tap to jump there, x to unplug) with buttons to make new ones
  function paintFlow() {
    const on = flowMode(), g = store.graph;
    root.classList.toggle('flow', on);
    if (!on) { world.scrollTop = 0; world.scrollLeft = 0; root.scrollTop = 0; root.scrollLeft = 0; }   // the flow view scrolls the world; leaving it must not leave the board scrolled away
    // groups in the flow view: a card the size of one folded module, followed (when open) by its members
    const groups = on ? (g.groups || []).map((gr) => ({ gr, mem: gr.nodes.filter((id) => views.has(id)) })).filter((x) => x.mem.length) : [];
    const groupOf = new Map(); groups.forEach(({ gr, mem }) => mem.forEach((id) => groupOf.set(id, gr.id)));
    const ord = flowOrder(g), seq = [], emitted = new Set();
    for (const id of ord) {
      const gid = groupOf.get(id);
      if (!gid) { seq.push({ node: id }); continue; }
      if (emitted.has(gid)) continue;
      emitted.add(gid); seq.push({ group: gid });
      ord.filter((x) => groupOf.get(x) === gid).forEach((x) => seq.push({ node: x, gid }));
    }
    for (const [gid, e] of flowGroupEls) if (!groups.some((x) => x.gr.id === gid)) { e.el.remove(); flowGroupEls.delete(gid); }
    seq.forEach((item, i) => {
      if (item.group) {
        const { gr, mem } = groups.find((x) => x.gr.id === item.group);
        const e = flowGroupCard(gr);
        e.el.style.order = i;
        const open = flowGroupOpen.has(gr.id);
        e.el.classList.toggle('open', open);
        e.name.textContent = gr.name || 'Group';
        e.count.textContent = mem.length + (mem.length === 1 ? ' module' : ' modules');
        e.tog.textContent = open ? '▾' : '▸';
        { const gm = groupMuted(gr); e.mute.replaceChildren(speakerSvg(gm)); e.mute.classList.toggle('on', gm); e.mute.title = gm ? 'This group is muted: click to switch it back on' : 'Mute this group'; e.el.classList.toggle('muted', gm); }
        const sorted = ord.filter((x) => groupOf.get(x) === gr.id);
        e.chips.replaceChildren(...sorted.map((id) => { const n = nodeById(g, id); return h('button', { class: 'fg-chip', type: 'button', style: `border-left-color:${CAT_COLOR[MODULES[n.type].cat] || '#6b7886'}`, onclick: () => { flowGroupOpen.add(gr.id); sync(); requestAnimationFrame(() => scrollToNode(id)); } }, titleOf(n)); }));
        return;
      }
      const v = views.get(item.node);
      if (!v) return;
      v.el.style.order = i;
      v.el.classList.toggle('fg-member', !!item.gid);
      v.el.classList.toggle('fg-hidden', !!item.gid && !flowGroupOpen.has(item.gid));
    });
    if (!on) for (const [, v] of views) { v.el.style.order = ''; v.el.classList.remove('fg-member', 'fg-hidden'); }
    for (const [id, v] of views) {
      v.el.querySelector(':scope > .flow-links')?.remove();
      if (!on) continue;
      const n = nodeById(g, id), def = MODULES[n.type], kids = [];
      const chip = (arrow, text, go, del) => h('span', { class: 'fl-chip' }, h('button', { class: 'fl-go', type: 'button', onclick: go }, `${arrow} ${text}`), del ? h('button', { class: 'fl-x', type: 'button', title: 'Unplug this cable', 'aria-label': 'Unplug this cable', onclick: del }, '×') : null);
      for (const w of g.wires.filter((x) => x.to.node === id)) {
        const src = nodeById(g, w.from.node);
        if (src) kids.push(chip('←', titleOf(src) + (w.to.port.startsWith('p:') ? ` (${w.to.port.slice(2)})` : ''), () => scrollToNode(src.id), () => hooks.removeWire(w.id)));
      }
      for (const w of g.wires.filter((x) => x.from.node === id)) {
        const dst = nodeById(g, w.to.node);
        if (dst) kids.push(chip('→', titleOf(dst) + (w.to.port.startsWith('p:') ? ` (${w.to.port.slice(2)})` : ''), () => scrollToNode(dst.id), null));
      }
      for (const p of portsOf(n)) if (p.dir === 'in' && !p.param && !wiresInto(g, id, p.id).length) kids.push(h('button', { class: 'fl-add', type: 'button', onclick: () => openConnectSheet({ toNode: id, toPort: p.id }) }, `＋ ${p.label || 'in'} from…`));
      if (def.out) kids.push(h('button', { class: 'fl-add', type: 'button', onclick: () => openConnectSheet({ fromNode: id }) }, '＋ send to…'));
      if (kids.length) v.el.querySelector('.n-head')?.after(h('div', { class: 'flow-links' }, kids));
    }
  }
  function sync() {
    const g = store.graph;
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const [id, v] of views) if (!ids.has(id)) { v.el.remove(); views.delete(id); }
    for (const n of g.nodes) {
      let v = views.get(n.id);
      if (v && v.sig !== sigOf(n)) { v.el.remove(); v = null; }
      if (!v) {
        v = buildNode(n);
        views.set(n.id, v);
        world.append(v.el);
        if (selection.has(n.id)) v.el.classList.add('selected');
      }
      v.sig = sigOf(n);
      syncNode(v, n);
    }
    hint.style.display = g.nodes.length ? 'none' : '';
    paintFlow();
    wasFlow = flowMode(); paintViewUI();
    // jack plugged state
    root.querySelectorAll('.jack').forEach((j) => j.classList.remove('plugged'));
    for (const w of g.wires) {
      root.querySelector(`.jack[data-node="${w.to.node}"][data-port="${CSS.escape(w.to.port)}"]`)?.classList.add('plugged');
      root.querySelector(`.jack[data-node="${w.from.node}"][data-port="out"]`)?.classList.add('plugged');
    }
    for (const [id, v] of views) {
      const n = nodeById(g, id);
      for (const jack of v.el.querySelectorAll('.jack.in:not(.param), .jack.out')) {
        const port = portsOf(n).find((p) => p.id === jack.dataset.port);
        const t = jack.dataset.dir === 'out' ? outType(g, id) : port?.accept === 'same' ? outType(g, id) : port?.accept?.length === 1 ? port.accept[0] : null;
        if (t) jack.dataset.type = t; else delete jack.dataset.type;
      }
      v.el.querySelectorAll('.jack.param').forEach((j) => (j.dataset.type = 'number'));
    }
    syncGroups();
    drawCables();
    drawMini();
  }

  // ---------- visuals driven by real events ----------
  const pulses = [];
  let raf = null;
  function loop() {
    const now = performance.now();
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const t = (now - p.t0) / p.dur;
      if (t >= 1) { p.el.remove(); pulses.splice(i, 1); continue; }
      if (t < 0) continue;
      try {
        const pt = p.path.getPointAtLength(p.len * t);
        p.el.setAttribute('cx', pt.x); p.el.setAttribute('cy', pt.y); p.el.style.opacity = 1;
      } catch { /* path gone */ }
    }
    raf = pulses.length ? requestAnimationFrame(loop) : null;
  }
  const api = {
    root, world, view, fit, sync, drawCables, applyView,
    toWorld, viewCenter() { const r = root.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); },
    get selected() { return [...selection][0] ?? null; },
    get selection() { return [...selection]; },
    selectAll() { selection.clear(); store.graph.nodes.forEach((n) => selection.add(n.id)); paintSelection(); },
    setSelection(ids) { selection.clear(); ids.forEach((i) => selection.add(i)); paintSelection(); },
    get selectedWire() { return selectedWire; },
    clearWireSel() { selectedWire = null; drawCables(); },
    select: selectNode,
    setHover(hv) {
      hover = hv;
      views.forEach((v, id) => {
        v.el.classList.toggle('hl', !!hv && hv.node === id);
        for (const [key, k] of Object.entries(v.ctl.knobs)) k.cell.classList.toggle('hl', !!hv && hv.node === id && hv.key === key);
      });
    },
    flashNode(id, ms = 180) {
      if (flowMode()) { const gr = groupOfNode(id); const fe = gr && flowGroupEls.get(gr.id); if (fe) { fe.el.classList.add('live'); clearTimeout(fe.liveT); fe.liveT = setTimeout(() => fe.el.classList.remove('live'), Math.max(ms, 260)); } }
      const hg = hiddenGroup(id);
      if (hg) { const ge = groupEls.get(hg.id)?.el; ge?.classList.add('live'); setTimeout(() => ge?.classList.remove('live'), ms); return; }
      const v = views.get(id);
      if (!v) return;
      v.el.classList.add('live');
      clearTimeout(v.liveT);
      v.liveT = setTimeout(() => v.el.classList.remove('live'), ms);
    },
    // light up the part of a Sample's pattern text (characters from..to) that is sounding now
    flashText(id, from, to, ms = 200) { views.get(id)?.ctl.hlText?.flash(from, to, ms); },
    flashStep(id, step, ms = 160, track) {
      const v = views.get(id);
      if (v?.ctl.chords) { const b = v.ctl.chords.btns[step]; b?.classList.add('now'); setTimeout(() => b?.classList.remove('now'), Math.max(ms, 250)); return; }
      if (v?.ctl.drums && track !== undefined) {
        const btns = v.ctl.drums.rows[track]?.slots[step] || [];
        btns.forEach((c) => c.classList.add('now'));
        setTimeout(() => btns.forEach((c) => c.classList.remove('now')), ms);
        return;
      }
      const s = v?.ctl.seq;
      if (!s) return;
      const els = s.cells.filter((c) => Number(c.dataset.step) === step);
      els.forEach((c) => c.classList.add('now'));
      s.lenBtns[step]?.classList.add('now');
      setTimeout(() => { els.forEach((c) => c.classList.remove('now')); s.lenBtns[step]?.classList.remove('now'); }, ms);
    },
    // While a module is dragged over the board: the cable under the pointer that it could be dropped into (highlighted), or null.
    // subject is { type } for a new module from the list, or { nodeId } for a module already on the board. Nothing lights up when it would not fit.
    cableHover(cx, cy, subject) {
      let id = null;
      if (cx != null && !flowMode()) {
        const hit = document.elementsFromPoint(cx, cy).find((el) => el.classList?.contains('cable-hit'));
        const found = hit && [...wireEls].find(([, e]) => e.hit === hit);
        if (found) {
          const g = store.graph, w = g.wires.find((x) => x.id === found[0]);
          const node = subject.nodeId ? nodeById(g, subject.nodeId) : makeNode(subject.type, 0, 0);
          if (w && insertPlan(g, w, node)) id = w.id;
        }
      }
      if (id !== insertHi) { wireEls.get(insertHi)?.grp.classList.remove('insert-target'); if (id) wireEls.get(id)?.grp.classList.add('insert-target'); insertHi = id; }
      return id;
    },
    get insertHighlight() { return insertHi; },
    get tool() { return tool; },
    setTool(t) { tool = t === 'select' ? 'select' : 'hand'; paintTool(); },
    // Space held in the Select tool is the hand (returns true while it is held)
    holdHand(on) { if (spaceHeld === on) return; spaceHeld = on; paintTool(); },
    get handHeld() { return spaceHeld; },
    reveal(id) { if (flowMode()) { flowOpen.add(id); sync(); requestAnimationFrame(() => scrollToNode(id)); } },
    pulse(wireId, delayMs = 0, dur = 220) {
      const e = wireEls.get(wireId);
      if (!e) return;
      const el = svg('circle', { r: 5, class: 'pulse', cx: -99, cy: -99 });
      el.dataset.type = e.grp.dataset.type;
      el.style.opacity = 0;
      pulseLayer.append(el);
      pulses.push({ el, path: e.cab, len: e.cab.getTotalLength(), t0: performance.now() + delayMs, dur });
      if (!raf) raf = requestAnimationFrame(loop);
    },
    clearPulses() { pulses.splice(0).forEach((p) => p.el.remove()); },
    // lay modules out left to right by signal flow, using their real sizes (one undo step)
    tidy({ merge = false } = {}) {
      const g = store.graph;
      if (!g.nodes.length) return;
      const depth = new Map();
      const dOf = (id, seen = new Set()) => {
        if (depth.has(id)) return depth.get(id);
        if (seen.has(id)) return 0;
        seen.add(id);
        const d = Math.max(-1, ...g.wires.filter((w) => w.to.node === id).map((w) => dOf(w.from.node, seen))) + 1;
        depth.set(id, d);
        return d;
      };
      g.nodes.forEach((n) => dOf(n.id));
      const size = (id) => { const el = views.get(id)?.el; return { w: el?.offsetWidth || 240, h: el?.offsetHeight || 200 }; };
      const cols = [];
      g.nodes.forEach((n) => (cols[depth.get(n.id)] ||= []).push(n));
      const pos = {}, cy = {};
      let x = 0;
      const GAPX = 72, GAPY = 36;
      cols.forEach((col) => {
        if (!col) return;
        const want = (n) => { const src = g.wires.filter((w) => w.to.node === n.id && cy[w.from.node] != null).map((w) => cy[w.from.node]); return src.length ? src.reduce((a, b) => a + b, 0) / src.length : n.y + size(n.id).h / 2; };
        const order = col.map((n) => ({ n, t: want(n) })).sort((a, b) => a.t - b.t || a.n.x - b.n.x);
        let bottom = -1e9, w = 0;
        for (const { n, t } of order) {
          const sz = size(n.id);
          const y = Math.max(t - sz.h / 2, bottom + GAPY);
          pos[n.id] = { x, y };
          cy[n.id] = y + sz.h / 2;
          bottom = y + sz.h;
          w = Math.max(w, sz.w);
        }
        x += w + GAPX;
      });
      const minY = Math.min(...Object.values(pos).map((p) => p.y));
      for (const p of Object.values(pos)) { p.x = Math.round(p.x / SNAP) * SNAP; p.y = Math.round((p.y - minY) / SNAP) * SNAP; }
      hooks.layout(pos, merge);
    },
    nodeEl: (id) => views.get(id)?.el,
    setPhase(id, phase) {
      const v = views.get(id);
      if (!v?.ctl.preview) return;
      if (phase != null && v.phase != null && Math.abs(v.phase - phase) < 0.004) return;
      v.phase = phase;
      const n = store.graph.nodes.find((x) => x.id === id);
      if (n) drawPreview(MODULES[n.type].preview, v.ctl.preview, n.params, { accent: accent(), phase, driven: false });
    },
    setPlayhead(id, idx) {
      const v = views.get(id);
      const dots = v?.ctl.seq?.dots || v?.ctl.chords?.dots || v?.ctl.drums?.dots;
      if (!dots || v.ph === idx) return;
      if (v.ph != null) dots[v.ph]?.classList.remove('on');
      if (idx != null) dots[idx]?.classList.add('on');
      v.ph = idx;
    },
    clearPlayheads() { views.forEach((v) => { const dots = v.ctl.seq?.dots || v.ctl.chords?.dots || v.ctl.drums?.dots; dots?.forEach((d) => d.classList.remove('on')); v.ph = null; }); },
    canvases: () => [...views].filter(([, v]) => v.ctl.canvas).map(([id, v]) => ({ id, type: v.ctl.node.type, canvas: v.ctl.canvas })),
    // palette drop
    placeFromPalette(type, cx, cy) {
      const p = toWorld(cx, cy);
      hooks.addNode(type, Math.round((p.x - 90) / SNAP) * SNAP, Math.round((p.y - 20) / SNAP) * SNAP);
    },
  };
  applyView();
  return api;
}

export function buildPalette(root, hooks, getGraph) {
  const items = new Map();
  for (const [cat, title] of CATEGORIES) {
    const sec = h('div', { class: 'pal-sec' }, h('div', { class: 'pal-h' }, title));
    // the Write modules are shown in small groups (melody, rhythm, harmony); every other section keeps the module order
    const grouped = PALETTE_GROUPS[cat], order = [];
    if (grouped) { for (const [label, types] of grouped) { order.push({ label }); for (const t of types) if (MODULES[t]) order.push({ type: t }); } for (const [t, d] of Object.entries(MODULES)) if (d.cat === cat && !grouped.some(([, ts]) => ts.includes(t))) order.push({ type: t }); }
    else for (const [t, d] of Object.entries(MODULES)) if (d.cat === cat) order.push({ type: t });
    for (const entry of order) {
      if (entry.label) { sec.append(h('div', { class: 'pal-sub' }, entry.label)); continue; }
      const type = entry.type, def = MODULES[type];
      const out = def.out === 'through' ? null : def.out;
      const item = h('div', { class: `pal-item cat-${def.cat}`, dataset: { type }, title: def.blurb },
        h('span', { class: 'pal-dot', dataset: { type: out || '' } }), h('span', {}, def.title));
      item.addEventListener('pointerdown', (e) => {
        if (item.classList.contains('disabled')) return;
        e.preventDefault();
        const x0 = e.clientX, y0 = e.clientY;
        let ghost = null;
        const move = (ev) => {
          if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 5) {
            ghost = h('div', { class: `pal-ghost cat-${def.cat}` }, def.title);
            document.body.append(ghost);
          }
          if (ghost) { ghost.style.transform = `translate(${ev.clientX + 8}px,${ev.clientY + 8}px)`; hooks.cableHover?.(ev.clientX, ev.clientY, { type }); }
        };
        const up = (ev) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          ghost?.remove();
          const board = document.getElementById('board').getBoundingClientRect();
          const inside = ev.clientX > board.left && ev.clientX < board.right && ev.clientY > board.top && ev.clientY < board.bottom;
          if (ghost) { if (inside) hooks.dropFromPalette(type, ev.clientX, ev.clientY); else hooks.cableHover?.(null, null, {}); }
          else hooks.dropFromPalette(type);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
      items.set(type, item);
      sec.append(item);
    }
    root.append(sec);
  }
  return {
    sync() {
      const g = getGraph();
      for (const [type, item] of items) {
        const dis = !!(MODULES[type].single && g.nodes.some((n) => n.type === type));
        item.classList.toggle('disabled', dis);
        item.title = dis ? 'Only one Output is allowed' : MODULES[type].blurb;
      }
    },
  };
}
