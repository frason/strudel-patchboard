// Small animated pictures for effects, in the same spirit as the Pulse width wave: no controls, the knobs do the work and the picture shows what they mean.
//   Delay:  the hit on the left, then its echoes. Echoes sit one delay time apart (the time knob, in seconds, laid along the cycle by the Output's tempo) and each is quieter than the last (mix sets the first,
//           feedback how fast they die away). A light sweeps across and each bar glows as it is reached. The base line is one cycle long, with a tick for
//           every beat (the Output's beats) and the next cycle's hit drawn as a dashed ghost where the pattern comes round again.
//   Reverb: the hit on the left, then its tail. The tail is as long as the room is big (size) and as tall as the room is loud (room). The same sweep lights it up.
// Everything stops when Animations are off (the pictures then sit still, fully lit).
const NS = 'http://www.w3.org/2000/svg';
const W = 240, H = 104, Y = 72, X0 = 16, X1 = 228, MAXH = 52, LOOP = 2.6;   // base line, where the hit is, where the picture ends, tallest bar, seconds per sweep
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pseudo = (i) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };

// the delay's bars: the dry hit, then echo k at k times the delay time (in seconds), mix * feedback^(k-1) as tall. The picture is one cycle wide, `cycleSec` seconds long.
export function delayBars(p, cycleSec = 1, maxEchoes = 24) {
  const mix = clamp(Number(p.mix) || 0, 0, 1), time = clamp(Number(p.time) || 0.25, 0.01, 1), fb = clamp(Number(p.feedback) || 0, 0, 0.95);
  const bars = [{ x: X0, h: 1, dry: true }];
  for (let k = 1; k <= maxEchoes; k++) {
    const x = X0 + ((X1 - X0) * time * k) / cycleSec, h = mix * fb ** (k - 1);
    if (x > X1 || h < 0.03) break;
    bars.push({ x, h, dry: false });
  }
  return bars;
}
// the reverb's tail: how many pixels long, how tall it starts
export const reverbShape = (p) => ({ len: clamp(14 + 20 * (Number(p.size) || 0), 14, X1 - X0 - 12), top: 0.12 + 0.88 * clamp(Number(p.room) || 0, 0, 1) });

