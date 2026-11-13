// Hydra visuals (hydra-synth), the same engine initHydra() uses on strudel.cc. Loaded only when a patch needs it.
// Where the picture goes is an app setting, not part of the code: behind the board, in a floating panel, or in its own window.
let hydra = null, canvas = null, saved = null;
let mode = 'panel', panel = null, popup = null, onNote = () => {};

export const hydraNotes = (f) => { onNote = f; };

export async function initHydra(options = {}) {
  if (!hydra) {
    const { default: Hydra } = await import('hydra-synth');
    // Hydra overwrites the globals speed and shape; remember Strudel's so they can be put back
    saved = { speed: globalThis.speed, shape: globalThis.shape };
    canvas = document.createElement('canvas');
    canvas.id = 'hydra-canvas';
    canvas.width = 960; canvas.height = 540;
    // feedStrudel is not supported: Patchboard draws its own views, so Hydra cannot read Strudel's canvas
    const { feedStrudel, src, contextType, pixelRatio, pixelated, ...cfg } = { detectAudio: false, ...options };
    void feedStrudel; void src; void contextType; void pixelRatio; void pixelated;
    hydra = new Hydra({ ...cfg, canvas, detectAudio: false });
  }
  place();
  return hydra;
}

// H("<1 2>") reads a Strudel pattern as a plain function, for Hydra parameters: osc(H("<10 40>"))
export const H = (p) => () => {
  const t = typeof globalThis.getTime === 'function' ? globalThis.getTime() : 0;
  const hap = globalThis.reify(p).queryArc(t, t)[0];
  return hap ? hap.value : 0;
};

export function clearHydra() {
  try { hydra?.hush(); } catch { /* ignore */ }
  detach();
  if (saved) { globalThis.speed = saved.speed; globalThis.shape = saved.shape; }
}

function detach() {
  canvas?.remove();
  panel?.remove(); panel = null;
  document.body.classList.remove('hydra-on');
  if (popup && !popup.closed) popup.close();
  popup = null;
}

// Must be called inside a click: browsers only allow a popup then.
export function prepareWindow() {
  if (popup && !popup.closed) return true;
  popup = window.open('', 'patchboard-hydra', 'width=720,height=440');
  if (!popup) { onNote('The browser blocked the visuals window, so it is shown on the board instead. Allow pop-ups for this page to use a separate window.'); mode = 'panel'; return false; }
  popup.document.title = 'Patchboard visuals';
  popup.document.body.style.cssText = 'margin:0;background:#000;display:grid;place-items:center;height:100vh;overflow:hidden';
  return true;
}

export function setHydraMode(m) {
  if (m === mode) return;
  mode = m;
  place();
}

function place() {
  if (!canvas) return;
  detach();
  if (mode === 'background') {
    canvas.className = 'hydra-bg';
    document.body.prepend(canvas);
    document.body.classList.add('hydra-on');
  } else if (mode === 'window' && popup && !popup.closed) {
    canvas.className = '';
    const v = popup.document.createElement('video');
    v.muted = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = 'max-width:100%;max-height:100%';
    v.srcObject = canvas.captureStream(30);
    popup.document.body.replaceChildren(v);
    v.play().catch(() => {});
  } else {
    canvas.className = 'hydra-panel-canvas';
    const bar = document.createElement('div');
    bar.className = 'hydra-bar';
    bar.textContent = 'Hydra visuals';
    const x = document.createElement('button');
    x.textContent = '×'; x.title = 'Hide (it comes back next time you press play)';
    x.onclick = () => { panel?.remove(); panel = null; };
    bar.append(x);
    panel = document.createElement('div');
    panel.className = 'hydra-panel';
    panel.append(bar, canvas);
    document.body.append(panel);
    let d = null;
    bar.addEventListener('pointerdown', (e) => { if (e.target === x) return; const r = panel.getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; bar.setPointerCapture?.(e.pointerId); });
    bar.addEventListener('pointermove', (e) => { if (!d) return; panel.style.left = e.clientX - d.dx + 'px'; panel.style.top = e.clientY - d.dy + 'px'; panel.style.right = 'auto'; panel.style.bottom = 'auto'; });
    bar.addEventListener('pointerup', () => { d = null; });
  }
}
