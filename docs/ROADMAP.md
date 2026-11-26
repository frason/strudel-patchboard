# Strudel Patchboard — Roadmap and plan for review

Status: draft for review (written 2026-11-25). Nothing in this document is built yet unless it says "exists".
Audience: a second engineer (Codex) asked to challenge the plan: ordering, design, risks, anything missing or over-built.

## 1. What this is

Patchboard is a browser app (Vite 8, plain JavaScript, no framework) that is a **visual patcher for live-coded music**. You connect modules with cables
(sequencers, instruments, effects, mixer, waves) and the app writes **Strudel** code (the JavaScript port of TidalCycles), plays it with Strudel's own
engine, and reads Strudel code back into modules (import from strudel.cc). Board and code stay in step both ways.

- Repo: `/Users/frason/Developer/Strudel_Board`, GitHub `frason/strudel-patchboard`, branch `main`. Live: https://strudel-patchboard.pages.dev (Cloudflare Pages).
- Engine: `@strudel/web` 1.3.0 (bundles its own core 1.2.6, superdough audio, zyklus clock). Strudel is the only clock.
- Deploy is manual (`npm run build`, then `npx wrangler pages deploy dist --project-name strudel-patchboard --branch main`). Commits and pushes happen only when the owner asks.
- Tests: `npm test` = `node --import ./scripts/stub-loader.mjs scripts/verify.mjs` + `npm run test:reconcile` + `npm run test:guard`. `verify.mjs` is a large single-file suite; it replays real songs
  (tools/*.strudel) through import and compares what the original and the imported board play in real Strudel over N cycles. That pattern ("prove it plays the same") is the project's main safety net.

### Architecture in one page (files in `src/`)

| Area | Files | Notes |
|---|---|---|
| Graph model | `graph.js`, `modules.js`, `validate.js`, `store.js` | `{v:1, nodes, wires, groups}`. `modules.js` defines every module (ports, params, blurbs). `whyNot()` decides which cables may connect; `normalize()` removes illegal ones. Undo/redo + autosave in `store.js` (localStorage `pb.*` only). |
| Code out | `compile.js`, `guard.js` | `compile(graph)` -> `{code, segments, issues}`. Segments map code ranges to modules (the code panel highlights played notes). `guard.js` is an **allow-list parser** (acorn) that every code string must pass before Strudel evaluates it: only the shapes the compiler writes, one-argument arrows, a fixed method list. It is a security boundary (the app stores an AI API key in localStorage); it is not a sandbox. |
| Code in | `importer.js` (+ `mini.js`, `chords.js`, `convert.js`, `todrums.js`) | Reads Strudel code into modules. Anything it cannot express is **kept as written** in Strudel Code modules or reported as skipped; it never guesses. |
| Sync | `reconcile.js`, `textsync.js` | Edits to the code panel merge into the board. |
| Audio | `engine.js`, `evallock.js`, `wav.js`, `packs.js`, `soundfonts.js`, `drum-aliases.json` | `engine.js` wraps `initStrudel`, a safe-output limiter, the audio recorder (AudioWorklet to 16-bit WAV), sample-pack loading (github: packs only, consent remembered), preloading of the sample files a piece needs. `evallock.js` serialises the player's and the offline evaluator's `evaluate()` calls (they share Strudel's global names). |
| Offline query | `snapshot.js` (`queryPatch(code, cycles)`) | Evaluates compiled code with no sound and returns events. Used for pictures, rhythm snapshot and sound preloading. |
| Recording / import | `recorder.js`, `recordui.js`, `midiin.js`, `midifile.js`, `takecode.js` | Take module: notes recorded from a MIDI/computer keyboard or a `.mid` file, written back as a Strudel pattern. |
| UI | `main.js`, `board.js`, `rollview.js`, `views.js`, `codepanel.js`, `style.css` | Board and flow views, rolls, code panel, toolbar, modals. |

### Hard constraints (please respect when reviewing)

1. **The guard stays.** Nothing may evaluate code that has not passed `guardCode`. Features that need more code shapes extend the allow-list narrowly, with tests.
2. **No secrets leave the browser.** The AI key and settings must never be sent anywhere, in particular never into a shared room or a shared file.
3. **No downloads without consent.** Sample packs and anything fetched on behalf of pasted code need an explicit yes (existing pattern in the import dialog).
4. **Import fidelity.** A change to the importer needs a real-song replay test that shows the same events as the original.
5. **No framework, no build-time dependencies without a reason.** The bundle is plain JS; the deploy is static (Cloudflare Pages).

## 2. The theme

What makes Patchboard different from Max/MSP, Pure Data, VCV Rack, Bitwig Grid or strudel.cc itself is that **a Strudel pattern is a function of time that can be queried
anywhere, and its randomness is deterministic**. Features below lean on that: they would be awkward or impossible in a tool that only sees audio or values.

Order of work (rationale in each section):

1. A. Grab (capture a segment and loop it) — small/medium, high delight, reuses Take.
2. B. Pattern x-ray on cables — medium, makes the app's core idea visible.
3. C. Form map and Bake — medium, builds on A and B.
4. E. Cycle-based modulation — small, can be done at any time.
5. G1. Share a board (link/file) — small, no server.
6. F. Verified patch library — small/medium product work, needs G1.
7. G2/G3. Live co-editing and jam mode — large, needs a server.
8. D. Audio to pattern — largest and most uncertain; research first.

## 3. Features

### A. Grab: capture a segment of what is playing and loop it

**Idea.** The user presses Grab, picks a voice (a cable/module output) and a span ("the last 4 cycles", "the next 8"), and gets a **Take** (notes) or a hit/sample pattern (drums)
plugged into its own Instrument, repeating. Typical use: a random note generator produces something good; grab it and keep it.

**Why it is Strudel-specific.** No audio recording: the live pattern is queried for a cycle range (`engine.haps(a, b)` already exists, as does `engine.nowCycle()`), and because
`rand`, `sometimes`, `degradeBy` and friends are deterministic functions of time, **re-querying the past gives exactly what was heard** (if the patch has not changed since).

**Design.**
- New `queryPatch(code, cycles, { from })` (currently always starts at cycle 0), and a way to compile **only the sub-chain feeding a chosen node**
  (`compileUpTo(graph, nodeId)`: same compiler, that node as the end, no Output). Query that offline, relative to the live `nowCycle()`.
- Events -> existing `takecode.js` (`takeToPattern`) for notes; for sample/drum voices use the `todrums.js` approach (rows per sound) or a Hit Pattern.
- Quantisation choice (snap 4/12 like the recorder), velocity from gain/velocity.
- UI: a Grab button on a module's header (voice) plus a toolbar entry; a small dialog (span, snap, preview roll, "Add to board" / "Replace Take").
- Result is a normal Take module (so editing, Earlier takes and undo already work), named "Grab 1".

**Open questions.**
- If the patch changed after the moment being grabbed, say so in the dialog ("this is what the current patch would have played").
- Sliders and anything driven by wall-clock input are not reproducible; mark those voices.
- How to grab one voice when several voices share effects (query sub-chain without shared tail effects; they do not change which notes play).

**Tests.** Grab of a seeded-random Note chain equals the events the live evaluator produced over the same cycles; Take round-trips (import of compiled code). Pane check: grab and play the loop.

**Effort.** S/M.

### B. Pattern x-ray on every cable

**Idea.** Hover or pin a cable and see the events passing through it (small piano roll for notes, strip for rhythm, lanes for sounds), before and after each transform
(Slow, Every, Rev, Euclid, Late...). Answers "what did this module do to my pattern?"

**Design.**
- A tap is `compileUpTo(graph, wire.from)` (same helper as A) queried for a few cycles with `queryPatch`; draw with the existing roll/strip renderers (`rollview.js`, `snapshot.js drawSnapshot`).
- Cache by a hash of the sub-chain's code text; recompute only when that text changes (compile is deterministic).
- Cost control: budget per frame, 2 to 4 cycles, debounce on edits, never while the page is hidden. Offline evaluations take the `evallock` and so are serialised with the player.
- UI: hover popover, plus a "show all cables" mode that labels each cable with a thumbnail.

**Risks.** Offline evaluation of large chains may be slow (the Pyramid-style songs); needs measured limits and a timeout. Mute states must be honoured.

**Tests.** x-ray events for a known chain equal the events from compiling the same chain by hand; cache invalidation test.

**Effort.** M. Shares the sub-chain compile with A, so do A first.

### C. Form map and Bake

**Form map.** A zoomed-out view (a mode of the board or a drawer) of 32 to 128 cycles: one lane per voice, showing where each voice plays or changes, derived by querying each
voice's sub-chain over the range. Patterns like `<a b c>/16`, `mask("<0 0 1 1>/16")`, `arrange` show up as the **shape of the song** (intro, verse, drop). No live-coding tool draws this.
- Needs per-voice sub-chain queries (from A/B) and a density/activity summary per cycle (events per cycle, pitch range) rather than every note.
- Click a cycle to start playback there? (Strudel can start at an offset only by evaluating `.early()`; needs investigation, may be out of scope.)

**Bake.** On any chain containing randomness or conditional modules (`rand`, `sometimes`, `every`, `degrade`, Random Notes...), "Bake cycles 0..N" replaces the chain with a Take (or
sample pattern) of exactly what it plays over that range (same mechanism as A, but a replace-in-place on the board).
- Option: keep the original chain muted next to the baked Take so it can be undone or re-baked.

**Effort.** M (map), S after A (bake).

### D. Audio to pattern

**Idea.** Drop a WAV/MP3; get a drum pattern or Note Pattern. Precedent: the Codex script that made the "Made to Stray" rhythm from a recording (onset detection, 16th-grid snapping, per-hit velocity, recurring offsets).

**Design (research first).**
- In-browser: decode with Web Audio, onset detection (spectral flux) for rhythm; pitch tracking (autocorrelation/YIN) for monophonic melody; no polyphonic transcription in scope.
- Output: Take (events in beats), with the user choosing tempo (detect or tap) and snap. For percussion, classify onsets by spectral centroid into kick/snare/hat rows -> Drum Machine.
- Clearly labelled as approximate; show the detected onsets over the waveform so the user can correct.
- No upload anywhere; processing is local.

**Risks.** Quality is the whole product; unreliable detection will disappoint. Start with percussive loops only. File size limits and decode time.

**Effort.** L; do a one-week spike with a handful of real loops before committing.

### E. Cycle-based modulation

**Idea.** Wave/LFO modules speak in cycles and bars ("slow 13.5" is already cycles) but the UI shows a knob. Show the modulation as a curve over the cycles it spans, aligned with the song's timeline, and allow "sync to N bars".
**Design.** Mostly UI in the Wave module and the cable x-ray; `slow` values stay as they are in code. **Effort.** S.

### F. Verified patch library and safe sharing

**Idea.** Patches that pass the guard cannot run arbitrary code, unlike pasted strudel.cc code. Offer shared patches with: a "verified: plays the same as its code" check (the same replay used in tests), sample packs that ask first, a share link.
**Design.** Static first: a `patches/` folder of curated patches (JSON + the code), a browse dialog, import = existing import. Later: user-submitted via a server (G2).
**Risks.** Moderation and licences for songs; start with original/licensed examples only. **Effort.** S/M.

### G. Multiplayer

**Staging.**
- **G1. Share a board** (no server): the graph as a compressed URL fragment or file; opens as a copy. Include sample-pack requirements (shown, not auto-loaded). Strip anything that is not the graph (never settings or keys). **S.**
- **G2. Live co-editing rooms.** Everyone sees the same board with cursors/selection; edits merge. Use a CRDT (Yjs) over WebSocket. Server: Cloudflare Worker + Durable Object per room (the app already deploys on Cloudflare). The graph model is nodes/wires/params, so map it to a Y.Map of nodes and a Y.Array or Y.Map of wires; per-user undo (Yjs UndoManager) replaces `store.js` undo while in a room. **L.**
- **G3. Jam mode.** Shared tempo and **cycle clock**: the room hands out a start time (server time plus an offset estimate) so every browser's Strudel clock is cycle-aligned; each person hears their own audio. Edits apply **at the next cycle boundary** for everyone. Voice ownership: each player owns voices (mute/solo/gain per owner), a shared Output tempo. **L.**

**Security and privacy.** Rooms by unguessable id; graphs only (no settings, keys, AI chat); every received graph goes through `normalize` + `validateShape`, and code is compiled locally and guarded as always; rate limits and size caps in the Durable Object; no accounts in v1 (display name only). Sample packs in a received patch require the local user's consent.
**Costs/ops.** Durable Objects + WebSockets cost money at scale; abuse handling for public rooms (start with private invite links only).
**Open questions.** Clock alignment tolerance (probably within about 50 ms is fine for loop-based music; measure). What happens to a recording (record button) in a room: local only. Does the Take recorder (MIDI) stream to others? (no, grab/share the result.)

## 4. Cross-cutting work

- **Sub-chain compile** (`compileUpTo`) and **range queries** (`queryPatch` with a start): shared foundation for A, B, C. Do first, with tests.
- **Per-voice identity**: today's graph has no first-class "voice". The Output's inputs (or Stack/Mixer inputs) are the natural voices; define `voicesOf(graph)` once and use it for Grab, the form map and jam ownership.
- **Performance budget**: the offline evaluator is a single shared instance behind `evallock`. Add a simple scheduler (priority: player > grab > x-ray hover > map) and a timing log in the Audio health text (Settings).
- **Accessibility and mobile**: new views need keyboard access and a phone layout (the app targets phones too; the 760px breakpoint exists).

## 5. Known gaps and housekeeping (not part of the headline features)

- Uncommitted at time of writing: Slow/Fast accept several cables of one kind (`modules.js`, `graph.js` `whyNot`, `compile.js` `input()`, tests in `verify.mjs`) and the DJ-filter orbit warning (`compile.js`, `modules.js`).
- Corporeal: the same song sounds different in the app than on strudel.cc; not investigated.
- Importer: merging separate `$:` blocks; round-tripping partials written as mask patterns; fractional `.orbit()` stays as written.
- Take as a source for Harmonics / Note filter masks.
- `IDEAS.md` items: cables that route around modules, chord voicing options (dictionary/anchor), hover preview in the chord picker, the `drive`/fm-envelope effects.
- Programs written in JavaScript (custom `register(...)` functions, lookup tables; e.g. the Pyramid Song, a guitar-strum script) cannot become modules and the guard refuses them. A sandboxed "Script mode" was considered and **declined by the owner**; do not propose it again without a new reason.

## 6. What I would like Codex to challenge

1. Is the order right? Would you build x-ray (B) before Grab (A)? Is there a cheaper first step for either?
2. `compileUpTo`: is compiling a sub-chain with the same compiler (no Output) safe with shared effects, Mixers, Ducks and Orbits? What breaks?
3. Is re-querying the **past** really reproducible for everything in our module set (Random modules, `perlin`, `sometimes`, `mask` patterns, sliders)? Where does it silently differ?
4. Offline evaluation shares Strudel's global names with the player (we hit `.p is not a function` once; fixed by one shared Strudel and `evallock`). Is there a cleaner isolation that does not need the lock?
5. Multiplayer: Yjs+Durable Objects versus a simpler authoritative-server model with whole-graph last-writer-wins plus per-module locks. Which is less risky for a graph this size, and how would per-user undo work with each?
6. Cycle clock sync: is "server time + offset, start at a shared cycle boundary" enough with Strudel's scheduler (zyklus), or do we need to nudge the scheduler's origin? Any known pitfalls with `setcps` changes mid-room?
7. Audio to pattern: realistic quality targets for in-browser onset and pitch detection on percussive loops and monophonic bass lines; should this be a separate small tool first?
8. Anything in the guard design that will fight these features (for example Grab's code strings, shared graphs' code), and anything we are missing that a live-coding performer would expect.

## 7. Definition of done for each feature

- Works in the browser pane (verified by actually driving it, not only by tests), on desktop and a phone-width viewport.
- New code paths covered in `scripts/verify.mjs` (or a new suite) with real-song or seeded-random replays where the feature touches imports or queries.
- `npm test` green (verify, reconcile, guard); guard accepts everything the compiler writes.
- The module blurbs and the in-app hints explain the feature in plain language.
- No new network access without consent; no secrets in anything shared.