// one live picture: `init` builds the shapes once, `paint` places them for the current knobs and the sweep position (0 to 1)
function live(node, ctl, { store, h }, key, label, init, paint) {
  const paramsOf = () => (store.graph.nodes.find((x) => x.id === node.id) || node).params;
  const svg = el('svg', { class: 'fxpic', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  svg.append(el('line', { class: 'fx-base', x1: 8, x2: W - 8, y1: Y, y2: Y }));
  const state = init(svg);
  let P = paramsOf(), t0 = 0, raf = 0;
  const animated = () => !svg.closest('.no-anim');
  const frame = (now) => {
    raf = 0;
    if (!svg.isConnected) return;
    if (!t0) t0 = now;
    paint(svg, state, P, ((now - t0) / 1000 / LOOP) % 1);
    if (animated()) raf = requestAnimationFrame(frame); else t0 = 0;
  };
  const draw = (p) => {
    P = p || paramsOf();
    paint(svg, state, P, animated() ? ((performance.now() - t0) / 1000 / LOOP) % 1 : 2);   // 2 = past the end: everything lit
    if (!raf && animated() && svg.isConnected) raf = requestAnimationFrame(frame);
  };
  ctl[key] = { draw };
  const wrap = h('div', { class: 'fxpicwrap' }, svg);
  draw(node.params);
  return wrap;
}
// how lit something at x is when the sweep is at `pos` (0 to 1): bright as the sweep reaches it, then easing back
const lit = (x, pos) => { if (pos > 1) return 1; const at = X0 + (X1 - X0) * pos, d = at - x; return d < -2 ? 0.28 : 0.28 + 0.72 * Math.exp(-Math.max(0, d) / 34); };

export function buildDelayPic(node, ctl, deps) {
  const out = () => deps.store.graph.nodes.find((n) => n.type === 'output')?.params || {};
  const cycleSec = () => (60 * (Number(out().beats) || 4)) / Math.max(1, Number(out().bpm) || 120);   // how long one cycle lasts, from the Output's tempo
  const beatsNow = () => Math.max(1, Math.min(16, Math.round(Number(deps.store.graph.nodes.find((n) => n.type === 'output')?.params.beats) || 4)));
  return live(node, ctl, deps, 'delaypic', 'Animation of a hit and its echoes along one cycle: how far apart they are and how fast they fade, with the next cycle marked',
    (svg) => {
      const bars = [], sweep = el('line', { class: 'fx-sweep', y1: Y - MAXH - 4, y2: Y });
      const ghost = el('rect', { class: 'fx-ghost', rx: 2, x: X1 - 2.5, y: Y - MAXH, width: 5, height: MAXH });
      const ticks = el('g'), tnext = el('text', { class: 'fx-txt', x: X1, y: H - 4, 'text-anchor': 'end' }), tfirst = el('text', { class: 'fx-txt', x: X0, y: H - 4, 'text-anchor': 'start' });
      tnext.textContent = 'next cycle'; tfirst.textContent = 'hit';
      svg.append(ghost, ticks, tfirst, tnext, sweep);
      return { bars, sweep, ghost, ticks, beats: 0 };
    },
    (svg, st, p, pos) => {
      const beats = beatsNow();
      if (beats !== st.beats) {   // one tick per beat along the cycle, longer at the start and the end
        st.beats = beats; st.ticks.replaceChildren();
        for (let i = 0; i <= beats; i++) { const x = X0 + ((X1 - X0) * i) / beats, ln = el('line', { class: 'fx-tick', x1: x, x2: x, y1: Y, y2: Y + (i === 0 || i === beats ? 9 : 5) }); st.ticks.append(ln); }
      }
      st.ghost.style.opacity = String(lit(X1, pos) * 0.9);
      const data = delayBars(p, cycleSec());
      while (st.bars.length < data.length) { const r = el('rect', { class: 'fx-bar', rx: 2, width: 5 }); svg.insertBefore(r, st.sweep); st.bars.push(r); }
      st.bars.forEach((r, i) => {
        const b = data[i];
        r.style.display = b ? '' : 'none';
        if (!b) return;
        const hh = Math.max(2, b.h * MAXH);
        r.setAttribute('x', b.x - 2.5); r.setAttribute('y', Y - hh); r.setAttribute('height', hh);
        r.classList.toggle('fx-dry', b.dry);
        r.style.opacity = String(lit(b.x, pos));
      });
      st.sweep.setAttribute('x1', X0 + (X1 - X0) * Math.min(pos, 1)); st.sweep.setAttribute('x2', X0 + (X1 - X0) * Math.min(pos, 1)); st.sweep.style.display = pos > 1 ? 'none' : '';
    });
}

export function buildReverbPic(node, ctl, deps) {
  const N = 56;
  return live(node, ctl, deps, 'reverbpic', 'Animation of a hit and the tail of the room: how long it rings and how loud',
    (svg) => {
      const hit = el('rect', { class: 'fx-bar fx-dry', rx: 2, width: 5, x: X0 - 2.5, y: Y - MAXH, height: MAXH });
      const lines = Array.from({ length: N }, () => el('line', { class: 'fx-tail' })), sweep = el('line', { class: 'fx-sweep', y1: Y - MAXH - 4, y2: Y });
      svg.append(...lines, hit, sweep);
      return { hit, lines, sweep };
    },
    (svg, st, p, pos) => {
      const { len, top } = reverbShape(p), x0 = X0 + 9;
      st.hit.style.opacity = String(lit(X0, pos));
      st.lines.forEach((ln, i) => {
        const u = i / (N - 1), x = x0 + len * u, hh = Math.max(1.5, MAXH * top * Math.exp(-3.2 * u) * (0.55 + 0.45 * pseudo(i)));
        ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.setAttribute('y1', Y - hh); ln.setAttribute('y2', Y);
        ln.style.opacity = String(lit(x, pos));
      });
      st.sweep.setAttribute('x1', X0 + (X1 - X0) * Math.min(pos, 1)); st.sweep.setAttribute('x2', X0 + (X1 - X0) * Math.min(pos, 1)); st.sweep.style.display = pos > 1 ? 'none' : '';
    });
}
