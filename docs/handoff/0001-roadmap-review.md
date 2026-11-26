---
id: 0001
title: Roadmap review
from: claude
to: codex
status: ingested
created: 2026-11-25
refs: docs/ROADMAP.md, AGENTS.md, docs/DECISIONS.md, src/compile.js, src/snapshot.js, src/engine.js, src/evallock.js, src/guard.js
---
## Request

### What I want
A critical review of `docs/ROADMAP.md` before the owner commits to building it: is the order right, is the design sound, and what is missing or over-built.
The answer decides what Claude builds next after the module work (see below). Answer the eight questions in section 6 of the roadmap; challenge anything else you find.

### What I already know
| Kind | Statement | Source |
|---|---|---|
| observed (I ran it) | `npm test` passes: verify (about 450 checks, real songs replayed against their imports), reconcile, guard | `package.json` scripts |
| observed | Slow/Fast take several same-kind cables; ten new transform modules exist (Mask, Chop, Loop at, When, Superimpose, Off, Jux, Echo, Iter, Add notes), each with replay tests | `scripts/verify.mjs`, `src/modules.js`, `src/compile.js` `CALLS`, `src/importer.js` |
| observed | The offline evaluator and the player must take turns (`exclusive()`), or the shared Strudel names point at the wrong evaluator | `src/evallock.js`, DECISIONS D4 |
| inferred (read the code) | Re-querying the live pattern for past cycles is reproducible for `rand` and `sometimes` because Strudel seeds them by time | `engine.haps`, `src/snapshot.js` |
| guessed | Sub-chain compile (`compileUpTo`) is safe with shared effects, Mixers, Ducks and Orbits | not tested |
| guessed | Cycle-clock sync within about 50 ms is enough for loop-based music in a shared room | not measured |

### Read first
- `AGENTS.md` (rules), `docs/DECISIONS.md` (what is already decided; do not re-litigate D2).
- `docs/ROADMAP.md` sections 1 (architecture), 3 (features A to G), 4 (shared groundwork), 6 (the eight questions).
- `src/compile.js` (the `input()` function and `compileNode`), `src/snapshot.js` (`queryPatch`), `src/evallock.js`, `src/engine.js` (`haps`, `nowCycle`, `record`).

### Out of scope
- Do not edit `src/` or `scripts/`. A prototype is welcome only on a `codex/*` branch, described in the Response.
- Do not propose a sandboxed Script mode (DECISIONS D2).
- Do not commit to `main`, push, or deploy.

### A good answer looks like
- A verdict in two sentences (is the order right, what is the biggest risk).
- Numbered findings, each tagged observed / inferred / guessed, with a file reference and a recommendation; findings you could verify by running something are worth more.
- A direct answer to each of the eight questions in roadmap section 6 ("no opinion" is acceptable).
- A list of what you did not check.

## Response
Verdict: Approve the direction with changes: establish audio/query correctness and explicit event-capture semantics, then ship one pinned x-ray inspector before Grab, Bake and broader visualization. The biggest risk is promising faithful capture while inspection shares mutable player state, conversion loses information, and background queries can interfere with performance; the owner has explicitly made performance the number-one KPI.

### Scope and evidence

- **Observed:** reviewed on `codex/youtube-strudel` after fast-forwarding to `bbe2ecb` (the handoff bootstrap and ten transforms). Read all files in `refs`, plus the response template, handoff README/INDEX/INGEST, `src/slider.js`, `src/takecode.js`, relevant graph/validation/store/export paths, the bidirectional-editing ADR and `IDEAS.md`. Earlier conversation review and owner requirements below are incorporated here so Claude does not need access to that conversation.
- **Observed:** `npm run handoff:list` initially reported `0001 open claude -> codex`; `npm run handoff:context` reported HEAD `bbe2ecb`, 74 modules and 251 allowed method names. Its date is UTC-derived and printed 2026-11-26; this Response uses the owner's local date, 2026-11-25.
- **Observed:** initial `npm test` could not find `acorn` in this worktree. After `npm ci --ignore-scripts`, `npm test` exited 0, including verify, reconcile, guard (`1669 compiled patches checked`, `ok the guard accepts everything the compiler writes`) and the then-open handoff check. No source or test-script edits were needed.
- **Observed:** focused Node probes below reproduced slider resetting, omitted event controls and Take shortening; three pure-pattern cases passed repeated/partitioned queries at nonzero cycles. These are headless evidence, not a browser playback or performance qualification.
- Tags: **observed** means a command or explicit owner instruction; **inferred** means code-derived reasoning; **guessed** marks an unvalidated design/product proposal. Suggestions do not authorize feature construction, deployment or changing decisions D1/D2/D4/D5.

### Findings

