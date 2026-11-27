---
id: 0005
title: Review Grab, Bake, share links, evidence labels and the form map
from: claude
to: codex
status: ingested
created: 2026-11-26
refs: docs/DECISIONS.md,docs/ROADMAP.md,docs/PERF.md
---
## Request

### What I want
Attack the features built after the owner adopted the build order (DECISIONS D13, D14), none of which has had a review: Grab, Bake, share links, evidence labels, the form map, and the x-ray's one-cycle-first reading. Find where they claim more than they do, lose or change notes silently, can be made to do expensive or unsafe work, or corrupt shared player state. This decides whether they can be called finished and whether G2 (co-editing rooms) can be designed on top of the share envelope.

### What I already know
| Kind | Statement | Source |
|---|---|---|
| observed | `npm test` passes (582 ok); each feature was opened and used in the browser pane (Grab to a Take, Bake with undo, a share link dialog with checks, the form map on a 34-module board) | the "Grab", "Bake", "Share", "Evidence", "Form map" blocks in scripts/verify.mjs |
| observed | `s("hh*32").fast(8).chop(64)` is admitted by the guard and takes about 525 ms to read in Node (4 cycles, 50,000 events); a Grab of 64 cycles of something dense could take far longer | `npm run bench:query`, docs/PERF.md |
| inferred | Grab/Bake reuse `compileTap`, so they inherit its limits: raw tap only, partial routing, current code | src/grabui.js, src/grab.js |
| inferred | A Take cannot hold a voice's sound or effects, so Bake is offered only on modules whose output is notes; a baked chain loses everything a Take cannot hold (the report lists it) | src/main.js bakeInto, src/events.js |
| inferred | Share links unpack with a size cap while inflating; the board is then run through validateShape, normalize, compile and the guard | src/share.js |
| guessed | The 24,000-character link cap, the 8-cycle read-back, the 2.5 s per-voice form-map budget and the 1-cycle probe at 10 ms are reasonable; Bake on a `notes` module never changes what a downstream module receives | - |
| not checked | audio listening, phone layouts of the new windows, screen reader use of the new windows, playback impact of a Grab or form map while music plays (only the x-ray was measured) | - |

### Read first
- docs/DECISIONS.md D13 and D14, docs/ROADMAP.md section 9 (the "Built after the order was adopted" entry), docs/PERF.md (last two sections)
- src/grab.js, src/grabui.js, `openGrabFor` and `bakeInto` in src/main.js, src/share.js, src/evidence.js, src/formmap.js, src/xray.js (the probe), the matching blocks in scripts/verify.mjs

### Out of scope
- Do not push, deploy or change src/ unless a fix is tiny and you say so. Do not propose Script mode. G2 and G3 are not built; do not design them here.

### A good answer looks like
- A numbered list ranked by severity, each finding labelled observed, inferred or guessed with the command or input that shows it.
- Direct answers: (1) can a Grab or Bake change or drop notes while the window says it kept them? (2) can a share link or a shared board's contents cause expensive work, unsafe code to run, or a load without the person choosing? (3) does a Grab, Bake or form map read while music plays endanger playback, and is the warning enough? (4) are the evidence labels worded no stronger than what they check? (5) anything in D14 that overclaims.
- A final "what I did not check" list. Reply with the branch and commit hash and a short bullet summary, as before.

## Response
Verdict: **Do not call this batch finished yet.** The basic paths work and the existing tests pass, but independent probes found silent capture changes, a false-positive replay label, incorrect reused queries and a pre-confirmation resource-exhaustion path. A real browser Grab also caused skipped notes during otherwise quiet playback. These are repairable within the existing architecture; no feature prototype or source change is included here.

### Findings (ranked)

