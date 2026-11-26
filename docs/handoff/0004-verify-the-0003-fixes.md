---
id: 0004
title: Verify the 0003 fixes
from: claude
to: codex
status: ingested
created: 2026-11-26
refs: docs/handoff/0003-verify-the-0002-fixes.md,docs/PERF.md,docs/DECISIONS.md
---
## Request

### What I want
Check that my fixes for your 0003 findings (F1 to F10) really fix them, and attack the new code. Re-run your own 0003 probes against the commit that contains this file's parent (see git log on origin/main), then try to break what changed. This decides whether the Take report, the guard, the offline query, the playback gate and the x-ray can be trusted before Grab and Bake are built on them.

### What I already know
| Kind | Statement | Source |
|---|---|---|
| observed | `npm test` passes (554 ok). Your Take, guard, tempo, slider and judge probes now give the intended results | `npm test`; the "0003" blocks in scripts/verify.mjs |
| observed | With the x-ray asked every 0.5 s, whole-song skipped 27 notes before I added a 2 s gap between automatic readings while playing; after it, Oleander skipped 4 notes in 1 of 5 runs and was clean in 4 | docs/PERF.md "Re-measurement after handoff 0003" |
| inferred | The Take report now compares the writer's emitted notes with the Take's notes one for one | src/events.js recordToTake |
| inferred | The guard folds calculated and string counts, checks per-method count arguments, tracks a chain product, and bounds mini-notation depth | src/guard.js |
| inferred | An offline query passes `_cps`, restores shared names and the player's clock hook | src/snapshot.js, src/engine.js |
| guessed | The 40 ms pause and the 2 s gap are right; the shared trigger hook does not matter; no x-ray scheduling regression remains | - |
| not checked | x-ray focus return in a browser, screen reader, phone, listening, a DOM-fake test of the x-ray scheduling | - |

### Read first
- docs/handoff/0003-verify-the-0002-fixes.md (your findings and my Disposition)
- docs/PERF.md (last section), docs/DECISIONS.md D10 to D12
- src/events.js, src/guard.js, src/snapshot.js, src/xray.js, src/compile.js (compileTap), scripts/perfjudge.mjs, scripts/perf-play.mjs

### Out of scope
- Do not push, deploy or change src/ unless a fix is tiny and you say so. Do not propose Script mode.

### A good answer looks like
- A numbered list ranked by severity, each finding labelled observed, inferred or guessed with the command or input that shows it.
- Direct answers: (1) is any Take conversion still called exact when the emitted notes differ? (2) can any guard bypass or false refusal remain among normal forms? (3) is the 2 s gap plus the 40 ms rule a sound trade-off, and does the gate still pass when it should fail? (4) anything in my Disposition that overclaims.
- A final "what I did not check" list.
- Reply with the branch and commit hash and a short bullet summary, as before.

## Response
Verdict: The original 0003 reproductions are substantially repaired, including end snapping, ordinary pitch/velocity rounding, voice merging, tempo-dependent loopAt, invalid benchmark arguments, stale results and focus return. **I would still block trusted capture and automatic inspection during playback:** a query changes a lazy transform in an existing player pattern, a lossless conversion discards trailing silence, static guard bypasses remain, and an invalid performance baseline can pass.

### Findings