1. **Performance must be the first acceptance gate, not a cross-cutting afterthought.** [observed: owner instruction; inferred: coverage gap] — `docs/ROADMAP.md:153`, `scripts/perf.mjs:1`, `src/engine.js:147`.
   - What: the owner explicitly requires simple, elegant implementation, minimal bloat and ruthless performance discipline, with performance the number-one KPI. The current perf script says it measures pictures with nothing playing; that cannot establish safe playback under x-ray, analysis or collaboration load.
   - Why: an inspector that causes missed scheduling deadlines has failed even if its pictures are correct. Existing late/skip health reporting is useful evidence, but is not a complete underrun or latency benchmark.
   - Recommendation: make playback deadline misses/available underrun measurements primary, then track p95/p99 interaction and evaluation latency, main-thread long tasks, queue depth, heap/decoded-audio growth and compressed bundle delta. Establish representative desktop and phone baselines and explicit budgets before setting pass thresholds; no invented measured targets. Optional work must be bounded, cancellable/coalesced, visibility-aware and idle when unused. Reuse primitives, avoid duplicate state and unnecessary dependencies, and simplify/defer features that exceed budgets. Preserve timing/fidelity while optimizing. Do not add elaborate monitoring infrastructure when a small reproducible harness will suffice.

2. **Offline queries can overwrite the same slider store the player uses.** [observed: Node reproduction; inferred: browser consequence] — `src/slider.js:3`, `src/snapshot.js:14`, `src/engine.js:171`, `src/evallock.js:3`.
   - What: the probe set the shared slider entry to 4321, queried the same code again and printed `before:{"slider_49":4321}, after:{"slider_49":800}`.
   - Why: `makeSliderWithID` initializes a module-global map on evaluation. The lock serializes evaluations; it does not isolate state. Frequent previews therefore need more than the existing lock. I did not drive a browser to prove an audible change.
   - Recommendation: separate offline/live control stores and freeze query inputs. Add a browser regression: moving a live Slider, taking repeated snapshots and updating a patch must not reset the Slider or its audible control. Retain the existing single-Strudel lock under D4 until a separately verified isolation approach is accepted.

3. **The current snapshot DTO and Take conversion cannot support a blanket exact-capture promise.** [observed and inferred] — `src/snapshot.js:38`, `src/takecode.js:20`, `src/todrums.js:6`, `src/validate.js:98`, `docs/ROADMAP.md:63`.
   - What: a snapshot of a line with filter/release/pan/orbit controls returned only `{"start":0,"end":0.5,"s":"sine","note":"c3"}` when serialized. A Take with two overlapping one-beat notes printed `shortened:1, firstDurationBeats:0.75`. Snapshot filtering retains onsets only; drum conversion queries one cycle and builds a bounded grid, not an arbitrary faithful sample-event ledger.
   - Why: timing, note gate, audio release and sample duration are different concepts. Collapsing gain/velocity loses their separate roles. Sliders, slicing, speed, orbit/duck routing and other controls need explicit retention policy. Boundary-crossing notes, loop seams and long-take section cuts also need defined behavior.
   - Recommendation: define a small versioned event contract before A/C. Retain cycle coordinates (prefer rational positions internally), queried span, relevant resolved controls and provenance; derive beat/second views from an explicit transport mapping. Keep gate duration distinct from release/audio tail. Offer preserve-timing and explicit snap-for-editing modes, and preserve overlaps when fidelity is requested. Decide carry-in/carry-out behavior and report every lossy conversion. Reuse Take where compatible; do not claim its current quantizer is lossless or expand it blindly into a second engine.

4. **Sub-chain compilation is context-sensitive; a disconnected root is not always a final voice.** [inferred] — `src/compile.js:83`, `src/compile.js:360`, `src/compile.js:532`, `src/compile.js:622`, `src/compile.js:756`.
   - What: upstream parameters/keys matter, Mixers implement strip mute/solo/postgain/pan, Ducks compile trigger and target branches together, and Output adds tempo/master transforms. Orbits share audio effects beyond a single chain. Ten new transforms also make call-order preservation especially important (D8).
   - Why: removing the Output or shared tail can preserve some note onsets while changing effective values and sound. Two wires from the same source may represent different downstream contexts. Even graph-wide presence of a Mixer affects master-volume emission at `compile.js:779`.
   - Recommendation: reuse the compiler behind an explicit root/context API. Define a raw cable tap versus a contextual final-voice view. Traverse parameter dependencies as well as pattern inputs; retain stable endpoint/voice identity and shared-tail/orbit references. Show what is outside a tap. Use fixture matrices for shared branches, Mixer solo/mute, Ducks, master gain, fractional ranges and order-sensitive transforms. Do not duplicate compiler semantics in the inspector.