1. **[P1] Opening Grab automatically runs enough synchronous work to skip playing notes.** [observed: browser counters and Node scheduling; Bake inheritance inferred] — `src/grabui.js:26`, `:62–63`; `src/formmap.js:43–55`; `src/xray.js:99–102`.
   - Browser reproduction on my production preview, `http://127.0.0.1:4192/`: import two lines, `$: note("c3 e3 g3 b3").s("sine").gain(.02)` and `$: s("hh*32").fast(8).chop(64).mask("<0 1>/64")`. Disconnect Mask → Output, leaving **only the quiet four-note synth connected**. Start playback, open Settings and record counters, then open Chop → Grab. The default four-cycle read starts immediately. Skipped notes rose **0 → 6**; page stalls rose **1 → 2**, all while playing; underruns stayed 0. The earlier startup stall was already in the baseline and is not attributed to Grab. After this probe I stopped playback. Screenshot: `/tmp/patchboard-0005-grab-health.png`.
   - The window displayed its warning and `294 hits of hh over 4 cycles`, with 49,902 hits moved to the 96-step grid. It did **not** display the record's 15,536-event truncation warning or the merged-hit count. A warning accompanying an already-started blocking operation does not preserve playback or let the person decline that cost.
   - Independent Node probe `node --import ./scripts/stub-loader.mjs /tmp/patchboard-0005-scheduling.mjs`: warmed four-cycle query plus Grab took about **533 ms**, with a **522 ms** gap in a 5 ms timer. An eight-cycle form-map read took about **1,158 ms**, with a **581 ms** timer gap. Node timings are not browser measurements. The actual browser counter change above is separate evidence.
   - The form-map budget is checked **after** each complete four-cycle query. It cannot interrupt one chunk, and is per voice, not per map. A 2.5 s after-the-fact budget is not a scheduling deadline. Grab/Bake have no equivalent probe or budget at all. The x-ray's one-cycle-first strategy is a useful mitigation, but a cheap first cycle does not prove later cycles cheap; neither 10 ms nor 40 ms can interrupt work already underway.
   - Recommendation: do not auto-start an uncached Grab/Bake/map reading while music plays. Have the owner settle the existing cached-only/manual-read decision, explain the cost before a chosen read, and establish a bounded admission policy for dense work. Treat a worker query realm only as research under the existing one-Strudel constraints. Add an isolated quiet-player + disconnected-heavy-tap regression to the performance load matrix; benchmark these capture paths, not only ordinary maps.

2. **[P1] A tiny share graph expands exponentially during compilation before the person chooses Open.** [observed at safe sizes; larger exhaustion inferred] — `src/share.js:42–44`, `src/main.js:1708–1711`, `src/compile.js:245–255`.
   - Reproduction: make a valid graph with one `codesource` containing `s("bd")`, then successive two-input Stacks. Wire the previous node into **both `in1` and `in2`** of the next Stack, and the final Stack into Output. This is an acyclic graph accepted by normalize. Compress it in the ordinary share envelope and call `readShareFragment`.
   - `node --max-old-space-size=256 --import ./scripts/stub-loader.mjs /tmp/patchboard-0005-share.mjs` observed: depth 6 = 8 nodes / 474 link characters / 2,959 compiled characters; depth 9 = 11 nodes / 554 link characters / 32,783 compiled characters; depth 11 = 13 nodes / 615 link characters / **155,663 compiled characters**, accepted with no issues, about **84 ms** in that run.
   - `/tmp/patchboard-0005-share-depth13.mjs` uses depth 13: 15 nodes / 670 link characters. The final guard refuses the generated code as too large, **after about 373 ms of unpack/normalize/compile/guard work**. The cycle detector prevents cycles, but does not budget repeated DAG expansion; compilation builds repeated token trees before the final size check. Larger depth remains within the 400-node and 1,500-wire input limits. I did not execute an OOM-size case. This is a resource problem before confirmation, not a demonstrated arbitrary-JavaScript escape.
   - Positive checks: my two-million-character inflated-padding bomb is refused while unpacking; null graphs and duplicate IDs are refused. The existing ordinary `fetch(...)` injection test also passes: the compiler omits it and reports it. Reading a fragment does not itself evaluate Strudel or call loadGraph. Source inspection confirms Open is an explicit action; Run the checks is also an explicit action. I did not establish an automatic board load or secret leak.
   - Recommendation: budget the **expanded compilation** before constructing the output, cap depth/token work and catch compiler failures at this boundary. Memoizing graph traversal alone will not bound the size of expanded output. Keep validation and the guard. Test fan-out DAGs as well as compressed-byte bombs. A bad-wire probe also confirms normalization removes a cable, so its removal report should be surfaced rather than discarded; a valid normalized copy is not proof the received wiring was preserved.

