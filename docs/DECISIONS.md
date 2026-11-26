# Decisions

One entry per decision that should survive a long conversation. Newest last. Format: context, decision, consequences, source.

## D1. The guard is an allow-list for text the app writes, not a sandbox (2026-11)
Context: pasted Strudel code is evaluated in the page, which also holds an AI key in localStorage.
Decision: every code string must pass `src/guard.js` (parse; only compiler-shaped calls, a fixed method list, one-argument arrows up to three deep) before it is evaluated.
Consequences: programs with their own functions or lookup tables (custom `register(...)`, objects, `s[0]` indexing) are refused and stay in strudel.cc.

## D2. No "Script mode" for arbitrary JavaScript (2026-11, owner)
Context: songs such as the Pyramid Song and a guitar-strum script cannot become modules. A sandboxed iframe running them was offered.
Decision: declined by the owner. Do not propose it again without a new reason.
Consequences: such pieces are opened in strudel.cc; the importer says why they cannot be imported.

## D3. Import fidelity is proven by replay (2026-11)
Context: the importer is judged by whether the board plays what the original code plays.
Decision: each real song under `tools/*.strudel` is replayed in `scripts/verify.mjs` against its import (events over N cycles in real Strudel). A kept call must stay behind any call that changes when notes happen (signals and patterns are read at each note's moment).
Consequences: new importer or compiler behaviour needs a song or seeded case in `verify.mjs`.

## D4. One Strudel for the player and the offline evaluator (2026-11)
Context: a second copy of Strudel replaced the shared global names and broke the player ("stack(...).p is not a function"), silencing drums.
Decision: the offline evaluator uses the same Strudel as the player in the browser and every evaluation takes a turn (`src/evallock.js`).
Consequences: no concurrent evaluations; any new use of `queryPatch` goes through the lock.

## D5. Sample packs ask first (2026-11)
Context: pasted code can name `samples('github:user/repo')`.
Decision: only `github:user/repo[/branch]` is accepted, never downloaded without a yes in the import dialog, remembered per pack.
Consequences: a shared patch never auto-loads sound files; the play button becomes a progress bar while a piece's files download.

## D6. The DJ filter is an orbit effect (2026-11)
Context: in Strudel `djf` filters the whole orbit, so a wave driving it also filtered the drums.
Decision: keep Strudel's behaviour, warn in the app when other sounds share the orbit, and say to put an Orbit module in front.
Consequences: Orbit is the way to isolate delay, reverb and DJ filter per part.

## D7. Roadmap order (2026-11-25)
Context: ideas gathered into `docs/ROADMAP.md`.
Decision: Grab, then pattern x-ray, then form map and Bake; modulation in cycles; share-a-board; verified library; multiplayer in stages; audio to pattern last (research first). **Superseded** by the reviewed order in ROADMAP section 8 (handoff 0001, finding F7). The owner asked to start building on the recommendations and Codex's review (2026-11-26), so the reviewed order is adopted: performance baseline + event contract + raw tap -> one pinned x-ray -> Grab and Bake -> file sharing and library -> form map -> co-editing -> jam. Still open for the owner: the Sample Source module (H) and bringing the audio-analysis editor into Patchboard.
Consequences: the sub-chain compile and range query are built first because three features need them.

## D8. A module becomes importable only in shapes it writes back exactly (2026-11-26)
Context: ten transform modules were added (Mask, Chop, Loop at, When, Superimpose, Off, Jux, Echo, Iter, Add notes). Transforms import ahead of the instrument, so a call whose result depends on call order (Echo sets gain, Jux sets pan, Chop/Loop at set begin/end/speed) can change meaning.
Decision: the importer makes a module only when the line has no other call that sets the same thing; otherwise the call is kept as written.
Consequences: such lines show as Strudel Code modules, not knobs. The tests replay both forms against real Strudel.

## D9. The offline evaluator has its own Slider store (2026-11-26)
Context: offline queries wrote Slider values into the store the player reads (handoff 0001, F2), and the global `sliderWithID` is shared by name.
Decision: `makeSliderWithID(ref, store)`; the offline evaluator uses its own store and installs its `sliderWithID` only while a query runs, inside `exclusive()`, then restores the player's.
Consequences: pictures and download lists can never reset a Slider held by the person; D4 (one Strudel, one lock) stands.

## D10. The event record is the one contract for inspection and capture (2026-11-26)
Context: the x-ray, Grab, Bake and the form map all need "what does this pattern play over these cycles", and the old snapshot kept only a few fields (handoff 0001, F3).
Decision: `src/events.js` defines a versioned record: exact fractional positions, event length (gate) separate from the controls that include release, every plain control, the span, a code revision, the engine build, a kind (queried, inferred, corrected), carry-in/out flags, and a conversion to a Take that reports every loss. The picture code (`queryPatch`) is unchanged; new tools use `queryEvents`.
Consequences: nothing claims to be lossless unless the report says so; capture is worded as pattern events, not as a recording.

## D11. A cable tap is raw, and says what is outside it (2026-11-26)
Context: removing the Output and the tail changes Mixer, master and orbit effects (handoff 0001, F4).
Decision: `compileTap(graph, nodeId)` compiles the pattern as module `nodeId` leaves it, from the same compiler, with only that module wired to a neutral Output, and returns what lies outside the tap (downstream modules, master settings, Mixer, orbit/duck). A contextual "final voice" view is not built yet.
Consequences: a replay test shows that for every lesson with a neutral master and no Mixer or Duck, the taps of the voices together play exactly what the whole board plays.