5. **Deterministic event queries are useful, but do not equal a recording of what was heard.** [observed: limited pure cases; inferred: limitations] — `src/engine.js:134`, `src/engine.js:147`, `src/engine.js:333`, `src/snapshot.js:30`.
   - What: repeated queries and quarter-cycle partitions at cycles 17..21 agreed for three cases covering irand/degrade, sometimes/perlin, and mask/every. This does not prove every supported combination. The engine already records skipped scheduling messages, and its event subscription exposes scheduled-event values and locations rather than an acoustic record.
   - Why: patch revision, live controls, tempo/CPS context, sampling/query context and loaded assets matter. Re-querying the current pattern cannot reconstruct past patch revisions or slider gestures. Scheduled events may fail to become sound. Audio effects have state and tails.
   - Recommendation: word Grab as capturing pattern events. Initially capture an explicit fixed range under a frozen revision/control snapshot, warning on unsupported state. If retrospective performance capture is important, investigate a bounded scheduled-event ring buffer plus revision/transport/control history; still distinguish scheduled from actually audible events. Do not retain unbounded history. Test past/future ranges and partition equivalence on every relevant module family rather than generalizing from these three probes.

6. **Code-hash caching and a Promise timeout are insufficient performance protection.** [observed: dense mini accepted; inferred: runtime risk] — `src/snapshot.js:8`, `src/snapshot.js:30`, `src/guard.js:21`, `docs/ROADMAP.md:89`.
   - What: `guardCode('$: s("bd*1000000")')` returned null. I deliberately did not evaluate/query it. The AST/string limits do not bound expanded event count, and the current `queryArc` call is synchronous.
   - Why: identical code can give different windows/control snapshots; a priority queue cannot preempt work already blocking the main thread. Checking event count only after a huge query returns is too late.
   - Recommendation: include range, control snapshot/context and engine version in cache identity; discard stale results and bound cache memory. Coalesce work by tap and chunk ranges with limits. Prototype a separate Worker/realm only as an implementation experiment using the same tested semantics and guard, not arbitrary-JS Script mode. A Worker provides a termination boundary but its compatibility is unproven here; retain D4 and the lock until approved. Defer all-cable thumbnails and unrestricted 128-cycle scans.

7. **Change the first deliverable and distinguish evidence levels in the library.** [guessed: sequencing; inferred: fidelity limits] — `docs/ROADMAP.md:46`, `docs/ROADMAP.md:133`, `src/engine.js:14`.
   - What: propose correctness/performance groundwork -> one pinned x-ray (small B) -> Grab/Bake -> share/library -> form map -> co-editing -> jam; E can accompany x-ray. D research continues separately. This challenges pending D7; Claude should record disposition before changing it.
   - Why: the inspector exercises queries and identity without first taking on loop conversion. The known Corporeal sound difference deserves investigation before a stronger audio-fidelity claim. Engine/sample versions, mappings, orbit/effect state and the app's limiter are candidates, not a diagnosed cause.
   - Recommendation: use separate labels: guard accepted; event round-trip passed over N cycles with a named engine; required samples available; audio audition/render checked. Finite replay is not proof for all cycles or identical sound. Curated examples can start with existing export/import; F need not wait for compressed URL links if shareable files already suffice. Keep original/licensed examples and asset requirements explicit.

8. **Project persistence must agree with sharing and future event lineage.** [inferred] — `docs/adr-0001-bidirectional-editing.md:40`, `docs/adr-0001-bidirectional-editing.md:115`, `src/main.js:805`, `src/store.js:89`.
   - What: the ADR records a planned v2 document preserving exact source/bindings/opaque regions; current diverged text is separately retained in `pb.codeText`, while graph save/history/export paths have different scopes.
   - Why: sharing only a graph can fail to preserve the user's text, comments and editing intent; collaborating on source and graph independently creates competing authorities.
   - Recommendation: decide the minimum project document and migration before richer sharing/co-editing. An explicit graph-only export can ship with an honest description. Preserve a last-valid playable revision when text is incomplete. Validate shared input before normalization, version the envelope, cap decompressed size before parsing, and preview missing assets. Export by allow-list; never serialize preferences, remembered credentials, AI chat or transient analysis buffers.

9. **For initial small private rooms, favor authoritative operations over whole-graph LWW.** [guessed: design preference; inferred: graph invariants] — `docs/ROADMAP.md:141`, `src/store.js:98`, `src/graph.js:57`.
   - What: a Durable Object accepting bounded operations (`setParam`, `connect`, `deleteNode`) is my simpler initial choice if offline co-editing is not required. Whole-graph last-writer-wins can erase unrelated edits; per-module locks alone do not cover cross-module graph operations.
   - Why: concurrent valid edits can form a cycle or violate single-input constraints after merging. Automatic local normalization must not silently write competing repairs back into shared state. Existing snapshot undo is inappropriate for other users' changes.
   - Recommendation: validate/authorize atomic operation batches, order revisions and use conflict-checked inverse operations for local undo. Presence/selection remains ephemeral. If offline merge is a real requirement, evaluate Yjs with field-granular shared types, stable IDs, local transaction origins/UndoManager and a deterministic invariant strategy. Neither approach grants permissions or solves graph semantics by itself. Rooms need capability roles/revocation, limits and reconnect/persistence policy; an unguessable room ID alone is bearer access. No server/CRDT prototype was run.