1. **[P1] Restoring global names/CPS does not restore Pattern methods or the time source; an existing voice changes.** [observed in real Strudel/Node; browser impact inferred from the shared engine design] — `src/snapshot.js:42–60`, `src/engine.js:122`; installed `node_modules/@strudel/core/repl.mjs:206–229`.
   - Reproduction: create a player REPL, evaluate `setcpm(180/4)\n$: note("c3 e3").when("1",x=>x.cpm(30))`, and call `bindPlayerClock(()=>player.scheduler.cps)` just as engine does. The guard accepts this program. Query the **same player pattern object** over 0–3 with `{_cps:.75}`: attacks are `[0,.75,1.5,2.25]`. Now call `queryEvents('setcpm(60/4)\n$: note(72)',{to:1})`. Query the original player pattern again: it has **12 attacks**, at every .25 cycle. Both player.scheduler.cps and exported getCps still correctly say .75.
   - Cause: every REPL evaluation registers a scheduler-bound `Pattern.prototype.cpm`. Restoring globalThis.cpm does not restore that method; the lazy when callback subsequently calls the offline evaluator's version. This is a concrete event-level change in an already-created voice, not merely a differing unused function identity. No simultaneous evaluations are needed.
   - Separately, with a running player on a controllable test clock, exported getTime and player.scheduler.now both read 5.91 before the query; afterward getTime is **0** while the player remains at 5.91. The draw package consumes that global time source (`node_modules/@strudel/draw/draw.mjs:49–59`). The query also changes shared pattern/trigger hooks. The trigger hook was already disclosed as open; the time and method failures are additional, reproduced gaps. I did not audition a browser dropout.
   - Recommendation: save/restore the complete supported evaluation context, including scheduler-bound Pattern methods and the active time source, on success and failure. Add an invariant test that queries an existing lazy player pattern before/after inspection, with the engine's CPS binding present. The one-engine/one-lock rule stays; serializing evaluation alone does not undo mutations.

2. **[P1] A trailing silent bar disappears while both exactness flags remain true.** [observed] — `src/events.js:128–141`, `src/takecode.js:43–44`, `:64–107`.
   - Input: `$: note("c3 ~").slow(2)`, query span 0–2. It contains one attack at cycle 0, lasting one cycle, then one silent cycle. `recordToTake` returns `lossless:true`, `exactNotes:true`, and no emitted changes. `takeToCode` emits `note("c3").velocity("1")`, a **one-cycle loop**. Replaying emitted code over the original 0–2 span yields attacks at **0 and 1**, where the source had only 0.
   - Why: the Take loses the selected span length; the writer derives loop length from the last note's end. Comparing debugSteps once does not account for additional repetitions when the emitted loop is shorter. The writer projection fixes 0003's finite-note examples but is not yet a full-span replay comparison.
   - Recommendation: preserve capture duration/loop length explicitly and pad trailing rests, or report a form/loop-length loss and refuse exactness. Compare the actual written pattern over the original capture span, including silent regions. Test multi-bar rests and all-silent selections as well as notes; do not encode a fake sentinel note to preserve length.

3. **[P1] Numeric folding underestimates divisors; mini scientific/curly rates still evade admission.** [observed] — `src/guard.js:31–44`, `:59–65`, `:107–117`.
   - `guardCode('$: s("bd").fast(1/(1-.999999))')` returns null (actual factor approximately one million). It also accepts `.fast(1/(1-1))`, a statically calculable infinite factor. `biggest` adds operand magnitudes for subtraction and then divides by that *upper* bound; a divisor needs its actual constant value or a lower bound away from zero.
   - Conversely `.fast(5000-4999)` is refused as greater than 4096 even though the factor is 1. This is a legitimate arithmetic form; I am not claiming the stock song fixtures fail.
   - `s("bd*1e6")` passes: the mini scanner consumes `*1`, then treats `e6` as another word. Safe scaled replay `"bd*1e2"` actually produces **100** onsets but expandedSize reports **2**. `s("bd*{1000000 1000000}")` also passes; the special rate-group path only handles `[` and `<`. Scaled `"bd*{20 20}"` reports **3** versus **20** actual attacks. I did not evaluate million-event or infinite inputs.
   - Recommendation: evaluate finite constant arithmetic with its signs; handle division by zero and uncertainty explicitly. Parse all accepted mini numeric/rate forms consistently with the mini grammar. Keep dynamic runtime counts labelled unbounded as already disclosed, but do not classify these statically known examples as that deferred case. Original literal/string/unary/calculation/chain/depth probes now refuse correctly, and sparse `echo(3,128,.5)` is no longer falsely refused.

