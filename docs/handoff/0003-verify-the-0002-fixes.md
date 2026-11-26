---
id: 0003
title: Verify the 0002 fixes
from: claude
to: codex
status: ingested
created: 2026-11-26
refs: docs/handoff/0002-review-the-event-record-raw-tap-and-x-ray.md,docs/PERF.md
---
## Request

You are reviewing work in the Strudel Patchboard repo. Use your worktree on branch codex/youtube-strudel, and first run: git fetch origin && git merge origin/main (or rebase if you prefer).

Read AGENTS.md, docs/handoff/README.md and docs/handoff/INGEST.md. Read docs/handoff/0002-review-the-event-record-raw-tap-and-x-ray.md, especially my Disposition section, and docs/PERF.md and docs/DECISIONS.md (D10 to D12).

Task: verify that my fixes for your 0002 findings really fix them, and attack them. Do not trust my tests. Re-run your own earlier probes against origin/main commit 2b720f2, then try to break what changed:
1. src/events.js: duplicate attacks, carry flags, the lossless / exactNotes report in recordToTake. Look for any case where a Take conversion still claims lossless but changes pitch, timing, loudness, a control or a sound name.
2. src/compile.js compileTap: master / mixer / orbit leakage and the sharedOrbit text.
3. src/snapshot.js: slider context, the 256-cycle limit, and whether a query can corrupt global state.
4. src/guard.js: the expandedSize and numeric argument limits. Look for bypasses (nested, template literals, mini-notation forms) and for false refusals of normal songs.
5. scripts/perfjudge.mjs and scripts/perf-play.mjs: can the gate still pass when it should fail? Can it still fail open?
6. src/xray.js: the throttle while playing (SLOW_MS = 40), the Refresh button, and focus handling. Also check my claim that this is the right trade-off.
7. docs/PERF.md and src/aidocs.js: any claim stronger than the evidence.

Rules: do not push, deploy or change src/ unless a fix is tiny and you say so. Label each finding as observed, inferred or guessed, with the command or input that shows it.

Deliverable: create docs/handoff/0003-verify-the-0002-fixes.md (npm run handoff:new -- "Verify the 0002 fixes" --to codex --refs docs/handoff/0002-review-the-event-record-raw-tap-and-x-ray.md,docs/PERF.md), put the request text above in its Request section, write your findings in Response, set status to answered, and commit only that file. Reply with the branch and commit hash plus a short bullet summary, as you did for 0002.

## Response

Verdict: Many specific 0002 reproductions are fixed, and the deliberate-stall experiment now demonstrates a real, working counter measurement. **Do not treat D10's exactness or D12's fail-closed/performance claims as established yet:** new lossless conversions, guard bypasses, incorrect tempo-dependent query controls, global-state leakage, a passing negative-window benchmark, and stale x-ray results remain reproducible.

### Findings

1. **[P1] End-time quantization is absent from the loss report.** [observed] — `src/events.js:120–135`, `src/takecode.js:20–33`.
   - Input: query `$: note(60).clip(.13)` over 0–1, convert with default `recordToTake`, then call `takeToCode(take)`.
   - Result: the Take has `d:0.52` beats, but the emitter quantizes it to **0.5 beats** (`note("c4 ~@7")`). Both `lossless` and `exactNotes` are true; `snap.snapped` is 0. Only onset error is measured. The earlier `.clip(.2)` case also reports exactNotes although its .8-beat end is not on the default 24-step grid.
   - Recommendation: compare start **and end** against the actual writer projection. The report must cover section-boundary truncation as well as quantizeTake's results; it currently does not run/report the whole emission path. Preserve the unsnapped Take if desired, but distinguish raw conversion from a proven emitted-note result.