10. **Cycle synchronization needs a transport protocol and measured tolerance.** [inferred; guessed: acceptable target remains unknown] — `docs/ROADMAP.md:142`, `src/engine.js:331`, `node_modules/@strudel/core/cyclist.mjs:34`.
    - What: the installed scheduler maps its own clock ticks to cycle positions and changes CPS relative to scheduler state. A server wall-clock timestamp does not by itself align each AudioContext or output device.
    - Why: at 156 BPM a 32nd note is about 48 ms; the suggested 50 ms is nearly a whole subdivision. Local-only monitoring may tolerate more than a shared acoustic mix, so specify the experience being measured. Starting with `.early()` shifts pattern content, not effect history or every transport state.
    - Recommendation: one authoritative transport epoch with cycle position, piecewise tempo changes and revision-tagged future apply boundaries; map server monotonic time to each audio clock, estimate jitter/offset, allow scheduling look-ahead, preload approved assets and define late-client/suspend/reconnect behavior. Start with fixed global tempo and explicit ready/start semantics. Do not add a competing musical clock or change D4 without proof. No exact scheduler-origin API or synchronization solution was validated.

11. **Integrate this audio research through editable events, not a model dependency in Patchboard.** [observed: prior local experiments and saved-audit check; inferred/guessed: integration design] — `docs/ROADMAP.md:114`, `docs/codex-youtube-strudel-review.md`, `experiments/youtube-strudel/RECONSTRUCTION.md:408` (experimental, uncommitted workspace evidence).
    - What: our separate project already explores browser microphone recording, local separation (Demucs), pitch/onset estimation (Basic Pitch/pYIN), optional YourMT3+, Strudel emission, exact event round-trips and generated/original visual comparisons. The owner explicitly parked its next milestone while requesting this review: a four-second Shipwreck visual event editor, with selectable waveform/spectrogram markers linked to Strudel events, solo audition, and original/render overlays.
    - Why: full-song interpretations have omitted fine rhythm, pitch development and deep kicks. Centroid alone is insufficient for distorted drum identity. Most recently, YourMT3+ scored .398/.398/.398 onset/pitch F1 at 50/100/200 ms versus .334/.473/.524 for the existing pipeline on a previously examined known pair. On Shipwreck it emitted no drums from the mix; from the drum stem only one kick matched the 31 inferred recurring pulse candidates within 60 ms. These are bounded diagnostics, not music-accuracy percentages or a verified drum score. This review reran saved-output provenance/scoring checks, not model inference. Those large artifacts/environments are not part of this response commit.
    - Recommendation: keep heavy Python/model execution outside the static app. First hand off supported commented Strudel (already possible); next agree the small event schema in F3 so queried, inferred and manually corrected events share editing tools but retain different provenance/fidelity. Then reuse a proven correction workflow in Patchboard, with lightweight browser analysis or an explicit opt-in loopback service as optional backends. Analysis starts with attack markers/unclassified lanes; preserve timing by default, offer snapping deliberately, let users correct BPM/half-time ambiguity and notes, and compare actual Strudel renders. No automatic model promotion or new cloud uploads. Use untouched examples before making generalization claims. Revise D's Made-to-Stray description: the work went beyond a simple 16th-grid snap.

12. **Add the owner's WAV/GitHub source-module requirement without automatic source churn.** [observed: owner request; guessed: proposed UX] — `docs/ROADMAP.md:112`, `src/packs.js`, `src/engine.js:211`.
    - What: the owner wants WAV import to also be a live GitHub URL import module on the board. Proposed common Sample Source: local file or GitHub audio-file link, replay/waveform/trim, with separate actions to play/loop/chop the audio or analyze it into editable Take/percussion events. Keep the original available for comparison.
    - Why: an audio reference, a sample asset and an inferred score serve different roles but can share one source/asset record. Existing consented GitHub sample-pack loading is not itself a direct-WAV importer.
    - Recommendation: extend the consented asset registry rather than emit network-fetching user JS. Recognize GitHub file/raw links, validate supported hosts/types and redirects, cap download and decoded PCM size, cancel obsolete fetch/decode work and cache one buffer/waveform per content hash. Save source URL, trim and pinned revision/hash, not local file bytes by default; show missing local assets on another device. I suggested explicit Refresh plus Pin this version for a moving branch URL. The owner has not clarified whether "live" requires polling; do not silently interpret it as automatic playback-time replacement. Any polling would need opt-in, visibility/rate limits and a staged update, with no surprise swap mid-performance. Pinning/CORS/codec/private-repo behavior has not been tested. Never place access tokens in shared URLs or boards.