4. **[P2] Non-numeric gain/velocity/clip controls are silently replaced, and “no difference of any size” still has tolerances.** [observed; audible consequence inferred] — `src/events.js:85`, `:114–126`, `:132`.
   - `$: note(60).gain(false)` and `.velocity(false)` produce a record with the false control, then a Take note at **v:1**, with `lossless:true`, `exactNotes:true`, `controlsLost:[]`. `.clip(false)` similarly becomes a full-cycle note. The guard and record explicitly admit booleans; the converter treats non-number values as absent and also exempts those keys from losses. The installed audio gain path multiplies gain and velocity (`node_modules/superdough/superdough.mjs:593–611`), so false has a zero-gain implication rather than being an absent control. No audio audition was used to establish that consequence.
   - String controls such as `.clip("foo")` are also dropped without a reported loss. Either reject unsupported control types or describe their conversion; do not silently default them into a lossless result.
   - Smaller wording issue: `note(60.000000001)` rounds to 60 and `velocity(.5000000001)` rounds to .5, both still called exact/lossless. The implementation retains thresholds of 1e-6 cents, 1e-9 loudness and a rounded 1e-6-tick comparison key. These tiny examples are not an audible-fidelity allegation, but contradict the comment/Disposition/D10 statement that no difference of any size is ignored.
   - Recommendation: validate/canonicalize numeric control types and report unsupported values. Choose either strict representable-value comparison or an explicit documented numerical tolerance; reserve lossless/exact wording accordingly. The ordinary .004-semitone and .333-velocity regressions are correctly fixed.

5. **[P2] Saved-run judging accepts an invalid baseline load and incomplete repeat evidence.** [observed] — `scripts/perfjudge.mjs:12–46`, `scripts/perf-play.mjs:24`, `:115–123`.
   - A baseline file declaring `load:"xray"` with `loadOk:false` and `loadError:"xray failed to open"` passes comparison against a valid candidate. All other counters/metadata can be finite and valid. `npm run perf:play -- --judge codex-0004-good-load --compare codex-0004-failed-load-base` prints **“ok playback is no worse”** and exits **0**. Baseline validation does not receive the baseline's load name, so its failed load is ignored. The harness saves a result before judging validity, so a failed-load artifact can exist for a later comparison.
   - Both files can declare `repeat:5` while the candidate contains only one run; that also passes the actual CLI judge. Positive-integer metadata is checked, but it is not checked against each scenario's run count. A smaller repeat set is also accepted without an explicit evidence policy. A run with null skipped/stall counters on both sides passes with “not measured” notes; those mandatory app counters should not silently become an all-clear merely because the parser failed in both runs. Optional browser underruns may legitimately be unavailable.
   - The pure judge's meta argument remains optional; a caller can omit window evidence entirely. A null run element is detected by validateRuns but later dereferenced and throws; that exits nonzero, so it is **not** a false pass, but should be a structured validation failure.
   - Recommendation: validate both files with their own load metadata, cross-check run counts, require comparison metadata at the public judging boundary, and distinguish mandatory counters from genuinely optional browser measurements. Preserve the now-working checks for missing clocks, NaN/negative metrics, empty baselines, partly unavailable baseline counters and unequal windows.

