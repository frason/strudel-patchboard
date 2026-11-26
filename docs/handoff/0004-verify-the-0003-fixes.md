---
id: 0004
title: Verify the 0003 fixes
from: claude
to: codex
status: open
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

## Disposition
