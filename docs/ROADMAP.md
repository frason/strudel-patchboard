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

**Why it is Strudel-specific.** No audio recording: the live pattern is queried for a cycle range (`engine.haps(a, b)` already exists, as does `engine.nowCycle()`), and `rand`, `sometimes`, `degradeBy` and friends are deterministic functions of time, so a fixed range can be queried again and again with the same events. *Review correction (handoff 0001, F5):* this is **not a recording of what was heard**. Patch revisions, Slider gestures, tempo, skipped scheduling, missing samples and effect tails are outside it. Grab captures **pattern events over an explicit fixed range under a frozen revision and control snapshot**, and says so; three pure cases were tested at cycles 17 to 21, not every module.

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

**Idea.** Drop a WAV/MP3; get a drum pattern or Note Pattern. Precedent: the Codex work that made the "Made to Stray" rhythm from a recording went beyond a 16th-grid snap (recurring offsets, per-hit velocity); a separate research project (`experiments/youtube-strudel`, not in this repo) explores microphone recording, local separation and pitch/onset estimation. Heavy models stay outside the static app.

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

- Done since this was written (2026-11-26): ten transform modules (Appendix A), the handoff system (`docs/handoff/`, `AGENTS.md`, `CLAUDE.md`, `scripts/handoff.mjs`). Slow/Fast several-cable input and the DJ-filter orbit warning are committed (235ff21).
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