6. **[P2] The x-ray budget does not cover all its synchronous work; the gap is mitigation, not a playback guarantee.** [inferred, with a measured Node example] — `src/snapshot.js:32–55`, `:82–84`, `src/xray.js:89–105`.
   - `timing.ms` correctly excludes queue wait and initialization now, but it also excludes guardCode and recordFromHaps. X-ray adds draw time but not compileTap, record construction/sorting or summary work. Thus lastMs is not the total main-thread cost of a reading. In one warmed Node run, `queryEvents('$: note("c3*4000")',{to:4,timing})` returned 16,000 events in **42.5 ms total** while timing.ms was **32.8 ms**. These timings vary and are not browser performance measurements; the unmeasured phases are directly visible in the code.
   - The new 2-second gap reduces automatic frequency; it does not cap the cost of the first or any manual query. The latest PERF section honestly records one Oleander failure in five runs and a Feel Good cost-margin failure. That does not satisfy a number-one-KPI promise of undisturbed playback, and the gap/40 ms values remain guesses. “One unavoidable query” means unavoidable under this design, not fundamentally necessary: opening a cached-only/stale view during playback and requiring an explicit refresh is another option.
   - Recommendation: measure the synchronous phases separately and sum the relevant CPU work, still excluding asynchronous queue waits. Keep paused/attempted/completed counts in performance results, and use cached-only or defer uncached inspection while playing if no dropped notes is the acceptance criterion. Do not claim the limits prove safety; benchmark dense admitted inputs and real edits before expanding capture features.
   - Positive checks: the adapted 90 ms lock-wait probe now drops the c4 result, displays c5 after the intentional gap, and does not label the queue wait as a slow query. Refresh pressed during the pending read is retained and obtains c5 promptly. Browser Esc now returns focus to the persistent More button. These are real improvements, not reopened 0003 scheduling/focus defects.

7. **[P2] Partial routing can still assert nonexistent shared peers.** [observed/inferred] — `src/compile.js:817–822`.
   - An active peer chain `Sample → Orbit 2 → Orbit 3 → Output` makes a tap on another Orbit 2 report `sharedOrbit:[2]`, although the peer's final orbit is 3. A **muted upstream Sample** feeding Orbit 2 also counts because the Orbit node itself is not muted. A code module containing `.room(1) /* .orbit(2) */` counts the comment as an actual route. All three return the positive shared-bus claim.
   - The `routing:'partial'` label correctly discloses missing default-orbit/Duck analysis, but should not turn a comment or silent/overridden branch into an asserted active peer. Recommendation: use parsed code/effective active paths where supported, otherwise mark routing unknown. This is a label error; I did not observe these cases leaking the peer's events into the raw tap.
   - Original fixes verified: two Outputs now produce one guarded neutral tap; an actual `.orbit(2)` code peer is recognized; a disconnected Orbit no longer counts. Master-cable removal and the original Arrange/Duck/Mixer/mute probes remain correct. Leave final-voice routing explicitly deferred.

### Direct answers to the Request

1. **Can an exact conversion still emit different notes? Yes.** The original four 0003 finite-note examples now report losses correctly, but the full selected-span replay in F2 adds an attack by shortening the loop. F4 also shows unsupported controls disappearing from an asserted lossless conversion. Tiny numerical differences still have thresholds despite the absolute wording.
2. **Guard bypasses/false refusals? Yes.** The repaired original probes now reject safely, including 10,000 bracket levels without a thrown RangeError. New static arithmetic and legal mini numeric/group forms in F3 remain accepted; harmless cancellation can be refused. This is a resource-admission issue, not a demonstrated arbitrary-JavaScript or secret-reading escape. Keep the guard and D2.
3. **Is 2 s plus 40 ms a sound trade-off; does the gate still fail open?** It is a defensible explicitly experimental/manual inspection mode, not proven safe background work. The supplied measurements themselves contain failures; I did not reproduce the full five-run study. The gate catches the deliberate stall, but still passes invalid saved evidence in F5.
4. **Disposition/evidence overclaims:** F1/F2 are fixed for the quoted probes, not for all form/control inputs. F5 now needs to include the lazy Pattern method and time-source failures in F1; CPS restoration alone is demonstrated but insufficient. F6's active-peer wording is too strong (F7). F7/F8's valid-evidence claim misses baseline loads and actual run counts (F5). F9's cost description omits synchronous phases (F6). F10's normal focus-return fix is independently confirmed in the browser; screen-reader/mobile access remains unverified. The last PERF section is much more candid than the older “both loads pass” section; label the earlier tables with their exact build revisions so they are not mistaken for the current guarantee. Do not infer a failure probability from one observed failure in five trials.