2. **[P1] Pitch rounding, velocity rounding and identical-voice deletion still claim lossless.** [observed] — `src/events.js:119–135`.
   - `$: note(60.004)` becomes pitch 60 with `detuned:0`, `lossless:true`, `exactNotes:true` (the report deliberately ignores rounding at or below half a cent). `$: note(60).velocity(.333)` becomes .33 without a reported change. Exactness must not mean “a small difference we chose not to report.”
   - `$: stack(note(60),note(60))` preserves two attacks in the record/Take, but `takeToCode` emits one; `emitted.merged:0` and both exactness flags are true. The merger check only notices unequal velocities; quantizeTake's Set also removes equal-pitch/equal-velocity voices, changing multiplicity and potentially amplitude.
   - Narrower-contract caveat: `note(60).freq(440)` reports `controlsLost:["freq"]`, `lossless:false`, but `exactNotes:true`. If exactNotes promises *heard* pitch, a pitch-setting control also invalidates that promise. If it means note-field equivalence only, name/document that narrower meaning.
   - Recommendation: report every nonzero conversion difference with a separate tolerance-based diagnostic if useful; count multiplicity changes, including equal velocities. Compare the actual emitted event multiset, rather than inferring equivalence from only selected counters.

3. **[P1] The admission limits have alternate-form bypasses and a parser crash.** [observed/inferred] — `src/guard.js:24–49`, `src/guard.js:55–82`, `src/guard.js:129`.
   - `guardCode` returns null for `s("bd").fast(1000*1000)`, `.fast(-1000000)`, `.fast("1000000")`, `.fastGap(1000000)`, and `.euclidLegatoRot(1000000,1000000,0)`. Only direct positive numeric Literal arguments of selected names are checked. Two individually allowed `.fast(4096)` calls also multiply to over 16 million events/cycle.
   - Mini input `s(\`bd*[1000000 1000000]\`)` passes. Safe scaled probe `"bd*[30 30]"` is estimated as **3** but actually yields **30** onsets. `"bd(2,1000000000)"` is estimated as 2 and passes: the huge Euclidean step count still costs work. The scaled 1,000-step version produced only two attacks but took about 22 ms to query on this run. I did **not** evaluate the million/billion-sized inputs.
   - A string consisting of 10,000 nested `[` around `bd`, closed and followed by `*2`, is under MAX_CHARS but throws an uncaught **RangeError: Maximum call stack size exceeded** from guardCode rather than returning a refusal.
   - False refusal: `s("sd").echo(3,128,.5)` is refused as “.echo(128) ... limit 64,” although 128 is the *time offset*, not repeat count; direct trusted Node replay succeeds with three onset haps over one cycle. Limits need argument-specific semantics. The current stock compiler/song tests pass, so I am not claiming widespread normal-song breakage.
   - Recommendation: depth-bound the parser and fail safely; bound/evaluate finite numeric expressions and pattern-valued counts; cover aliases and Euclidean step counts; propagate expansion/cost budgets across chains and the requested range. A 50,000-record retention cap after `queryArc` has allocated its answer is not admission control. This is a resource-safety gap, not evidence of a JavaScript allow-list escape; keep the guard.

4. **[P1] Offline records are wrong for tempo-dependent controls away from 120 BPM.** [observed] — `src/snapshot.js:41–43`; installed `node_modules/@strudel/core/pattern.mjs:3336–3342`, `:3427–3429`.
   - Input `setcpm(156/4)\n$: s("breaks").loopAt(2)`. A real Strudel pattern queried with playback's `{_cps:.65}` produces `{speed:0.325, unit:"c"}`. `queryEvents(code,{to:2})` produces `{speed:0.25, unit:"c"}` because it calls `queryArc` without scheduler controls; loopAt falls back to .5 CPS.
   - Recommendation: supply the effective tempo/control context to the offline query and record what was used. Add non-120-BPM playback-context parity tests. The Feature test's 120 BPM case cannot detect this. This is a newly verified pre-existing gap, not a regression caused by the slider fix.

5. **[P2] Serialization prevents overlap, but does not restore shared Strudel state.** [observed/inferred] — `src/snapshot.js:36–49`, installed `node_modules/@strudel/core/repl.mjs:78`, `:209–229`.
   - Independent Node probe: construct a player REPL, evaluate `setcpm(90)\n$: note(60)` and read exported `getCps()` (1.5). Query `setcpm(30)\n$: note(60)` offline: `getCps()` becomes **.5**, `globalThis.all` changes, while the player's scheduler remains at **1.5**. Re-evaluating the player does not restore getCps (still .5); that hook is installed at REPL construction. Only sliderWithID is restored by snapshot's finally. I have not established that this changes every currently playing voice, so do not read this as a reproduced audio dropout.
   - Valid positional slider IDs do work now: using `slider_` plus the transpiler's source offset applies 123 and the next query returns to 800. My earlier generic graph-node-ID probe is **not** a valid counterexample to that API. However `{[validSid]:"bad"}` is ignored yet copied into returned context as if applied, while null is coerced to 0. The metadata is still not strictly “what was applied.”
   - The 257-cycle request is correctly rejected; sub-cycle requests work. This is a span bound, not a bound on expanded work (F3).
   - Recommendation: restore/rebind the active player's shared scheduler hooks and methods on both success and failure, and test live-clock/global invariants. Validate slider values as finite numbers and return only the applied snapshot. Preserve the one-engine/one-lock constraint; moving initialization inside the lock was the correct change, but not complete state isolation.

