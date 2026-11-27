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
Decision: `src/events.js` defines a versioned record: exact fractional positions (approximate and said so when too large), the event's SLOT in the pattern (`dur`; `gateOf` gives slot times clip, and the release is never added), every plain control and short list of plain values, the span, a code revision, the engine build, a kind (queried, inferred, corrected), carry-in/out flags, and a conversion to a Take that reports every loss. An event is an attack: later fragments of one event are folded into it. The picture code (`queryPatch`) is unchanged; new tools use `queryEvents`.
Consequences: nothing claims to be lossless unless the report says so. `exactNotes` is the narrower claim that the notes the pattern writer would emit are the Take's notes one for one (start, end, pitch, loudness, multiplicity), with one documented numerical tolerance (floating-point noise: 1e-6 of a cent, 1e-9 of loudness, a millionth of a grid step), no `freq` control over the note, no non-number gain, velocity or clip, and the written loop as long as the capture (a rest at the end is kept, a span that is not whole bars is reported); sound names and every other control are listed as lost. It is a claim about the written note field, not about what is heard. Capture is worded as pattern events, not as a recording. Revised after handoff 0002 (F1 to F3) and 0003 (F1, F2, F4: the record also names the tempo it was read at).

## D11. A cable tap is raw, and says what is outside it (2026-11-26)
Context: removing the Output and the tail changes Mixer, master and orbit effects (handoff 0001, F4).
Decision: `compileTap(graph, nodeId)` compiles the pattern as module `nodeId` leaves it, from the same compiler, with only that module wired to a neutral Output, and returns what lies outside the tap (downstream modules, master settings, Mixer, orbit/duck). A contextual "final voice" view is not built yet.
Consequences: a replay test shows that for every lesson with a neutral master and no Mixer or Duck, the taps of the voices together play exactly what the whole board plays. The master volume and master effects are removed from the tap as settings and as cables, and `outside` also names orbit numbers other active parts are clearly set to (an Orbit module or `.orbit(n)` in code). That routing analysis is labelled partial (`routing: 'partial'`): default-orbit peers and Duck between parts are not analysed, and a board with two Outputs is tapped with the first only (handoff 0002, F4 and F5; 0003, F6).

## D12. The x-ray holds back while music plays, and the playback gate fails closed (2026-11-26)
Context: a query runs on the same thread as the player's scheduler and cannot be interrupted. The repaired playback harness (handoff 0002, F7) showed that steady x-ray reading on heavy boards could cost skipped notes. The first version of the harness had read counters that could not move.
Decision: while music plays, the x-ray stops updating on its own once a reading took over 40 ms (it keeps the last picture, says why and offers a Refresh button). The playback gate (`scripts/perfjudge.mjs`) refuses to pass on missing or invalid evidence (no baseline, a null or non-finite measurement, an audio clock that was not read, a window that is not positive or differs from the baseline's) and is tested; a deliberate stall proves the counters move. The guard refuses patterns whose estimated size is over 50,000 events and absurd counts for fast, ply, chop, euclid and similar, including calculated and string counts and chains that multiply. These are admission limits, not proofs that a query is cheap: counts that are only known when the pattern runs are not bounded. The 40 ms and 25% numbers are guesses.
Consequences: any new background work on the main thread proves itself with `npm run perf:play` (a load plus `--compare`), and the 25% margin stays a provisional guess until more data exists. The loads call the same pausable refresh the panel uses, so a passing load can mean the queries paused: read the table with that in mind (handoff 0003, F9). Revised after handoff 0003 (F3, F7, F8, F9) and 0004 (F3, F5, F6: the gate also checks the baseline's own load, run counts and mandatory counters; an offline query restores the player's `cpm` method and time source). Open for the owner: whether inspection while playing should show only a cached picture until Refresh is pressed.

## D13. The build order from the 0001 review is adopted (2026-11-26)
Context: handoff 0001 proposed an order and the owner had not yet approved it. Handoffs 0002 to 0004 hardened the first steps.
Decision: the owner adopted this order: (1) the prerequisites still open from review: contextual final-voice tap, benchmarks for dense chains, long Takes and live edits, phone and long-session runs, x-ray keyboard and screen-reader testing, the Corporeal audio-parity check (needs the song code from the owner), and the small leftovers (x-ray scheduling test, trigger hook, labelled PERF tables); (2) Grab and Bake; (3) cycle-based modulation; (4) the patch library with evidence labels and share-a-board (G1); (5) the bounded form map; (6) co-editing rooms (G2); (7) jam mode (G3). Audio-to-pattern stays separate research. Feature H (Sample Source), the audio-analysis editor and cached-only x-ray while playing remain the owner's open decisions.
Consequences: no step starts before the one above it is done or the owner says to skip it; each step follows the definition of done in ROADMAP section 7 and needs its own handoff review where it touches the guard, security, cost or scope. Source: owner, 2026-11-26.

## D14. Grab, Bake, share links, evidence labels and the form map were built without a Codex review (2026-11-26)
Context: after D13 the owner asked for as much of the list as possible while Codex was out of usage. Handoffs 0001 to 0004 had each found real defects in work built without a second look.
Decision: build them anyway, small and bounded, each with tests and a browser check, and queue one handoff (0005) so Codex attacks them first when it returns. Choices made without review: (1) Grab and Bake read through the same offline query and tap as the x-ray, so they carry the same limits (raw tap, current code, live Slider values); (2) Bake only appears on modules whose output is notes, because a Take cannot stand in for a voice that has a sound; the original is kept unconnected, not deleted; (3) sample hits are written as `s("...")` rows on the smallest grid that holds every hit, keeping sound and timing only; (4) a share link carries only the graph, is capped at 24,000 characters and 1.5 MB unpacked, and never loads without the person choosing; unsafe code inside a shared board is left out by the compiler and reported; (5) the evidence labels are exactly two (guard accepted, read-back replay over 8 cycles) plus an explicit "not checked" line; (6) the form map evaluates each voice once, reads it in chunks of 4 cycles with a pause between, and stops reading a voice after about 2.5 s (the playback gate passes with the form map re-reading every 3 s; see docs/PERF.md).
Consequences: none of these is called finished until handoff 0005 is answered and ingested. G2 and G3 were not started: they need a server and a design review first. Source: owner, 2026-11-26.

## D15. Reads that cannot be interrupted do not start by themselves while music plays; boards have an expansion limit; claims match checks (2026-11-26)
Context: handoff 0005 (Codex's review of the D14 builds) showed a Grab opening on a dense board skipped playing notes, a share link of 15 modules asked for hundreds of milliseconds of compiling before any choice, and several windows claimed more than their checks (a Take that lost a trailing bar, a read-back that rounded).
Decision: (1) Grab, Bake and the form map read nothing while music plays until the person presses a button, and say a note may come late; (2) `compile()` refuses a board whose cables make the compiler write modules more than 5,000 times (counted on the graph first), for share links, files and imports alike; (3) a capture's report is about the Take that is really stored (2,000-note cap, thousandths of a beat, length), and Add is off when it would lose notes; (4) the read-back label compares start, slot and every control; (5) the form map says "starts notes", not "plays".
Consequences: D14's "not finished until reviewed and ingested" stands for these fixes, which Codex has not re-checked. The cached-only x-ray decision (D12) is still the owner's. Source: handoff 0005, 2026-11-26.