- **Performance is the first gate** (handoff 0001, F1; the owner's number-one KPI): playback must not miss deadlines while the feature runs. Measure before and after: playback deadline misses and underruns, p95/p99 interaction and evaluation latency, main-thread long tasks, queue depth, heap and decoded-audio growth, compressed bundle delta, on a desktop and a phone baseline. Optional work is bounded, cancellable or coalesced, visibility-aware and idle when unused; a feature that exceeds its budget is simplified or deferred.

- Works in the browser pane (verified by actually driving it, not only by tests), on desktop and a phone-width viewport.
- New code paths covered in `scripts/verify.mjs` (or a new suite) with real-song or seeded-random replays where the feature touches imports or queries.
- `npm test` green (verify, reconcile, guard); guard accepts everything the compiler writes.
- The module blurbs and the in-app hints explain the feature in plain language.
- No new network access without consent; no secrets in anything shared.

## Appendix A. Module gap ranking and the ten modules built first (2026-11-26)

The app had 64 modules; Strudel's pattern methods number about 920 raw names (aliases and sound controls included), of which the code check lets 251 through as text.
Raw counts overstate the gap, so the ranking below is by use, not by count.

**Evidence.** Calls without a module in the seven real songs kept under `tools/` (only seven, so treat as a weak signal): `mask` 2 songs / 4 calls; `dict`, `offset`, `set` (chord voicing) 2 songs; `when`, `loopAt`, `chop`,
`superimpose`, `add`, `euclidRot`, `end`, `lpe`, `dt`, `dfb` 1 song each. Songs seen earlier in conversation but not saved (Pyramid Song, a guitar-strum script) leaned on `pick`/`pickOut`/`pickRestart`, `jux`, `layer`, custom `register` functions (refused by design, DECISIONS D2).
Ranking also uses how prominent each function is in everyday Strudel patches (my judgement, not measured).

| Rank | Function | Why | Status |
|---|---|---|---|
| 1 | `mask` | 2 of 7 songs, 4 calls; the basic "bring a part in later" tool | built: Mask |
| 2 | `chop`, `striate` | sample/break work (46 Cycles); no other way to slice from the board | built: Chop |
| 3 | `loopAt` | pairs with Chop for breaks | built: Loop at |
| 4 | `when` | 46 Cycles; generalises Every N to chosen cycles | built: When (function choices shared with Every N) |
| 5 | `superimpose` | common thickening trick | built: Superimpose |
| 6 | `off` | very common harmony/echo layer | built: Off |
| 7 | `jux`, `juxBy` | very common stereo width | built: Jux |
| 8 | `echo` | echoes of the pattern itself | built: Echo |
| 9 | `iter`, `iterBack` | rotating melodies | built: Iter |
| 10 | `add(note(...))` | Oleander; moves a riff through a progression | built: Add notes |

**Second batch (2026-11-27, D20).** Built: `segment` (Segment), `linger` (Linger), `hurry` (Hurry), `chunk`/`chunkBack` (Chunk), `inside`/`outside` (Inside), `pressBy`/`press` (Press), `palindrome` (Palindrome); `euclidRot`/`euclidLegato`/`euclidLegatoRot` as Rotate and "hits last" on Euclid; `begin`/`end` as settings on Sample; chord voicing options (`dict`, `anchor`, `offset`, `octaves`, and `mode` beyond the three registers) on the Chord Sequencer. `rolled` was dropped: the Strudel version the app runs (core 1.2.6) has no `rolled`, and a negative `linger` fails there too, so Linger holds 1/16 to 1. Found on the way: `chord("<C Am>/2")` lost its slowdown on import (fixed).
**Next candidates** (not built): chord voicing options `dict`/`anchor`/`offset`/`mode` (3 songs, and an `IDEAS.md` item); `pick`/`pickOut`/`pickRestart` (table lookups; needs a design for the table values);
`slice`/`splice`; `linger`; `hurry`; `chunk`; `inside`/`outside`; `rolled`; `press`; `segment`; `euclidRot`/`euclidLegato` as options on Euclid; `begin`/`end` on Sample; `velocity` on samples; `whenKey`; `stut` as an alias of Echo.

**How the ten work (for reviewers).**
- Defined in `src/modules.js` (all `cat: 'transform'`, bypassed when muted) with `LAYER_FNS`, a small shared list of functions (reverse, fast, slow, repeat, octave, fifth, a hair later) used by When, Superimpose, Off and Jux (same text as Every N writes).
- One table `CALLS` in `src/compile.js` writes each module's single method call.
- `applyCall` in `src/importer.js` reads each call back into a module only in the exact shapes the module can write. Anything else stays as written in a Strudel Code module. Echo (sets the volume) and Jux (sets the pan) are never made modules on a line that also sets gain/pan, because the order of such calls decides the result; Chop and Loop at likewise when `begin`/`end`/`speed`/`unit` or each other are on the line.
- `scripts/verify.mjs`: each module plays exactly what the same call written by hand plays, its code reads back into the same module and settings, and the order-sensitive cases play the same as the original.
- Known weakness: transforms import into the chain *before* the instrument (the existing design), which is why the order-sensitive cases above fall back to code.

## 8. Changes from review (handoff 0001, ingested 2026-11-26)

Codex reviewed this roadmap on `codex/youtube-strudel` (commit 16f3cde). The full answer and the decision on each finding are in `docs/handoff/0001-roadmap-review.md`. What changed:

1. **Fixed already:** offline queries no longer share the live Slider store (finding F2; `src/slider.js`, `src/snapshot.js`, tests, browser check).
2. **Performance baseline first.** Extend `scripts/perf.mjs` (today it measures pictures with nothing playing) to measure playback under inspection load before building any feature that queries.
3. **Event contract before Grab and Bake.** A small versioned event record: cycle positions kept rational, the queried span, resolved controls, provenance (queried, inferred, hand-corrected), gate length kept separate from release, defined carry-in/out at range edges, and a report of every lossy conversion. Take is reused where compatible and is not claimed lossless (an overlapping Take note is shortened today).
4. **Two tap views.** `compileUpTo` becomes a raw cable tap and a contextual final voice, from one compiler. It must follow parameter inputs and keys, the effective Mixer/Output state, Duck and orbit relationships, and must preserve call order for the new transforms. Fixture matrix before use.
5. **Query cost.** Cache identity includes the range, a control snapshot and the engine version. Work is coalesced, bounded and visibility-aware. Deferred: all-cable thumbnails, 128-cycle scans. Task: bound expanded mini-notation in the guard (`bd*1000000` passes today). Research only: a Worker query realm (D4 stands).
6. **Project document before sharing** (G1): a versioned envelope, size caps before parsing, allow-list export, graph-only export described honestly, last-valid playable revision.
7. **Rooms** (G2): authoritative operation stream in a Durable Object, conflict-checked inverse undo, capability roles and limits; Yjs only if offline merge becomes a requirement. **Jam clock** (G3): one transport epoch, revision-tagged apply boundaries, fixed global tempo first; the earlier "within about 50 ms" figure is withdrawn until measured.
8. **Order adopted by the owner on 2026-11-26 (D13):** performance baseline + event contract + audio-parity check (Corporeal) -> one pinned read-only x-ray (with cycle-based modulation) -> Grab and Bake -> file sharing and curated library with evidence labels -> bounded form map -> co-editing -> jam. Audio-to-pattern continues as separate research.
9. **Evidence labels for the library:** guard accepted; event round trip passed over N cycles on a named engine; required samples available; audio auditioned. Finite replay is not proof for all cycles or identical sound.
10. **Performer needs added to the definition of done:** stable playback during inspection, a visible last-valid revision, edits applied at musical boundaries, headroom feedback, missing-sample recovery, keyboard access.

### H. Sample Source module for audio files (proposed, needs the owner)
A Sample Source from a local WAV or a GitHub audio-file link: replay, waveform, trim, then separate actions to play/loop/chop it or to analyse it into editable events. Extends the consented asset registry; no user JavaScript that fetches. GitHub file/raw links only, validated host and type, size caps for download and decoded audio, one cached buffer and waveform per content hash, saved URL + trim + pinned revision or hash (not local bytes), explicit Refresh and Pin, no silent polling, no tokens in shared boards. Untested: CORS, codecs, private repos.

## Appendix B. Event-centred ideas (ranked research list, none authorised)
1. Event explanation: "why this note?" (source step through transpose/repeat/nudge in a few supported chains; unknown lineage marked). 2. Musical diff and protected parts (added/removed/moved events before an edit applies; lock a voice). 3. Direct editing of the result with a preview of the source edit, or an explicit override or Bake where the chain is not invertible. 4. Constrained variation (keep these hits, change the last cycle, stay below C3). 5. Rhythm borrowing from corrected attack markers. 6. Future pattern relationships (alignments, collisions, gaps) over a bounded horizon. Event explanation and musical diff extend the x-ray first; keyboard access and a phone interaction are required, not hover-only.

## 9. Built since the review (2026-11-26)
- Playback performance harness: `scripts/cdp.mjs` (shared headless-Chrome plumbing, also used by `scripts/perf.mjs`) and `scripts/perf-play.mjs` (`npm run perf:play`): presses play on real boards and measures skipped notes, audio underruns, page stalls, long tasks, CPU, frame time and heap, with an optional load running while it plays and a `--compare` against a saved run. Numbers and method: `docs/PERF.md`. Audio health in Settings now shows underruns.
- Event record (`src/events.js`, `queryEvents` in `src/snapshot.js`), raw cable tap (`compileTap` in `src/compile.js`), and a pinned read-only x-ray (`src/xray.js`, "Show what comes out" in a module's menu). Tests in `scripts/verify.mjs`.
- Handoff 0002 (Codex's review of the above) was ingested the same day: fragment/slot/carry/loss semantics of the event record, the master-cable and shared-orbit tap fixes, queries applying captured Slider values, the guard's expansion limits, a repaired and tested playback gate (with a deliberate-stall self-test), an x-ray that holds back while music plays, stronger Feature test assertions and scoped AI-docs claims. See `docs/handoff/0002-review-the-event-record-raw-tap-and-x-ray.md`, DECISIONS D10 to D12 and `docs/PERF.md`.
- Handoff 0004 (ingested 2026-11-26): offline queries restore the player's `cpm` method and time source; captures keep a trailing rest (`take.length`); guard reads exact divisors and exponent/curly mini rates; the gate validates the baseline's load, run counts and mandatory counters; the x-ray cost sums every synchronous phase; tap peers must be active and effective. Open: cached-only inspection while playing (owner), trigger hook, DOM fake for x-ray scheduling.
- Built after the order was adopted (D13/D14, 2026-11-26, while Codex was unavailable, so NOT yet reviewed by Codex; see handoff 0005):
  - **Grab** (`src/grab.js`, `src/grabui.js`, "Grab..." in a module's menu): a span of a module's output becomes a Take (notes) or a Strudel Code (pattern) of `s("...")` rows (sample hits), with a loss report; the window says it is a replay of the current board, not a recording.
  - **Bake** ("Bake..." on a notes module): the same read, written as a Take that takes the module's place on its cables; the original stays, unconnected. Undoable.
  - **Cycle-based modulation (E, first part):** the Wave preview shows a tick and number for every cycle of its sweep.
  - **Share a board (G1)** (`src/share.js`): Export, "Copy a share link"; opening a link shows a dialog and loads nothing until chosen; size caps while unpacking; **evidence labels** (`src/evidence.js`): guard accepted, and read-back replay over 8 cycles on a named engine, each saying what it did not check.
  - **Form map** (`src/formmap.js`, "Song form map..." on the Output): lanes by voice, a cell per cycle, evaluated once per voice and read in chunks of 4 cycles with a per-voice time budget; the playback gate passes with it re-reading every 3 s.
  - Leftovers closed: the shared trigger hook is restored after a query; a stand-in-page test of the x-ray's scheduling; the x-ray reads one cycle first and keeps only that when it is already slow; `npm run bench:query` and its table in docs/PERF.md; the older PERF tables are labelled as historical.
  - Not built: G2 co-editing rooms and G3 jam mode (need a server and their own design review), the contextual final-voice tap, the "show all cables" x-ray, the Corporeal audio-parity check (needs the song code), phone and long-session runs, screen-reader testing of the new windows.
- Still to do from section 8: the contextual final-voice tap, benchmarks of live edits while playing (whole-board dense chains and long Takes are now in docs/PERF.md, `npm run bench:board`), a phone and a long-session run, keyboard and screen-reader testing of the x-ray (dialogs done, see above), the audio-parity check (Corporeal; the song itself is not in the repo, so it needs the code from the owner), then Grab and Bake.
- Handoff 0005 (Codex's review of the D14 builds, ingested 2026-11-26): Take length and storage checks on Grab/Bake, banked hits, no reads while playing until pressed, the expansion limit on compile, the stricter read-back label, form map incomplete marks; see DECISIONS D15. Not yet re-checked by Codex.
- Handoff 0006 (Codex verifying the 0005 fixes, ingested 2026-11-26): Take versions keep their length, automatic Grab reads recheck at their turn, cached patterns restore their Sliders, the expansion count skips ignored cables and `compile()` stops at the guard's size, merged notes are counted, the form-map outline is drawn after the fill, bank types are reported. Decision D16. Not yet re-checked by Codex or in a browser.
- Curated library (D17, built 2026-11-26): `library/*.json` bundled boards, `src/library.js`, Learn menu > "Library of boards..." with evidence checks and Open a copy; four seed boards. Not yet reviewed by Codex (handoff 0007).
- Whole-board benchmark (2026-11-26, `npm run bench:board`, docs/PERF.md): compile and guard are cheap; a 2,000-note Take reads in about 90 ms; a chain of ten `fast` modules is admitted and takes 1.2 s to read and 3.7 s to map. **Open for the owner:** the guard's limit of 50,000 events per cycle is far above what a reading can take comfortably; lowering it would refuse boards that load today (not done).
- Dialog keyboard and screen-reader basics (2026-11-26, `showModal` in main.js): every window is `aria-modal`, named by its heading, takes focus when it opens (first field, else first button), keeps Tab inside, and gives focus back to the control that opened it on close (Escape already closed it). Checked in the dev server with the Library dialog using dispatched key events (not a real screen reader, not a physical keyboard); not unit-tested because the handlers live in main.js. Still open: the x-ray's own keyboard path, a real screen-reader pass, focus inside the Record window (it captures keys).
- Handoff 0003 (Codex's check of those fixes, ingested 2026-11-26): the Take report now compares the notes the writer really emits (start, end, pitch, loudness, multiplicity), the guard folds calculated and string counts and bounds chains, offline queries use the patch's own tempo and restore the player's hooks, the playback judge refuses invalid or missing evidence and the harness rejects a bad window before starting Chrome, the x-ray drops stale readings and returns focus, and the tap's routing is labelled partial. Open from it: a DOM fake to test the x-ray's scheduling, restoring the shared trigger hook, pattern-valued counts in the guard, default-orbit and Duck analysis for the tap.
- 0007 fixes (2026-11-27, D18): initial and queued Grab and map reads are admitted at their turn; the size budget counts layout; library entries get a size limit, safe metadata and visible omissions; a Take version keeps its grid; the benchmark prints cycles read. The guard's per-cycle limit is now 1,024 (D19, owner approved) with a plain refusal and an AI clean-up offer. Still open: the fuller estimate (reciprocal rates, separate lines, callbacks are not summed), so 1,024 is not a total bound.