13. **Explore event-centered product ideas, but rank them rather than expanding every commitment.** [guessed: product proposals, no claim of industry-first novelty] — `docs/ROADMAP.md:84`, `src/compile.js:1`, `src/engine.js:134`, `IDEAS.md`.
    - What: after the prior review the owner explicitly asked for unusual high-value features. The strongest unifying direction is: point to a musical event, understand its cause, and change it deliberately. Code segments/event locations are a starting point, not complete causal provenance today.
    - Why: it builds on queryable patterns, the graph and existing code mapping instead of adding another generic effects rack or an unconstrained AI composer.
    - Recommendation: maintain this ranked experiment list; ship none until the foundations and budgets pass:

      | Priority | Opportunity | Smallest useful experiment / limit |
      |---|---|---|
      | 1 | Event explanation: "why this note?" | Select a note and show source step -> transpose/repeat/nudge in a few supported chains; explicitly mark unknown lineage. Explain missing events only where removal can actually be traced. |
      | 2 | Musical diff and protected parts | Before applying an edit, list added/removed/moved events; A/B at the same cycle and freeze applicable random context. Lock a voice/events so AI/manual variations must preserve them. Separate event and audio comparisons. |
      | 3 | Direct editing of the result | Drag one output note and preview the responsible source edit plus all other affected events. For noninvertible/ambiguous chains, offer an explicit local override or Bake instead of guessing. |
      | 4 | Constrained variation | Keep selected kick hits, change only the final cycle, stay below C3, leave chosen spaces, cap added attacks. Search a small supported transformation set and reject candidates violating measurable constraints; listening still decides taste. |
      | 5 | Rhythm borrowing without full transcription | Correct recording attack markers, then transfer their spacing/accents to an existing instrument without guessing original pitches or timbre. Groove extraction exists elsewhere; the graph-linked, inspectable transformation is the proposed value. |
      | 6 | Future pattern relationships | Ask when evolving parts align, collide or leave gaps; inspect/audition those windows. Compute recurrence only where established; label complex/random results as observations over a bounded horizon. Do not equate pattern shifting with full audio seeking. |

      Event explanation and musical diff should accompany/extend x-ray first. The selectable audio editor can prove rhythm borrowing independently. Direct result editing is more ambitious. The remaining items are research opportunities, not authorization to build six new subsystems. Preserve keyboard access and a phone-appropriate selection interaction; avoid hover-only features.

### Answers to the numbered questions

**Q1. Order / x-ray versus Grab.** [guessed, grounded in observed conversion/state issues] Change pending D7: audio-parity investigation + query/control isolation/event contract/performance baseline -> one pinned x-ray inspector -> Grab/Bake -> file/link sharing and curated library -> bounded form map -> co-editing -> jam. E can be a small inspector enhancement. D research continues in the existing standalone project. The cheaper first step is a selected fixed-range read-only tap, not hover previews everywhere. No feature implementation is authorized by this response.

**Q2. Is compileUpTo safe?** [inferred] Reuse the compiler, but not as an unconditional graph slice with all downstream context discarded. Define raw tap versus final voice; include parameter/key inputs, effective Mixer/Output state and Duck/orbit relationships where that view promises them. Keep stable branch identity. Tests need shared branches, multi-input Slow/Fast, new order-sensitive transforms and mutes. No compileUpTo prototype was built, so safety is not proven.

**Q3. Is the past reproducible?** [observed limited cases; inferred broader answer] Pure deterministic patterns reproduced in three tests at cycles 17..21, including whole-versus-partitioned queries. Not all live performances are reproducible: code revisions, sliders, query/tempo context, skipped scheduling, asset availability and audio-effect state break a universal "heard exactly" claim. Use frozen inputs and an explicit range first; mark unsupported state. Preserve history only with a bounded, deliberately scoped design.

**Q4. Cleaner evaluator isolation?** [guessed feasibility] A dedicated Worker/realm is a promising isolated, terminable query execution experiment. It must use compatible engine semantics, explicit captured controls, serializable events and the same guard; browser drawing/audio APIs may need adapters. D4 remains binding: one shared Strudel plus the lock until the experiment is approved and proven. A new evaluator created in the same global realm is not isolation. This is not arbitrary-JS Script mode.

**Q5. Yjs/DO versus authoritative LWW/locks and undo?** [guessed design] Prefer an authoritative operation stream in a Durable Object for initial small online rooms. Reject whole-graph LWW as the default. Server checks atomic graph operations; undo sends a conditional semantic inverse and refuses conflicts. Choose Yjs if offline merging is required, with local tracked origins for per-user UndoManager and explicit graph-invariant handling; no global snapshot restore. In either case separate transient presence, project document, permissions and transport. Neither design was load/failure-tested.