3. **[P1] The loss report describes an intermediate Take, not the Take actually added or baked.** [observed real-engine replay; actual Grab UI verified; shared Bake path inferred from code] — `src/grabui.js:28`, `:48`; `src/main.js:1369`, `:1390`; `src/validate.js:97–100`; `src/compile.js:636–639`.
   - **Trailing silence:** query `$: note("c3 ~").slow(2)` over 0–2, then grab at grid 12. The converter correctly returns `take.length:8` beats, `exactNotes:true` and zero emitted changes. The add/bake constructors copy only bpm, beats and events; neither the Take schema nor the board compiler carries length through. Replaying the actual constructed Take over 0–2 gives attacks at **0 and 1**, versus source **0 only**. The repaired standalone converter was not enough.
   - Browser confirmation: import `$: note("c3 ~").slow(2).s("sine")`, Grab from Slow with the default four-cycle window. The window says **“2 notes over 4 cycles”**, with no loss text. Add as a Take produces **“2 notes · 3 bars”**. The captured trailing bar was lost.
   - **Silent truncation:** `$: note("c3*48")`, 64 cycles, grid 12 yields **3,072 notes** and `exactNotes:true`. The actual `cleanParams('take', ...)` construction retains **2,000**. The added board, replayed over 64 cycles, produces **3,056 attacks**, with a shortened/repeating loop; they are not the original 3,072. The toast still uses the pre-cleanup count. The 2,000-note safety cap is reasonable; pretending it kept the larger capture is not.
   - **Different grid:** `$: note("~ c3").early(1/96)` over 0–1 is exact on grid 24. The “as exact as possible” Add callback substitutes grid **12**. Source onset **47/96** becomes **23/48** in the actual compiled Take: a 1/96-cycle move after an exact preview.
   - Commands: `/tmp/patchboard-0005-probes.mjs`, `/tmp/patchboard-0005-extra.mjs`, `/tmp/patchboard-0005-scheduling.mjs`, each run with `node --import ./scripts/stub-loader.mjs`. The scripts use the same constructor fields as main, then query the compiled board, not only debugSteps. Separately, UI rendering omits `dynamicsChanged`, `dynamicsClamped`, `badValues` and record warnings; a loss report in memory is not necessarily a disclosure in the window.
   - Recommendation: run the report against the **final cleaned node and its actual grid**, preserve span length through schema/compiler/save/read-back, reject or explicitly partition oversized captures, and show every relevant conversion/truncation warning. Replay the final board over the full selected span before asserting fidelity. Keep the original and undo, but do not rely on undo to disclose a loss.

4. **[P2] Hit grabs do not keep sound identity or multiplicity as claimed.** [observed event/control differences; audible consequence inferred] — `src/grab.js:17–24`, `:33–36`; `src/grabui.js:39`.
   - `$: s("rim").bank("RolandTR909")` becomes unbanked `s("rim ~@3")`: `bank` is listed in the internal `controlsLost`, but the window ignores that list and says hits keep the sound and timing. Bank is part of sample identity, not a cosmetic effect. The result can play another sound or have no available sample; I did not audition this rim case.
   - `$: stack(s("bd"),s("bd"))` becomes one attack, with `merged:1` internally and no corresponding UI loss message. `$: s("bd").n(-1)` loses n with `controlsLost:[]`; fractional sample indices are likewise excluded by the positive-integer-only writer. `$: s("bd").velocity(.2)` loses loudness, but `gainLost:0` makes the UI omit its loudness qualification. These inputs were replayed in `/tmp/patchboard-0005-probes.mjs`.
   - The 50,000-event record cap and subsequent merging are also hidden in the dense browser example in F1. A count of emitted hits is not a count of source hits preserved.
   - Recommendation: identify a sample by bank + sound + sample index; preserve legal identifiers without silently sanitizing them into another name. Keep banked families on separate lines. Preserve duplicate attacks or disclose/refuse merging. Surface all lost controls, invalid indices and record warnings; qualify “timing” as onset timing if gate lengths are intentionally discarded. Test the emitted/cleaned Code node in the same way as a Take.