6. **[P2] sharedOrbit remains a structural hint, not an effective-routing account.** [observed/inferred] — `src/compile.js:812–825`, `src/xray.js:29–33`.
   - Fixed: my earlier wired-master test now removes postgain and returns `outside.master:true`; two live explicit Orbit 2 modules are identified. The earlier Arrange/Duck/Mixer-solo/raw-mute probes still behave as expected.
   - Missed peers: a default-orbit Instrument plus another default-orbit voice through DJ filter yields `orbit:false, sharedOrbit:[]`. An explicit Orbit 2 plus an active Strudel Code (pattern) containing `s("bd").orbit(2).room(1)` also yields no shared-orbit warning. A disconnected unused Orbit 2, conversely, makes the label claim another part uses that bus. The analysis only counts Orbit nodes, ignoring effective routes, reachability and code controls.
   - Imported-graph edge case: two Outputs pass validateShape and normalize removes nothing, although Output is marked `single` in the UI. compileTap neutralizes only the first and retains the other master/voice; the result fails guard parsing (`Unexpected token (4:16)`). This is not a normal UI-created board; it shows the raw-tap API needs to reject unsupported graph shapes or construct exactly one Output.
   - Recommendation: explicitly label this routing analysis partial, account for active default buses/Duck/code routes, and use “unknown” for cases not analyzed. Filter unused/muted peers. Reject multiple Outputs at the graph boundary or remove them from a tap copy. Do not promise contextual final-voice fidelity yet.

7. **[P1] The pure performance judge still fails open on missing/invalid evidence.** [observed] — `scripts/perfjudge.mjs:8–35`.
   - A valid result versus `{}` as baseline returns `{failed:0}`: no matching baseline is required. A missing or null `audioAdvanced` also passes because only literal false is rejected. `validateRuns({a:[{playingStart:true,playingEnd:true}]})` returns an empty error list despite no clock or measurements.
   - `cpuMsPerSec:NaN` (or the JSON string `"oops"`) passes; negative counter deltas pass. Baseline `[measuredUnderruns0, nullUnderruns]` versus a new null-underruns run passes with a note, although a previously measured counter was lost. Baseline run validity is not checked.
   - Recommendation: strictly validate finite metric types, nonnegative counters/costs where applicable (retained heap growth can be negative), true clock evidence, and both result sets. Require matching scenarios, an actual reference run and compatible measurement metadata. Keep genuinely unsupported metrics as explicit unavailable evidence, without letting one missing repeat erase measured support from another.

8. **[P1] A real negative-duration browser benchmark passes the gate.** [observed] — `scripts/perf-play.mjs:17`, `:94–104`, `:113–119`.
   - First ran `npm run perf:play -- --only whole-song --repeat 1 --seconds 8 --save codex-0003-idle` successfully.
   - Then ran `npm run perf:play -- --only whole-song --repeat 1 --seconds -1 --save codex-0003-negative-window --compare codex-0003-idle`. It exits **0**, prints `playback for -1 s`, marks audioClock true, reports **CPU -202 ms/s, frame -35.7 ms/s**, and prints **“ok playback is no worse than codex-0003-idle.”** The sleep collapses, the audio-advance threshold becomes negative, and costs are divided by a negative window. Saved window/repeat metadata is ignored in comparison too.
   - Recommendation: reject nonfinite/nonpositive windows and noninteger/nonpositive repeats **before starting Chrome**; validate saved metadata and minimum required evidence in judge mode as well. A shorter or empty measurement cannot qualify as evidence against a longer baseline merely because its counters stayed small.
   - Positive control that is genuinely repaired: the 8-second whole-song `--load stall --compare codex-0003-idle` run exits **1**, recording **8 skipped notes, 1 stall, 601 ms long task** and five failing comparisons. This confirms the stale-panel fix and load execution; it does not validate all fail-closed paths.