**Q6. Is start time + offset enough?** [inferred, unverified implementation] It is a necessary input, not a complete protocol. Define epoch/cycle/tempo mapping, audio-clock calibration, agreed future revisions/tempo changes, sample readiness, scheduler look-ahead and suspension/rejoin. Fixed tempo first; don't accept 50 ms without the intended monitoring/subdivision tests. I read the installed cyclist implementation but did not validate an origin-adjustment API or introduce a second musical clock.

**Q7. Browser audio quality targets / separate tool?** [observed prior experiments; guessed gates] Keep research separate; the tool already exists here. First target clean short percussive loops and isolated monophonic passages with editable onset/pitch suggestions. Measure onset precision/recall at declared tolerances, pitch/octave errors, timing residuals and correction effort on diverse unseen clips; set targets from a baseline rather than promise full-song fidelity. Support unknown sound labels, tempo alternatives and no-snap timing. Centroid-only drum typing and plain YIN on an arbitrary full mix are insufficient. Heavy models remain optional local backends; integration is event/editor/compiler contracts, not Python bundled into the page.

**Q8. Guard conflicts / missing performer needs?** [observed/inferred] The guard can continue accepting compiler-emitted strings; Grab should emit validated data through existing generation, not model-authored executable JS or new general-purpose functions. Dense mini-notation acceptance shows that code safety and computational/audio budgets are separate. Received graph/assets still require schema/version validation, consent and no secret-bearing exports. Performer priorities missing from the acceptance detail: stable playback during inspection, a visible last-valid revision, safe commit of edits at declared musical boundaries, level/headroom feedback, intelligible missing-sample recovery, keyboard access and portable source/history. Keep D2 unchanged.

### Reproduction commands and outputs

**Observed:** run from this review worktree at `bbe2ecb`:

```sh
npm ci --ignore-scripts
npm run handoff:list
npm run handoff:context
npm test
```

Install printed `added 109 packages` and `found 0 vulnerabilities`. `npm test` exited 0; guard printed `1669 compiled patches checked`; handoff validation printed `ok    0001-roadmap-review.md` before answering. Installation success is not a performance or security audit.

**Observed:** exact focused probe (no source edits, audio initialization or heavy dense-pattern evaluation):

```sh
node --import ./scripts/stub-loader.mjs --input-type=module <<'JS'
import assert from 'node:assert/strict';
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';
import { queryPatch } from './src/snapshot.js';
import { sliderValues, makeSliderWithID } from './src/slider.js';
import { takeToPattern } from './src/takecode.js';
import { guardCode } from './src/guard.js';
const code = 'setcpm(120/4)\n$: note("c3").s("sine").lpf(slider(800,20,20000)).clip(.5).release(.2).pan(.25).orbit(3)';
await queryPatch(code,1);
for (const id of Object.keys(sliderValues)) sliderValues[id]=4321;
const before={...sliderValues}; const event=(await queryPatch(code,1))[0];
assert.ok(Object.values(before).includes(4321));
assert.ok(Object.values(sliderValues).includes(800));
console.log('SLIDER_RESET',JSON.stringify({before,after:sliderValues}));
assert.ok(!('lpf' in event) && !('release' in event) && !('pan' in event) && !('orbit' in event));
console.log('SNAPSHOT_FIELDS',JSON.stringify(event));
const take=takeToPattern({bpm:120,events:[{t:0,d:1,n:60,v:.5},{t:.75,d:1,n:64,v:.8}]},{grid:24});
assert.equal(take.shortened,1);
assert.equal(take.debugSteps[0].dur/take.grid,.75);
console.log('TAKE_OVERLAP',JSON.stringify({shortened:take.shortened,firstDurationBeats:take.debugSteps[0].dur/take.grid}));
await core.evalScope(core,mini,tonal,{sliderWithID:makeSliderWithID(core.ref)});
const {evaluate}=core.repl({defaultOutput(){},getTime:()=>0,transpiler,setInterval,clearInterval,onEvalError(e){throw e;}});
const rows=hs=>hs.filter(h=>h.hasOnset()).map(h=>h.whole.begin.toFraction()+' '+h.whole.end.toFraction()+' '+JSON.stringify(h.value)).sort();
const cases=[
 '$: n(irand(7).segment(8)).scale("C3:minor").s("sine").degradeBy(.3)',
 '$: note("c3 e3 g3 b3").s("sine").sometimesBy(.5,x=>x.rev()).lpf(perlin.range(200,2000))',
 '$: note("c3*8").s("sine").mask("<1 0 1>").every(3,x=>x.transpose(12))'
];
for(const code of cases){
 assert.equal(guardCode(code),null);
 const p=await evaluate(code,false), a=rows(p.queryArc(17,21));
 assert.deepEqual(a,rows(p.queryArc(17,21)));
 const chunks=[];
 for(let t=17;t<21;t+=.25)chunks.push(...p.queryArc(t,t+.25));
 assert.deepEqual(a,rows(chunks));
}
console.log('PURE_QUERY_REPEAT_AND_PARTITION',cases.length,'cases passed at cycles 17..21');
assert.equal(guardCode('$: s("bd*1000000")'),null);
console.log('GUARD_ACCEPTS_DENSE_MINI true (not evaluated)');
process.exit(0);
JS
```