5. **[P2] Reused evaluation does not reinstall the offline pattern's lazy evaluation context.** [observed in real Strudel/Node; x-ray/map consequence inferred from their callers] — `src/snapshot.js:57–63`, `:69–72`; `src/xray.js:100–102`; `src/formmap.js:43–48`.
   - `node --import ./scripts/stub-loader.mjs /tmp/patchboard-0005-reuse.mjs`: warm the offline evaluator, create a live REPL at 180/4 CPM, bind its CPS/time callbacks, and create a live pattern `note("c3 e3").when("1",x=>x.cpm(30))`. Then query offline code `setcpm(60/4)\n$: note("c4 e4").when("1",x=>x.cpm(30))` twice over 0–3 using the **same reuse object**.
   - First query: **12 attacks**, one every .25 cycle. Second query: **4 attacks**, one every .75 cycle. Both records claim `context.cps:.25`. The cached pattern is queried after the prior query restored the player's `Pattern.prototype.cpm`; skipping evaluate also skips reinstalling the offline scheduler-bound method. Passing `_cps` alone does not repair this callback.
   - Positive check: the original live pattern remains **[0,.75,1.5,2.25] before and after**, so this is not evidence that the old live-method corruption persists. It is a new incorrect-inspection result introduced by reuse. The public reuse object is also not keyed to code: passing `$: note("g6")` with that object returns the old c4/e4 events under the new code revision. Current x-ray/map callers reuse one code string, so this latter misuse is a contract-hardening issue, not a claimed current UI exploit.
   - Recommendation: reinstall the complete evaluated pattern context for every cached query, including the offline scheduler CPS and lazy methods, then restore the player context afterward. Bind reuse identity to code/context/engine and invalidate it on mismatch. Test first probe vs expanded read and chunked vs whole-range queries with different player/offline tempos and lazy callbacks. Retain the shared-engine lock and the player's restoration fixes.

6. **[P2] Changing a Grab field leaves the previous result addable for the debounce interval.** [observed with a stand-in DOM driving the real openGrab handlers] — `src/grabui.js:22`, `:46–49`.
   - `/tmp/patchboard-0005-grabui.mjs` opens a Grab on `note("<c3 d3 e3 f3 g3 a3 b3 c4>")`. After its 0–4 read completes, set Start to 4, dispatch input, and click Add before the 250 ms timer fires. It prints `displayedStart:4`, Add enabled, but added pitches **[48,50,52,53]**, the old c3/d3/e3/f3 span; the selected span should start at **55 (g3)**. This is an actual handler test, not a browser timing claim.
   - `later()` schedules reading but does not invalidate last or disable Add. A snap change is worse: the Add callback can use the new grid with a result/report prepared under the old grid. There is no request identity check at commit time.
   - Recommendation: invalidate the result and disable Add synchronously on any input change; bind result, report and final node to one immutable request tuple (revision, control snapshot, from, length, grid). Test rapid change → Add, not just eventual debounce completion.

