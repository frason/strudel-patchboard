// The Take module's picture: the notes you played on a roll, a Re-record button, and the earlier takes it keeps.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return !t ? '' : m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

// Draws the notes and returns the layout it used ({ lo, rows, rh, px, span, W, H }), so a click can be turned back into a beat and a note.
// With `lay` given it draws with that layout (the picture must not rescale while a note is being dragged).
export function drawTakeRoll(canvas, events, beatsPerBar = 4, { edit = false, lay = null } = {}) {
  const c = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H); c.fillStyle = '#0b0f13'; c.fillRect(0, 0, W, H);
  const end = events.length ? Math.max(...events.map((e) => e.t + e.d)) : 0;
  const pad = edit ? 3 : 1;   // when editing there is a bar of empty room after the last note and a few empty rows above and below
  const span = lay ? lay.span : Math.max(beatsPerBar * (edit ? 2 : 1), Math.ceil(end / beatsPerBar) * beatsPerBar + (edit ? beatsPerBar : 0));
  const lo = lay ? lay.lo : events.length ? Math.min(...events.map((e) => e.n)) - pad : 55, hi = events.length ? Math.max(...events.map((e) => e.n)) + pad : 79;
  const rows = lay ? lay.rows : Math.max(edit ? 16 : 10, hi - lo + 1), rh = H / rows, px = W / span, out = { lo, rows, rh, px, span, W, H };
  if (!events.length && !edit) { c.fillStyle = '#6f8290'; c.font = '600 22px monospace'; c.textAlign = 'center'; c.fillText('empty: press Re-record', W / 2, H / 2 + 7); return out; }
  for (let r = 0; r < rows; r++) { const n = lo + r; if ([1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12)) { c.fillStyle = '#0f151b'; c.fillRect(0, H - (r + 1) * rh, W, rh); } }
  for (let b = 0; b <= span; b++) { c.strokeStyle = b % beatsPerBar === 0 ? '#3a4a58' : '#18212a'; c.lineWidth = b % beatsPerBar === 0 ? 2 : 1; c.beginPath(); c.moveTo(b * px, 0); c.lineTo(b * px, H); c.stroke(); }
  for (const e of events) { c.fillStyle = `rgba(232,168,90,${0.4 + 0.6 * clamp(e.v, 0, 1)})`; c.fillRect(e.t * px, H - (e.n - lo + 1) * rh, Math.max(4, e.d * px - 2), Math.max(4, rh - 2)); }
  if (!events.length) { c.fillStyle = '#6f8290'; c.font = '600 20px monospace'; c.textAlign = 'center'; c.fillText('empty: click to add notes, or Re-record', W / 2, H / 2 + 7); }
  return out;
}

export function buildTakePic(node, ctl, { store, hooks, h }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const canvas = h('canvas', { class: 'takecanvas', width: 760, height: 150, role: 'img', 'aria-label': 'The notes of this take on a piano roll' });
  const info = h('div', { class: 'takeinfo' });
  const rec = h('button', { type: 'button', class: 'btn sm', title: 'Play this take again. The one you replace is kept under Earlier takes.' }, '● Re-record');
  rec.addEventListener('pointerdown', (e) => e.stopPropagation());
  rec.addEventListener('click', () => hooks.recordTake(node.id));
  const older = h('select', { class: 'sel takeolder', 'aria-label': 'Earlier takes' });
  older.addEventListener('pointerdown', (e) => e.stopPropagation()); older.addEventListener('keydown', (e) => e.stopPropagation());
  older.addEventListener('change', () => { const i = Number(older.value); older.value = ''; if (Number.isInteger(i)) hooks.restoreTake(node.id, i); });
  const row = h('div', { class: 'takerow' }, rec, older);
  let lay = null, locked = null;
  const draw = (p) => {
    const P = p || paramsOf(), ev = Array.isArray(P.events) ? P.events : [];
    lay = drawTakeRoll(canvas, ev, P.beats || 4, { edit: true, lay: locked });
    const bars = ev.length ? Math.ceil(Math.max(P.len || 0, ...ev.map((e) => e.t + e.d)) / (P.beats || 4)) : 0;
    info.textContent = ev.length ? `${ev.length} note${ev.length === 1 ? '' : 's'} · ${bars} bar${bars === 1 ? '' : 's'} · ${Math.round(P.bpm)} BPM` : 'no notes yet';
    const vs = Array.isArray(P.versions) ? P.versions : [];
    older.replaceChildren(h('option', { value: '' }, vs.length ? `Earlier takes (${vs.length})` : 'No earlier takes'), ...vs.map((v, i) => h('option', { value: String(i) }, `${i + 1}. ${v.events.length} notes · ${ago(v.at)}`)));
    older.disabled = !vs.length;
  };
  // ---- editing: click empty space to add a note, click a note to remove it, drag it to move it, drag its right end to change its length ----
  canvas.title = 'Click to add a note. Click a note to remove it. Drag a note to move it, or drag its right end to change its length.';
  canvas.style.cursor = 'crosshair';
  const at = (e) => {
    const r = canvas.getBoundingClientRect(), sx = canvas.width / r.width, x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * (canvas.height / r.height);
    return { beat: x / lay.px, n: Math.round(lay.lo + Math.floor((lay.H - y) / lay.rh)), x };
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault();
    const P = paramsOf(), evs = (Array.isArray(P.events) ? P.events : []).map((x) => ({ ...x })), grid = Number(P.grid) || 4, snap = (b) => Math.round(b * grid) / grid, step = 1 / grid;
    if (!lay) return;
    locked = { ...lay };
    const p0 = at(e);
    let idx = evs.findIndex((x) => x.n === p0.n && p0.beat >= x.t && p0.beat < x.t + x.d), mode, orig = null, isNew = false;
    if (idx >= 0) { orig = { ...evs[idx] }; mode = (orig.t + orig.d - p0.beat) * lay.px <= 9 ? 'size' : 'move'; }
    else {   // empty space: a new note, one step long, that the drag can lengthen
      evs.push({ t: Math.max(0, snap(p0.beat)), d: step, n: clamp(p0.n, 0, 127), v: 0.8 }); idx = evs.length - 1; orig = { ...evs[idx] }; mode = 'size'; isNew = true;
      hooks.editTake(node.id, evs.map((x) => ({ ...x })));
    }
    let moved = isNew;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const move = (ev) => {
      const p = at(ev), db = p.beat - p0.beat, cur = { ...orig };
      if (mode === 'size') cur.d = Math.max(step, snap(orig.d + db));
      else { cur.t = Math.max(0, snap(orig.t + db)); cur.n = clamp(orig.n + (p.n - p0.n), 0, 127); }
      if (cur.t !== evs[idx].t || cur.d !== evs[idx].d || cur.n !== evs[idx].n) { evs[idx] = cur; moved = true; hooks.editTake(node.id, evs.map((x) => ({ ...x }))); }
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      if (!moved && mode === 'move') hooks.editTake(node.id, evs.filter((_, k) => k !== idx));   // a click on a note takes it away
      locked = null; draw();
    };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  });
  ctl.take = { draw };
  const wrap = h('div', { class: 'takewrap' }, canvas, info, row);
  draw(node.params);
  return wrap;
}
export const TAKEPICS = { take: buildTakePic };
