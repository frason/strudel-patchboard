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
Decision: Grab, then pattern x-ray, then form map and Bake; modulation in cycles; share-a-board; verified library; multiplayer in stages; audio to pattern last (research first). Pending review by Codex (handoff 0001).
Consequences: the sub-chain compile and range query are built first because three features need them.

## D8. A module becomes importable only in shapes it writes back exactly (2026-11-26)
Context: ten transform modules were added (Mask, Chop, Loop at, When, Superimpose, Off, Jux, Echo, Iter, Add notes). Transforms import ahead of the instrument, so a call whose result depends on call order (Echo sets gain, Jux sets pan, Chop/Loop at set begin/end/speed) can change meaning.
Decision: the importer makes a module only when the line has no other call that sets the same thing; otherwise the call is kept as written.
Consequences: such lines show as Strudel Code modules, not knobs. The tests replay both forms against real Strudel.