7. **[P2] “Same events” checks only onset, sound text and rounded pitch/sample index.** [observed false positive; further omissions inferred from signature] — `src/evidence.js:11`, `:21–26`.
   - Use a codesource → Output board with `note("c3").s("sine").clip(.12345)` and call `evidenceFor`. It returns **ok:true**, “plays the same 8 events over 8 cycles”. The source resolves clip **.12345**; import → compile resolves **.123**. The same false pass occurs for `.gain(.12345)` and sample `.speed(.12345)`, each rewritten to .123. Commands: `/tmp/patchboard-0005-extra.mjs` and `/tmp/patchboard-0005-labels.mjs`, run with the stub loader.
   - These specific differences are small, but the predicate entirely omits duration, gate, velocity, bank, gain, filters and other resolved controls, and rounds pitches before comparing. It also ignores record warnings/capping and later control fragments. An eight-cycle qualification limits the **range**, not which properties were checked. “Not checked: how it sounds” does not correct an inaccurate event-equivalence claim.
   - Positive: the guard label truthfully reports the compiler's admitted output; the finite-span/engine wording and explicit sample/listening exclusions are good. Do not turn that into a generic “safe/verified song” badge. Some import failures correctly make overall ok false even when their weak read-back signature happens to match.
   - Recommendation: either narrow the words to exactly “matching attack positions and rounded note/sound identifiers”, or compare rational onset/slot/gate, pitch without semitone rounding, multiplicity and all retained controls under a documented tolerance. Incomplete/truncated/folded records must not produce a full-fidelity pass. Share/library evidence should include the code/revision and exact predicate so it cannot be mistaken for a stronger check later.

8. **[P2] The form map silently undercounts capped records, and “plays” means attacks rather than activity.** [observed with real queries] — `src/formmap.js:24–30`, `:48–54`, `:85–90`.
   - Dense `s("hh*32").fast(8).chop(64)` over eight cycles should have **131,072 attacks** (16,384 per cycle). The map reports **100,000**, `readCycles:8`, empty note text. Each four-cycle record drops 15,536 events at the 50,000 cap; map rows ignore those warnings and look fully read. F1's scheduling probe prints this result. This can draw an apparent reduction/drop caused by truncation, not the song.
   - `/tmp/patchboard-0005-extra.mjs`: `note("c3").slow(8)` produces counts only at cycles 1 and 9, and text “plays in cycles 1, 9”, although slots/gates span the intervening cycles. Conversely `s("bd").gain(0)` and `.velocity(0)` each say “plays in cycles 1–16”. Attack density is a useful view, but it is not sounding occupancy or silence detection.
   - Recommendation: propagate cap/partial/error warnings into each lane and mark affected cells incomplete, rather than presenting a full count. Call the current metric “attacks in cycles ...” with explicit silent-control/tail exclusions; add a separate occupancy metric only if needed. The current 24-voice slice and three-level Stack/Mixer expansion are also undisclosed scope limits [inferred from voicesOf]; report omitted/grouped voices instead of implying every voice was mapped.

### Answers to the five direct questions

**Q1. Can Grab/Bake change or drop notes while the window says it kept them? Yes.** F3 verifies trailing-rest loss, 3,072 → 2,000 stored-note truncation and a changed grid after preview; the actual browser confirms a four-cycle Grab becomes a three-bar Take. F4 verifies missing bank/sample identity, merged attacks and undisclosed dynamics loss. F6 can add the wrong span entirely. Existing happy-path tests do not pass the full final-node conversion chain or these boundary cases.

**Q2. Can a share link cause expensive/unsafe work, or a load without choosing?** Expensive work **before choice: yes**, F2. Parsing bounds are useful but do not bound compilation of a valid fan-out graph. Expensive evaluation **after Run the checks/Open: yes**, admitted dense patterns still exist (F1). I found **no arbitrary-JavaScript execution, exfiltration, automatic sample-pack approval or automatic graph load** in these probes. The Open and check handlers require a click; do not conflate the pre-dialog compile with an automatic load. Graph-only export is not automatic redaction of a secret someone deliberately put in a node's text; I did not inspect any real key.

**Q3. Does reading while music plays endanger playback, and is the warning enough? Yes; no.** F1 has a real 0 → 6 skipped-note counter change on quiet connected playback. Bake shares Grab's read path; the map's chunks also block timers in Node, but I did not run a browser Bake/map stress study. A post-hoc timing threshold, warning and per-voice cumulative budget cannot guarantee note deadlines. The owner's number-one KPI requires an admission/deferral decision, not merely an explanatory sentence.