9. **[P2] An old x-ray answer can be published and then frozen; queue delay is treated as query cost.** [observed in a Node fake-DOM scheduling probe; inferred for UI consequences] — `src/xray.js:84–104`, `src/main.js:903–904`, `:984`.
   - Ran the actual createXray/queryEvents modules with a minimal fake DOM, prewarmed evaluator, and an `exclusive()` turn held for 90 ms. Opened a c4 Note Pattern, changed its graph text to c5 and called `update()` while the query waited, then released the lock. After 450 ms the graph was c5 but summary still said **c4**, with **“Updates are paused ... last reading took 92 ms.”** The reading itself was small: the elapsed time includes the lock wait.
   - `gen` increments when a query starts or closes, not when an edit supersedes it. The old result is therefore accepted; the replacement then hits the slow-reading pause. A manual Refresh bypasses the pause when idle, but a Refresh while busy only sets dirty and loses the manual intent when rescheduled automatically. Stopping playback does not schedule an update in main, despite the message offering “or stop the music.”
   - Recommendation: invalidate the in-flight revision on updates, retain pending manual intent, and refresh on the transition to stopped. Separate queue delay/cold initialization from synchronous query/record/draw cost when deciding what to pause.
   - Trade-off: retaining the last picture with an explicit Refresh is a sensible temporary safety choice **[inferred]**, but 40 ms is an unvalidated heuristic **[guessed]**, not a proven safe budget. It cannot prevent the first suddenly expensive query. The 0.5/2-second stress hooks call the same pausable refresh, so passing those loads can mean the queries stopped; report completed/paused query counts and responsiveness coverage alongside playback cost. The literal “forced to re-read every .5 s” table label and xray.stress's “worst case” comment overstate the work exercised.

10. **[P2] Focus enters the panel but does not return from the normal menu path.** [observed browser UI + inferred cause] — `src/xray.js:71–76`, `:108–116`, `src/board.js:519–522`.
    - On this worktree's production preview at `http://127.0.0.1:4191/`: start lesson 1, click Sample's More, then Show what comes out. Accessibility focus correctly becomes Cable x-ray. Press Esc: the panel closes and focus becomes the **web area/body**, not Sample's More button.
    - The menu's handler removes itself before calling open; the selected menu item is no longer a persistent invoker. `open()` cannot recover the More anchor by reading document.activeElement after that removal.
    - Recommendation: pass the stable More button/anchor into open and restore it on close; cover click and keyboard activation, switching pinned modules, deleted invokers and modal interactions. No screen-reader or phone certification follows from this one desktop check.

### Direct answers and disposition audit

1. **Events:** duplicate-fragment attacks, genuine simultaneous attacks, ordinary carry clipping, silence, .4-semitone rounding, short notes, sound-name loss and Harmonics retention all improve on the original probes. Lossless/exactNotes is still false evidence in F1–F2. Carry flags remain whole-slot flags; gate/release behavior is separately represented. Do not use them as audio-tail flags.
2. **Raw taps:** the original master-cable leakage is fixed; the bounded raw Arrange/Duck/Mixer/mute cases pass. The wider routing claim is partial (F6).
3. **Snapshot:** valid slider snapshots and the 256-cycle rejection work; invalid metadata and shared hooks remain problematic, and tempo-dependent resolved controls are wrong (F4–F5).
4. **Guard:** it rejects the original literal million-event example and tested nested literal multiplication. It does not yet implement a dependable expanded-cost bound (F3). No recommendation to remove the guard or add Script mode.
5. **Performance gate:** the deliberate-stall repair is real. Missing/invalid evidence and invalid windows still pass (F7–F8).
6. **X-ray trade-off:** paused inspection is reasonable as an explicitly stale, manual-refresh mode; the implementation must preserve freshness/focus and measure the work actually performed (F9–F10). I cannot endorse 40 ms as a validated safety boundary from these measurements.
7. **Documentation/evidence:** the rewritten `aidocs.js` privacy, sample-preload, bounded importer-test and AI-copy descriptions correct the concrete 0002 prose issues. D10's “every loss”/exactNotes and D12's “fails closed” claims must be narrowed until F1–F8 are fixed. PERF's deliberate-stall correction is independently corroborated; its table is a local historical observation, not a general proof of safety. The first-run intro still says “nothing is uploaded” (`src/main.js:1617`, observed in the browser), contrary to the now-correct optional-AI qualification in aidocs. The docs' unconditional “same board” round-trip sentence remains broader than bounded event replay evidence; this review did not establish a new importer counterexample, so that is a wording inference, not a newly reproduced importer bug.

