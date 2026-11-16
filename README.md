# Strudel Patchboard

**Learn [Strudel](https://strudel.cc) by seeing what the code means** (an unofficial tool, not made or endorsed by the Strudel team). Wire modules together on a page; a live panel shows the Strudel code the patch compiles to, and that code is what plays. Numbers and choices in the code can be edited and the patch updates.

```
npm install
npm run dev      # http://127.0.0.1:5174
npm test         # evaluates every starter in real Strudel, checks graph rules, import/export
```

## Decisions (stated, then built)
- **Patching level:** pattern-level. Cables carry events (`notes`, `trigger`, `number`, `sound`), not audio.
- **2D vs 3D:** 2D, DOM + SVG cables, with sockets, knobs and sagging cables for the tactile feel.
- **Code panel:** CodeMirror 6 (`@codemirror/view` directly). `@strudel/codemirror` was not reused: it bundles an
  evaluating editor, autocomplete and vim bindings; the panel only needs read-only text plus decorations, and Strudel
  already exposes what the highlighting needs (see below).
- **Framework:** Vite + plain JavaScript.
- **Code → graph: a reader, not an editor.** The code panel is read-only, but Import accepts any Strudel code (paste or file). It reads the code with a JavaScript parser (acorn) and builds the modules it can express; everything else is listed with its line number and the reason, never guessed or silently dropped. `npm run test:import` round-trips every lesson (code → modules → code, same events in real Strudel) and runs any local corpus in `scripts/corpus/` (git-ignored).

## How it hangs together
- `graph.js` / `modules.js`: one serialisable graph `{nodes:[{id,type,x,y,params}], wires:[{from:{node,port}, to:{node,port}}]}`.
  Port typing, feedback-loop detection and wire normalisation live here. Undo, autosave, saves, export, compiler and panel all read it.
- `compile.js`: graph → idiomatic Strudel string (`$:`, `stack`, `cat`, `.fast(2)`, `.lpf(800)` …). Alongside the string it returns
  `segments` (character ranges ↔ module / knob / step) and per-line plain-English notes.
- `engine.js`: `@strudel/web`. `initAudio()` runs inside the Start click. The compiled string is passed to `repl.evaluate`.
- **Event tagging:** Strudel's transpiler attaches `hap.context.locations` (character offsets of each mini-notation token in the
  evaluated string). Our `defaultOutput` forwards them, and `segments` map offsets to modules and sequencer steps. No second
  representation, and the same offsets light the exact tokens in the code panel. Effects/transformers without strings light up
  as the event travels downstream along the wires (pulses on cables).
- Sliders: `slider(v, lo, hi)` in the code; moving the module updates Strudel's live value immediately, and the code rewrites.

## Newer modules
- **Arrange**: a song strip, `arrange([cycles, pattern], ...)`; drag a section's edge for its length.
- **Orbit**: picks the mix bus, so each part keeps its own reverb and delay.
- **FM**: up to four modulators, with a *tune* view (chain, harmonic scale, index and feedback gauges) and a *routes* view
  (drag disc to disc; the full 4x4 FM matrix, written as `fm13`, `fm20` ... ). A number grid sets any route by keyboard.
- **Drawn envelopes** on Instrument, Sample, FM and Filter: drag the corners of the shape.
- **Effects** (rack): reverb, delay, chorus, distortion, phaser and tremolo as tiles with an on/off and an amount.
- **Mixer**: a Stack with a fader (`.postgain()`), pan, mute and solo per input.
- **Macro**: one 0 to 1 number for many knobs. *Sweep* maps it across each knob's range (`.range(lo, hi)`), *multiply* scales each
  knob's own setting (`.mul(setting)`).
- **Random Notes / Random Rhythm**: write a new random melody (`n(irand(7).segment(8)).scale(...)`) or rhythm (`struct("x*8?0.4")`)
  every cycle. *Freeze* (1 and up) picks one variation and repeats it (`.ribbon(n, 1)`). **Shuffle** (shuffle or scramble) and
  **Sometimes** (`sometimesBy`) are transformers for any pattern.
- **Output volume**: a master `all(x => x.postgain(v))`, and it accepts a slider cable.
- **Instrument and Sample**: the sound comes first (a card with a graphic for its family), then the envelope, then the waveform buttons (only while the
  sound is a synth wave), then the knobs. The sound picker is a wide grid of cards with a drawing per family (keys, strings, brass, drums ...).