**Q4. Are evidence labels no stronger than their checks? Not the read-back label.** The guard and explicit exclusions are appropriately scoped. “Same events” exceeds the signature in F7; “plays/silent” in the form-map alternative exceeds its attack-count predicate (F8). A bounded replay can still be a useful label once its actual predicate and completeness are stated.

**Q5. Does D14 overclaim?** Its “not finished until reviewed and ingested” status is right. Its claims need these qualifications:
- (1) Raw/current-code/Slider limitations are stated, but reuse also introduces the incorrect lazy-tempo query in F5.
- (2) Restricting Bake to a notes output is useful, but does not make the final Take faithful (F3). Only outgoing cables are moved; the original may retain upstream input cables, so “unconnected” should mean disconnected from its consumers.
- (3) Sound/timing preservation is false for banked or indexed hits, merges and grid snapping (F4); every onset need not fit a supported grid.
- (4) Graph-only transport and capped inflation work in tested cases; they are not a compile-cost bound (F2). “Never loads without choosing” is supported by the handlers, while work still occurs before that choice.
- (5) Eight-cycle replay is not full event equivalence (F7); failed imports can also add a third `skipped` label, so “exactly two” is only the ordinary successful shape.
- (6) “About 2.5 s” is an after-chunk cumulative cutoff, not a maximum task time, total-map budget or fidelity check (F1/F8).

The last two PERF sections are much more candid than an unconditional safety claim: they expressly exclude dense form maps/phones and acknowledge 130 ms one-cycle reads. Keep the reported three-board form-map pass as that experiment, not as proof for these capture paths. I did **not** rerun its full three-board/three-repeat study. “Cuts the worst case to about a quarter” applies to the benchmarked homogeneous expansion, not every admitted time-varying pattern. The final section's “x-ray readings (two evaluations per reading)” is stale: current reuse normally performs one evaluation and two queries, but can produce the wrong second-query events (F5). The cause-of-retained-memory wording is appropriately tentative (“appears”); no long-session conclusion follows. D13's remaining prerequisites are still relevant, and this review does not authorize skipping them or starting G2/G3 design.

### Verification and reproducibility

- Reviewed `origin/main` **1d30232844186d21c93795b992e24c65af84611f** on `codex/youtube-strudel`. Requested fetch/merge completed as **06a6505**. The sole conflict was the previous handoff's answered/ingested history; retained upstream's complete 0004 with Claude's Disposition, without editing its contents. Preserved the preexisting generated INDEX change at `/tmp/strudel-index-before-0005.md` before merging. Main checkout was not edited.
- Read AGENTS, handoff README/INGEST, this Request and its refs (ROADMAP, DECISIONS including D13/D14, PERF), requested feature implementations/callers, and the matching verify blocks. Source/scripts were not edited.
- `npm run handoff:list` shows 0005 open before this answer. `npm run handoff:context` prints branch `codex/youtube-strudel`, HEAD `06a6505`, 74 modules and 251 allowed methods.
- `npm test` exits **0** (log `/tmp/patchboard-0005-tests.log`); `npm run build` exits **0**, writes **83 docs files**. Existing locked dependencies were already installed. The build was a local preview, not a deployment.
- `npm run bench:query` exits **0** (`/tmp/patchboard-0005-bench.log`), independently reproducing an admitted half-second dense query; the dense-Chop median was about **481 ms**, slowest about **572 ms**. Timing values vary by run/machine and are not safety thresholds.
- Independent probes and logs are `/tmp/patchboard-0005-{probes,extra,labels,reuse,share,share-depth13,grabui,scheduling}.mjs` and the corresponding `.log` files. Run each from this worktree with `node --import ./scripts/stub-loader.mjs /tmp/<name>.mjs`; share probes additionally used `--max-old-space-size=256`. All are local tests; none sends board/audio/key data to a service.
- Browser preview ran this worktree's production build on port 4192. It exercised import, Grab, actual Add as Take, playback, disconnection and refreshed Settings counters. No microphone, AI key or external sharing was used. I did not add the lossy dense hit output to the board. Screenshot records the health counters after the dense Grab; playback was stopped afterward.
- The authorized answer commit contains only this handoff. Generated context, build files, experiments and temporary probes are not included. `npm run handoff:check` and `git diff --check` pass after the answer. Request and Disposition are unchanged.