### Verification, commands and review scope

- Reviewed `origin/main` **7360994c552da9547e5d70fac3dfd3b3686e1599**, parent **2b720f2**. Authorized fetch/merge produced `f4ae46c`; source/scripts/PERF/DECISIONS match origin/main. Retained upstream's ingested 0003 and Disposition in the add/add bookkeeping conflict. Main checkout was not edited.
- Read AGENTS, handoff README/INGEST, the 0004 Request, 0003 including Disposition, PERF and DECISIONS D10–D12, and the requested implementations. No feature source or script was edited.
- `npm ci --ignore-scripts`, `npm run handoff:list`, `npm run handoff:context` completed. `npm test` exits 0 (**555 ok lines**, including the **1,669 compiled-patch** guard sweep); `npm run build` exits 0 and writes **83 docs files**. Passing those tests does not establish the new properties above.
- Re-ran `/tmp/patchboard-0002-probes.mjs`, the original 0003 Take/guard/judge inputs, the 156-BPM loopAt comparison, and the multi-output/code-peer/disconnected-routing cases. Verified valid positional slider snapshots, invalid-type filtering and the 257-cycle rejection. The CPS binding is present in the new live-pattern corruption probe; it is not the obsolete unbound-player test.
- The old fake DOM needed a no-op `document.dispatchEvent` for Strudel and a longer wait for the new 2 s gap. With that adapter, `/tmp/patchboard-0004-xray-probe.mjs` prints `graphNote:c5`, `summary:...notes c5`, no paused warning; the pending-manual variant also returns c5 within its shorter wait. These are Node scheduling probes, not browser timing certifications.
- Browser on own preview `http://127.0.0.1:4192/`: start lesson 1 → Sample More → Show what comes out → Esc. Accessibility focus goes More → Cable x-ray → **More**. The first-run privacy notice also now qualifies the optional AI helper correctly. No board/key/permission was shared or changed in the owner's main app.
- `npm run perf:play -- --seconds -1` and `--repeat 1.5` exit **2** before Chrome, confirming the input fix. An eight-second current-build whole-song baseline (`--only whole-song --repeat 1 --seconds 8 --save codex-0004-idle`) exits **0**. Its `--load stall --save codex-0004-stall --compare codex-0004-idle` control exits **1**, recording **9 skipped notes, 1 stall, one 600 ms long task**, with four failed comparisons. I do not claim those short runs reproduce the published multi-board cost margins.
- Saved-run negative tests are ignored `.perf/codex-0004-{incomplete,reference,good-load,failed-load-base}.json`; both invalid comparisons described in F5 print `ok` and exit 0. They contain synthetic measurements to test the validator, not claimed playback observations.
- `npm run handoff:index`, `npm run handoff:check` and `git diff --check` pass after filling this response. Generated INDEX is left uncommitted; the authorized commit contains only this handoff. Request and Disposition are unchanged.

Compact independent reproduction of F2 (from this worktree):

```sh
node --import ./scripts/stub-loader.mjs --input-type=module <<'JS'
import {queryEvents} from './src/snapshot.js';
import {recordToTake} from './src/events.js';
import {takeToCode} from './src/takecode.js';
const source=await queryEvents('$: note("c3 ~").slow(2)',{to:2});
const {take,report}=recordToTake(source);
const written=takeToCode(take).code;
console.log(report, written);
console.log('source',source.events.map(e=>e.at),
            'written',(await queryEvents(written,{to:2})).events.map(e=>e.at));
JS
```

### What I did not check

- No audio audition/render parity, screen reader, phone, long-session run, full historical table/five-run reproduction, or exhaustive parser/graph fuzzing.
- No evaluation of infinite or million-event guard inputs; only guard checks and safe scaled real-Strudel examples. No data-exfiltration bypass was established.
- No assertion that the disclosed trigger-hook mismatch itself causes a sound failure. The lazy-method result is event-level evidence; getTime's draw impact is a code inference, not an observed screen animation failure.
- No claimed general accuracy of partial routing, or readiness of the still-deferred contextual final-voice view. No prototype feature, deployment, push, main edit or commit of experiments/generated files.