### Commands, results and scope

- Target `origin/main` is exactly **`2b720f20a190912f223f8f969f6aaf6a8fb8b63c`**. Authorized fetch/merge created merge `bc48d56`; source/scripts/PERF/DECISIONS match that target. The only conflict was 0002 status/spacing; retained upstream's ingested file and Disposition verbatim.
- Read AGENTS, handoff README/INGEST, 0002 including Disposition, PERF and D10–D12. Created this file with the requested handoff:new command and copied the owner's request above.
- `npm ci --ignore-scripts` completed. `node --import ./scripts/stub-loader.mjs /tmp/patchboard-0002-probes.mjs` reran the previous review's actual probes; outputs are summarized above. Follow-up real-Strudel and guard/metric probes were independent of verify.mjs expectations.
- `npm test`: exit 0, 544 `ok` lines including the three handoffs and **1,669 compiled patches** in the guard sweep. An initial run reached the handoff checker before this new Request was filled and rejected the template; after filling it, the full suite passed. `npm run build`: exit 0, **83 documentation files** generated.
- Three real harness runs: 8-second idle exit 0; negative-window comparison exit 0 (incorrect); 8-second deliberate stall exit 1 (correct). Commands and observed counters are in F8. I did not rerun the entire published three-board, three-repeat table.
- Browser check used the own-worktree build via `npm run preview -- --host 127.0.0.1 --port 4191`, through the normal lesson/menu UI. It did not touch the owner's main checkout, saved boards, key or permissions.
- F9 scheduling probe was `/tmp/patchboard-0003-xray-probe.mjs`, not a browser/performance measurement. It imports the real modules, uses fake canvas/DOM methods, and holds the real eval lock; it does not modify source or replace queryEvents. Approximate elapsed times will vary.
- `npm run handoff:check` and `git diff --check` pass after the response is filled. Generated INDEX is refreshed locally and intentionally excluded from the authorized one-file commit.

For a compact independent Take reproduction, run from the worktree:

```sh
node --import ./scripts/stub-loader.mjs --input-type=module <<'JS'
import {queryEvents} from './src/snapshot.js';
import {recordToTake} from './src/events.js';
import {takeToCode} from './src/takecode.js';
for (const code of ['$: note(60.004)', '$: note(60).velocity(.333)',
                    '$: note(60).clip(.13)', '$: stack(note(60),note(60))']) {
  const {take,report}=recordToTake(await queryEvents(code,{to:1}));
  console.log(code,JSON.stringify({take,report,code:takeToCode(take).code}));
}
JS
```

### Risks and what I did not check
- Remaining exactness and admission errors are blockers for trusting capture or automatically admitting expensive inspection. No JavaScript data-exfiltration bypass was demonstrated.
- No huge/million-event input was evaluated; dangerous cases were guard-only probes, with small scaled examples for actual replay. No source fix or prototype feature was written.
- No listening, audio render parity, new song transcription, phone, screen reader, sustained load, full historical performance-table reproduction or exhaustive mini-notation fuzzing. I did not claim every shared-global mismatch audibly alters playback.
- The new Feature test tour's full expanded assertions passed the suite; I did not independently audition or reimplement all nine group's checks in this review (the requested attack scope was the seven areas above).
- No push, deployment, main-checkout edit or commit of experiments, temporary probes, generated INDEX or performance artifacts.

Source: written by Codex on 2026-11-26.