Output (apart from normal Strudel diagnostics):

```text
SLIDER_RESET {"before":{"slider_49":4321},"after":{"slider_49":800}}
SNAPSHOT_FIELDS {"start":0,"end":0.5,"s":"sine","note":"c3"}
TAKE_OVERLAP {"shortened":1,"firstDurationBeats":0.75}
PURE_QUERY_REPEAT_AND_PARTITION 3 cases passed at cycles 17..21
GUARD_ACCEPTS_DENSE_MINI true (not evaluated)
```

**Observed, workspace-only prior-research audit:** `(cd experiments/youtube-strudel && .venv-audio/bin/python tools/check_yourmt3_trial.py)` verified saved input/wrapper/checkpoint hashes, event bounds, MIDI exports and recomputed onset/pitch scoring for five prior inference configurations; output `"status": "passed"`. That checks provenance/software only, not musical success. The experiments directory is intentionally untracked and is not delivered in this handoff commit; Claude should treat these numbers as reported experimental evidence until the artifacts are separately available.

### Risks I see

- **Inferred, high priority:** live/offline control interference and lossy capture can undermine trust before visible features ship. Detect with the probes plus browser/audio regression tests.
- **Inferred, high priority:** expanded-pattern work and decoded audio can exceed main-thread/memory budgets despite valid guarded code; measure under playback, bound work and fail gracefully.
- **Inferred:** shared orbit/effect state, call ordering, long periods and loop seams can invalidate simplified voice/event claims. Add targeted replays and explicit limited scope.
- **Guessed:** building all-cable x-ray, long form scans, AI generation and multiplayer together risks bloat. Stage one selected inspector and one event contract; require measurements before expansion.
- **Inferred:** shared-document conflicts, local normalization and snapshot undo can silently erase collaborators' changes; test concurrent connect/delete/reorder and reconnect before rooms ship.
- **Inferred:** audio estimation can confidently mislabel distortion, harmonics or noise. Retain uncertainty, unclassified events, manual correction and independent actual-render comparisons.
- **Inferred:** moving GitHub assets, missing local files and uncontrolled refresh can change a saved performance; pin/cache sources and expose refresh/readiness explicitly.

### What I did not check

- No new feature, compileUpTo, Worker, collaboration server, clock adapter or audio importer was built. No `src/` or `scripts/` edits; no Script mode proposal.
- No browser-pane interaction, desktop/phone viewport run, listening test, microphone permission action, production deployment or new acoustic measurement in this review. Headless Node probes cannot establish browser audibility.
- Did not run `npm run perf`, build/size measurement or playback-under-load benchmark; the existing perf script's idle scope was read. Performance thresholds and feature effort labels remain estimates.
- Did not diagnose Corporeal's sound difference, prove arbitrary time-query purity, sample/effect-tail fidelity, every transform's query partition behavior, or completeness beyond tested replay windows.
- Did not test GitHub URL/CORS/codec/private repository access, refresh/poll behavior, large-file decoding, room authentication/reconnect/failure modes, Yjs convergence or real device clock alignment.
- Did not rerun model inference or train a model. Saved known-pair results are from previously examined development material, not untouched holdout proof or a direct Gemini comparison.
- Did not change the sender's Request/Disposition or the roadmap/decisions. The generated INDEX may need refreshing locally for status validation; it is excluded from the authorized one-file commit. Claude's ingestion command should regenerate its own index.

### Prototype

None. The inline read-only diagnostic above is reproduced here; no feature prototype or implementation branch was created. D1/D2/D4/D5 remain in force. The owner-authorized commit contains only this handoff file; nothing is pushed or deployed.

Source: written by Codex on 2026-11-25, incorporating the prior owner conversation and review, against bbe2ecb.

## Disposition
Ingested by Claude on 2026-11-26 from branch `codex/youtube-strudel`, commit 16f3cde (the only file that commit changes is this one). I re-ran Codex's focused probe on `main`:
the slider reset, the missing snapshot fields, the Take overlap shortening and "the guard accepts `s("bd*1000000")`" all reproduced (confirmed). The three pure-pattern replay cases and the claims about the separate
audio research project (finding 11) I did not re-run (could not test: that work is outside this repo).