A portable minimal reproduction of the final-Take loss (from this worktree; no temporary probe file needed):

```sh
node --import ./scripts/stub-loader.mjs --input-type=module <<'JS'
import {queryEvents} from './src/snapshot.js';
import {grabFrom} from './src/grab.js';
import {makeNode} from './src/graph.js';
import {cleanParams} from './src/validate.js';
import {compile} from './src/compile.js';
const rec=await queryEvents('$: note("c3 ~").slow(2)',{to:2});
const r=grabFrom(rec,{grid:12}),take=r.take;
const t=makeNode('take',0,0,cleanParams('take',{
  grid:12,bpm:take.bpm,beats:take.beatsPerBar,events:take.events,versions:[]
})),o=makeNode('output',0,0);
const g={v:1,nodes:[t,o],wires:[{
  id:'w',from:{node:t.id,port:'out'},to:{node:o.id,port:'in'}
}]};
console.log('exact',r.takeReport.exactNotes,'captured beats',take.length);
console.log('source',rec.events.map(e=>e.at),
            'written',(await queryEvents(compile(g).code,{to:2})).events.map(e=>e.at));
JS
```

Expected: `exact true captured beats 8`; source `[0/1]`, written `[0/1,1/1]`.

### Risks I see

- A comforting preview/report may lead someone to Bake away a useful generative voice and discover only later that its rest, notes or sample identity changed. The original and undo reduce recovery cost but do not establish fidelity.
- A share confirmation dialog protects board replacement, but cannot protect responsiveness from work done before it exists. Keep resource admission separate from the allow-list's code-shape security role.
- Passing ordinary-song performance runs can hide a different waveform/inspection workload. Correct event counts, completeness and active-read counts must accompany cost results; an incorrect or prematurely capped map is not a successful optimization.

### What I did not check

- No browser Bake action, browser form-map stress series, full published multi-board performance reproduction, audio render/listening parity, long session, physical phone or screen reader. The real browser evidence is the Grab and health-counter sequence above.
- No OOM-size/deep graph bomb execution, exhaustive graph/parser fuzzing, transport limits across messaging apps, corrupted compressed-stream corpus or proof of absence of a JavaScript/security escape. Small expansion examples demonstrate the missing budget without running a destructive case.
- No blanket verification of every shared global hook or every lazy transform. The player-method invariant passed in the targeted test; reused offline results did not. No claim that all current player state is corrupt.
- No prototype, dependency change, main edit, push, deployment, unrelated commit, Script-mode proposal, or co-editing/jam design. The separate untracked music-detector mini-project was left untouched during this review.

Source: written by Codex on 2026-11-26.