- **Descriptions** fold away behind "about this module" on every module (Settings → Module descriptions keeps them all open).
- **Code panel**: type anywhere. A moment after you stop, the board follows: a changed number moves its knob, a new line adds modules, a deleted line removes
  only its own modules and cables, and a module you did not touch stays exactly as it was (settings, position, size, collapsed, muted). Your text stays as you
  typed it: comments and spacing are kept, and a knob moved on the board changes only that number in your text. Code the board cannot show (a custom function,
  Hydra, a pattern the modules cannot express) stays in your text and does not play here; the bar under the code lists each part with the reason, and Copy and
  Open in strudel.cc use your full text. Code that is not valid JavaScript shows the error and leaves the board as it was. While your text differs from the
  board's code the highlights and plain-English notes are off (they are positions in the board's code); "Show the board's code" brings them back and replaces your
  text. Opening a lesson, Import or New starts from the board's code. Settings → Code panel → "numbers only" brings back the old locked panel.
- **Code panel choices**: a sound name, a bank, a filter type, shuffle or scramble, and what Sometimes or Every does are underlined with a ▾. Click one (or press Enter
  on it) and the same picker or menu the module uses opens right there; the pick goes to the module and the code rewrites. In a Sample pattern each sound word is its own
  choice (only that word is replaced). Scales and keys, chord symbols and note names are not choices: use the modules for those.
- **B/C (beats per cycle)** in the top bar also sets how the sequencer grids are grouped: bars of B/C steps (8 steps at 4 are two groups of 4; at 6, a group of 6 and a group of 2).
  It only changes the drawing; sequencers set to "one step per cycle" keep groups of four.
- **Dials**: click a dial and small ▼ ▲ buttons appear beside its value (click = one step, Shift-click = ten, hold = repeat); they show for the dial you hover or
  have clicked, so nothing else moves. Or use the keys: up and down (or left and right) move it one step; Shift or Page Up and Down move ten; Home and End go to the ends.
  Dials on a log scale (a cutoff in Hz) move by a small percentage per press.
- Everything dragged also works from the keyboard (Tab to a handle, then the arrow keys; Shift for bigger steps).

## Safe output (stops clipping)
The app puts a limiter between Strudel and the speakers (Settings → Sound → Safe output, on by default). It has two stages. A fast compressor
starts at -2 dB and takes hot peaks down smoothly; behind it a soft clipper rounds off what is left, so the output cannot pass 0.97.
Below about 0.8 of full scale the signal is untouched (the compressor's automatic make-up gain is measured once per browser and cancelled).
A very hot patch, a stack of FM voices for example, therefore gets denser instead of crackling.
A small "limiting" light by the transport shows when the sound went past full scale a moment ago (it reads "clipping" with Safe output off).
It is part of this app's audio, not of the generated code, so it is not in the code panel and not there when the same code runs on strudel.cc.
Turning the Output volume or a loud part down is still the better fix: the limiter only protects the speakers.

## Audio capture (development only)
`npm run dev` loads `src/capture.js`, which taps what reaches the speakers and reports numbers (loudness, note starts, attack and
fade times, strongest frequencies) and a spectrogram. It is not in the production build. After pressing Play, in the browser console:
```
__capture.record(4).then((r) => console.log(JSON.stringify(__capture.analyze(r))))   // Safari: no top-level await
__capture.suite().then((r) => console.log(JSON.stringify(r, null, 1)))               // does each control still do what it says?
__capture.sweep().then((r) => console.log(JSON.stringify(r, null, 1)))               // does every starter play, without clipping?
```
It measures; it cannot say whether something sounds good.

## What was and wasn't verified
See the end-of-task report in the conversation. In short: generated code was evaluated in real Strudel for every starter and a
kitchen-sink patch, and the UI was driven in a browser. Audio was not heard, and nothing was run on strudel.cc.

## Deploying (Cloudflare Pages, free `*.pages.dev` address)
The app is static: `npm run build` writes everything to `dist/`.

Quickest, no Git needed:
```
npm run build
npx wrangler login                                   # opens a browser to sign in to Cloudflare
npx wrangler pages deploy dist --project-name strudel-patchboard
```
Or, better, connect the GitHub repository in the Cloudflare dashboard (Workers & Pages → Create → Pages → Connect to Git) so every push
to `main` deploys itself: build command `npm run build`, output directory `dist`, and an environment variable `NODE_VERSION` = `22`
(Vite 8 needs a recent Node).

### A custom domain
Pages project → Custom domains → Set up a custom domain. If the domain is registered with (or its nameservers point to) Cloudflare, the DNS
record and the HTTPS certificate are added automatically. Add both the bare name and `www`, and a redirect from one to the other.

Check the production build locally with `npm run build && npm run preview` (http://localhost:4173).

## Licence
AGPL-3.0-or-later (see `LICENSE`), because it is built on Strudel, which is AGPL-3.0. Source: https://github.com/frason/strudel-patchboard.
If you host your own public copy, link to your source: set `SOURCE_URL` near the top of `src/main.js`.

## Hydra visuals
Patchboard does not run Hydra. If you paste code that uses it, the Hydra lines are left out of the board, listed in the import report, and can be copied
with **Copy the skipped code**: nothing is deleted. Run that code on [strudel.cc](https://strudel.cc), where Hydra works.
