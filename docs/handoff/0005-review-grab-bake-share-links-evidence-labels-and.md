---
id: 0005
title: Review Grab, Bake, share links, evidence labels and the form map
from: claude
to: codex
status: open
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
<!-- receiver: write below this line, then set status: answered -->

## Disposition
<!-- sender: after reading the Response, one line per numbered finding: accepted | rejected | deferred, with the reason and where it went (ROADMAP section, DECISIONS entry, or a task) -->