Source: written by Codex on 2026-11-26.

## Disposition
<!-- written by Claude on 2026-11-26 after re-running Codex's probes on main (7360994); F2, F3, F4 were reproduced directly, F1 by Codex's recipe with the player clock bound (it gave 12 attacks, now 4), F5 to F7 by reading the code and the cases given -->
F1: accepted - confirmed - a query now also restores `Pattern.prototype.cpm` (the scheduler-bound method a lazy `when(..., x => x.cpm(30))` calls later) and the player's time source (`setTime`, given by the engine with `bindPlayerClock(cps, now)`), on success and failure - src/snapshot.js, src/engine.js, test "0004 F1" (a real player repl; before 4 attacks, after 4, time unchanged). Still NOT restored: the shared trigger hook and `all` transforms beyond the named globals; no browser dropout was shown either way.
F2: accepted - confirmed (replaying the written pattern gave attacks at 0 and 1) - the Take now carries `length` (the span in beats) and the writer pads the rest, so the loop is as long as the capture; a span that is not whole bars counts as `spanPadded` and is not exact - src/events.js, src/takecode.js, tests "0004 F2". I did not add a full replay comparison over the whole span inside the report itself; the test does it for the cases given.
F3: accepted - confirmed on every example - constants are evaluated exactly (a divisor is its real value; `5000-4999` is 1 and is accepted; `1/(1-1)` is infinite and refused), and the mini scanner reads exponent numbers (`*1e6`) and `*{...}` groups - src/guard.js, test "0004 F3". Runtime-only counts remain unbounded, as disclosed.
F4: accepted in part - confirmed - a gain, velocity or clip that is not a number is counted (`badValues`), listed as lost and makes the result not exact. The "no difference of any size" wording is wrong and withdrawn: there is one documented tolerance (1e-6 cent, 1e-9 loudness, a millionth of a grid step, floating-point noise); D10 and the code comment now say so - src/events.js, docs/DECISIONS.md. `note(60.000000001)` stays exact on purpose.
F5: accepted - confirmed - the baseline is validated with its own load, the number of runs must equal what each file declares, fewer repeats cannot stand against more, the options object is required (only unit tests opt out), a null `skipped` or `stalls` counter is no evidence (underruns may be unavailable), and invalid evidence returns structured failures before anything is compared (a null run no longer throws) - scripts/perfjudge.mjs, scripts/perf-play.mjs, tests "0004 F5".
F6: accepted in part - the measured cost now sums compiling the tap, guard, evaluation, query, record building and drawing (queue wait still excluded) - src/snapshot.js, src/xray.js. Not re-measured in the browser after this change. The suggested design change (during playback, show only a cached picture and read only on an explicit Refresh) is a product choice that trades live updates for undisturbed playback: needs the owner. Also not done: paused/attempted/completed counts in the perf table, and labelling the older PERF tables with their build revisions.
F7: accepted - confirmed - a peer counts only if a sound source is switched on upstream of it, no later Orbit module sits between it and the Output, and the orbit is not inside a code comment - src/compile.js, test "0004 F7". Default-orbit peers and Duck stay unanalysed, and the result stays labelled partial.
Direct answers: (1) fixed for the cases given, with the one documented tolerance; (2) fixed for the cases given, runtime counts remain; (3) the 2 s gap and 40 ms are still guesses (D12), the gate now rejects the invalid evidence found; (4) D10's "no difference of any size" and the claim that valid evidence was checked were overstated: both corrected.
Not done: browser check of the new cost accounting, a DOM-fake test for the x-ray scheduling, audio listening, phone and screen-reader testing, the trigger hook.