## Disposition
<!-- written by Claude on 2026-11-26 after re-running Codex's probes on main (2b720f2): every numbered finding was reproduced (confirmed) unless noted -->
F1: accepted - confirmed (`clip(.13)` gave 0.52 beat, written as 0.5, reported exact) - the Take report now compares the notes the writer really emits (`takeToPattern` steps, after snapping starts AND ends, lanes, merging and section cuts) with the Take's notes one for one: `emitted.changed` / `emitted.extra`; `exactNotes` needs both to be 0 - src/events.js, test "0003 F1".
F2: accepted - confirmed - there is no "small enough to ignore" any more: any pitch difference counts as `detuned` (maxCents to 2 places), `dynamicsChanged` counts loudness that was rounded or clamped, `pitchOverridden` counts a `freq` control over the note field, and identical simultaneous notes count in `emitted.merged` (compared by multiplicity, not only by unequal velocity) - src/events.js, tests "0003 F2" (the plain melody on the grid is still exact and lossless).
F3: accepted - confirmed on all five alternate forms, the bracketed rate, the euclid steps, the chained product, the parser crash and the false refusal of `echo(3,128,.5)` - guard now folds numeric expressions and number strings, checks only the count arguments of each method (echo: the first; euclid: both), tracks a product along a chain (`.fast(4096).fast(4096)` is refused), counts `bd*[30 30]` as 30 and a Euclid's steps as work, bounds the mini-notation walk (depth 100) and turns any unexpected error into a refusal. Still admission limits, not a cost proof: pattern-valued counts (`.fast("<2 1000000>")` is caught as a string, `.fast(sine)` is not) and a long list of individually allowed calls are not bounded - src/guard.js, tests "0003 F3".
F4: accepted - confirmed (loopAt at 156 bpm: speed .25 offline, .325 in playback) - queries now pass the evaluated patch's tempo as `_cps`, exactly as the player does, and the record says which tempo it used (`context.cps`) - src/snapshot.js, test "0003 F4". Not covered: other scheduler controls than `_cps`.
F5: accepted in part - confirmed - an offline query now restores the names it rebinds (`all each hush cpm setCps setcps setCpm setcpm compileKabel`) and puts the player's clock hook back (`bindPlayerClock`, engine.js), and a Slider value that is not a finite number is neither used nor reported as applied. NOT restored: the shared trigger hook (`setTriggerFunc`) - not shown to matter, recorded here as open. I have not shown that the old behaviour changed any playing voice either.
F6: accepted - confirmed - two Outputs now tap with only the first (the others and their cables are left out of the copy); `sharedOrbit` counts only other parts that are on, reach the Output and are set to the same orbit by an Orbit module or by `.orbit(n)` in code, with the default orbit as the tapped chain's own when it has none; the result carries `routing: 'partial'` and the x-ray says the routing is only partly checked. Default-orbit peers and Duck between parts are still NOT analysed - D11 says so. test: tap tests in verify.mjs.
F7: accepted - confirmed - the judge now needs a baseline with valid runs, finite non-negative costs and counters, a true audio clock (null fails), and it fails when a counter measured in the baseline is missing now or the baseline is partly unmeasured - scripts/perfjudge.mjs, tests "0003 F7".
F8: accepted - confirmed (negative window exited 0) - the harness rejects a window under 1 s, a repeat that is not a whole number and an unknown load BEFORE starting Chrome (exit 2), and the judge compares only equal windows with valid saved metadata - scripts/perf-play.mjs, scripts/perfjudge.mjs, tests "0003 F8". Positive control re-run (see docs/PERF.md).
F9: accepted - confirmed by Codex's scheduling probe; the fix is verified by reading and in the browser, with no Node fake-DOM regression test yet (deferred: a small DOM fake for xray.js) - a reading that lands after the module's code changed is dropped and asked again, queue wait and first-time setup are no longer counted as query cost (`timing.ms` is measured inside the turn), a Refresh pressed while a query runs is kept, and the panel reads again when the music stops (`playingChanged`) - src/xray.js, src/snapshot.js, src/main.js. The 40 ms limit stays a guess (D12 says so).
F10: accepted - confirmed - the menu hands its More button to `open` and the panel gives focus back to it (or finds the module's More button again if the board was redrawn) - src/board.js, src/main.js, src/xray.js. Checked in the pane, see the summary; no screen-reader test.
Direct answer 7 (documentation): accepted - D10 and D12 narrowed (see DECISIONS), the first-run intro no longer says "nothing is uploaded" (it names the optional AI helper), and the "reads back into the same board" sentence in the AI docs now says "meant to", with what the tests do and do not prove.
Not reproduced / could not test: none. Not done: contextual final-voice tap; a DOM fake for the x-ray scheduling; audio-parity listening; phone and screen-reader checks.
