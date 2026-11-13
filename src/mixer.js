// The Mixer: one strip per input, in the same colour as its input jack on the left edge.
// Each strip has a fader (volume, written as .postgain(), 1 = unchanged), a pan, and mute and solo buttons.
// Drag a fader up and down, drag a pan sideways; double-click either to reset it. From the keyboard: Tab to a control, then the arrow keys
// (Home resets it). Mute silences a strip; solo silences every strip that is not solo.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const VMAX = 1.5;

export function buildMixer(node, ctl, { store, hooks, h }) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const stripsOf = () => (paramsOf().strips || []).map((s) => ({ vol: 1, pan: 0.5, mute: false, solo: false, ...s }));
  const patch = (i, change) => {
    const cur = stripsOf();
    cur[i] = { ...cur[i], ...change };
    hooks.setParam(node.id, 'strips', cur);
  };
  const n = node.params.n;
  const strips = Array.from({ length: n }, (_, i) => {
    const label = h('div', { class: 'mx-label' }, 'in ' + (i + 1));
    const fill = h('div', { class: 'mx-fill' }), unity = h('div', { class: 'mx-unity', title: 'unchanged (1)' });
    const fader = h('div', { class: 'mx-fader', tabindex: '0', role: 'slider', 'aria-label': `input ${i + 1} volume`, 'aria-valuemin': '0', 'aria-valuemax': String(VMAX), title: 'volume: drag up and down, double-click for 1' }, fill, unity);
    const val = h('div', { class: 'mx-val' });
    const panMark = h('div', { class: 'mx-panmark' });
    const pan = h('div', { class: 'mx-pan', tabindex: '0', role: 'slider', 'aria-label': `input ${i + 1} pan`, 'aria-valuemin': '0', 'aria-valuemax': '1', title: 'pan: drag sideways, double-click for the middle' }, h('div', { class: 'mx-pancenter' }), panMark);
    const mute = h('button', { class: 'mx-btn mute', type: 'button', title: 'mute this input', 'aria-label': `mute input ${i + 1}`, 'aria-pressed': 'false' }, 'M');
    const solo = h('button', { class: 'mx-btn solo', type: 'button', title: 'solo this input: silences the others', 'aria-label': `solo input ${i + 1}`, 'aria-pressed': 'false' }, 'S');
    const el = h('div', { class: 'mx-strip', style: `--hue: ${(i * 57 + 200) % 360}` }, label, fader, val, pan, h('div', { class: 'mx-btns' }, mute, solo));
    // dragging: pointer position along the control gives the value; the control does not need to be hit exactly
    const dragCtl = (target, fromEvent) => {
      target.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault();
        try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        fromEvent(e);
        const move = (ev) => fromEvent(ev);
        const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); };
        target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
      });
    };
    dragCtl(fader, (ev) => {
      const r = fader.getBoundingClientRect(), f = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
      let v = Math.round(f * VMAX * 100) / 100;
      if (Math.abs(v - 1) < 0.04) v = 1;
      if (stripsOf()[i].vol !== v) patch(i, { vol: v });
    });
    dragCtl(pan, (ev) => {
      const r = pan.getBoundingClientRect(), f = clamp((ev.clientX - r.left) / r.width, 0, 1);
      let v = Math.round(f * 100) / 100;
      if (Math.abs(v - 0.5) < 0.05) v = 0.5;
      if (stripsOf()[i].pan !== v) patch(i, { pan: v });
    });
    fader.addEventListener('dblclick', () => patch(i, { vol: 1 }));
    pan.addEventListener('dblclick', () => patch(i, { pan: 0.5 }));
    const keyed = (target, fn) => target.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!d && e.key !== 'Home') return;
      e.preventDefault(); fn(d || 0, e.shiftKey, e.key === 'Home');
    });
    keyed(fader, (d, sh, home) => patch(i, { vol: home ? 1 : clamp(Math.round((stripsOf()[i].vol + d * (sh ? 0.1 : 0.02)) * 100) / 100, 0, VMAX) }));
    keyed(pan, (d, sh, home) => patch(i, { pan: home ? 0.5 : clamp(Math.round((stripsOf()[i].pan + d * (sh ? 0.1 : 0.02)) * 100) / 100, 0, 1) }));
    for (const [b, key] of [[mute, 'mute'], [solo, 'solo']]) {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('keydown', (e) => e.stopPropagation());
      b.addEventListener('click', () => patch(i, { [key]: !stripsOf()[i][key] }));
    }
    return { el, fill, val, fader, pan, panMark, mute, solo, label };
  });
  const root = h('div', { class: 'mixer', role: 'group', 'aria-label': 'mixer' }, strips.map((s) => s.el));
  ctl.mixer = {
    draw(p) {
      const st = (p.strips || []);
      const anySolo = st.slice(0, n).some((s) => s && s.solo);
      strips.forEach((s, i) => {
        const v = { vol: 1, pan: 0.5, mute: false, solo: false, ...(st[i] || {}) };
        s.fill.style.height = `${(clamp(v.vol / VMAX, 0, 1) * 100).toFixed(1)}%`;
        s.val.textContent = v.vol.toFixed(2);
        s.fader.setAttribute('aria-valuenow', String(v.vol));
        s.pan.setAttribute('aria-valuenow', String(v.pan)); s.pan.setAttribute('aria-valuetext', v.pan === 0.5 ? 'centre' : v.pan < 0.5 ? `${Math.round((0.5 - v.pan) * 200)} percent left` : `${Math.round((v.pan - 0.5) * 200)} percent right`);
        s.panMark.style.left = `${(v.pan * 100).toFixed(1)}%`;
        s.mute.classList.toggle('on', v.mute); s.mute.setAttribute('aria-pressed', String(v.mute));
        s.solo.classList.toggle('on', v.solo); s.solo.setAttribute('aria-pressed', String(v.solo));
        s.el.classList.toggle('silenced', v.mute || (anySolo && !v.solo));
      });
    },
  };
  ctl.mixer.draw(node.params);
  return root;
}