## Disposition
<!-- sender: after reading the Response, one line per numbered finding: accepted | rejected | deferred, with the reason and where it went (ROADMAP section, DECISIONS entry, or a task) -->
F1: accepted - not reproduced in a browser by me (I have not re-run the playing-board skipped-note count); the cost is certain from the code and Codex's Node timings (a four-cycle dense read is one uninterruptible block) - Grab, Bake and the form map no longer read by themselves while music plays: the window opens with "Press Read now" (map: "Read the map") and every field change while playing waits for that press; the window text says a read can make a note late; truncation warnings of the record now show in the Grab text. Not done: a cost estimate before the read, a bounded admission policy for dense work, a quiet-player plus disconnected-heavy-tap load in the perf matrix, a worker query realm (research only), and the owner's decision on cached-only x-ray - src/grabui.js, src/main.js (openFormMap). Test: window opens without reading while playing is NOT unit-tested (the stand-in DOM test runs with the player off); needs the browser gate.
F2: accepted - confirmed (depth 13: 15 nodes, 666 link characters, 16,384 writings; 373 ms before the old refusal) - the number of times the compiler would write modules (paths from the Output back, computed on the graph with no compiling) is counted first and `compile()` refuses past 5,000 (so a share link, a patch file and an import all stop at the same place); the share link also catches compiler errors and reports the cables that normalising removes (it used to drop them silently). The limit is a judgement: depth 11 (4,095) still opens. Not done: depth/token budget on single huge modules, an OOM-size run, a corrupted-stream corpus - src/graph.js (`expansionCost`, `MAX_EXPANSION`), src/compile.js, src/share.js. Test: "0005 F2" x2.
F3: accepted - confirmed on all four (trailing rest, 3,072 to 2,000, grid 24 to 12, UI hiding fields) - the Take module now has a `len` (beats; validate.js keeps it, compile.js passes it to the writer) and Grab/Bake set it, so the trailing bar stays and a real replay of the added board matches the source; the report now also compares what the Take module STORES (`cleanTakeEvents`: at most 2,000 notes, thousandths of a beat) against the writer's output, so a capture that would be cut is "not exact" and Add is switched off with an explanation (shorten the span); the "as exact as possible" 24 grid is gone from the window (a Take has 2, 4 or 12), and what is previewed is what is added; the window now shows every loss the report counts (loudness clamped or changed, bad values, frequency overrides, span padding, grid moves, storage) and the record's own warnings; Re-record and restoring an earlier take set `len` to 0 - src/validate.js, src/compile.js, src/events.js, src/grab.js (`lossesOf`), src/grabui.js, src/main.js. Test: "0005 F3" x3 (the replay builds the Take as the app does and plays the compiled board). Bake in the browser not re-run.
F4: accepted - confirmed - a hit keeps its bank (banked hits go on their own lines as .bank("...")), merged attacks, sample numbers that cannot be written (negative, fractional), names with characters that cannot be kept, and any loudness (gain or velocity) are counted and said in the window; hit text now says "starting time only, not how long they last". Not done: keeping duplicate attacks (they are still merged, now said) - src/grab.js. Test: "0005 F4" x2.
F5: accepted - confirmed (12 then 4 attacks) - a reused pattern gets its scheduler-bound methods and its own tempo put back for the read (and the player's restored after), and a reuse object is tied to the code and the evaluator it came from (another code string evaluates afresh) - src/snapshot.js. Test: "0005 F5". The PERF.md line "two evaluations per reading" is stale: it is one evaluation and two queries (corrected).
F6: accepted - confirmed (added c3 to f3 instead of g3 on) - any change to Start, Length or Snap drops the result and turns Add off at once, and the Add handler uses the grid the result was made with - src/grabui.js. Test: "0005 F6" (stand-in DOM).
F7: accepted - confirmed (clip .12345 passed) - the read-back compares start, slot and every control of every attack (numbers to nine places; a pitch is compared exactly, with eb and d# treated as the same note), and a record that was cut or folded cannot give a pass; the label says what was compared - src/evidence.js. Test: "0005 F7". The sample-existence and listening exclusions stay.
F8: accepted in part - confirmed - a voice whose read was cut is marked incomplete (orange outline, a note), the text says "starts notes in cycles" (attacks, not sounding time; a silent or zero-gain note still counts, a long note counts only where it starts) and voices past 24 are counted as not shown. Not done: a separate occupancy metric (not asked for by the owner), per-map time budget - src/formmap.js, src/main.js. Test: "0005 F8" x2.
Direct answers: Q1 yes, now fixed for the cases found and the window lists every counted loss; Q2 expensive work before choosing was real and is capped (no code escape found by Codex); Q3 reads no longer start while playing, but a read the person asks for can still make a note late (not verified in a browser here); Q4 the read-back label was stronger than its check and now compares everything above; Q5 D14 is amended (see DECISIONS D15).
Not done / not verified: no browser run of the Grab, Bake or map playback behaviour after these changes; the x-ray cached-only decision still waits for the owner; no phone, screen-reader or listening checks; `npm test` passes.

