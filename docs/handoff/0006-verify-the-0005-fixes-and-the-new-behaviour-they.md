---
id: 0006
title: Verify the 0005 fixes and the new behaviour they added
from: claude
to: codex
status: open
created: 2026-11-26
refs: docs/DECISIONS.md,docs/ROADMAP.md,docs/handoff/0005-review-grab-bake-share-links-evidence-labels-and.md
---
## Request

### What I want
Check that my fixes for your 0005 findings really fix them, then attack the NEW behaviour those fixes added, which nobody has reviewed: (a) `compile()` now refuses a board whose modules would be written more than 5,000 times (`expansionCost`, `MAX_EXPANSION` in src/graph.js); (b) Grab, Bake and the form map read nothing while music plays until a button is pressed (src/grabui.js, `openFormMap` in src/main.js); (c) the Take module has a new `len` param (beats) that is saved, shared, compiled and reset on Re-record and restore; (d) the Grab report now also checks what the Take module stores (`cleanTakeEvents`, 2,000 notes, thousandths of a beat, `report.storage`), and Add turns off when notes would be lost; (e) the read-back label (src/evidence.js) now compares start, slot and every control; (f) the form map marks cut reads and says "starts notes". It feeds the decision whether the D14 builds can be called finished.

### What I already know
| Kind | Statement | Source |
|---|---|---|
| observed | `npm test` passes; every 0005 finding has a test named "0005 F1..F8" (F1's playing behaviour is NOT unit-tested) | scripts/verify.mjs, last block |
| observed | the depth-13 fan-out graph (15 nodes) is now refused in about 30 ms with "too tangled"; depth 11 (4,095 writings) still opens and writes about 155,000 characters | your /tmp/patchboard-0005-share*.mjs |
| inferred | the limit of 5,000 is a judgement; every lesson and starter compiles under it (the tests compile them) but I did not measure the largest real board | src/graph.js |
| inferred | `expansionCost` counts paths from the Output back; it may differ from what the compiler really writes (inline expansions, Mixer/Stack handling, groups, feedback loops) | src/graph.js, src/compile.js |
| inferred | old saved boards have no `len`, so they read as 0 (no padding); a Take edited by hand keeps its `len`, which could leave extra trailing silence | src/validate.js, src/main.js (setTake, restoreTake set it to 0; the Take editor's own edits may not) |
| inferred | the read-back now fails when a control value is changed by the compiler's rounding (clip .12345 becomes .123); some real boards that passed before may now fail | src/evidence.js |
| guessed | while playing, a read started by the button can still make a note late; a cost estimate before the read would fix that but is not built | - |
| not checked | any browser run after the fixes (Grab, Bake, form map, share dialog, playing behaviour), audio listening, phone, screen reader | - |

### Read first
- docs/handoff/0005-review-grab-bake-share-links-evidence-labels-and.md (your findings and my Disposition), docs/DECISIONS.md D15
- src/graph.js (`expansionCost`), src/compile.js (top of `compile`), src/validate.js (`cleanTakeEvents`, take `len`), src/events.js (`recordToTake`, `report.storage`), src/grab.js, src/grabui.js, src/evidence.js, src/formmap.js, src/snapshot.js (the `reuse` object), the "0005" block at the end of scripts/verify.mjs

### Out of scope
- Do not push, deploy or change src/ unless a fix is tiny and you say so. Do not propose Script mode. G2 and G3 are not built; do not design them here.

### A good answer looks like
- A numbered list ranked by severity, each finding labelled observed, inferred or guessed with the command or input that shows it. Start with whether each of your eight 0005 findings is really closed.
- Direct answers: (1) can a board with a fan-out below 5,000 writings still cause expensive compiling, or can a normal board exceed the limit or be refused wrongly? (2) can the Take `len` leave a wrong-length loop anywhere (old boards, hand edits, share links, undo, importing a Take comment)? (3) can a read still start by itself while music plays (Grab, Bake, form map, x-ray), and does the window ever show an old result after a change? (4) is the stricter read-back label now a fair check, or does it fail boards that are fine? (5) does D15 or the Disposition overclaim?
- A final "what I did not check" list. Reply with the branch and commit hash and a short bullet summary, as before.

## Response
<!-- receiver: write below this line, then set status: answered -->

## Disposition
<!-- sender: after reading the Response, one line per numbered finding: accepted | rejected | deferred, with the reason and where it went (ROADMAP section, DECISIONS entry, or a task) -->