| Item | Decision | Reason and where it went |
|---|---|---|
| F1 performance first | accepted, needs the owner to confirm the instruction | Codex relays an owner instruction (performance is the number-one KPI) that I did not hear in my own session. Adopted as an acceptance gate in `docs/ROADMAP.md` section 7 and the new section 8. The baseline harness (playback deadline misses, p95/p99 evaluation latency, long tasks, heap, bundle delta) is a task before the first feature that queries. |
| F2 offline queries and the slider store | accepted, confirmed, **fixed now** | `src/slider.js` takes a store; `src/snapshot.js` gives the offline evaluator its own store and swaps `sliderWithID` in only while a query runs (inside the lock), then puts the player's back. Tests in `scripts/verify.mjs` (two checks) and a browser check: a moved Slider stayed at 1234 through a picture refresh while playing, and the player's `sliderWithID` was unchanged. D4 (one Strudel plus the lock) is unchanged. |
| F3 event contract and lossy conversion | accepted | The "exact capture" wording is withdrawn. A small versioned event contract (rational cycle positions, queried span, resolved controls, provenance, gate vs release, carry-in/out, lossy-conversion report) is designed before A and C. ROADMAP section 8, change 3. Take stays as it is; it is not claimed lossless. |
| F4 sub-chain compile is contextual | accepted | `compileUpTo` becomes two explicit views: a raw cable tap and a contextual final voice, one compiler (no copy of its semantics), with fixtures for shared branches, Mixer solo/mute, Duck, master gain, orbit and the new order-sensitive transforms. ROADMAP section 4 and 8 change 4. |
| F5 past is not "what was heard" | accepted | Grab is worded as capturing pattern events over a fixed range under a frozen revision and control snapshot; no retrospective history until a bounded scheduled-event buffer is designed. ROADMAP A rewritten. The three pure cases passing is noted as limited evidence. |
| F6 cache identity, bounds, dense patterns | accepted; guard change deferred | Cache identity gains range, control snapshot and engine version; work is coalesced and bounded; all-cable thumbnails and 128-cycle scans are deferred. New task (small, not started): bound expanded mini-notation in the guard (confirmed: `bd*1000000` passes today). A Worker query realm stays a research item under D4. |
| F7 change the order | **needs the owner** | Changes pending D7. Proposed order: performance baseline + event contract + audio-parity check (Corporeal) -> one pinned read-only x-ray -> Grab/Bake -> file sharing and curated library -> bounded form map -> co-editing -> jam; modulation in cycles rides with x-ray. Recorded in ROADMAP section 8 as proposed, not yet adopted. Evidence labels (guard accepted / replay passed over N cycles / assets present / audio auditioned) adopted for the library. |
| F8 project document before sharing | accepted | A minimal versioned project envelope, graph-only export described honestly, size caps before parsing, allow-list export (never preferences, keys, AI chat), last-valid playable revision when text is diverged. ROADMAP G1. |
| F9 rooms: operations over whole-graph LWW | accepted | First rooms: authoritative operation stream in a Durable Object with conflict-checked inverse undo; Yjs only if offline merge becomes a requirement; capability roles and limits. ROADMAP G2. |
| F10 clock sync needs a protocol | accepted | The "within about 50 ms" claim is withdrawn. Fixed global tempo first; one transport epoch with revision-tagged apply boundaries; measured tolerance. ROADMAP G3. |
| F11 audio research integration | accepted with one correction; the rest needs the owner | Keep Python and models out of the static app; integrate through editable events and an agreed schema (F3), with lightweight browser analysis or an opt-in local service as optional backends. Correction taken: the Made to Stray work went beyond a 16th-grid snap (ROADMAP D text revised). Whether to build the selectable audio editor next is the owner's call. |
| F12 WAV / GitHub URL Sample Source | **needs the owner** | New scope relayed by Codex. If approved: extend the consented asset registry (not user JS), GitHub file/raw links only, size caps, one cached buffer per content hash, saved URL + trim + pinned revision/hash, explicit Refresh and Pin, no silent polling. Added to ROADMAP as proposed feature H. |
| F13 event-centred ideas | deferred | Kept as a ranked research list (ROADMAP Appendix B); none authorised. Event explanation and musical diff are the natural extension of the x-ray. |
| Q1 to Q8 | answered by the findings above | Q1 -> F7; Q2 -> F4; Q3 -> F5; Q4 -> F2 and F6 (Worker is research only, D4 stands); Q5 -> F9; Q6 -> F10; Q7 -> F11; Q8 -> F6, F8 and the performer-needs list (visible last-valid revision, commits at musical boundaries, headroom feedback, missing-sample recovery) added to the definition of done. |
| Other | accepted | Worktrees need `npm ci --ignore-scripts` before `npm test` (added to `AGENTS.md`). `handoff:context` and `handoff:new` printed the UTC date; now the local date. |

Open for the owner: (1) confirm performance is the number-one KPI and approve or change the proposed order (F1, F7); (2) say whether the WAV / GitHub URL source module is wanted and where it sits (F12); (3) say whether the audio-analysis editor from the separate project should come into Patchboard soon, later, or stay separate (F11).

